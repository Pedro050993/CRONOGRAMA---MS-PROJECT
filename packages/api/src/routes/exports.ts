import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  compareSchedules, exportMspdi, importMspdi, minutesPerDayOf, standardCalendar,
  validateMspdiXml, type MspProject, type MspResource, type MspTask, type WorkCalendar,
} from '@cronograma/core';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';
import { storage } from '../storage/index.js';

const idParam = z.object({ id: z.string() });

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com separador ";" e BOM: o padrao que o Excel brasileiro abre sem reconfigurar. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '﻿';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Monta o pacote MSPDI a partir do banco.
 * Atividade NAO CALCULAVEL nao vira duracao arbitrada: ela e exportada como
 * duracao zero e marcada no campo de rastreabilidade, para o planejador ver no Project.
 */
async function buildMspProject(projectId: string): Promise<{ msp: MspProject; notCalculable: string[] }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const calendarDefs = await prisma.workCalendarDef.findMany({ where: { projectId } });
  const activities = await prisma.activity.findMany({
    where: { projectId },
    include: { wbsNode: true, productivity: true, assignments: { include: { resource: true } } },
    orderBy: { code: 'asc' },
  });
  const links = await prisma.logicLink.findMany({ where: { projectId, status: { in: ['VALIDATED', 'MODIFIED'] } } });
  const resources = await prisma.resourceDef.findMany({ where: { projectId } });
  const baseline = await prisma.baseline.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, include: { rows: true } });
  const baselineRows = new Map((baseline?.rows ?? []).map((r) => [r.activityId, r]));

  const calendars: { uid: number; calendar: WorkCalendar; isBase: boolean }[] = calendarDefs.length > 0
    ? calendarDefs.map((c, i) => ({
        uid: i + 1, isBase: true,
        calendar: { id: c.id, name: c.name, workWeek: c.workWeek as never, exceptions: c.exceptions as never },
      }))
    : [{ uid: 1, isBase: true, calendar: standardCalendar() }];
  const calUidById = new Map(calendarDefs.map((c, i) => [c.id, i + 1]));
  const defaultCalendarUid = calendars[0]!.uid;

  const uidByActivity = new Map<string, number>();
  activities.forEach((a, i) => uidByActivity.set(a.id, i + 2)); // UID 1 fica para o resumo do projeto

  const linksBySuccessor = new Map<string, typeof links>();
  for (const l of links) {
    const arr = linksBySuccessor.get(l.successorId) ?? [];
    arr.push(l);
    linksBySuccessor.set(l.successorId, arr);
  }

  const notCalculable: string[] = [];
  const projectStart = project.contractStart ?? new Date();

  const summary: MspTask = {
    uid: 1, id: 1, name: project.name, wbs: '1', outlineNumber: '1', outlineLevel: 1,
    isSummary: true, isMilestone: false,
    start: projectStart.toISOString(),
    finish: (activities.map((a) => a.earlyFinish).filter(Boolean).sort().pop() ?? projectStart).toISOString(),
    durationMinutes: 0, predecessors: [],
  };

  const tasks: MspTask[] = [summary];
  activities.forEach((a, i) => {
    const uid = uidByActivity.get(a.id)!;
    if (a.durationStatus === 'NOT_CALCULABLE' && !a.isMilestone) notCalculable.push(a.code);
    const bl = baselineRows.get(a.id);
    const preds = (linksBySuccessor.get(a.id) ?? [])
      .filter((l) => uidByActivity.has(l.predecessorId))
      .map((l) => ({ predecessorUid: uidByActivity.get(l.predecessorId)!, type: l.type as never, lagMinutes: l.lagMinutes }));

    tasks.push({
      uid, id: i + 2,
      name: a.name,
      wbs: a.wbsNode?.code ?? `1.${i + 1}`,
      outlineNumber: `1.${i + 1}`,
      outlineLevel: 2,
      isSummary: false,
      isMilestone: a.isMilestone,
      start: (a.earlyStart ?? projectStart).toISOString(),
      finish: (a.earlyFinish ?? a.earlyStart ?? projectStart).toISOString(),
      durationMinutes: a.isMilestone ? 0 : a.durationStatus === 'CALCULATED' ? a.durationMinutes : 0,
      ...(a.workHH !== null ? { workHH: a.workHH } : {}),
      percentComplete: a.percentComplete,
      percentWorkComplete: a.percentComplete,
      ...(a.constraintType ? { constraintType: a.constraintType as never } : {}),
      ...(a.constraintDate ? { constraintDate: a.constraintDate.toISOString() } : {}),
      calendarUid: a.calendarId ? calUidById.get(a.calendarId) ?? defaultCalendarUid : defaultCalendarUid,
      ...(a.totalFloatMinutes !== null ? { totalSlackMinutes: a.totalFloatMinutes } : {}),
      critical: a.isCritical,
      ...(a.actualStart ? { actualStart: a.actualStart.toISOString() } : {}),
      ...(a.actualFinish ? { actualFinish: a.actualFinish.toISOString() } : {}),
      ...(a.actualWorkHH !== null ? { actualWorkHours: a.actualWorkHH } : {}),
      ...(a.remainingWorkHH !== null ? { remainingWorkHours: a.remainingWorkHH } : {}),
      ...(a.durationStatus === 'NOT_CALCULABLE' && !a.isMilestone
        ? { notes: `DURACAO NAO CALCULAVEL. Faltam: ${JSON.stringify(a.missingInputs)}. Duracao exportada como zero para NAO arbitrar prazo.` }
        : a.calcMemo.length > 0 ? { notes: a.calcMemo.join('\n') } : {}),
      predecessors: preds,
      ...(bl ? {
        baseline: {
          number: baseline!.number, start: bl.start.toISOString(), finish: bl.finish.toISOString(),
          durationMinutes: bl.durationMinutes, workHours: bl.workHH,
        },
      } : {}),
      extended: {
        Text1: a.wbsNode?.code ?? '',
        Text2: a.discipline ?? '',
        Text3: a.area ?? '',
        Text4: a.system ?? '',
        Text5: a.wbsNode?.type ?? '',
        Text6: a.unit ?? '',
        Text8: a.productivity?.source ?? '',
        Text9: a.durationStatus === 'CALCULATED' ? 'CALCULADA' : 'NAO CALCULAVEL',
        Text10: a.completionCriteria ?? a.deliverable ?? '',
        ...(a.qty !== null ? { Number1: a.qty } : {}),
        ...(a.productivity ? { Number2: a.productivity.value } : {}),
      },
    });
  });

  const mspResources: MspResource[] = resources.map((r, i) => ({
    uid: i + 1, id: i + 1, name: r.name, type: r.kind === 'MATERIAL' ? 0 : 1,
    maxUnits: r.maxUnits, ...(r.group ? { group: r.group } : {}),
  }));
  const resUidById = new Map(resources.map((r, i) => [r.id, i + 1]));

  let asgUid = 1;
  const assignments = activities.flatMap((a) =>
    a.assignments
      .filter((x) => resUidById.has(x.resourceId) && uidByActivity.has(a.id))
      .map((x) => ({
        uid: asgUid++, taskUid: uidByActivity.get(a.id)!, resourceUid: resUidById.get(x.resourceId)!,
        units: x.units, workHours: x.workHH,
      })),
  );

  const minutesPerDay = minutesPerDayOf(calendars[0]!.calendar);
  return {
    notCalculable,
    msp: {
      name: project.name,
      title: project.scopeSummary ?? project.name,
      ...(project.client ? { company: project.client } : {}),
      startDate: projectStart.toISOString(),
      ...(project.statusDate ? { statusDate: project.statusDate.toISOString() } : {}),
      saveVersion: 14,
      minutesPerDay,
      minutesPerWeek: minutesPerDay * 5,
      daysPerMonth: 20,
      defaultStartTime: '07:00',
      defaultFinishTime: '16:00',
      calendars, defaultCalendarUid,
      tasks, resources: mspResources, assignments,
    },
  };
}

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  /** Relatorio de validacao antes de baixar o arquivo (§14, item 5). */
  app.get('/api/projects/:id/exports/mspdi/validate', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const { msp, notCalculable } = await buildMspProject(id);
    const { xml, report, byteLength } = exportMspdi(msp);
    const xmlReport = validateMspdiXml(xml);
    return {
      modelValidation: report,
      xmlValidation: xmlReport,
      byteLength,
      notCalculable,
      downloadable: report.valid && xmlReport.valid,
      note: notCalculable.length > 0
        ? `${notCalculable.length} atividade(s) sem duracao calculavel serao exportadas com duracao ZERO e nota explicativa. O sistema nao arbitra prazo.`
        : 'Todas as atividades tem duracao calculada a partir de quantidade, indice, equipe e calendario.',
    };
  });

  app.get('/api/projects/:id/exports/mspdi', async (req, reply) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'export.create');
    const { msp, notCalculable } = await buildMspProject(id);
    const { xml, report, byteLength } = exportMspdi(msp);
    const xmlReport = validateMspdiXml(xml);

    if (!report.valid || !xmlReport.valid) {
      return reply.status(422).send({
        error: 'INVALID_MSPDI',
        message: 'O XML gerado nao passou na validacao e nao sera entregue. Corrija os erros e exporte novamente.',
        modelValidation: report,
        xmlValidation: xmlReport,
      });
    }

    const key = `projects/${id}/exports/mspdi-${Date.now()}.xml`;
    await storage().put(key, Buffer.from(xml, 'utf8'), 'application/xml');
    const record = await prisma.exportRecord.create({
      data: {
        projectId: id, format: 'MSPDI_XML', storageKey: key, byteSize: byteLength,
        validation: { model: report, xml: xmlReport, notCalculable } as never, createdBy: u.id,
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'EXPORT_MSPDI', entity: 'ExportRecord', entityId: record.id, after: { key, byteLength } });
    publish({ kind: 'export.ready', projectId: id, by: u.id, payload: { exportId: record.id, format: 'MSPDI_XML' } });

    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="cronograma-${id}.xml"`)
      .header('X-Validation-Tasks', String(report.counts.tasks))
      .header('X-Validation-Links', String(report.counts.links))
      .send(xml);
  });

  /** Importacao de XML existente para auditoria e comparacao (§14). */
  app.post('/api/projects/:id/imports/mspdi', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');

    const file = await req.file();
    if (!file) throw new Error('Envie o arquivo XML no campo "file".');
    const xml = (await file.toBuffer()).toString('utf8');

    const validation = validateMspdiXml(xml);
    const imported = importMspdi(xml);
    const { msp } = await buildMspProject(id);
    const diff = compareSchedules(imported.tasks, msp.tasks);

    await audit({
      projectId: id, userId: u.id, action: 'MSPDI_IMPORTED', entity: 'Project', entityId: id,
      after: { fileName: file.filename, tasks: imported.tasks.length, diffEntries: diff.length },
    });

    return {
      validation,
      imported: {
        name: imported.name, title: imported.title, startDate: imported.startDate,
        statusDate: imported.statusDate, taskCount: imported.tasks.length, warnings: imported.warnings,
      },
      comparison: {
        entries: diff,
        summary: {
          added: diff.filter((d) => d.kind === 'ADDED').length,
          removed: diff.filter((d) => d.kind === 'REMOVED').length,
          dateChanged: diff.filter((d) => d.kind === 'DATE_CHANGED').length,
          logicChanged: diff.filter((d) => d.kind === 'LOGIC_CHANGED').length,
        },
      },
      note: 'A importacao NAO alterou o cronograma do projeto. Ela produziu uma comparacao para auditoria.',
    };
  });

  /** Exportacoes tabulares. Cada linha carrega fonte, revisao, confianca e status. */
  app.get('/api/projects/:id/exports/:dataset.:format', async (req, reply) => {
    const u = currentUser(req);
    const { id, dataset, format } = z.object({
      id: z.string(),
      dataset: z.enum(['quantities', 'activities', 'links', 'wbs', 'constraints', 'audit']),
      format: z.enum(['csv', 'json']),
    }).parse(req.params);
    await requireCapability(u.id, id, 'export.create');

    let rows: Record<string, unknown>[] = [];
    switch (dataset) {
      case 'quantities': {
        const items = await prisma.quantityItem.findMany({
          where: { projectId: id }, include: { document: { select: { fileName: true, documentNumber: true } } },
        });
        rows = items.map((q) => ({
          entityKey: q.entityKey, disciplina: q.discipline, area: q.area, sistema: q.system,
          linha: q.lineNumber, tag: q.tag, material: q.material, classe: q.pipeClass, schedule: q.schedule,
          dn_pol: q.nominalDiameterIn, tipo_item: q.itemType, quantidade: q.qty, unidade: q.unit,
          fonte: q.sourceKind, documento: q.document?.fileName ?? '', numero_documento: q.document?.documentNumber ?? '',
          revisao: q.documentRevision, classe_do_dado: q.dataClass, confianca: q.confidence,
          status_validacao: q.reviewStatus, validado_por: q.reviewedBy, validado_em: q.reviewedAt,
          memoria_calculo: q.calcMemo ? JSON.stringify(q.calcMemo) : '',
        }));
        break;
      }
      case 'activities': {
        const items = await prisma.activity.findMany({
          where: { projectId: id }, include: { wbsNode: true, productivity: true },
        });
        rows = items.map((a) => ({
          codigo: a.code, nome: a.name, eap: a.wbsNode?.code ?? '', tipo_pacote: a.wbsNode?.type ?? '',
          disciplina: a.discipline, area: a.area, sistema: a.system, etapa: a.step,
          entregavel: a.deliverable, criterio_conclusao: a.completionCriteria,
          quantidade: a.qty, unidade: a.unit,
          indice: a.productivity?.value ?? '', indice_unidade: a.productivity ? `HH/${a.productivity.perUnit}` : '',
          fonte_indice: a.productivity?.source ?? '',
          trabalho_hh: a.workHH, capacidade_hh_dia: a.dailyCapacityHH,
          duracao_dias: a.durationStatus === 'CALCULATED' ? Number((a.durationMinutes / 480).toFixed(2)) : '',
          status_duracao: a.durationStatus, faltando: JSON.stringify(a.missingInputs),
          inicio_cedo: a.earlyStart, termino_cedo: a.earlyFinish,
          inicio_tarde: a.lateStart, termino_tarde: a.lateFinish,
          folga_total_dias: a.totalFloatMinutes === null ? '' : Number((a.totalFloatMinutes / 480).toFixed(2)),
          critica: a.isCritical, marco: a.isMilestone, contratual: a.isContractual,
          inicio_real: a.actualStart, termino_real: a.actualFinish,
          hh_realizado: a.actualWorkHH, hh_saldo: a.remainingWorkHH, avanco_pct: a.percentComplete,
        }));
        break;
      }
      case 'links': {
        const items = await prisma.logicLink.findMany({
          where: { projectId: id },
          include: { predecessor: { select: { code: true, name: true } }, successor: { select: { code: true, name: true } } },
        });
        rows = items.map((l) => ({
          predecessora: l.predecessor.code, predecessora_nome: l.predecessor.name,
          sucessora: l.successor.code, sucessora_nome: l.successor.name,
          tipo: l.type, defasagem_dias: Number((l.lagMinutes / 480).toFixed(2)),
          status: l.status, motivo: l.reason, natureza: l.reasonKind, regra: l.ruleId,
          fontes: l.sourceRefs.join(' | '), confianca: l.confidence,
          validado_por: l.validatedBy, validado_em: l.validatedAt,
        }));
        break;
      }
      case 'wbs': {
        const items = await prisma.wbsNode.findMany({ where: { projectId: id }, orderBy: { code: 'asc' } });
        rows = items.map((n) => ({
          codigo: n.code, tipo: n.type, nome: n.name, pai: n.parentId,
          disciplina: n.discipline, area: n.area, sistema: n.system,
          escopo_incluso: n.scopeIn, escopo_excluso: n.scopeOut, entregavel: n.deliverable,
          quantidade: n.qty, unidade: n.unit, documentos: n.documentIds.join(' | '),
        }));
        break;
      }
      case 'constraints': {
        const items = await prisma.constraintRecord.findMany({ where: { projectId: id } });
        rows = items.map((c) => ({
          descricao: c.description, categoria: c.category, responsavel: c.owner,
          data_necessaria: c.neededBy, data_prometida: c.promisedBy, status: c.status,
          evidencia_remocao: c.removalEvidence, impacto: c.potentialImpact, origem: c.origin,
        }));
        break;
      }
      case 'audit': {
        const items = await prisma.auditLog.findMany({
          where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 10000,
          include: { user: { select: { name: true, email: true } } },
        });
        rows = items.map((a) => ({
          data: a.createdAt, usuario: a.user?.name ?? '', email: a.user?.email ?? '',
          acao: a.action, entidade: a.entity, entidade_id: a.entityId,
          valor_anterior: a.before ? JSON.stringify(a.before) : '',
          valor_novo: a.after ? JSON.stringify(a.after) : '',
          justificativa: a.justification,
        }));
        break;
      }
    }

    if (format === 'json') return rows;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${dataset}-${id}.csv"`)
      .send(toCsv(rows));
  });

  app.get('/api/projects/:id/exports', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return prisma.exportRecord.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  });
}
