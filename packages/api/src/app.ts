import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from './env.js';
import { HttpError, unauthorized } from './lib/http.js';
import { verifyToken } from './lib/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerValidationRoutes } from './routes/validation.js';
import { registerScopeRoutes } from './routes/scope.js';
import { registerPlanningRoutes } from './routes/planning.js';
import { registerExportRoutes } from './routes/exports.js';
import { registerAuditRoutes } from './routes/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; organizationId: string; email: string };
  }
}

/** Rotas que dispensam autenticacao. Tudo o mais exige token valido. */
const PUBLIC = new Set(['/api/health', '/api/auth/login', '/api/auth/register-organization']);

/** Unica rota que aceita o token via query, pela limitacao do EventSource. */
const SSE_PATH = /^\/api\/projects\/[^/]+\/events$/;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      // Log sem conteudo de documento (§19): apenas metadados de requisicao.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password'],
    },
    bodyLimit: env.maxUploadBytes,
  });

  await app.register(cors, { origin: env.corsOrigin.split(',').map((s) => s.trim()), credentials: true });
  await app.register(multipart, {
    limits: { fileSize: env.maxUploadBytes, files: 500 },
  });

  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0] ?? '';
    if (PUBLIC.has(path)) return;

    const header = req.headers.authorization;
    let raw: string | undefined;
    if (header?.startsWith('Bearer ')) {
      raw = header.slice(7);
    } else if (SSE_PATH.test(path)) {
      // EventSource nao permite cabecalho de autorizacao. Aceitamos o token na query
      // APENAS nesta rota, que e somente-leitura; o token continua sendo validado igual.
      raw = (req.query as Record<string, string | undefined>)['token'];
    }
    if (!raw) throw unauthorized();

    try {
      const payload = verifyToken(raw);
      req.user = { id: payload.sub, organizationId: payload.org, email: payload.email };
    } catch (e) {
      throw unauthorized(e instanceof Error ? e.message : 'Token invalido.');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code ?? 'ERROR', message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados invalidos na requisicao.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if ((err as { code?: string }).code === 'P2002') {
      return reply.status(409).send({ error: 'DUPLICATE', message: 'Registro ja existente com a mesma chave.' });
    }
    req.log.error({ err }, 'erro nao tratado');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Erro interno. O evento foi registrado.' });
  });

  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));

  await registerAuthRoutes(app);
  await registerProjectRoutes(app);
  await registerDocumentRoutes(app);
  await registerValidationRoutes(app);
  await registerScopeRoutes(app);
  await registerPlanningRoutes(app);
  await registerExportRoutes(app);
  await registerAuditRoutes(app);

  return app;
}

export function currentUser(req: FastifyRequest): { id: string; organizationId: string; email: string } {
  if (!req.user) throw unauthorized();
  return req.user;
}
