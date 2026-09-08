import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { requireMembership } from '../lib/rbac.js';

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:id/audit', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({
      entity: z.string().optional(),
      entityId: z.string().optional(),
      action: z.string().optional(),
      userId: z.string().optional(),
      take: z.coerce.number().max(1000).default(200),
      skip: z.coerce.number().default(0),
    }).parse(req.query);

    const where = {
      projectId: id,
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, take: q.take, skip: q.skip,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { total, rows };
  });

  /** Historico de versoes de um item especifico, montado a partir da auditoria. */
  app.get('/api/projects/:id/history/:entity/:entityId', async (req) => {
    const u = currentUser(req);
    const { id, entity, entityId } = z.object({ id: z.string(), entity: z.string(), entityId: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const rows = await prisma.auditLog.findMany({
      where: { projectId: id, entity, entityId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
    const decisions = await prisma.decision.findMany({ where: { projectId: id, targetId: entityId }, orderBy: { createdAt: 'asc' } });
    return { audit: rows, decisions };
  });
}
