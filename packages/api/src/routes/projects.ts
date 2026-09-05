import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../app.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { assertVersion } from '../lib/concurrency.js';
import { subscribe } from '../lib/events.js';
import { badRequest, notFound } from '../lib/http.js';
import { requireCapability, requireMembership } from '../lib/rbac.js';

const createSchema = z.object({
  name: z.string().min(2),
  client: z.string().optional(),
  contract: z.string().optional(),
  scopeSummary: z.string().optional(),
  site: z.string().optional(),
  disciplines: z.array(z.string()).default([]),
  definitionOfDone: z.string().optional(),
  contractStart: z.string().datetime().optional(),
  contractFinish: z.string().datetime().optional(),
  mspVersion: z.string().default('2016'),
  isDemo: z.boolean().default(false),
});

/**
 * Campos que, quando nao informados, geram PENDENCIA em vez de valor generico (§5.1).
 * Esta lista e a materializacao da regra "nao preencha automaticamente".
 */
const REQUIRED_FOR_PLANNING: { field: keyof z.infer<typeof createSchema>; label: string; severity: string }[] = [
  { field: 'client', label: 'Cliente', severity: 'MEDIUM' },
  { field: 'contract', label: 'Contrato', severity: 'HIGH' },
  { field: 'scopeSummary', label: 'Escopo contratado', severity: 'HIGH' },
  { field: 'site', label: 'Local da obra', severity: 'LOW' },
  { field: 'definitionOfDone', label: 'Definicao objetiva de "entregue"', severity: 'HIGH' },
  { field: 'contractStart', label: 'Data de inicio contratual', severity: 'HIGH' },
  { field: 'contractFinish', label: 'Marco final contratual', severity: 'HIGH' },
];

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async (req) => {
    const u = currentUser(req);
    const memberships = await prisma.projectMember.findMany({
      where: { userId: u.id },
      include: {
        project: {
          include: { _count: { select: { documents: true, activities: true, openIssues: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return memberships.map((m) => ({ ...m.project, myRole: m.role }));
  });

  app.post('/api/projects', async (req, reply) => {
    const u = currentUser(req);
    const body = createSchema.parse(req.body);

    const project = await prisma.project.create({
      data: {
        organizationId: u.organizationId,
        name: body.isDemo ? `${body.name} [DEMONSTRACAO]` : body.name,
        client: body.client ?? null,
        contract: body.contract ?? null,
        scopeSummary: body.scopeSummary ?? null,
        site: body.site ?? null,
        disciplines: body.disciplines,
        definitionOfDone: body.definitionOfDone ?? null,
        contractStart: body.contractStart ? new Date(body.contractStart) : null,
        contractFinish: body.contractFinish ? new Date(body.contractFinish) : null,
        mspVersion: body.mspVersion,
        isDemo: body.isDemo,
        members: { create: { userId: u.id, role: 'ADMIN' } },
      },
    });

    // Nada e preenchido por conta: o que faltou vira pendencia rastreavel.
    const missing = REQUIRED_FOR_PLANNING.filter((f) => !body[f.field]);
    if (missing.length > 0) {
      await prisma.openIssue.createMany({
        data: missing.map((m) => ({
          projectId: project.id,
          scope: `project.${String(m.field)}`,
          description: `"${m.label}" nao informado na criacao do projeto. O sistema nao adota valor generico: informe ou registre como premissa aprovada.`,
          severity: m.severity,
        })),
      });
    }

    await audit({ projectId: project.id, userId: u.id, action: 'PROJECT_CREATED', entity: 'Project', entityId: project.id, after: project });
    return reply.status(201).send({ project, openIssuesCreated: missing.length });
  });

  app.get('/api/projects/:id', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const role = await requireMembership(u.id, id);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        calendars: true,
        _count: { select: { documents: true, quantities: true, activities: true, openIssues: true, conflicts: true } },
      },
    });
    return { ...project, myRole: role };
  });

  app.patch('/api/projects/:id', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.admin');
    const body = createSchema.partial().extend({ version: z.number().int() }).parse(req.body);

    const before = await prisma.project.findUniqueOrThrow({ where: { id } });
    assertVersion('Projeto', before, body.version);

    const { version, isDemo, contractStart, contractFinish, ...rest } = body;
    const after = await prisma.project.update({
      where: { id },
      data: {
        ...rest,
        ...(contractStart !== undefined ? { contractStart: contractStart ? new Date(contractStart) : null } : {}),
        ...(contractFinish !== undefined ? { contractFinish: contractFinish ? new Date(contractFinish) : null } : {}),
        version: { increment: 1 },
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'PROJECT_UPDATED', entity: 'Project', entityId: id, before, after });
    return after;
  });

  // --- Membros ---
  app.post('/api/projects/:id/members', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.admin');
    const body = z.object({
      userId: z.string(),
      role: z.enum(['ADMIN', 'PLANNER', 'REVIEWER', 'VIEWER']),
    }).parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!target || target.organizationId !== u.organizationId) {
      throw badRequest('Usuario nao pertence a esta organizacao.');
    }
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: body.userId } },
      create: { projectId: id, userId: body.userId, role: body.role },
      update: { role: body.role },
    });
    await audit({ projectId: id, userId: u.id, action: 'MEMBER_SET', entity: 'ProjectMember', entityId: member.id, after: member });
    return reply.status(201).send(member);
  });

  app.delete('/api/projects/:id/members/:userId', async (req) => {
    const u = currentUser(req);
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.admin');
    const before = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId } } });
    if (!before) throw notFound('Membro nao encontrado.');
    await prisma.projectMember.delete({ where: { id: before.id } });
    await audit({ projectId: id, userId: u.id, action: 'MEMBER_REMOVED', entity: 'ProjectMember', entityId: before.id, before });
    return { removed: true };
  });

  // --- Eventos em tempo real (SSE) ---
  app.get('/api/projects/:id/events', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ projectId: id, at: new Date().toISOString() })}\n\n`);

    const unsubscribe = subscribe(id, reply);
    const keepAlive = setInterval(() => {
      try { reply.raw.write(': keep-alive\n\n'); } catch { /* fechado */ }
    }, 25000);

    req.raw.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
    return reply;
  });

  // --- Pendencias, premissas e decisoes ---
  app.get('/api/projects/:id/issues', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    const q = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() }).parse(req.query);
    return prisma.openIssue.findMany({
      where: { projectId: id, ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
  });

  app.post('/api/projects/:id/issues/:issueId/resolve', async (req) => {
    const u = currentUser(req);
    const { id, issueId } = z.object({ id: z.string(), issueId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.write');
    const body = z.object({ resolution: z.string().min(5) }).parse(req.body);
    const before = await prisma.openIssue.findUniqueOrThrow({ where: { id: issueId } });
    const after = await prisma.openIssue.update({
      where: { id: issueId },
      data: { status: 'RESOLVED', resolvedBy: u.id, resolvedAt: new Date(), resolution: body.resolution },
    });
    await audit({ projectId: id, userId: u.id, action: 'ISSUE_RESOLVED', entity: 'OpenIssue', entityId: issueId, before, after, justification: body.resolution });
    return after;
  });

  app.get('/api/projects/:id/assumptions', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    return prisma.assumption.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' } });
  });

  app.post('/api/projects/:id/assumptions', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'project.write');
    const body = z.object({
      statement: z.string().min(5),
      rationale: z.string().optional(),
      source: z.string().optional(),
    }).parse(req.body);
    const created = await prisma.assumption.create({ data: { projectId: id, ...body } });
    await audit({ projectId: id, userId: u.id, action: 'ASSUMPTION_CREATED', entity: 'Assumption', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  app.post('/api/projects/:id/assumptions/:assumptionId/approve', async (req) => {
    const u = currentUser(req);
    const { id, assumptionId } = z.object({ id: z.string(), assumptionId: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'validation.approve');
    const after = await prisma.assumption.update({
      where: { id: assumptionId },
      data: { approvedBy: u.id, approvedAt: new Date() },
    });
    await audit({ projectId: id, userId: u.id, action: 'ASSUMPTION_APPROVED', entity: 'Assumption', entityId: assumptionId, after });
    return after;
  });

  app.get('/api/projects/:id/decisions', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    return prisma.decision.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 500 });
  });

  // --- Calendarios e recursos ---
  app.post('/api/projects/:id/calendars', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      workWeek: z.record(z.array(z.object({ start: z.string(), end: z.string() }))),
      exceptions: z.array(z.object({ date: z.string(), working: z.boolean(), name: z.string() })).default([]),
      isDefault: z.boolean().default(false),
    }).parse(req.body);
    const created = await prisma.workCalendarDef.create({
      data: { projectId: id, ...body, workWeek: body.workWeek as never, exceptions: body.exceptions as never },
    });
    await audit({ projectId: id, userId: u.id, action: 'CALENDAR_CREATED', entity: 'WorkCalendarDef', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  app.post('/api/projects/:id/resources', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      kind: z.string().default('WORK'),
      group: z.string().optional(),
      maxUnits: z.number().positive().default(1),
      productiveHoursPerDay: z.number().positive().optional(),
    }).parse(req.body);
    const created = await prisma.resourceDef.create({ data: { projectId: id, ...body } });
    await audit({ projectId: id, userId: u.id, action: 'RESOURCE_CREATED', entity: 'ResourceDef', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  app.get('/api/projects/:id/resources', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    return prisma.resourceDef.findMany({ where: { projectId: id }, orderBy: { code: 'asc' } });
  });

  app.post('/api/projects/:id/productivity', async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireCapability(u.id, id, 'schedule.write');
    const body = z.object({
      code: z.string().min(1),
      description: z.string().min(1),
      value: z.number().positive(),
      perUnit: z.string().min(1),
      basis: z.enum(['BUDGETED', 'PLANNED', 'OBSERVED', 'FORECAST']),
      // Fonte e data sao obrigatorias por regra de negocio, nao por formalidade.
      source: z.string().min(5, 'Informe a fonte do indice (historico, orcamento, norma). Sem fonte o indice nao calcula duracao.'),
      sourceDate: z.string(),
    }).parse(req.body);
    // Indice digitado por humano identificado ja nasce aprovado; o importado de
    // arquivo nasce PENDENTE e passa pela conferencia.
    const created = await prisma.productivityIndex.create({
      data: {
        projectId: id, ...body, sourceDate: new Date(body.sourceDate),
        approvalStatus: 'APPROVED', approvedBy: u.id, approvedAt: new Date(),
      },
    });
    await audit({ projectId: id, userId: u.id, action: 'PRODUCTIVITY_CREATED', entity: 'ProductivityIndex', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  app.get('/api/projects/:id/productivity', async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await requireMembership(u.id, id);
    return prisma.productivityIndex.findMany({
      where: { projectId: id },
      include: { import: { select: { id: true, fileName: true, sha256: true, createdAt: true } } },
      orderBy: [{ approvalStatus: 'asc' }, { code: 'asc' }],
    });
  });
}
