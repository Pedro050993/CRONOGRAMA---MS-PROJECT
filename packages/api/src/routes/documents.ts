import type { FastifyInstance } from 'fastify';
import { unzip } from 'unzipit';
import { z } from 'zod';
import { classifyIncoming, supportFor, type ExistingDocument } from '@cronograma/core';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { badRequest, notFound } from '../lib/http.js';
import { enqueue, retryJob } from '../lib/queue.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';
import { contentKey, sha256, storage } from '../storage/index.js';

interface IncomingFile {
  fileName: string;
  folderPath: string;
  data: Buffer;
  mimeType: string;
}

/** Normaliza e bloqueia path traversal vindo de ZIP ou de upload de pasta. */
function safeFolderPath(raw: string): string {
  const parts = raw.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
  return `/${parts.join('/')}`;
}

function splitPath(fullPath: string): { folderPath: string; fileName: string } {
  const clean = fullPath.replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  const fileName = idx === -1 ? clean : clean.slice(idx + 1);
  const folder = idx === -1 ? '' : clean.slice(0, idx);
  return { folderPath: safeFolderPath(folder), fileName };
}

async function expandZip(buf: Buffer, baseFolder: string): Promise<IncomingFile[]> {
  const { entries } = await unzip(new Uint8Array(buf).buffer as ArrayBuffer);
  const names = Object.keys(entries);
  if (names.length > env.maxZipEntries) {
    throw badRequest(`O ZIP tem ${names.length} entradas, acima do limite de ${env.maxZipEntries}.`);
  }
  let total = 0;
  const out: IncomingFile[] = [];
  for (const name of names) {
    const entry = entries[name]!;
    if (entry.isDirectory) continue;
    total += entry.size;
    if (total > env.maxZipUncompressedBytes) {
      throw badRequest('O conteudo descomprimido do ZIP excede o limite configurado (protecao contra zip bomb).');
    }
    const { folderPath, fileName } = splitPath(`${baseFolder}/${name}`);
    out.push({
      fileName,
      folderPath,
      data: Buffer.from(await entry.arrayBuffer()),
      mimeType: 'application/octet-stream',
    });
  }
  return out;
}

