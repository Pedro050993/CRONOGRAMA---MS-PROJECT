import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';

const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'CORRECTED', 'REJECTED', 'FLAGGED']),
  version: z.number().int(),
  justification: z.string().optional(),
  corrections: z.record(z.unknown()).optional(),
});

export async function registerValidationRoutes(app: FastifyInstance): Promise<void> {
  /** Fila de validacao: o que ainda nao passou por humano, ordenado pelo pior caso. */
  app.get('/api/projects/:id/validation/queue', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({
      kind: z.enum(['quantity', 'entity']).default('quantity'),
      maxConfidence: z.coerce.number().optional(),
      discipline: z.string().optional(),
      area: z.string().optional(),
      system: z.string().optional(),
      documentId: z.string().optional(),
      status: z.enum(['PENDING', 'APPROVED', 'CORRECTED', 'REJECTED', 'FLAGGED']).default('PENDING'),
      take: z.coerce.number().max(500).default(100),
    }).parse(req.query);

    const where = {
      projectId: id,
      reviewStatus: q.status,
      ...(q.discipline ? { discipline: q.discipline } : {}),
      ...(q.area ? { area: q.area } : {}),
      ...(q.system ? { system: q.system } : {}),
      ...(q.documentId ? { documentId: q.documentId } : {}),
      ...(q.maxConfidence !== undefined ? { confidence: { lte: q.maxConfidence } } : {}),
    };

    if (q.kind === 'entity') {
      return prisma.techEntity.findMany({
        where, take: q.take,
        orderBy: [{ confidence: 'asc' }, { createdAt: 'asc' }],
        include: { evidence: true, document: { select: { id: true, fileName: true, documentNumber: true } } },
      });
    }
    return prisma.quantityItem.findMany({
      where, take: q.take,
      orderBy: [{ confidence: 'asc' }, { createdAt: 'asc' }],
      include: {
        evidence: true,
        document: { select: { id: true, fileName: true, documentNumber: true, currentVersionId: true } },
      },
    });
  });

  /**
   * Previa de impacto da correcao (§8): mostra o que muda ANTES de aplicar.
   * Nenhuma alteracao relevante se propaga sem o usuario ver o efeito.
   */
  app.post('/api/projects/:id/validation/quantities/:itemId/preview-impact', async (req) => {
    const u = currentUser(req);
    const { id, itemId } = z.object({ id: z.string(), itemId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const body = z.object({ corrections: z.record(z.unknown()) }).parse(req.body);

    const item = await prisma.quantityItem.findFirstOrThrow({ where: { id: itemId, projectId: id } });
    const newQty = typeof body.corrections['qty'] === 'number' ? (body.corrections['qty'] as number) : item.qty;
    const delta = Number((newQty - item.qty).toFixed(4));

    const activities = await prisma.activity.findMany({
      where: { projectId: id, quantityItemIds: { has: itemId } },
      select: { id: true, code: true, name: true, qty: true, unit: true, workHH: true, durationMinutes: true, durationStatus: true },
    });
    const wbsNode = item.wbsNodeId
      ? await prisma.wbsNode.findUnique({ where: { id: item.wbsNodeId }, select: { id: true, code: true, name: true, qty: true, unit: true } })
      : null;
    const controlItems = await prisma.controlMapItem.count({ where: { projectId: id, controlKey: item.entityKey } });

    return {
      item: { id: item.id, entityKey: item.entityKey, qty: item.qty, unit: item.unit },
      proposed: { qty: newQty, delta, ...body.corrections },
      impact: {
        wbsNode,
        activities: activities.map((a) => ({
          ...a,
          note: delta !== 0
            ? 'A quantidade da atividade muda; HH e duracao serao recalculados e precisam de nova aprovacao.'
            : 'Sem efeito na quantidade da atividade.',
        })),
        controlMapItems: controlItems,
        requiresRecalculation: delta !== 0,
        requiresApproval: true,
      },
    };
  });

  app.post('/api/projects/:id/validation/quantities/:itemId/decide', async (req) => {
    const u = currentUser(req);
    const { id, itemId } = z.object({ id: z.string(), itemId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const body = decisionSchema.parse(req.body);

    const before = await prisma.quantityItem.findFirst({ where: { id: itemId, projectId: id } });
    if (!before) throw notFound('Item quantitativo nao encontrado.');
    if (before.version !== body.version) {
      throw conflict(`Item alterado por outra pessoa (versao atual ${before.version}, voce leu ${body.version}).`, { currentVersion: before.version });
    }
    if (body.decision !== 'APPROVED' && !body.justification?.trim()) {
      throw badRequest('Rejeicao, correcao ou marcacao de pendencia exige justificativa registrada.');
    }

    const corrections = body.corrections ?? {};
    const allowed = ['qty', 'unit', 'lineNumber', 'nominalDiameterIn', 'pipeClass', 'schedule', 'material', 'area', 'system', 'subsystem', 'itemType', 'tag'];
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(corrections)) {
      if (allowed.includes(k)) data[k] = v;
    }
    if (body.decision === 'CORRECTED' && Object.keys(data).length === 0) {
      throw badRequest('Correcao sem nenhum campo alterado.');
    }

    const after = await prisma.quantityItem.update({
      where: { id: itemId },
      data: {
        ...data,
        // Corrigido por humano deixa de ser extracao: passa a ser entrada validada.
        ...(body.decision === 'CORRECTED' ? { dataClass: 'USER_INPUT' as const } : {}),
        reviewStatus: body.decision,
        reviewedBy: u.id,
        reviewedAt: new Date(),
        note: body.justification ?? null,
        version: { increment: 1 },
      },
    });

    await prisma.decision.create({
      data: {
        projectId: id, stage: 'QUANTITY', targetId: itemId, decision: body.decision, by: u.id,
        justification: body.justification ?? 'Aprovado sem alteracoes.',
        before: before as never, after: after as never,
      },
    });
    await audit({
      projectId: id, userId: u.id, action: `QUANTITY_${body.decision}`, entity: 'QuantityItem',
      entityId: itemId, before, after, justification: body.justification ?? null,
    });
    publish({ kind: 'quantity.approved', projectId: id, by: u.id, payload: { itemId, decision: body.decision, qty: after.qty } });
    return after;
  });

  /** Aprovacao em lote — permitida somente com regra transparente e registrada (§8). */
  app.post('/api/projects/:id/validation/quantities/bulk-approve', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const body = z.object({
      rule: z.object({
        minConfidence: z.number().min(0).max(1),
        documentId: z.string().optional(),
        discipline: z.string().optional(),
        sourceKind: z.string().optional(),
      }),
      justification: z.string().min(10, 'Aprovacao em lote exige a regra escrita e justificada.'),
      maxItems: z.number().int().max(2000).default(500),
    }).parse(req.body);

    const where = {
      projectId: id, reviewStatus: 'PENDING' as const,
      confidence: { gte: body.rule.minConfidence },
      ...(body.rule.documentId ? { documentId: body.rule.documentId } : {}),
      ...(body.rule.discipline ? { discipline: body.rule.discipline } : {}),
      ...(body.rule.sourceKind ? { sourceKind: body.rule.sourceKind } : {}),
    };
    const items = await prisma.quantityItem.findMany({ where, take: body.maxItems, select: { id: true } });
    if (items.length === 0) return { approved: 0, rule: body.rule };

    await prisma.quantityItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { reviewStatus: 'APPROVED', reviewedBy: u.id, reviewedAt: new Date(), note: `Lote: ${body.justification}` },
    });
    await prisma.decision.create({
      data: {
        projectId: id, stage: 'QUANTITY', targetId: `BULK:${items.length}`, decision: 'APPROVED', by: u.id,
        justification: `${body.justification} | Regra aplicada: ${JSON.stringify(body.rule)}`,
        after: { approvedIds: items.map((i) => i.id) } as never,
      },
    });
    await audit({
      projectId: id, userId: u.id, action: 'QUANTITY_BULK_APPROVED', entity: 'QuantityItem',
      entityId: null, after: { count: items.length, rule: body.rule }, justification: body.justification,
    });
    publish({ kind: 'quantity.approved', projectId: id, by: u.id, payload: { bulk: true, count: items.length } });
    return { approved: items.length, rule: body.rule };
  });

  app.post('/api/projects/:id/validation/entities/:entityId/decide', async (req) => {
    const u = currentUser(req);
    const { id, entityId } = z.object({ id: z.string(), entityId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const body = decisionSchema.parse(req.body);

    const before = await prisma.techEntity.findFirst({ where: { id: entityId, projectId: id } });
    if (!before) throw notFound('Entidade nao encontrada.');
    if (before.version !== body.version) {
      throw conflict(`Entidade alterada por outra pessoa (versao atual ${before.version}).`, { currentVersion: before.version });
    }
    if (body.decision !== 'APPROVED' && !body.justification?.trim()) {
      throw badRequest('Rejeicao ou correcao exige justificativa registrada.');
    }

    const attributes = body.corrections
      ? { ...(before.attributes as Record<string, unknown>), ...body.corrections }
      : (before.attributes as Record<string, unknown>);

    const after = await prisma.techEntity.update({
      where: { id: entityId },
      data: {
        attributes: attributes as never,
        ...(body.decision === 'CORRECTED' ? { dataClass: 'USER_INPUT' as const } : {}),
        reviewStatus: body.decision, reviewedBy: u.id, reviewedAt: new Date(),
        note: body.justification ?? null, version: { increment: 1 },
      },
    });
    await prisma.decision.create({
      data: {
        projectId: id, stage: 'ENTITY_RELATION', targetId: entityId, decision: body.decision, by: u.id,
        justification: body.justification ?? 'Aprovado sem alteracoes.', before: before as never, after: after as never,
      },
    });
    await audit({ projectId: id, userId: u.id, action: `ENTITY_${body.decision}`, entity: 'TechEntity', entityId, before, after, justification: body.justification ?? null });
    publish({ kind: 'entity.updated', projectId: id, by: u.id, payload: { entityId, decision: body.decision } });
    return after;
  });

  /** Comentarios e mencoes por item validado. */
  app.post('/api/projects/:id/comments', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const body = z.object({
      entity: z.string(), entityId: z.string(), body: z.string().min(1),
      mentions: z.array(z.string()).default([]),
    }).parse(req.body);
    const created = await prisma.comment.create({
      data: { projectId: id, userId: u.id, entity: body.entity, entityId: body.entityId, body: body.body, mentions: body.mentions },
      include: { user: { select: { id: true, name: true } } },
    });
    publish({ kind: 'comment.added', projectId: id, by: u.id, payload: { commentId: created.id, entity: body.entity, entityId: body.entityId } });
    return reply.status(201).send(created);
  });

  app.get('/api/projects/:id/comments', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({ entity: z.string().optional(), entityId: z.string().optional() }).parse(req.query);
    return prisma.comment.findMany({
      where: { projectId: id, ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
  });
}
