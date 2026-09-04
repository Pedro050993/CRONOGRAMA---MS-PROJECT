import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember, cleanupStorage, createOrgWithOwner, createProject, createUser,
  migrateTestDb, resetDb, type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let reviewer: TestUser;
let viewer: TestUser;
let projectId: string;
let itemId: string;

beforeAll(async () => {
  migrateTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
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
  reviewer = await createUser(app, owner, 'revisor@teste.local', 'Revisor');
  viewer = await createUser(app, owner, 'leitor@teste.local', 'Leitor');
  projectId = await createProject(app, owner);
  await addMember(app, owner, projectId, reviewer.id, 'REVIEWER');
  await addMember(app, owner, projectId, viewer.id, 'VIEWER');

  const { prisma } = await import('../src/db.js');
  const doc = await prisma.document.create({
    data: { projectId, fileName: 'ISO.pdf', folderPath: '/ISO', documentNumber: 'CPM-20.701' },
  });
  const item = await prisma.quantityItem.create({
    data: {
      projectId, documentId: doc.id, entityKey: 'JOINTS|10-P-1201', discipline: 'PIPING',
      sourceKind: 'PIPING_ISOMETRIC', lineNumber: '10-P-1201', nominalDiameterIn: 10,
      qty: 14, unit: 'jt', dataClass: 'AI_INFERENCE', confidence: 0.62, reviewStatus: 'PENDING',
    },
  });
  itemId = item.id;
});

const post = (url: string, user: TestUser, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${user.token}` }, payload });
const get = (url: string, user: TestUser) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${user.token}` } });

describe('validacao humana da extracao', () => {
  it('a fila mostra o pior caso primeiro e permite filtrar por confianca', async () => {
    const r = await get(`/api/projects/${projectId}/validation/queue?kind=quantity&maxConfidence=0.8`, reviewer);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].confidence).toBe(0.62);

    const vazio = await get(`/api/projects/${projectId}/validation/queue?kind=quantity&maxConfidence=0.5`, reviewer);
    expect(vazio.json()).toHaveLength(0);
  });

  it('VIEWER nao aprova', async () => {
    const r = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, viewer, {
      decision: 'APPROVED', version: 1,
    });
    expect(r.statusCode).toBe(403);
  });

  it('mostra o IMPACTO da correcao antes de aplicar', async () => {
    const r = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/preview-impact`, reviewer, {
      corrections: { qty: 16 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().proposed.delta).toBe(2);
    expect(r.json().impact.requiresRecalculation).toBe(true);
    expect(r.json().impact.requiresApproval).toBe(true);
  });

  it('aprovacao registra revisor, decisao e auditoria', async () => {
    const r = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, {
      decision: 'APPROVED', version: 1,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().reviewStatus).toBe('APPROVED');
    expect(r.json().reviewedBy).toBe(reviewer.id);

    const hist = await get(`/api/projects/${projectId}/history/QuantityItem/${itemId}`, reviewer);
    expect(hist.json().audit.some((a: { action: string }) => a.action === 'QUANTITY_APPROVED')).toBe(true);
    expect(hist.json().decisions[0].decision).toBe('APPROVED');
  });

  it('correcao muda a classe do dado de INFERENCIA para ENTRADA VALIDADA', async () => {
    const r = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, {
      decision: 'CORRECTED', version: 1, corrections: { qty: 16 },
      justification: 'Contagem conferida na prancha: sao 16 juntas, nao 14.',
    });
    expect(r.json().qty).toBe(16);
    expect(r.json().dataClass).toBe('USER_INPUT');
    expect(r.json().note).toMatch(/16 juntas/);
  });

  it('EXIGE justificativa para rejeitar ou corrigir', async () => {
    const semJust = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, {
      decision: 'REJECTED', version: 1,
    });
    expect(semJust.statusCode).toBe(400);
    expect(semJust.json().message).toMatch(/justificativa/);
  });

  it('bloqueia sobrescrita concorrente com 409 e devolve a versao atual', async () => {
    await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, { decision: 'APPROVED', version: 1 });
    const segundo = await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, owner, {
      decision: 'CORRECTED', version: 1, corrections: { qty: 99 }, justification: 'Alteracao concorrente de teste',
    });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().details.currentVersion).toBe(2);

    const { prisma } = await import('../src/db.js');
    expect((await prisma.quantityItem.findUniqueOrThrow({ where: { id: itemId } })).qty).toBe(14);
  });

  it('aprovacao em lote exige regra escrita e registra a regra aplicada', async () => {
    const semJust = await post(`/api/projects/${projectId}/validation/quantities/bulk-approve`, reviewer, {
      rule: { minConfidence: 0.6 }, justification: 'ok',
    });
    expect(semJust.statusCode).toBe(400);

    const r = await post(`/api/projects/${projectId}/validation/quantities/bulk-approve`, reviewer, {
      rule: { minConfidence: 0.6, sourceKind: 'PIPING_ISOMETRIC' },
      justification: 'Itens de isometrico com confianca acima de 0,60 conferidos por amostragem de 20%.',
    });
    expect(r.json().approved).toBe(1);

    const dec = await get(`/api/projects/${projectId}/decisions`, reviewer);
    expect(dec.json()[0].justification).toMatch(/Regra aplicada/);
  });

  it('item pendente NAO entra no quadro quantitativo aprovado', async () => {
    const antes = await get(`/api/projects/${projectId}/quantities/rollup?groupBy=discipline&unit=jt&onlyApproved=true`, reviewer);
    expect(antes.json().totals.qty).toBe(0);

    await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, { decision: 'APPROVED', version: 1 });

    const depois = await get(`/api/projects/${projectId}/quantities/rollup?groupBy=discipline&unit=jt&onlyApproved=true`, reviewer);
    expect(depois.json().totals.qty).toBe(14);
  });

  it('o portao de promocao bloqueia enquanto a extracao nao for aprovada', async () => {
    const antes = await get(`/api/projects/${projectId}/schedule/promotion-check`, reviewer);
    expect(antes.json().canPromote).toBe(false);
    expect(antes.json().blocked[0].reason).toMatch(/sem aprovacao humana/);

    await post(`/api/projects/${projectId}/validation/quantities/${itemId}/decide`, reviewer, { decision: 'APPROVED', version: 1 });
    const depois = await get(`/api/projects/${projectId}/schedule/promotion-check`, reviewer);
    expect(depois.json().canPromote).toBe(true);
  });
});
