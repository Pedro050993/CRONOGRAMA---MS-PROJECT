import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importProductivityRows, supportFor, type ProductivityBasis } from '@cronograma/core';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/http.js';
import { enqueue } from '../lib/queue.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';
import { parseDelimited, parseXlsx, pickSheet } from '../lib/tabular.js';
import { contentKey, sha256, storage } from '../storage/index.js';

const idParam = z.object({ id: z.string() });

const BASIS = ['BUDGETED', 'PLANNED', 'OBSERVED', 'FORECAST'] as const;

/** Formatos que este importador lê hoje. PDF vai para o worker. */
const DELIMITED = new Set(['csv', 'tsv', 'txt']);
const SPREADSHEET = new Set(['xlsx', 'xlsm']);

export async function registerProductivityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Importa a base de produtividade de um arquivo (§ D6).
   *
   * O arquivo original é armazenado e passa a SER a fonte do índice: cada índice
   * guarda nome, hash, aba e linha de onde saiu. Nada entra aprovado.
   */
  app.post('/api/projects/:id/productivity/imports', async (req, reply) => {
    const u = currentUser(req);
    const { id: projectId } = idParam.parse(req.params);
    await requireCapability(u.id, projectId, 'schedule.write');

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = 'application/octet-stream';
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[String(part.fieldname)] = String(part.value);
        continue;
      }
      fileBuffer = await part.toBuffer();
      fileName = part.filename ?? 'base-produtividade';
      mimeType = part.mimetype;
    }
    if (!fileBuffer) throw badRequest('Envie o arquivo da base de produtividade no campo "file".');

    const declaredBasis = fields['declaredBasis'];
    if (declaredBasis && !BASIS.includes(declaredBasis as ProductivityBasis)) {
      throw badRequest(`Base "${declaredBasis}" invalida. Use uma de: ${BASIS.join(', ')}.`);
    }
    const declaredSourceDate = fields['declaredSourceDate'];
    if (declaredSourceDate && !/^\d{4}-\d{2}-\d{2}$/.test(declaredSourceDate)) {
      throw badRequest('A data declarada deve estar no formato AAAA-MM-DD.');
    }

    const hash = sha256(fileBuffer);
    const extension = (fileName.split('.').pop() ?? '').toLowerCase();
    const key = contentKey(projectId, hash, fileName).replace('/originals/', '/productivity/');
    if (!(await storage().exists(key))) await storage().put(key, fileBuffer, mimeType);

    const duplicate = await prisma.productivityImport.findFirst({
      where: { projectId, sha256: hash },
      select: { id: true, fileName: true, createdAt: true, candidatesCount: true },
    });
    if (duplicate && fields['allowDuplicate'] !== 'true') {
      throw conflict(
        `Este arquivo ja foi importado em ${duplicate.createdAt.toISOString().slice(0, 10)} ` +
        `(${duplicate.candidatesCount} indice(s)). O conteudo e identico por SHA-256. ` +
        'Reenvie com allowDuplicate=true se a intencao e importar de novo.',
        { importId: duplicate.id },
      );
    }

    // PDF vai para o worker: extrair tabela de PDF exige o mesmo pipeline dos desenhos.
    if (extension === 'pdf') {
      const record = await prisma.productivityImport.create({
        data: {
          projectId, fileName, sha256: hash, byteSize: fileBuffer.byteLength, mimeType,
          storageKey: key, importedBy: u.id, status: 'PENDING',
          ...(fields['sheetName'] ? { sheetName: fields['sheetName'] } : {}),
          ...(declaredBasis ? { declaredBasis } : {}),
          ...(declaredSourceDate ? { declaredSourceDate: new Date(`${declaredSourceDate}T00:00:00Z`) } : {}),
          statusMessage: 'Aguardando o worker extrair a tabela do PDF.',
        },
      });
      const jobId = await enqueue({
        projectId, kind: 'productivity.import',
        payload: {
          importId: record.id, storageKey: key, fileName,
          declaredBasis: declaredBasis ?? null, declaredSourceDate: declaredSourceDate ?? null,
        },
      });
      await audit({ projectId, userId: u.id, action: 'PRODUCTIVITY_IMPORT_QUEUED', entity: 'ProductivityImport', entityId: record.id, after: { fileName, sha256: hash } });
      return reply.status(202).send({
        importId: record.id, jobId, status: 'PENDING',
        note: 'PDF enfileirado para extracao. Tabela em PDF depende da qualidade do arquivo: ' +
              'o que nao for lido com seguranca sera listado como linha recusada, nunca adivinhado.',
      });
    }

    // Formatos lidos aqui mesmo, de forma deterministica.
    let rows: string[][];
    let sheetName: string | undefined;
    if (DELIMITED.has(extension)) {
      rows = parseDelimited(fileBuffer.toString('utf8'));
    } else if (SPREADSHEET.has(extension)) {
      const sheets = await parseXlsx(fileBuffer);
      const sheet = pickSheet(sheets, fields['sheetName']);
      if (!sheet) throw unprocessable('A planilha nao tem nenhuma aba com conteudo.');
      rows = sheet.rows;
      sheetName = sheet.name;
    } else {
      const support = supportFor(fileName);
      throw unprocessable(
        `Formato ".${extension}" nao e aceito na importacao da base de produtividade. ` +
        'Envie XLSX, CSV ou PDF. ' + (support.blockedMessage ?? ''),
        { alternatives: ['XLSX', 'CSV', 'PDF'] },
      );
    }

    const result = importProductivityRows(rows, {
      fileName, fileSha256: hash,
      ...(sheetName ? { sheetName } : {}),
      ...(declaredBasis ? { declaredBasis: declaredBasis as ProductivityBasis } : {}),
      ...(declaredSourceDate ? { declaredSourceDate } : {}),
      codePrefix: fields['codePrefix'] ?? 'IDX',
    });

    const record = await prisma.productivityImport.create({
      data: {
        projectId, fileName, sha256: hash, byteSize: fileBuffer.byteLength, mimeType,
        storageKey: key, importedBy: u.id, status: result.candidates.length > 0 ? 'DONE' : 'PARTIAL',
        ...(sheetName ? { sheetName } : {}),
        ...(declaredBasis ? { declaredBasis } : {}),
        ...(declaredSourceDate ? { declaredSourceDate: new Date(`${declaredSourceDate}T00:00:00Z`) } : {}),
        candidatesCount: result.candidates.length,
        rejectedCount: result.rejected.length,
        rejectedRows: result.rejected as never,
        columnMap: result.columnMap as never,
        suppliedByUser: result.suppliedByUser,
        warnings: result.warnings,
        statusMessage: result.candidates.length === 0
          ? 'Nenhum indice importado. Veja os avisos e as linhas recusadas.'
          : null,
      },
    });

    // Códigos já usados no projeto recebem sufixo: nada é sobrescrito.
    const existing = new Set(
      (await prisma.productivityIndex.findMany({ where: { projectId }, select: { code: true } })).map((x) => x.code),
    );
    const created: string[] = [];
    const renamed: { from: string; to: string }[] = [];
    for (const c of result.candidates) {
      let code = c.code;
      if (existing.has(code)) {
        let n = 2;
        while (existing.has(`${code}-${n}`)) n++;
        renamed.push({ from: code, to: `${code}-${n}` });
        code = `${code}-${n}`;
      }
      existing.add(code);
      const row = await prisma.productivityIndex.create({
        data: {
          projectId, code, description: c.description, value: c.value, perUnit: c.perUnit,
          basis: c.basis, source: c.source, sourceDate: new Date(`${c.sourceDate}T00:00:00Z`),
          approvalStatus: 'PENDING', confidence: c.confidence,
          importId: record.id,
          ...(c.evidence?.sheet ? { importSheet: c.evidence.sheet } : {}),
          ...(c.evidence?.row ? { importRow: c.evidence.row } : {}),
          ...(c.discipline ? { discipline: c.discipline } : {}),
          ...(c.scopeNote ? { scopeNote: c.scopeNote } : {}),
        },
      });
      created.push(row.id);
    }

    await audit({
      projectId, userId: u.id, action: 'PRODUCTIVITY_IMPORTED', entity: 'ProductivityImport', entityId: record.id,
      after: { fileName, sha256: hash, imported: created.length, rejected: result.rejected.length, renamed },
    });
    publish({ kind: 'entity.updated', projectId, by: u.id, payload: { productivityImportId: record.id, imported: created.length } });

    return reply.status(201).send({
      importId: record.id,
      imported: created.length,
      rejected: result.rejected,
      renamed,
      columnMap: result.columnMap,
      suppliedByUser: result.suppliedByUser,
      warnings: result.warnings,
      note: created.length > 0
        ? `${created.length} indice(s) importados como PENDENTES. Nenhum deles calcula prazo antes de ser conferido.`
        : 'Nenhum indice foi importado.',
    });
  });

  app.get('/api/projects/:id/productivity/imports', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return prisma.productivityImport.findMany({
      where: { projectId: id },
      include: { _count: { select: { indices: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/api/projects/:id/productivity/imports/:importId', async (req) => {
    const u = currentUser(req);
    const { id, importId } = z.object({ id: z.string(), importId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const record = await prisma.productivityImport.findFirst({
      where: { id: importId, projectId: id },
      include: { indices: { orderBy: { importRow: 'asc' } } },
    });
    if (!record) throw notFound('Importacao nao encontrada.');
    return record;
  });

  /** Confirmação humana do índice lido do arquivo. Sem ela, ele não calcula prazo. */
  app.post('/api/projects/:id/productivity/:indexId/decide', async (req) => {
    const u = currentUser(req);
    const { id, indexId } = z.object({ id: z.string(), indexId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const body = z.object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      version: z.number().int(),
      justification: z.string().optional(),
      corrections: z.object({
        value: z.number().positive().optional(),
        perUnit: z.string().optional(),
        basis: z.enum(BASIS).optional(),
        description: z.string().optional(),
        discipline: z.string().optional(),
      }).optional(),
    }).parse(req.body);

    const before = await prisma.productivityIndex.findFirst({ where: { id: indexId, projectId: id } });
    if (!before) throw notFound('Indice nao encontrado.');
    if (before.version !== body.version) {
      throw conflict(`Indice alterado por outra pessoa (versao atual ${before.version}).`, { currentVersion: before.version });
    }
    if (body.decision === 'REJECTED' && !body.justification?.trim()) {
      throw badRequest('Rejeitar um indice exige justificativa registrada.');
    }

    const corrections = body.corrections ?? {};
    const corrected = Object.keys(corrections).length > 0;
    if (corrected && !body.justification?.trim()) {
      throw badRequest('Corrigir um indice lido do arquivo exige justificativa: a correcao passa a divergir da fonte.');
    }

    const after = await prisma.productivityIndex.update({
      where: { id: indexId },
      data: {
        ...corrections,
        approvalStatus: body.decision,
        approvedBy: body.decision === 'APPROVED' ? u.id : null,
        approvedAt: body.decision === 'APPROVED' ? new Date() : null,
        rejectionReason: body.decision === 'REJECTED' ? body.justification ?? null : null,
        ...(corrected
          ? { source: `${before.source} — corrigido por revisor: ${body.justification}` }
          : {}),
        version: { increment: 1 },
      },
    });

    await prisma.decision.create({
      data: {
        projectId: id, stage: 'PRODUCTIVITY', targetId: indexId, decision: body.decision, by: u.id,
        justification: body.justification ?? 'Indice conferido contra a fonte e aprovado sem alteracao.',
        before: before as never, after: after as never,
      },
    });
    await audit({
      projectId: id, userId: u.id, action: `PRODUCTIVITY_${body.decision}`, entity: 'ProductivityIndex',
      entityId: indexId, before, after, justification: body.justification ?? null,
    });
    publish({ kind: 'entity.updated', projectId: id, by: u.id, payload: { productivityIndexId: indexId, decision: body.decision } });
    return after;
  });

  /** Aprovação em lote — só com regra escrita, como na validação de quantitativos. */
  app.post('/api/projects/:id/productivity/bulk-approve', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const body = z.object({
      importId: z.string(),
      justification: z.string().min(10, 'Aprovacao em lote exige a regra escrita e justificada.'),
    }).parse(req.body);

    const pending = await prisma.productivityIndex.findMany({
      where: { projectId: id, importId: body.importId, approvalStatus: 'PENDING' },
      select: { id: true },
    });
    if (pending.length === 0) return { approved: 0 };

    await prisma.productivityIndex.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { approvalStatus: 'APPROVED', approvedBy: u.id, approvedAt: new Date() },
    });
    await prisma.decision.create({
      data: {
        projectId: id, stage: 'PRODUCTIVITY', targetId: `BULK:${body.importId}`, decision: 'APPROVED',
        by: u.id, justification: body.justification,
        after: { approvedIds: pending.map((p) => p.id) } as never,
      },
    });
    await audit({
      projectId: id, userId: u.id, action: 'PRODUCTIVITY_BULK_APPROVED', entity: 'ProductivityIndex',
      after: { count: pending.length, importId: body.importId }, justification: body.justification,
    });
    return { approved: pending.length };
  });
}
