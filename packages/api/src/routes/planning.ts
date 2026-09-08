import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildLookahead, buildOutline, buildProgressSnapshot, computeCpm, computeDuration, computePpc,
  DEFAULT_MAPS, evaluateItem, evaluatePromotion, evaluateReadiness, explainPredecessors,
  proposeSequence, runQualityChecks, standardCalendar, summarizeFindings, validateWbs,
  weightedPhysicalProgress, analyzeMove,
  type ActivityContext, type ConstraintRecord as CoreConstraint, type ControlMapItem as CoreControlItem,
  type Link as CoreLink, type NetworkActivity, type PromotionCandidate, type ProgressActivity,
  type ReadinessAssessment as CoreReadiness, type WbsNode as CoreWbsNode, type WorkCalendar,
} from '@cronograma/core';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/http.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';

const idParam = z.object({ id: z.string() });

async function loadCalendars(projectId: string): Promise<Record<string, WorkCalendar>> {
  const defs = await prisma.workCalendarDef.findMany({ where: { projectId } });
  const out: Record<string, WorkCalendar> = {};
  for (const d of defs) {
    out[d.id] = {
      id: d.id, name: d.name,
      workWeek: d.workWeek as never,
      exceptions: d.exceptions as never,
    };
  }
  if (Object.keys(out).length === 0) {
    const fallback = standardCalendar();
    out[fallback.id] = fallback;
  }
  return out;
}

function toCoreWbs(n: {
  id: string; parentId: string | null; type: string; code: string; name: string;
  discipline: string | null; area: string | null; system: string | null; subsystem: string | null;
  scopeIn: string | null; scopeOut: string | null; deliverable: string | null;
  qty: number | null; unit: string | null; documentIds: string[]; acceptanceCriteria: unknown; sortIndex: number;
}): CoreWbsNode {
  return {
    id: n.id, parentId: n.parentId, type: n.type as CoreWbsNode['type'], code: n.code, name: n.name,
    ...(n.discipline ? { discipline: n.discipline as never } : {}),
    ...(n.area ? { area: n.area } : {}),
    ...(n.system ? { system: n.system } : {}),
    ...(n.subsystem ? { subsystem: n.subsystem } : {}),
    ...(n.scopeIn ? { scopeIn: n.scopeIn } : {}),
    ...(n.scopeOut ? { scopeOut: n.scopeOut } : {}),
    ...(n.deliverable ? { deliverable: n.deliverable } : {}),
    ...(n.qty !== null && n.unit ? { quantity: { qty: n.qty, unit: n.unit } } : {}),
    documentIds: n.documentIds,
    acceptanceCriteria: (n.acceptanceCriteria as never) ?? [],
    sortIndex: n.sortIndex,
  };
}