async function ensureFolder(projectId: string, path: string): Promise<string> {
  const segments = path.split('/').filter(Boolean);
  let current = '';
  let parentId: string | null = null;
  for (const seg of segments) {
    current += `/${seg}`;
    const folder: { id: string } = await prisma.folder.upsert({
      where: { projectId_path: { projectId, path: current } },
      create: { projectId, path: current, parentId },
      update: {},
      select: { id: true },
    });
    parentId = folder.id;
  }
  if (!parentId) {
    const root = await prisma.folder.upsert({
      where: { projectId_path: { projectId, path: '/' } },
      create: { projectId, path: '/' },
      update: {},
      select: { id: true },
    });
    return root.id;
  }
  return parentId;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Upload de arquivo, multiplos arquivos, pasta (campo `path` por arquivo) ou ZIP.
   * O original e imutavel: gravamos por hash e nunca sobrescrevemos.
   */
  app.post('/api/projects/:id/documents/upload', async (req, reply) => {
    const u = currentUser(req);
    const { id: projectId } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, projectId, 'document.upload');

    const incoming: IncomingFile[] = [];
    const pathsByField = new Map<string, string>();
    let expandZips = true;

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        const name = String(part.fieldname);
        if (name === 'expandZip') expandZips = String(part.value) !== 'false';
        // Campos "path:<nome-do-arquivo>" carregam o caminho relativo da pasta enviada.
        if (name.startsWith('path:')) pathsByField.set(name.slice(5), String(part.value));
        continue;
      }
      const data = await part.toBuffer();
      if (data.byteLength > env.maxUploadBytes) throw badRequest(`Arquivo "${part.filename}" excede o limite de upload.`);
      const declaredPath = pathsByField.get(part.filename ?? '') ?? (part.fields as never as Record<string, { value?: string }>)?.['path']?.value;
      const raw = declaredPath ? `${declaredPath}` : (part.filename ?? 'arquivo');
      const { folderPath, fileName } = splitPath(raw.includes('/') ? raw : `/${raw}`);
      const finalName = part.filename ?? fileName;

      if (expandZips && /\.zip$/i.test(finalName)) {
        incoming.push(...await expandZip(data, folderPath === '/' ? `/${finalName.replace(/\.zip$/i, '')}` : folderPath));
      } else {
        incoming.push({ fileName: finalName, folderPath, data, mimeType: part.mimetype });
      }
    }

    if (incoming.length === 0) throw badRequest('Nenhum arquivo recebido.');

    const existing = await prisma.document.findMany({
      where: { projectId },
      select: {
        id: true, fileName: true, folderPath: true, documentNumber: true,
        currentVersion: { select: { sha256: true, revision: true } },
      },
    });
    const existingForMatch: ExistingDocument[] = existing.map((d) => ({
      id: d.id, fileName: d.fileName, folderPath: d.folderPath,
      sha256: d.currentVersion?.sha256 ?? '',
      ...(d.documentNumber ? { documentNumber: d.documentNumber } : {}),
      ...(d.currentVersion?.revision ? { revision: d.currentVersion.revision } : {}),
    }));

    const results: unknown[] = [];
    const store = storage();

    for (const f of incoming) {
      const hash = sha256(f.data);
      const decision = classifyIncoming(
        { fileName: f.fileName, folderPath: f.folderPath, sha256: hash, byteSize: f.data.byteLength },
        existingForMatch,
      );
      const support = supportFor(f.fileName);

      if (decision.kind === 'DUPLICATE') {
        results.push({
          fileName: f.fileName, folderPath: f.folderPath, outcome: 'DUPLICATE',
          matchedDocumentId: decision.matchedDocumentId, reason: decision.reason,
        });
        continue;
      }

      const key = contentKey(projectId, hash, f.fileName);
      if (!(await store.exists(key))) await store.put(key, f.data, f.mimeType);
      const folderId = await ensureFolder(projectId, f.folderPath);

      const isNewRevision = decision.kind === 'NEW_REVISION' && decision.matchedDocumentId;
      const doc = isNewRevision
        ? await prisma.document.findUniqueOrThrow({ where: { id: decision.matchedDocumentId! } })
        : await prisma.document.create({
            data: { projectId, folderId, fileName: f.fileName, folderPath: f.folderPath },
          });

      const status = support.level === 'SUPPORTED' ? 'PENDING' : 'BLOCKED_UNSUPPORTED';
      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id, sha256: hash, byteSize: f.data.byteLength,
          mimeType: f.mimeType, storageKey: key, uploadedBy: u.id,
          status, statusMessage: support.level === 'SUPPORTED' ? null : support.blockedMessage ?? null,
        },
      });
      await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });

      let jobId: string | null = null;
      if (support.level === 'SUPPORTED') {
        jobId = await enqueue({
          projectId, kind: 'document.process',
          payload: { documentId: doc.id, versionId: version.id, storageKey: key, fileName: f.fileName },
        });
      } else {
        // Formato nao interpretavel vira pendencia visivel, nunca silencio.
        await prisma.openIssue.create({
          data: {
            projectId, scope: `document.${doc.id}`,
            description: support.blockedMessage ?? `Formato "${support.extension}" nao interpretavel nesta fase.`,
            severity: 'MEDIUM',
          },
        });
      }

      if (isNewRevision) {
        await enqueue({ projectId, kind: 'revision.impact', payload: { documentId: doc.id, newVersionId: version.id } });
      }

      await audit({
        projectId, userId: u.id, action: isNewRevision ? 'DOCUMENT_NEW_REVISION' : 'DOCUMENT_UPLOADED',
        entity: 'DocumentVersion', entityId: version.id,
        after: { documentId: doc.id, fileName: f.fileName, folderPath: f.folderPath, sha256: hash, decision: decision.kind },
      });

      publish({
        kind: 'document.uploaded', projectId, by: u.id,
        payload: { documentId: doc.id, versionId: version.id, fileName: f.fileName, outcome: decision.kind, jobId },
      });

      existingForMatch.push({ id: doc.id, fileName: f.fileName, folderPath: f.folderPath, sha256: hash });

      results.push({
        documentId: doc.id, versionId: version.id, fileName: f.fileName, folderPath: f.folderPath,
        outcome: decision.kind, reason: decision.reason, confidence: decision.confidence,
        missingEvidence: decision.missingEvidence,
        support: { level: support.level, phase: support.phase, blockedMessage: support.blockedMessage, alternatives: support.alternatives },
        jobId,
      });
    }

    return reply.status(201).send({ received: incoming.length, results });
  });

  app.get('/api/projects/:id/documents', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({
      type: z.string().optional(), area: z.string().optional(), discipline: z.string().optional(),
      status: z.string().optional(), search: z.string().optional(),
    }).parse(req.query);

    return prisma.document.findMany({
      where: {
        projectId: id,
        ...(q.area ? { area: q.area } : {}),
        ...(q.discipline ? { discipline: q.discipline } : {}),
        ...(q.type ? { OR: [{ confirmedType: q.type as never }, { suggestedType: q.type as never }] } : {}),
        ...(q.search ? { OR: [{ fileName: { contains: q.search, mode: 'insensitive' } }, { documentNumber: { contains: q.search, mode: 'insensitive' } }] } : {}),
      },
      include: {
        currentVersion: { select: { id: true, revision: true, status: true, statusMessage: true, pageCount: true, sha256: true, uploadedAt: true } },
        _count: { select: { versions: true, quantities: true, entities: true } },
      },
      orderBy: [{ folderPath: 'asc' }, { fileName: 'asc' }],
    });
  });

  /** Matriz documental com inconsistencias (§5, etapa 3). */
  app.get('/api/projects/:id/documents/matrix', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);

    const docs = await prisma.document.findMany({
      where: { projectId: id },
      include: { currentVersion: true, versions: { orderBy: { uploadedAt: 'desc' } } },
    });

    const byNumber = new Map<string, typeof docs>();
    for (const d of docs) {
      if (!d.documentNumber) continue;
      const arr = byNumber.get(d.documentNumber) ?? [];
      arr.push(d);
      byNumber.set(d.documentNumber, arr);
    }

    const rows = docs.map((d) => {
      const inconsistencies: string[] = [];
      if (!d.documentNumber) inconsistencies.push('Numero do documento nao identificado no carimbo.');
      if (!d.currentVersion?.revision) inconsistencies.push('Revisao nao identificada.');
      if (!d.confirmedType) inconsistencies.push('Tipo ainda nao confirmado por humano — a classificacao e sugestao, nao fato.');
      if (d.currentVersion?.status === 'FAILED') inconsistencies.push(`Processamento falhou: ${d.currentVersion.statusMessage ?? 'sem detalhe'}`);
      if (d.currentVersion?.status === 'BLOCKED_UNSUPPORTED') inconsistencies.push(d.currentVersion.statusMessage ?? 'Formato nao interpretavel nesta fase.');
      if (d.documentNumber && (byNumber.get(d.documentNumber)?.length ?? 0) > 1) {
        inconsistencies.push('Mesmo numero de documento aparece em mais de um registro.');
      }
      return {
        id: d.id, fileName: d.fileName, folderPath: d.folderPath, documentNumber: d.documentNumber,
        suggestedType: d.suggestedType, confirmedType: d.confirmedType, typeConfidence: d.typeConfidence,
        discipline: d.discipline, area: d.area, system: d.system,
        revision: d.currentVersion?.revision ?? null,
        status: d.currentVersion?.status ?? null,
        versionCount: d.versions.length,
        uploadedAt: d.currentVersion?.uploadedAt ?? null,
        inconsistencies,
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        unclassified: rows.filter((r) => !r.confirmedType).length,
        withInconsistencies: rows.filter((r) => r.inconsistencies.length > 0).length,
        blocked: rows.filter((r) => r.status === 'BLOCKED_UNSUPPORTED').length,
      },
    };
  });

  app.get('/api/projects/:id/documents/:docId', async (req) => {
    const u = currentUser(req);
    const { id, docId } = z.object({ id: z.string(), docId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const doc = await prisma.document.findFirst({
      where: { id: docId, projectId: id },
      include: {
        versions: { orderBy: { uploadedAt: 'desc' }, include: { pages: { orderBy: { pageNumber: 'asc' } } } },
        currentVersion: { include: { pages: { orderBy: { pageNumber: 'asc' } } } },
      },
    });
    if (!doc) throw notFound('Documento nao encontrado.');
    return doc;
  });

  /** Confirmacao humana da classificacao (§5, etapa 3). */
  app.post('/api/projects/:id/documents/:docId/classify', async (req) => {
    const u = currentUser(req);
    const { id, docId } = z.object({ id: z.string(), docId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'document.classify');
    const body = z.object({
      confirmedType: z.string(),
      documentNumber: z.string().optional(),
      discipline: z.string().optional(),
      area: z.string().optional(),
      system: z.string().optional(),
      version: z.number().int(),
      justification: z.string().optional(),
    }).parse(req.body);

    const before = await prisma.document.findFirstOrThrow({ where: { id: docId, projectId: id } });
    if (before.version !== body.version) {
      throw badRequest(`Documento alterado por outra pessoa (versao ${before.version}). Recarregue antes de confirmar.`);
    }
    const after = await prisma.document.update({
      where: { id: docId },
      data: {
        confirmedType: body.confirmedType as never,
        confirmedBy: u.id, confirmedAt: new Date(),
        ...(body.documentNumber !== undefined ? { documentNumber: body.documentNumber } : {}),
        ...(body.discipline !== undefined ? { discipline: body.discipline } : {}),
        ...(body.area !== undefined ? { area: body.area } : {}),
        ...(body.system !== undefined ? { system: body.system } : {}),
        version: { increment: 1 },
      },
    });
    await prisma.decision.create({
      data: {
        projectId: id, stage: 'DOCUMENT_CLASSIFICATION', targetId: docId, decision: 'APPROVED',
        by: u.id, justification: body.justification ?? 'Classificacao confirmada pelo revisor.',
        before: before as never, after: after as never,
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'DOCUMENT_CLASSIFIED', entity: 'Document', entityId: docId, before, after });
    publish({ kind: 'entity.updated', projectId: id, by: u.id, payload: { documentId: docId, confirmedType: body.confirmedType } });
    return after;
  });

  /** Download do original ou do derivado, com URL temporaria. */
  app.get('/api/projects/:id/versions/:versionId/download', async (req) => {
    const u = currentUser(req);
    const { id, versionId } = z.object({ id: z.string(), versionId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const v = await prisma.documentVersion.findFirstOrThrow({
      where: { id: versionId, document: { projectId: id } },
    });
    const url = await storage().signedUrl(v.storageKey);
    return { url, expiresInSeconds: env.signedUrlTtl, storageKey: v.storageKey, mimeType: v.mimeType };
  });

  app.get('/api/files/*', async (req, reply) => {
    const u = currentUser(req);
    const key = decodeURIComponent((req.params as Record<string, string>)['*'] ?? '');
    const v = await prisma.documentVersion.findFirst({
      where: { storageKey: key, document: { project: { members: { some: { userId: u.id } } } } },
    });
    if (!v) throw notFound('Arquivo nao encontrado ou sem acesso.');
    const data = await storage().get(key);
    return reply.type(v.mimeType || 'application/octet-stream').send(data);
  });

  // --- Fila de processamento ---
  app.get('/api/projects/:id/jobs', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    return prisma.processingJob.findMany({
      where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 200,
    });
  });

  app.post('/api/projects/:id/jobs/:jobId/retry', async (req) => {
    const u = currentUser(req);
    const { id, jobId } = z.object({ id: z.string(), jobId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'document.upload');
    await retryJob(jobId);
    await audit({ projectId: id, userId: u.id, action: 'JOB_RETRIED', entity: 'ProcessingJob', entityId: jobId });
    publish({ kind: 'document.processing', projectId: id, by: u.id, payload: { jobId, status: 'QUEUED' } });
    return { retried: true };
  });
}
