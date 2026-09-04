import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { badRequest, unauthorized } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { currentUser } from '../app.js';
import { capabilities } from '../env.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const registerOrgSchema = z.object({
  organizationName: z.string().min(2),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10, 'A senha deve ter ao menos 10 caracteres.'),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Criacao da primeira organizacao e do seu dono. */
  app.post('/api/auth/register-organization', async (req, reply) => {
    const body = registerOrgSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw badRequest('Ja existe usuario com este e-mail.');

    const org = await prisma.organization.create({ data: { name: body.organizationName } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id, email: body.email, name: body.name,
        passwordHash: await hashPassword(body.password), orgRole: 'OWNER',
      },
    });
    await audit({ userId: user.id, action: 'ORG_CREATED', entity: 'Organization', entityId: org.id, after: { name: org.name } });
    return reply.status(201).send({
      token: signToken({ sub: user.id, org: org.id, email: user.email }),
      user: { id: user.id, name: user.name, email: user.email, organizationId: org.id },
    });
  });

  app.post('/api/auth/login', async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Mensagem unica para e-mail inexistente e senha errada: nao enumeramos usuarios.
    if (!user || !user.active || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('E-mail ou senha invalidos.');
    }
    return {
      token: signToken({ sub: user.id, org: user.organizationId, email: user.email }),
      user: { id: user.id, name: user.name, email: user.email, organizationId: user.organizationId },
    };
  });

  app.get('/api/auth/me', async (req) => {
    const u = currentUser(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { id: true, name: true, email: true, organizationId: true, orgRole: true },
    });
    const memberships = await prisma.projectMember.findMany({
      where: { userId: u.id },
      select: { projectId: true, role: true },
    });
    return { user, memberships };
  });

  /** A interface consulta isto para nao prometer capacidade que o ambiente nao tem. */
  app.get('/api/capabilities', async () => capabilities());

  /** Criacao de usuario dentro da organizacao. */
  app.post('/api/users', async (req, reply) => {
    const u = currentUser(req);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (me.orgRole !== 'OWNER') throw badRequest('Apenas o dono da organizacao pode criar usuarios.');
    const body = registerOrgSchema.omit({ organizationName: true }).parse(req.body);
    const created = await prisma.user.create({
      data: {
        organizationId: me.organizationId, email: body.email, name: body.name,
        passwordHash: await hashPassword(body.password),
      },
      select: { id: true, name: true, email: true },
    });
    await audit({ userId: u.id, action: 'USER_CREATED', entity: 'User', entityId: created.id, after: created });
    return reply.status(201).send(created);
  });

  app.get('/api/users', async (req) => {
    const u = currentUser(req);
    return prisma.user.findMany({
      where: { organizationId: u.organizationId },
      select: { id: true, name: true, email: true, orgRole: true, active: true },
      orderBy: { name: 'asc' },
    });
  });
}