export async function registerPlanningRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // EAP / AWP
  // -------------------------------------------------------------------------
  app.get('/api/projects/:id/wbs', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const nodes = await prisma.wbsNode.findMany({ where: { projectId: id }, orderBy: { sortIndex: 'asc' } });
    const core = nodes.map(toCoreWbs);
    const issues = validateWbs(core);
    let outline: unknown[] = [];
    try {
      outline = issues.some((i) => i.severity === 'ERROR') ? [] : buildOutline(core);
    } catch { outline = []; }
    return { nodes, outline, issues };
  });

  app.post('/api/projects/:id/wbs', async (req, reply) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      parentId: z.string().nullable(),
      type: z.enum(['PROJECT', 'PHASE', 'CWA', 'CWP', 'IWP', 'ACTIVITY']),
      code: z.string().min(1),
      name: z.string().min(1),
      discipline: z.string().optional(),
      area: z.string().optional(),
      system: z.string().optional(),
      subsystem: z.string().optional(),
      scopeIn: z.string().optional(),
      scopeOut: z.string().optional(),
      deliverable: z.string().optional(),
      qty: z.number().optional(),
      unit: z.string().optional(),
      documentIds: z.array(z.string()).default([]),
      acceptanceCriteria: z.array(z.object({ description: z.string(), evidenceRequired: z.string() })).default([]),
      sortIndex: z.number().int().default(0),
    }).parse(req.body);

    const existing = await prisma.wbsNode.findMany({ where: { projectId: id } });
    const candidate: CoreWbsNode = {
      id: '__novo__', parentId: body.parentId, type: body.type, code: body.code, name: body.name,
      ...(body.discipline ? { discipline: body.discipline as never } : {}),
      ...(body.area ? { area: body.area } : {}),
      ...(body.system ? { system: body.system } : {}),
      ...(body.scopeOut ? { scopeOut: body.scopeOut } : {}),
      ...(body.deliverable ? { deliverable: body.deliverable } : {}),
      ...(body.qty !== undefined && body.unit ? { quantity: { qty: body.qty, unit: body.unit } } : {}),
      acceptanceCriteria: body.acceptanceCriteria,
      sortIndex: body.sortIndex,
    };
    const errors = validateWbs([...existing.map(toCoreWbs), candidate])
      .filter((i) => i.severity === 'ERROR' && i.nodeId === '__novo__');
    if (errors.length > 0) throw unprocessable('No de EAP invalido.', errors);

    const created = await prisma.wbsNode.create({
      data: {
        projectId: id, parentId: body.parentId, type: body.type, code: body.code, name: body.name,
        discipline: body.discipline ?? null, area: body.area ?? null, system: body.system ?? null,
        subsystem: body.subsystem ?? null, scopeIn: body.scopeIn ?? null, scopeOut: body.scopeOut ?? null,
        deliverable: body.deliverable ?? null, qty: body.qty ?? null, unit: body.unit ?? null,
        documentIds: body.documentIds, acceptanceCriteria: body.acceptanceCriteria as never, sortIndex: body.sortIndex,
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'WBS_NODE_CREATED', entity: 'WbsNode', entityId: created.id, after: created });
    publish({ kind: 'wbs.changed', projectId: id, by: u.id, payload: { nodeId: created.id, code: created.code } });
    return reply.status(201).send(created);
  });

  /** Previa de impacto antes de mover um no da EAP (§10). */
  app.post('/api/projects/:id/wbs/:nodeId/preview-move', async (req) => {
    const u = currentUser(req);
    const { id, nodeId } = z.object({ id: z.string(), nodeId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const body = z.object({ newParentId: z.string().nullable(), newSortIndex: z.number().int() }).parse(req.body);
    const nodes = await prisma.wbsNode.findMany({ where: { projectId: id } });
    return analyzeMove(nodes.map(toCoreWbs), nodeId, body.newParentId, body.newSortIndex);
  });

  app.post('/api/projects/:id/wbs/:nodeId/move', async (req) => {
    const u = currentUser(req);
    const { id, nodeId } = z.object({ id: z.string(), nodeId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      newParentId: z.string().nullable(), newSortIndex: z.number().int(),
      version: z.number().int(), justification: z.string().min(5),
    }).parse(req.body);

    const before = await prisma.wbsNode.findFirstOrThrow({ where: { id: nodeId, projectId: id } });
    if (before.version !== body.version) throw conflict(`No alterado por outra pessoa (versao ${before.version}).`);

    const nodes = await prisma.wbsNode.findMany({ where: { projectId: id } });
    const impact = analyzeMove(nodes.map(toCoreWbs), nodeId, body.newParentId, body.newSortIndex);
    if (!impact.ok) throw unprocessable('Movimento invalido na EAP.', impact.errors);

    const after = await prisma.wbsNode.update({
      where: { id: nodeId },
      data: { parentId: body.newParentId, sortIndex: body.newSortIndex, version: { increment: 1 } },
    });
    await audit({ projectId: id, userId: u.id, action: 'WBS_NODE_MOVED', entity: 'WbsNode', entityId: nodeId, before, after, justification: body.justification });
    publish({ kind: 'wbs.changed', projectId: id, by: u.id, payload: { nodeId, impact } });
    return { node: after, impact };
  });

  // -------------------------------------------------------------------------
  // Atividades
  // -------------------------------------------------------------------------
  app.get('/api/projects/:id/activities', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return prisma.activity.findMany({
      where: { projectId: id },
      include: {
        assignments: { include: { resource: true } },
        wbsNode: { select: { id: true, code: true, name: true, type: true } },
        productivity: true,
      },
      orderBy: { code: 'asc' },
    });
  });

  app.post('/api/projects/:id/activities', async (req, reply) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      code: z.string().min(1), name: z.string().min(1),
      wbsNodeId: z.string().optional(), calendarId: z.string().optional(),
      productivityId: z.string().optional(),
      discipline: z.string().optional(), area: z.string().optional(), system: z.string().optional(),
      step: z.string().optional(), deliverable: z.string().optional(), completionCriteria: z.string().optional(),
      isMilestone: z.boolean().default(false), isContractual: z.boolean().default(false),
      qty: z.number().optional(), unit: z.string().optional(),
      quantityItemIds: z.array(z.string()).default([]),
      constraintType: z.string().optional(), constraintDate: z.string().optional(),
      constraintJustification: z.string().optional(),
      crew: z.array(z.object({ resourceId: z.string(), count: z.number().int().positive(), productiveHoursPerDay: z.number().positive() })).default([]),
    }).parse(req.body);

    const created = await prisma.activity.create({
      data: {
        projectId: id, code: body.code, name: body.name,
        wbsNodeId: body.wbsNodeId ?? null, calendarId: body.calendarId ?? null,
        productivityId: body.productivityId ?? null,
        discipline: body.discipline ?? null, area: body.area ?? null, system: body.system ?? null,
        step: body.step ?? null, deliverable: body.deliverable ?? null,
        completionCriteria: body.completionCriteria ?? null,
        isMilestone: body.isMilestone, isContractual: body.isContractual,
        qty: body.qty ?? null, unit: body.unit ?? null,
        quantityItemIds: body.quantityItemIds,
        constraintType: body.constraintType ?? null,
        constraintDate: body.constraintDate ? new Date(body.constraintDate) : null,
        constraintJustification: body.constraintJustification ?? null,
        assignments: {
          create: body.crew.map((c) => ({ resourceId: c.resourceId, count: c.count, units: c.count, workHH: 0 })),
        },
      },
    });
    // Horas produtivas ficam no recurso, nao na atividade: um numero, uma fonte.
    for (const c of body.crew) {
      await prisma.resourceDef.update({ where: { id: c.resourceId }, data: { productiveHoursPerDay: c.productiveHoursPerDay } });
    }
    await audit({ projectId: id, userId: u.id, action: 'ACTIVITY_CREATED', entity: 'Activity', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  /**
   * Recalcula a duracao a partir de quantidade, indice, equipe e calendario.
   * Faltando insumo, a atividade fica NOT_CALCULABLE com a lista do que falta.
   */
  app.post('/api/projects/:id/schedule/compute-durations', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');

    const activities = await prisma.activity.findMany({
      where: { projectId: id },
      include: { assignments: { include: { resource: true } }, productivity: true },
    });

    const results: unknown[] = [];
    for (const a of activities) {
      if (a.isMilestone) {
        await prisma.activity.update({
          where: { id: a.id },
          data: { durationMinutes: 0, durationStatus: 'CALCULATED', missingInputs: [] as never, calcMemo: ['Marco: duracao zero por definicao.'] },
        });
        results.push({ activityId: a.id, code: a.code, status: 'CALCULATED', durationDays: 0 });
        continue;
      }

      const crew = a.assignments
        .filter((x) => x.resource.productiveHoursPerDay !== null)
        .map((x) => ({
          resourceId: x.resource.id, resourceName: x.resource.name,
          count: x.count, productiveHoursPerDay: x.resource.productiveHoursPerDay!,
        }));

      const r = computeDuration({
        quantity: a.qty !== null && a.unit ? { qty: a.qty, unit: a.unit } : null,
        productivity: a.productivity
          ? {
              value: a.productivity.value, perUnit: a.productivity.perUnit,
              source: a.productivity.source, sourceDate: a.productivity.sourceDate.toISOString().slice(0, 10),
              basis: a.productivity.basis as never,
              // Indice importado e nao conferido bloqueia a duracao no proprio motor.
              approvalStatus: a.productivity.approvalStatus,
            }
          : null,
        crew: crew.length > 0 ? crew : null,
        actualWorkHH: a.actualWorkHH ?? 0,
      });

      const minutesPerDay = 480;
      await prisma.activity.update({
        where: { id: a.id },
        data: {
          workHH: r.workHH, remainingWorkHH: r.remainingWorkHH, dailyCapacityHH: r.dailyCapacityHH,
          durationMinutes: r.durationWorkingDays === null ? 0 : Math.max(1, Math.round(r.durationWorkingDays * minutesPerDay)),
          durationStatus: r.status,
          missingInputs: r.missing as never,
          calcMemo: r.memo,
        },
      });
      results.push({
        activityId: a.id, code: a.code, name: a.name, status: r.status,
        workHH: r.workHH, durationDays: r.durationWorkingDays, missing: r.missing, memo: r.memo,
      });
    }

    const blocked = results.filter((r) => (r as { status: string }).status === 'NOT_CALCULABLE');
    await audit({ projectId: id, userId: u.id, action: 'DURATIONS_COMPUTED', entity: 'Activity', after: { total: results.length, notCalculable: blocked.length } });
    publish({ kind: 'schedule.recalculated', projectId: id, by: u.id, payload: { computed: results.length, notCalculable: blocked.length } });
    return { total: results.length, calculated: results.length - blocked.length, notCalculable: blocked.length, results };
  });

  // -------------------------------------------------------------------------
  // Sequenciamento
  // -------------------------------------------------------------------------
  app.post('/api/projects/:id/sequencing/propose', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');

    const activities = await prisma.activity.findMany({ where: { projectId: id } });
    const entities = await prisma.techEntity.findMany({ where: { projectId: id } });
    const byKey = new Map(entities.map((e) => [e.entityKey, e]));

    const contexts: ActivityContext[] = activities.map((a) => {
      const attrs = (byKey.get(a.code)?.attributes ?? {}) as Record<string, unknown>;
      return {
        activityId: a.id, name: a.name,
        discipline: (a.discipline ?? 'OTHER') as never,
        step: (a.step ?? 'ERECTION') as never,
        ...(a.area ? { area: a.area } : {}),
        ...(a.system ? { system: a.system } : {}),
        ...(attrs['objectKey'] ? { objectKey: String(attrs['objectKey']) } : { objectKey: a.code }),
        ...(attrs['lineNumber'] ? { lineNumber: String(attrs['lineNumber']) } : {}),
        ...(attrs['parentLineNumber'] ? { parentLineNumber: String(attrs['parentLineNumber']) } : {}),
        ...(attrs['supportRefs'] ? { supportRefs: attrs['supportRefs'] as string[] } : {}),
        ...(attrs['structureRefs'] ? { structureRefs: attrs['structureRefs'] as string[] } : {}),
        ...(attrs['connectsToEquipment'] ? { connectsToEquipment: attrs['connectsToEquipment'] as string[] } : {}),
        ...(attrs['testPackId'] ? { testPackId: String(attrs['testPackId']) } : {}),
        ...(attrs['commissioningSystemId'] ? { commissioningSystemId: String(attrs['commissioningSystemId']) } : {}),
        ...(typeof attrs['elevationM'] === 'number' ? { elevationM: attrs['elevationM'] } : {}),
        ...(attrs['documentedInterferences'] ? { documentedInterferences: attrs['documentedInterferences'] as string[] } : {}),
        ...(attrs['tag'] ? { tag: String(attrs['tag']) } : {}),
        sourceRefs: byKey.get(a.code)?.documentId ? [byKey.get(a.code)!.documentId!] : [],
        confidence: byKey.get(a.code)?.confidence ?? 0.6,
      };
    });

    const proposal = proposeSequence(contexts, { idPrefix: 'SEQ' });

    let created = 0;
    for (const l of proposal.links) {
      const exists = await prisma.logicLink.findUnique({
        where: { predecessorId_successorId: { predecessorId: l.predecessorId, successorId: l.successorId } },
      });
      if (exists) continue;
      await prisma.logicLink.create({
        data: {
          projectId: id, predecessorId: l.predecessorId, successorId: l.successorId,
          type: l.type, lagMinutes: l.lagMinutes, status: 'SUGGESTED',
          reason: l.rationale.reason, reasonKind: l.rationale.reasonKind,
          ruleId: l.rationale.ruleId ?? null, sourceRefs: l.rationale.sourceRefs,
          confidence: l.rationale.confidence,
        },
      });
      created += 1;
    }

    for (const q of proposal.questions) {
      await prisma.openIssue.create({
        data: {
          projectId: id, scope: 'sequencing',
          description: `${q.question} | Por que importa: ${q.whyItMatters} | Falta: ${q.missingEvidence.join('; ')}`,
          severity: 'HIGH',
        },
      });
    }

    await audit({ projectId: id, userId: u.id, action: 'SEQUENCE_PROPOSED', entity: 'LogicLink', after: { created, questions: proposal.questions.length } });
    publish({ kind: 'link.updated', projectId: id, by: u.id, payload: { proposed: created } });

    return {
      proposedLinks: created,
      totalCandidates: proposal.links.length,
      questions: proposal.questions,
      ruleStats: proposal.ruleStats,
      note: 'Os vinculos entraram como SUGERIDOS. Nenhum deles afeta o calculo aprovado ate ser validado por um planejador (§12.3).',
    };
  });

  app.get('/api/projects/:id/links', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({ status: z.enum(['SUGGESTED', 'VALIDATED', 'REJECTED', 'MODIFIED']).optional() }).parse(req.query);
    return prisma.logicLink.findMany({
      where: { projectId: id, ...(q.status ? { status: q.status } : {}) },
      include: {
        predecessor: { select: { id: true, code: true, name: true } },
        successor: { select: { id: true, code: true, name: true } },
      },
      orderBy: { confidence: 'desc' },
    });
  });

  /** "Por que esta atividade vem antes?" (§12.3). */
  app.get('/api/projects/:id/activities/:activityId/why', async (req) => {
    const u = currentUser(req);
    const { id, activityId } = z.object({ id: z.string(), activityId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const links = await prisma.logicLink.findMany({
      where: { projectId: id, successorId: activityId },
      include: { predecessor: { select: { id: true, code: true, name: true } } },
    });
    const activities = await prisma.activity.findMany({ where: { projectId: id }, select: { id: true, name: true } });
    const coreLinks: CoreLink[] = links.map((l) => ({
      id: l.id, predecessorId: l.predecessorId, successorId: l.successorId,
      type: l.type as never, lagMinutes: l.lagMinutes, status: l.status as never,
      rationale: { reasonKind: l.reasonKind as never, reason: l.reason, ...(l.ruleId ? { ruleId: l.ruleId } : {}), sourceRefs: l.sourceRefs, confidence: l.confidence },
    }));
    const ctx = activities.map((a) => ({ activityId: a.id, name: a.name } as ActivityContext));
    return explainPredecessors(activityId, coreLinks, ctx).map((e) => ({
      predecessor: links.find((l) => l.predecessorId === e.link.predecessorId)?.predecessor,
      type: e.link.type,
      lagMinutes: e.link.lagMinutes,
      status: e.link.status,
      reason: e.link.rationale.reason,
      reasonKind: e.link.rationale.reasonKind,
      ruleId: e.ruleId,
      sourceRefs: e.link.rationale.sourceRefs,
      confidence: e.link.rationale.confidence,
    }));
  });

  app.post('/api/projects/:id/links/:linkId/decide', async (req) => {
    const u = currentUser(req);
    const { id, linkId } = z.object({ id: z.string(), linkId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      decision: z.enum(['VALIDATED', 'REJECTED', 'MODIFIED']),
      version: z.number().int(),
      type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
      lagMinutes: z.number().int().optional(),
      justification: z.string().optional(),
    }).parse(req.body);

    const before = await prisma.logicLink.findFirstOrThrow({ where: { id: linkId, projectId: id } });
    if (before.version !== body.version) throw conflict(`Vinculo alterado por outra pessoa (versao ${before.version}).`);
    if (body.decision !== 'VALIDATED' && !body.justification?.trim()) {
      throw badRequest('Rejeitar ou alterar um vinculo exige justificativa registrada.');
    }
    if (body.decision === 'MODIFIED' && body.lagMinutes !== undefined && body.lagMinutes !== 0 && !body.justification?.trim()) {
      throw badRequest('Defasagem exige justificativa (§13.3).');
    }

    const after = await prisma.logicLink.update({
      where: { id: linkId },
      data: {
        status: body.decision,
        ...(body.type ? { type: body.type } : {}),
        ...(body.lagMinutes !== undefined ? { lagMinutes: body.lagMinutes } : {}),
        ...(body.justification ? { reason: `${before.reason} | Ajuste do planejador: ${body.justification}` } : {}),
        validatedBy: u.id, validatedAt: new Date(), version: { increment: 1 },
      },
    });
    await prisma.decision.create({
      data: {
        projectId: id, stage: 'LOGIC_LINK', targetId: linkId, decision: body.decision, by: u.id,
        justification: body.justification ?? 'Vinculo validado como proposto.', before: before as never, after: after as never,
      },
    });
    await audit({ projectId: id, userId: u.id, action: `LINK_${body.decision}`, entity: 'LogicLink', entityId: linkId, before, after, justification: body.justification ?? null });
    publish({ kind: 'link.updated', projectId: id, by: u.id, payload: { linkId, decision: body.decision } });
    return after;
  });

  // -------------------------------------------------------------------------
  // Calculo do cronograma
  // -------------------------------------------------------------------------
  app.post('/api/projects/:id/schedule/compute', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      projectStart: z.string().optional(),
      includeSuggestedLinks: z.boolean().default(false),
    }).parse(req.body ?? {});

    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const calendars = await loadCalendars(id);
    const defaultCalendarId = Object.keys(calendars)[0]!;
    const activities = await prisma.activity.findMany({ where: { projectId: id } });
    if (activities.length === 0) throw unprocessable('Nao ha atividades para calcular.');

    const notCalculable = activities.filter((a) => a.durationStatus === 'NOT_CALCULABLE' && !a.isMilestone);
    const links = await prisma.logicLink.findMany({ where: { projectId: id } });

    const net: NetworkActivity[] = activities.map((a) => ({
      id: a.id, name: a.name,
      durationMinutes: a.durationStatus === 'CALCULATED' ? a.durationMinutes : 0,
      calendarId: a.calendarId && calendars[a.calendarId] ? a.calendarId : defaultCalendarId,
      isMilestone: a.isMilestone,
      ...(a.constraintType ? {
        constraint: {
          type: a.constraintType as never,
          ...(a.constraintDate ? { date: a.constraintDate.toISOString() } : {}),
          ...(a.constraintJustification ? { justification: a.constraintJustification } : {}),
        },
      } : {}),
      ...(a.actualStart ? { actualStart: a.actualStart.toISOString() } : {}),
      ...(a.actualFinish ? { actualFinish: a.actualFinish.toISOString() } : {}),
      percentComplete: a.percentComplete,
    }));

    const coreLinks: CoreLink[] = links.map((l) => ({
      id: l.id, predecessorId: l.predecessorId, successorId: l.successorId,
      type: l.type as never, lagMinutes: l.lagMinutes, status: l.status as never,
      rationale: { reasonKind: l.reasonKind as never, reason: l.reason, ...(l.ruleId ? { ruleId: l.ruleId } : {}), sourceRefs: l.sourceRefs, confidence: l.confidence },
    }));

    const projectStart = new Date(body.projectStart ?? project.contractStart ?? new Date());
    let cpm;
    try {
      cpm = computeCpm(net, coreLinks, {
        projectStart, calendars,
        includeStatuses: body.includeSuggestedLinks ? ['VALIDATED', 'MODIFIED', 'SUGGESTED'] : ['VALIDATED', 'MODIFIED'],
      });
    } catch (e) {
      throw unprocessable(e instanceof Error ? e.message : 'Falha ao calcular o CPM.');
    }

    for (const a of activities) {
      const r = cpm.activities[a.id];
      if (!r) continue;
      await prisma.activity.update({
        where: { id: a.id },
        data: {
          earlyStart: new Date(r.earlyStart), earlyFinish: new Date(r.earlyFinish),
          lateStart: new Date(r.lateStart), lateFinish: new Date(r.lateFinish),
          totalFloatMinutes: r.totalFloatMinutes, freeFloatMinutes: r.freeFloatMinutes,
          isCritical: r.isCritical,
        },
      });
    }

    const quality = runQualityChecks({
      activities: net, links: coreLinks, calendars,
      notCalculable: notCalculable.map((a) => a.id),
      authorizedOpenEnds: activities.filter((a) => a.isMilestone && a.isContractual).map((a) => a.id),
      wbsByActivity: Object.fromEntries(activities.filter((a) => a.wbsNodeId).map((a) => [a.id, a.wbsNodeId!])),
      scopeRefsByActivity: Object.fromEntries(activities.map((a) => [a.id, a.quantityItemIds])),
      workHHByActivity: Object.fromEntries(activities.map((a) => [a.id, a.workHH ?? 0])),
      deliverableByActivity: Object.fromEntries(activities.map((a) => [a.id, a.deliverable ?? ''])),
      contractualMilestones: activities.filter((a) => a.isContractual).map((a) => a.id),
    });

    await audit({ projectId: id, userId: u.id, action: 'SCHEDULE_COMPUTED', entity: 'Project', entityId: id, after: { projectFinish: cpm.projectFinish, criticalPath: cpm.criticalPath.length } });
    publish({ kind: 'schedule.recalculated', projectId: id, by: u.id, payload: { projectFinish: cpm.projectFinish } });

    return {
      projectStart: cpm.projectStart,
      projectFinish: cpm.projectFinish,
      criticalPath: cpm.criticalPath,
      activities: cpm.activities,
      quality: { findings: quality, summary: summarizeFindings(quality) },
      notCalculable: notCalculable.map((a) => ({ id: a.id, code: a.code, name: a.name, missing: a.missingInputs })),
      usedSuggestedLinks: body.includeSuggestedLinks,
    };
  });

  /** Portao de promocao: o que ainda impede o plano de ser aprovado (§4.2). */
  app.get('/api/projects/:id/schedule/promotion-check', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);

    const quantities = await prisma.quantityItem.findMany({ where: { projectId: id } });
    const activities = await prisma.activity.findMany({ where: { projectId: id } });

    const candidates: PromotionCandidate[] = [
      ...quantities.map((q) => ({
        id: q.id, stage: 'QUANTITY' as const, label: `${q.entityKey} (${q.qty} ${q.unit})`,
        provenance: {
          dataClass: q.dataClass as never, method: 'TABLE_PARSER' as const,
          ...(q.confidence !== null ? { confidence: q.confidence } : {}),
          evidence: q.documentId ? [{ documentId: q.documentId }] : [],
          processedAt: q.createdAt.toISOString(), reviewStatus: q.reviewStatus as never,
          ...(q.reviewedBy ? { reviewedBy: q.reviewedBy } : {}),
          ...(q.note ? { note: q.note } : {}),
        },
      })),
      ...activities.map((a) => ({
        id: a.id, stage: 'DURATION' as const, label: `${a.code} — ${a.name}`,
        dependsOn: a.quantityItemIds,
        provenance: {
          dataClass: (a.durationStatus === 'CALCULATED' ? 'CONFIGURABLE_RULE' : 'PENDING_INFO') as never,
          method: 'COMPUTED' as const, evidence: [],
          processedAt: a.updatedAt.toISOString(),
          reviewStatus: 'APPROVED' as never,
          ...(a.durationStatus === 'NOT_CALCULABLE' ? { note: 'Duracao nao calculavel: faltam insumos.' } : {}),
        },
      })),
    ];

    const result = evaluatePromotion(candidates);
    return {
      ...result,
      note: result.canPromote
        ? 'Toda a cadeia tem proveniencia utilizavel. O plano pode ser promovido a aprovado.'
        : 'Ha itens sem aprovacao humana ou sem rastreabilidade. O plano NAO pode ser promovido.',
    };
  });

  // -------------------------------------------------------------------------
  // Baseline e realizado
  // -------------------------------------------------------------------------
  app.post('/api/projects/:id/baselines', async (req, reply) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'baseline.create');
    const body = z.object({ name: z.string().min(2), note: z.string().optional() }).parse(req.body);

    const activities = await prisma.activity.findMany({ where: { projectId: id } });
    const missing = activities.filter((a) => !a.earlyStart || !a.earlyFinish);
    if (missing.length > 0) {
      throw unprocessable(
        `${missing.length} atividade(s) sem datas calculadas. Rode o calculo do cronograma antes de congelar a linha de base.`,
        missing.slice(0, 20).map((a) => ({ code: a.code, name: a.name })),
      );
    }
    const last = await prisma.baseline.findFirst({ where: { projectId: id }, orderBy: { number: 'desc' } });
    const number = (last?.number ?? -1) + 1;

    const baseline = await prisma.baseline.create({
      data: {
        projectId: id, number, name: body.name, createdBy: u.id, note: body.note ?? null,
        rows: {
          create: activities.map((a) => ({
            activityId: a.id, start: a.earlyStart!, finish: a.earlyFinish!,
            durationMinutes: a.durationMinutes, workHH: a.workHH ?? 0,
          })),
        },
      },
      include: { _count: { select: { rows: true } } },
    });
    await audit({ projectId: id, userId: u.id, action: 'BASELINE_CREATED', entity: 'Baseline', entityId: baseline.id, after: { number, rows: baseline._count.rows } });
    return reply.status(201).send(baseline);
  });

  app.get('/api/projects/:id/baselines', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return prisma.baseline.findMany({
      where: { projectId: id }, include: { _count: { select: { rows: true } } }, orderBy: { number: 'desc' },
    });
  });

  /** Atualizacao do realizado — exige permissao e justificativa (§4.3). */
  app.post('/api/projects/:id/activities/:activityId/actuals', async (req) => {
    const u = currentUser(req);
    const { id, activityId } = z.object({ id: z.string(), activityId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      actualStart: z.string().optional(),
      actualFinish: z.string().optional(),
      actualWorkHH: z.number().nonnegative().optional(),
      remainingWorkHH: z.number().nonnegative().optional(),
      percentComplete: z.number().min(0).max(100).optional(),
      version: z.number().int(),
      justification: z.string().optional(),
    }).parse(req.body);

    const before = await prisma.activity.findFirstOrThrow({ where: { id: activityId, projectId: id } });
    if (before.version !== body.version) throw conflict(`Atividade alterada por outra pessoa (versao ${before.version}).`);

    // Alterar um realizado ja registrado e diferente de registra-lo pela primeira vez.
    const changingExisting =
      (before.actualStart !== null && body.actualStart !== undefined) ||
      (before.actualFinish !== null && body.actualFinish !== undefined) ||
      ((before.actualWorkHH ?? 0) > 0 && body.actualWorkHH !== undefined && body.actualWorkHH !== before.actualWorkHH);

    if (changingExisting) {
      const role = await requireCapability(u.id, id, 'actual.write');
      if (!body.justification || body.justification.trim().length < 10) {
        throw badRequest(
          'Alterar um realizado ja registrado exige justificativa de no minimo 10 caracteres. ' +
          'O passado do projeto nao e reescrito em silencio (§4.3).',
        );
      }
      void role;
    }

    const after = await prisma.activity.update({
      where: { id: activityId },
      data: {
        ...(body.actualStart !== undefined ? { actualStart: new Date(body.actualStart) } : {}),
        ...(body.actualFinish !== undefined ? { actualFinish: new Date(body.actualFinish) } : {}),
        ...(body.actualWorkHH !== undefined ? { actualWorkHH: body.actualWorkHH } : {}),
        ...(body.remainingWorkHH !== undefined ? { remainingWorkHH: body.remainingWorkHH } : {}),
        ...(body.percentComplete !== undefined ? { percentComplete: body.percentComplete } : {}),
        version: { increment: 1 },
      },
    });
    await audit({
      projectId: id, userId: u.id, action: changingExisting ? 'ACTUAL_CHANGED' : 'ACTUAL_RECORDED',
      entity: 'Activity', entityId: activityId, before, after, justification: body.justification ?? null,
    });
    publish({ kind: 'schedule.recalculated', projectId: id, by: u.id, payload: { activityId, actualsUpdated: true } });
    return after;
  });

  /** Curva S e tendencia (§13.4), ponderadas por HH. */
  app.get('/api/projects/:id/progress', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({ statusDate: z.string().optional(), baselineNumber: z.coerce.number().optional(), stepDays: z.coerce.number().default(7) }).parse(req.query);

    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const calendars = await loadCalendars(id);
    const defaultCalendarId = Object.keys(calendars)[0]!;
    const activities = await prisma.activity.findMany({ where: { projectId: id, isMilestone: false } });
    const baseline = await prisma.baseline.findFirst({
      where: { projectId: id, ...(q.baselineNumber !== undefined ? { number: q.baselineNumber } : {}) },
      orderBy: { number: 'desc' }, include: { rows: true },
    });
    if (!baseline) {
      return { error: 'NO_BASELINE', message: 'Nao ha linha de base congelada. Sem baseline nao existe desvio para medir — apenas plano atual.' };
    }
    const rows = new Map(baseline.rows.map((r) => [r.activityId, r]));

    const progressActivities: ProgressActivity[] = [];
    const skipped: string[] = [];
    for (const a of activities) {
      const b = rows.get(a.id);
      if (!b || !a.earlyStart || !a.earlyFinish) { skipped.push(a.code); continue; }
      progressActivities.push({
        id: a.id, name: a.name,
        baselineWorkHH: b.workHH, baselineStart: b.start.toISOString(), baselineFinish: b.finish.toISOString(),
        plannedWorkHH: a.workHH ?? 0, plannedStart: a.earlyStart.toISOString(), plannedFinish: a.earlyFinish.toISOString(),
        ...(a.actualStart ? { actualStart: a.actualStart.toISOString() } : {}),
        ...(a.actualFinish ? { actualFinish: a.actualFinish.toISOString() } : {}),
        ...(a.actualWorkHH !== null ? { actualWorkHH: a.actualWorkHH } : {}),
        ...(a.remainingWorkHH !== null ? { remainingWorkHH: a.remainingWorkHH } : {}),
        calendarId: a.calendarId && calendars[a.calendarId] ? a.calendarId : defaultCalendarId,
      });
    }

    const snapshot = buildProgressSnapshot(progressActivities, {
      statusDate: q.statusDate ?? project.statusDate?.toISOString() ?? new Date().toISOString(),
      calendars, stepDays: q.stepDays,
    });
    return {
      ...snapshot,
      baseline: { number: baseline.number, name: baseline.name, frozenAt: baseline.frozenAt },
      skippedActivities: skipped,
      note: 'Curva S ponderada por HH (§4.4). Custo, medicao, faturamento e caixa NAO estao misturados aqui.',
    };
  });

  // -------------------------------------------------------------------------
  // Mapas de controle
  // -------------------------------------------------------------------------
  app.get('/api/projects/:id/control-maps/definitions', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return DEFAULT_MAPS;
  });

  app.get('/api/projects/:id/control-maps/:mapId/items', async (req) => {
    const u = currentUser(req);
    const { id, mapId } = z.object({ id: z.string(), mapId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const def = DEFAULT_MAPS.find((m) => m.id === mapId);
    if (!def) throw notFound(`Mapa de controle "${mapId}" nao encontrado.`);

    const items = await prisma.controlMapItem.findMany({ where: { projectId: id, mapId }, orderBy: { controlKey: 'asc' } });
    const activityByKey = new Map(
      (await prisma.activity.findMany({ where: { projectId: id }, select: { code: true, totalFloatMinutes: true, earlyFinish: true, lateFinish: true } }))
        .map((a) => [a.code, a]),
    );

    const evaluated = items.map((it) => {
      const core: CoreControlItem = {
        id: it.id, mapId: it.mapId, controlKey: it.controlKey,
        fields: it.fields as never, stages: it.stages as never,
        ...(it.plannedHH !== null ? { plannedHH: it.plannedHH } : {}),
        ...(it.actualHH !== null ? { actualHH: it.actualHH } : {}),
      };
      const act = activityByKey.get(it.controlKey);
      const delayDays = act?.totalFloatMinutes !== undefined && act.totalFloatMinutes !== null && act.totalFloatMinutes < 0
        ? Math.round(-act.totalFloatMinutes / 480)
        : act?.totalFloatMinutes !== undefined ? 0 : undefined;
      return { item: it, evaluation: evaluateItem(core, def, delayDays) };
    });

    const progress = weightedPhysicalProgress(
      items.map((it) => ({
        id: it.id, mapId: it.mapId, controlKey: it.controlKey,
        fields: it.fields as never, stages: it.stages as never,
        ...(it.plannedHH !== null ? { plannedHH: it.plannedHH } : {}),
      })),
      Object.fromEntries(DEFAULT_MAPS.map((m) => [m.id, m])),
    );

    return { definition: def, items: evaluated, progress };
  });

  app.put('/api/projects/:id/control-maps/:mapId/items/:controlKey', async (req) => {
    const u = currentUser(req);
    const { id, mapId, controlKey } = z.object({ id: z.string(), mapId: z.string(), controlKey: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      fields: z.record(z.unknown()).default({}),
      stages: z.record(z.object({
        status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'NOT_APPLICABLE']),
        completedAt: z.string().optional(),
        evidenceRef: z.string().optional(),
        by: z.string().optional(),
        exception: z.object({ justification: z.string().min(10), approvedBy: z.string(), approvedAt: z.string() }).optional(),
      })).default({}),
      plannedHH: z.number().optional(),
      actualHH: z.number().optional(),
      version: z.number().int().optional(),
    }).parse(req.body);

    const def = DEFAULT_MAPS.find((m) => m.id === mapId);
    if (!def) throw notFound(`Mapa de controle "${mapId}" nao encontrado.`);

    // Declarar concluido sem evidencia so passa com excecao aprovada e justificada.
    for (const [key, st] of Object.entries(body.stages)) {
      if (st.status !== 'DONE') continue;
      const stageDef = def.stages.find((s) => s.key === key);
      if (!stageDef) throw badRequest(`Estagio "${key}" nao pertence ao mapa "${mapId}".`);
      if (!st.evidenceRef && !st.exception) {
        throw badRequest(
          `Estagio "${stageDef.label}" nao pode ser concluido sem evidencia (${stageDef.evidenceRequired}) ` +
          'nem excecao aprovada e justificada.',
        );
      }
    }

    const existing = await prisma.controlMapItem.findUnique({
      where: { projectId_mapId_controlKey: { projectId: id, mapId, controlKey } },
    });
    if (existing && body.version !== undefined && existing.version !== body.version) {
      throw conflict(`Item alterado por outra pessoa (versao ${existing.version}).`);
    }

    const saved = await prisma.controlMapItem.upsert({
      where: { projectId_mapId_controlKey: { projectId: id, mapId, controlKey } },
      create: {
        projectId: id, mapId, controlKey, fields: body.fields as never, stages: body.stages as never,
        plannedHH: body.plannedHH ?? null, actualHH: body.actualHH ?? null,
      },
      update: {
        fields: body.fields as never, stages: body.stages as never,
        ...(body.plannedHH !== undefined ? { plannedHH: body.plannedHH } : {}),
        ...(body.actualHH !== undefined ? { actualHH: body.actualHH } : {}),
        version: { increment: 1 },
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'CONTROL_MAP_ITEM_SAVED', entity: 'ControlMapItem', entityId: saved.id, before: existing, after: saved });
    publish({ kind: 'entity.updated', projectId: id, by: u.id, payload: { controlMapItemId: saved.id, controlKey } });

    const evaluation = evaluateItem(
      { id: saved.id, mapId, controlKey, fields: saved.fields as never, stages: saved.stages as never, ...(saved.plannedHH !== null ? { plannedHH: saved.plannedHH } : {}) },
      def,
    );
    return { item: saved, evaluation };
  });

  // -------------------------------------------------------------------------
  // Restricoes, prontidao e lookahead
  // -------------------------------------------------------------------------
  app.get('/api/projects/:id/constraints', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    return prisma.constraintRecord.findMany({ where: { projectId: id }, orderBy: [{ status: 'asc' }, { neededBy: 'asc' }] });
  });

  app.post('/api/projects/:id/constraints', async (req, reply) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'project.write');
    const body = z.object({
      description: z.string().min(5),
      category: z.string(),
      owner: z.string().min(1),
      neededBy: z.string(),
      promisedBy: z.string().optional(),
      potentialImpact: z.string().min(5),
      origin: z.string().min(3),
      wbsNodeId: z.string().optional(),
      activityId: z.string().optional(),
    }).parse(req.body);
    const created = await prisma.constraintRecord.create({
      data: {
        projectId: id, ...body,
        neededBy: new Date(body.neededBy),
        promisedBy: body.promisedBy ? new Date(body.promisedBy) : null,
        wbsNodeId: body.wbsNodeId ?? null, activityId: body.activityId ?? null,
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'CONSTRAINT_CREATED', entity: 'ConstraintRecord', entityId: created.id, after: created });
    publish({ kind: 'constraint.updated', projectId: id, by: u.id, payload: { constraintId: created.id } });
    return reply.status(201).send(created);
  });

  app.patch('/api/projects/:id/constraints/:constraintId', async (req) => {
    const u = currentUser(req);
    const { id, constraintId } = z.object({ id: z.string(), constraintId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.write');
    const body = z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'REMOVED', 'ACCEPTED_RISK', 'CANCELLED']).optional(),
      promisedBy: z.string().optional(),
      removalEvidence: z.string().optional(),
      version: z.number().int(),
    }).parse(req.body);

    const before = await prisma.constraintRecord.findFirstOrThrow({ where: { id: constraintId, projectId: id } });
    if (before.version !== body.version) throw conflict(`Restricao alterada por outra pessoa (versao ${before.version}).`);
    if (body.status === 'REMOVED' && !body.removalEvidence?.trim() && !before.removalEvidence) {
      throw badRequest('Declarar uma restricao removida exige evidencia de remocao.');
    }
    const after = await prisma.constraintRecord.update({
      where: { id: constraintId },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.promisedBy ? { promisedBy: new Date(body.promisedBy) } : {}),
        ...(body.removalEvidence ? { removalEvidence: body.removalEvidence } : {}),
        version: { increment: 1 },
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'CONSTRAINT_UPDATED', entity: 'ConstraintRecord', entityId: constraintId, before, after });
    publish({ kind: 'constraint.updated', projectId: id, by: u.id, payload: { constraintId } });
    return after;
  });

  app.put('/api/projects/:id/readiness', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireCapability(u.id, id, 'project.write');
    const body = z.object({
      wbsNodeId: z.string().nullable().default(null),
      activityId: z.string().nullable().default(null),
      dimension: z.string(),
      verdict: z.enum(['READY', 'NOT_READY', 'NOT_ASSESSED']),
      note: z.string().optional(),
    }).parse(req.body);
    if (!body.wbsNodeId && !body.activityId) throw badRequest('Informe o IWP (wbsNodeId) ou a atividade.');

    const saved = await prisma.readinessAssessment.upsert({
      where: { wbsNodeId_activityId_dimension: { wbsNodeId: body.wbsNodeId as never, activityId: body.activityId as never, dimension: body.dimension } },
      create: { projectId: id, ...body, assessedBy: u.id, assessedAt: new Date() },
      update: { verdict: body.verdict, note: body.note ?? null, assessedBy: u.id, assessedAt: new Date() },
    });
    await audit({ projectId: id, userId: u.id, action: 'READINESS_ASSESSED', entity: 'ReadinessAssessment', entityId: saved.id, after: saved });
    return saved;
  });

  app.get('/api/projects/:id/readiness/:targetId', async (req) => {
    const u = currentUser(req);
    const { id, targetId } = z.object({ id: z.string(), targetId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const assessments = await prisma.readinessAssessment.findMany({
      where: { projectId: id, OR: [{ wbsNodeId: targetId }, { activityId: targetId }] },
    });
    const constraints = await prisma.constraintRecord.findMany({
      where: { projectId: id, OR: [{ wbsNodeId: targetId }, { activityId: targetId }] },
    });
    const core: CoreReadiness[] = assessments.map((a) => ({
      dimension: a.dimension as never, verdict: a.verdict as never,
      ...(a.assessedBy ? { assessedBy: a.assessedBy } : {}),
      ...(a.assessedAt ? { assessedAt: a.assessedAt.toISOString() } : {}),
      ...(a.note ? { note: a.note } : {}),
    }));
    const coreConstraints: CoreConstraint[] = constraints.map((c) => ({
      id: c.id, description: c.description,
      targetKind: c.wbsNodeId ? 'IWP' : 'ACTIVITY',
      targetId, category: c.category as never, owner: c.owner,
      neededBy: c.neededBy.toISOString(),
      ...(c.promisedBy ? { promisedBy: c.promisedBy.toISOString() } : {}),
      status: c.status as never,
      ...(c.removalEvidence ? { removalEvidence: c.removalEvidence } : {}),
      potentialImpact: c.potentialImpact, origin: c.origin,
      createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    }));
    return evaluateReadiness(targetId, core, coreConstraints);
  });

  app.get('/api/projects/:id/lookahead', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({ weeks: z.coerce.number().default(6) }).parse(req.query);

    const activities = await prisma.activity.findMany({
      where: { projectId: id, earlyStart: { not: null } },
      select: { id: true, name: true, earlyStart: true },
    });
    const assessments = await prisma.readinessAssessment.findMany({ where: { projectId: id } });
    const constraints = await prisma.constraintRecord.findMany({ where: { projectId: id } });

    const byActivity: Record<string, CoreReadiness[]> = {};
    for (const a of assessments) {
      if (!a.activityId) continue;
      (byActivity[a.activityId] ??= []).push({
        dimension: a.dimension as never, verdict: a.verdict as never,
        ...(a.assessedBy ? { assessedBy: a.assessedBy } : {}),
      });
    }
    const coreConstraints: CoreConstraint[] = constraints.map((c) => ({
      id: c.id, description: c.description, targetKind: 'ACTIVITY',
      targetId: c.activityId ?? c.wbsNodeId ?? '', category: c.category as never, owner: c.owner,
      neededBy: c.neededBy.toISOString(),
      ...(c.promisedBy ? { promisedBy: c.promisedBy.toISOString() } : {}),
      status: c.status as never, potentialImpact: c.potentialImpact, origin: c.origin,
      createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    }));

    const horizon = new Date(Date.now() + q.weeks * 7 * 86400000).toISOString();
    return buildLookahead(
      activities.map((a) => ({ id: a.id, name: a.name, plannedStart: a.earlyStart!.toISOString() })),
      byActivity, coreConstraints, horizon,
    );
  });

  app.post('/api/projects/:id/ppc', async (req) => {
    const u = currentUser(req);
    const { id } = idParam.parse(req.params);
    await requireMembership(u.id, id);
    const body = z.object({
      commitments: z.array(z.object({
        activityId: z.string(), completed: z.boolean(), nonCompletionCause: z.string().optional(),
      })),
    }).parse(req.body);
    return computePpc(body.commitments);
  });
}
