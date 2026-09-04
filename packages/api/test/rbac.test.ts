import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, cleanupStorage, createOrgWithOwner, createProject, createUser, migrateTestDb, resetDb, type TestUser } from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let planner: TestUser;
let reviewer: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let projectId: string;

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
  owner = await createOrgWithOwner(app, 'dono@teste.local');
  planner = await createUser(app, owner, 'planejador@teste.local', 'Planejador');
  reviewer = await createUser(app, owner, 'revisor@teste.local', 'Revisor');
  viewer = await createUser(app, owner, 'leitor@teste.local', 'Leitor');
  outsider = await createUser(app, owner, 'externo@teste.local', 'Externo');
  projectId = await createProject(app, owner);
  await addMember(app, owner, projectId, planner.id, 'PLANNER');
  await addMember(app, owner, projectId, reviewer.id, 'REVIEWER');
  await addMember(app, owner, projectId, viewer.id, 'VIEWER');
});

const get = (url: string, user: TestUser) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${user.token}` } });
const post = (url: string, user: TestUser, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${user.token}` }, payload });

describe('autenticacao', () => {
  it('rejeita rota protegida sem token', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(r.statusCode).toBe(401);
  });

  it('rejeita token adulterado', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: { authorization: `Bearer ${owner.token.slice(0, -4)}AAAA` },
    });
    expect(r.statusCode).toBe(401);
  });

  it('nao distingue e-mail inexistente de senha errada', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nao@existe.local', password: 'x' } });
    const b = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: owner.email, password: 'errada' } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().message).toBe(b.json().message);
  });

  it('recusa senha curta na criacao', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/auth/register-organization',
      payload: { organizationName: 'X', name: 'Y', email: 'curta@teste.local', password: 'curta' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('isolamento e papeis por projeto', () => {
  it('quem nao e membro nem sabe que o projeto existe', async () => {
    const r = await get(`/api/projects/${projectId}`, outsider);
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toMatch(/nao encontrado ou sem acesso/);
  });

  it('VIEWER le mas nao escreve', async () => {
    expect((await get(`/api/projects/${projectId}`, viewer)).statusCode).toBe(200);
    const r = await post(`/api/projects/${projectId}/wbs`, viewer, {
      parentId: null, type: 'PROJECT', code: 'X', name: 'X',
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/exige papel PLANNER/);
  });

  it('REVIEWER aprova extracao mas nao edita o cronograma', async () => {
    const wbs = await post(`/api/projects/${projectId}/wbs`, reviewer, { parentId: null, type: 'PROJECT', code: 'X', name: 'X' });
    expect(wbs.statusCode).toBe(403);
  });

  it('PLANNER edita o cronograma mas nao congela linha de base', async () => {
    const wbs = await post(`/api/projects/${projectId}/wbs`, planner, { parentId: null, type: 'PROJECT', code: 'P1', name: 'Projeto' });
    expect(wbs.statusCode).toBe(201);
    const bl = await post(`/api/projects/${projectId}/baselines`, planner, { name: 'BL0' });
    expect(bl.statusCode).toBe(403);
    expect(bl.json().message).toMatch(/exige papel ADMIN/);
  });

  it('ADMIN faz tudo no seu projeto', async () => {
    const r = await post(`/api/projects/${projectId}/wbs`, owner, { parentId: null, type: 'PROJECT', code: 'P1', name: 'Projeto' });
    expect(r.statusCode).toBe(201);
  });

  it('remover membro corta o acesso imediatamente', async () => {
    expect((await get(`/api/projects/${projectId}`, viewer)).statusCode).toBe(200);
    const del = await app.inject({
      method: 'DELETE', url: `/api/projects/${projectId}/members/${viewer.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(del.statusCode).toBe(200);
    expect((await get(`/api/projects/${projectId}`, viewer)).statusCode).toBe(404);
  });
});

describe('criacao de projeto', () => {
  it('gera PENDENCIA para cada campo essencial nao informado, sem inventar valor', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Obra sem dados' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.openIssuesCreated).toBe(7);
    expect(body.project.client).toBeNull();
    expect(body.project.contractStart).toBeNull();

    const issues = await get(`/api/projects/${body.project.id}/issues`, owner);
    const scopes = issues.json().map((i: { scope: string }) => i.scope);
    expect(scopes).toContain('project.definitionOfDone');
    expect(scopes).toContain('project.contractFinish');
    expect(issues.json()[0].description).toMatch(/nao adota valor generico/);
  });

  it('projeto de demonstracao e marcado no proprio nome', async () => {
    const id = await createProject(app, owner, { name: 'Piloto', isDemo: true });
    const r = await get(`/api/projects/${id}`, owner);
    expect(r.json().name).toContain('[DEMONSTRACAO]');
    expect(r.json().isDemo).toBe(true);
  });
});
