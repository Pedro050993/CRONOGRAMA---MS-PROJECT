/**
 * Importação da base de produtividade: XLSX e CSV reais, gravados no banco,
 * com o portão de aprovação valendo até o cálculo da duração.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  cleanupStorage, createOrgWithOwner, createProject, migrateTestDb,
  multipart, resetDb, type TestUser,
} from './helpers.js';
import { makeXlsx } from './xlsx-fixture.js';

let app: FastifyInstance;
let owner: TestUser;
let projectId: string;

const CSV = [
  'BASE DE PRODUTIVIDADE - TUBULACAO;;;;;',
  ';;;;;',
  'Codigo;Servico;Indice;Unidade;Base;Data',
  'IDX-MONT;Montagem de tubulacao carbono;0,90;pol-dia;Orcado;15/01/2026',
  'IDX-SOLD;Soldagem carbono;1,40;in-dia;Historico;15/01/2026',
  'IDX-RUIM;Servico com unidade estranha;2,00;vara;Orcado;15/01/2026',
].join('\r\n');

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
  projectId = await createProject(app, owner);
});

async function importar(
  file: { name: string; content: Buffer | string },
  fields: Record<string, string> = {},
) {
  const { body, headers } = multipart(
    [{ field: 'file', filename: file.name, content: file.content }],
    fields,
  );
  return app.inject({
    method: 'POST', url: `/api/projects/${projectId}/productivity/imports`,
    headers: { ...headers, authorization: `Bearer ${owner.token}` },
    payload: body,
  });
}

const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${owner.token}` } });
const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${owner.token}` }, payload });

describe('importação de CSV', () => {
  it('importa os índices válidos e lista os recusados com o motivo', async () => {
    const r = await importar({ name: 'BASE-2026.csv', content: CSV });
    expect(r.statusCode).toBe(201);
    const body = r.json();

    expect(body.imported).toBe(2);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].field).toBe('perUnit');
    expect(body.rejected[0].reason).toMatch(/Nenhuma unidade parecida foi assumida/);
    expect(body.rejected[0].rowIndex).toBe(6);
    expect(body.note).toMatch(/PENDENTES/);
  });

  it('a fonte do índice é o próprio arquivo, com hash verificável', async () => {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    const solda = indices.find((i: { code: string }) => i.code === 'IDX-SOLD');
    expect(solda.source).toContain('BASE-2026.csv');
    expect(solda.source).toMatch(/SHA-256 [0-9a-f]{12}/);
    expect(solda.importRow).toBe(5);
    expect(solda.import.fileName).toBe('BASE-2026.csv');
  });

  it('índice importado nasce PENDENTE, nunca aprovado', async () => {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    expect(indices.every((i: { approvalStatus: string }) => i.approvalStatus === 'PENDING')).toBe(true);
  });

  it('índice digitado à mão nasce aprovado, com o usuário registrado', async () => {
    const r = await post(`/api/projects/${projectId}/productivity`, {
      code: 'IDX-MANUAL', description: 'Montagem', value: 0.9, perUnit: 'in-dia', basis: 'BUDGETED',
      source: 'Orcamento contratual, planilha do contrato CT-001', sourceDate: '2026-01-15',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().approvalStatus).toBe('APPROVED');
    expect(r.json().approvedBy).toBe(owner.id);
  });

  it('BLOQUEIA o arquivo inteiro quando falta a base e ela não é declarada', async () => {
    const semBase = CSV.split('\r\n').map((l, i) => (i >= 2 ? l.split(';').filter((_, c) => c !== 4).join(';') : l)).join('\r\n');
    const r = await importar({ name: 'SEM-BASE.csv', content: semBase });
    expect(r.statusCode).toBe(201);
    expect(r.json().imported).toBe(0);
    expect(r.json().warnings[0]).toMatch(/orçado e observado não são a mesma coisa em pleito/i);
  });

  it('aceita a base declarada na importação e registra que veio do usuário', async () => {
    const semBase = CSV.split('\r\n').map((l, i) => (i >= 2 ? l.split(';').filter((_, c) => c !== 4).join(';') : l)).join('\r\n');
    const r = await importar({ name: 'SEM-BASE.csv', content: semBase }, { declaredBasis: 'BUDGETED' });
    expect(r.json().imported).toBe(2);
    expect(r.json().suppliedByUser).toContain('basis');
    expect(r.json().warnings.join(' ')).toMatch(/declarada por você/);
  });

  it('recusa base declarada fora da lista', async () => {
    const r = await importar({ name: 'X.csv', content: CSV }, { declaredBasis: 'CHUTE' });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/invalida/);
  });

  it('detecta reimportação do mesmo arquivo por hash', async () => {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const dup = await importar({ name: 'copia.csv', content: CSV });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toMatch(/ja foi importado/);

    const forcado = await importar({ name: 'copia.csv', content: CSV }, { allowDuplicate: 'true' });
    expect(forcado.statusCode).toBe(201);
  });

  it('não sobrescreve índice existente com o mesmo código: renomeia e avisa', async () => {
    await importar({ name: 'BASE-A.csv', content: CSV });
    const segundo = await importar({ name: 'BASE-B.csv', content: CSV.replace('1,40', '1,55') }, { allowDuplicate: 'true' });
    expect(segundo.json().renamed.length).toBeGreaterThan(0);
    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    const codigos = indices.map((i: { code: string }) => i.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('recusa formato que não é planilha nem PDF', async () => {
    const r = await importar({ name: 'base.dwg', content: Buffer.from('AC1032') });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toMatch(/Envie XLSX, CSV ou PDF/);
  });
});

describe('importação de XLSX', () => {
  it('lê a planilha real, com strings compartilhadas e números', async () => {
    const xlsx = makeXlsx('Produtividade', [
      ['BASE DE PRODUTIVIDADE'],
      [],
      ['Codigo', 'Servico', 'Indice', 'Unidade', 'Base', 'Data'],
      ['IDX-A', 'Montagem', '0.9', 'in-dia', 'Orcado', '2026-01-15'],
      ['IDX-B', 'Soldagem', '1.4', 'in-dia', 'Observado', '2026-01-15'],
    ]);
    const r = await importar({ name: 'BASE.xlsx', content: xlsx });
    expect(r.statusCode).toBe(201);
    expect(r.json().imported).toBe(2);

    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    expect(indices.find((i: { code: string }) => i.code === 'IDX-B').value).toBe(1.4);
    expect(indices[0].importSheet).toBe('Produtividade');
  });
});

describe('conferência do índice importado', () => {
  async function importarECapturar(): Promise<{ id: string; version: number }> {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    return indices.find((i: { code: string }) => i.code === 'IDX-SOLD');
  }

  it('aprovar registra revisor, decisão e auditoria', async () => {
    const idx = await importarECapturar();
    const r = await post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
      decision: 'APPROVED', version: idx.version,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().approvalStatus).toBe('APPROVED');
    expect(r.json().approvedBy).toBe(owner.id);

    const hist = await get(`/api/projects/${projectId}/history/ProductivityIndex/${idx.id}`);
    expect(hist.json().decisions[0].stage).toBe('PRODUCTIVITY');
  });

  it('rejeitar e corrigir exigem justificativa', async () => {
    const idx = await importarECapturar();
    const semJust = await post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
      decision: 'REJECTED', version: idx.version,
    });
    expect(semJust.statusCode).toBe(400);

    const corrigirSemJust = await post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
      decision: 'APPROVED', version: idx.version, corrections: { value: 1.6 },
    });
    expect(corrigirSemJust.statusCode).toBe(400);
    expect(corrigirSemJust.json().message).toMatch(/passa a divergir da fonte/);
  });

  it('correção aprovada fica marcada na própria fonte do índice', async () => {
    const idx = await importarECapturar();
    const r = await post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
      decision: 'APPROVED', version: idx.version, corrections: { value: 1.6 },
      justification: 'Conferido contra a planilha original: a celula era 1,60 e a leitura trouxe 1,40.',
    });
    expect(r.json().value).toBe(1.6);
    expect(r.json().source).toMatch(/corrigido por revisor/);
  });

  it('aprovação em lote exige regra escrita', async () => {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const imports = (await get(`/api/projects/${projectId}/productivity/imports`)).json();

    const curta = await post(`/api/projects/${projectId}/productivity/bulk-approve`, {
      importId: imports[0].id, justification: 'ok',
    });
    expect(curta.statusCode).toBe(400);

    const r = await post(`/api/projects/${projectId}/productivity/bulk-approve`, {
      importId: imports[0].id,
      justification: 'Planilha conferida linha a linha contra o original assinado pelo orcamentista.',
    });
    expect(r.json().approved).toBe(2);
  });
});

describe('portão de aprovação no cálculo da duração', () => {
  it('atividade com índice importado e NÃO conferido fica NOT_CALCULABLE', async () => {
    await importar({ name: 'BASE-2026.csv', content: CSV });
    const indices = (await get(`/api/projects/${projectId}/productivity`)).json();
    const idx = indices.find((i: { code: string }) => i.code === 'IDX-SOLD');

    const cal = (await post(`/api/projects/${projectId}/calendars`, {
      code: 'C', name: 'C',
      workWeek: { 1: [{ start: '07:00', end: '16:00' }] }, exceptions: [],
    })).json();
    const res = (await post(`/api/projects/${projectId}/resources`, {
      code: 'SOL', name: 'Soldador', maxUnits: 4, productiveHoursPerDay: 6.5,
    })).json();
    await post(`/api/projects/${projectId}/activities`, {
      code: 'A-1', name: 'Soldagem', calendarId: cal.id, productivityId: idx.id,
      qty: 100, unit: 'in-dia', deliverable: 'Juntas soldadas', completionCriteria: 'END liberado',
      crew: [{ resourceId: res.id, count: 4, productiveHoursPerDay: 6.5 }],
    });

    const antes = await post(`/api/projects/${projectId}/schedule/compute-durations`, {});
    expect(antes.json().notCalculable).toBe(1);
    expect(antes.json().results[0].missing[0].reason).toMatch(/não foi confirmado por um revisor|nao foi confirmado por um revisor/);

    await post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, { decision: 'APPROVED', version: idx.version });

    const depois = await post(`/api/projects/${projectId}/schedule/compute-durations`, {});
    expect(depois.json().notCalculable).toBe(0);
    expect(depois.json().results[0].workHH).toBe(140);
  });
});
