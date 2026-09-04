import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember, cleanupStorage, createOrgWithOwner, createProject, createUser,
  migrateTestDb, resetDb, type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let planner: TestUser;
let projectId: string;

beforeAll(async () => {
  migrateTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  const { prisma } = await import('../src/db.js');
  await prisma.$disconnect();
  cleanupStorage();
});
beforeEach(async () => {
  await resetDb();
  owner = await createOrgWithOwner(app);
  planner = await createUser(app, owner, 'planejador@teste.local', 'Planejador');
  projectId = await createProject(app, owner);
  await addMember(app, owner, projectId, planner.id, 'PLANNER');
});

describe('sincronizacao em tempo real (SSE)', () => {
  it('a alteracao de um usuario chega ao outro pelo canal do projeto', async () => {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const controller = new AbortController();
    const received: string[] = [];

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/events`, {
      headers: { authorization: `Bearer ${planner.token}` },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readLoop = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received.push(decoder.decode(value, { stream: true }));
        }
      } catch { /* abortado ao fim do teste */ }
    })();

    // Espera o handshake antes de disparar o evento.
    for (let i = 0; i < 50 && received.join('').indexOf('event: connected') === -1; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(received.join('')).toContain('event: connected');

    await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/wbs`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { parentId: null, type: 'PROJECT', code: 'OBRA', name: 'Obra' },
    });

    for (let i = 0; i < 100 && received.join('').indexOf('wbs.changed') === -1; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const stream = received.join('');
    expect(stream).toContain('event: wbs.changed');
    expect(stream).toContain('"by":"' + owner.id + '"');

    controller.abort();
    await readLoop;
  });

  it('quem nao e membro nao abre o canal do projeto', async () => {
    const outsider = await createUser(app, owner, 'fora@teste.local', 'Fora');
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/events`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('trilha de auditoria', () => {
  it('registra usuario, acao, valor anterior e valor novo', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/projects/${projectId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { version: 1, client: 'Cliente Corrigido' },
    });
    expect(r.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/audit?entity=Project`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const row = audit.json().rows.find((a: { action: string }) => a.action === 'PROJECT_UPDATED');
    expect(row.user.email).toBe(owner.email);
    expect(row.before.client).toBe('Cliente de Teste');
    expect(row.after.client).toBe('Cliente Corrigido');
  });

  it('bloqueia sobrescrita concorrente do projeto', async () => {
    await app.inject({
      method: 'PATCH', url: `/api/projects/${projectId}`,
      headers: { authorization: `Bearer ${owner.token}` }, payload: { version: 1, site: 'Local A' },
    });
    const segundo = await app.inject({
      method: 'PATCH', url: `/api/projects/${projectId}`,
      headers: { authorization: `Bearer ${owner.token}` }, payload: { version: 1, site: 'Local B' },
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().message).toMatch(/alterado por outra pessoa/);
  });

  it('exporta a auditoria em CSV', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/exports/audit.csv`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('valor_anterior');
    expect(r.body).toContain('PROJECT_CREATED');
  });
});

describe('protecao do realizado', () => {
  it('registrar realizado pela primeira vez nao exige justificativa; alterar exige', async () => {
    const { prisma } = await import('../src/db.js');
    const cal = await prisma.workCalendarDef.create({
      data: { projectId, code: 'C', name: 'C', workWeek: {} as never, exceptions: [] as never },
    });
    const act = await prisma.activity.create({
      data: { projectId, code: 'A-1', name: 'Montagem', calendarId: cal.id, durationStatus: 'CALCULATED', durationMinutes: 480 },
    });

    const primeiro = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/activities/${act.id}/actuals`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { actualWorkHH: 40, version: 1 },
    });
    expect(primeiro.statusCode).toBe(200);

    const semJustificativa = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/activities/${act.id}/actuals`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { actualWorkHH: 25, version: 2 },
    });
    expect(semJustificativa.statusCode).toBe(400);
    expect(semJustificativa.json().message).toMatch(/nao e reescrito em silencio/);

    const comJustificativa = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/activities/${act.id}/actuals`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { actualWorkHH: 25, version: 2, justification: 'Apontamento duplicado no RDO de 12/03 corrigido.' },
    });
    expect(comJustificativa.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/audit?action=ACTUAL_CHANGED`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(audit.json().rows[0].justification).toMatch(/RDO de 12\/03/);
    expect(audit.json().rows[0].before.actualWorkHH).toBe(40);
  });

  it('PLANNER nao altera realizado ja registrado — isso e de ADMIN', async () => {
    const { prisma } = await import('../src/db.js');
    const act = await prisma.activity.create({
      data: { projectId, code: 'A-2', name: 'Soldagem', actualWorkHH: 10, durationStatus: 'CALCULATED' },
    });
    const r = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/activities/${act.id}/actuals`,
      headers: { authorization: `Bearer ${planner.token}` },
      payload: { actualWorkHH: 5, version: 1, justification: 'Tentativa de alteracao pelo planejador.' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/exige papel ADMIN/);
  });
});

describe('mapas de controle', () => {
  it('recusa concluir etapa sem evidencia nem excecao aprovada', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${projectId}/control-maps/MAP.PIPING.V1/items/10-P-1201`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { fields: {}, stages: { FABRICATION: { status: 'DONE' } } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/sem evidencia/);
  });

  it('aceita com evidencia e calcula avanco ponderado com semaforo explicito', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${projectId}/control-maps/MAP.PIPING.V1/items/10-P-1201`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        fields: { area: 'A100', lineNumber: '10-P-1201' },
        stages: {
          FABRICATION: { status: 'DONE', evidenceRef: 'ROM-0012' },
          ERECTION: { status: 'DONE', evidenceRef: 'RM-0033' },
        },
        plannedHH: 200,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().evaluation.physicalProgress).toBeCloseTo(0.45, 4);
    expect(r.json().evaluation.semaphoreRule).toBeTruthy();
  });

  it('acusa quebra de sequencia tecnica com semaforo VERMELHO', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${projectId}/control-maps/MAP.PIPING.V1/items/8-P-1202`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { fields: {}, stages: { WELDING: { status: 'DONE', evidenceRef: 'S-1' } }, plannedHH: 100 },
    });
    expect(r.json().evaluation.semaphore).toBe('RED');
    expect(r.json().evaluation.violations.join(' ')).toMatch(/sequencia tecnica foi quebrada/);
  });

  it('avanco do conjunto e ponderado por HH e exclui item sem HH', async () => {
    const put = (key: string, payload: unknown) => app.inject({
      method: 'PUT', url: `/api/projects/${projectId}/control-maps/MAP.PIPING.V1/items/${key}`,
      headers: { authorization: `Bearer ${owner.token}` }, payload,
    });
    await put('L1', { fields: {}, stages: { FABRICATION: { status: 'DONE', evidenceRef: 'x' } }, plannedHH: 900 });
    await put('L2', { fields: {}, stages: {}, plannedHH: 100 });

    const r = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/control-maps/MAP.PIPING.V1/items`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(r.json().progress.totalHH).toBe(1000);
    expect(r.json().progress.progress).toBeCloseTo(0.135, 4);
  });
});
