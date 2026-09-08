/**
 * Fluxo vertical completo da Fase 1:
 * escopo validado -> EAP -> atividades -> duracao -> sequencia -> CPM -> baseline -> XML.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cleanupStorage, createOrgWithOwner, createProject, migrateTestDb, resetDb, type TestUser } from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let projectId: string;
let calendarId: string;
let indexId: string;
let resourceId: string;

const dayShifts = [{ start: '07:00', end: '12:00' }, { start: '13:00', end: '16:00' }];

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

const post = (url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${owner.token}` }, payload: payload ?? {} });
const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${owner.token}` } });

beforeEach(async () => {
  await resetDb();
  owner = await createOrgWithOwner(app);
  projectId = await createProject(app, owner);

  calendarId = (await post(`/api/projects/${projectId}/calendars`, {
    code: 'CAL-5X8', name: 'Padrao 5x8', isDefault: true,
    workWeek: { 0: [], 1: dayShifts, 2: dayShifts, 3: dayShifts, 4: dayShifts, 5: dayShifts, 6: [] },
    exceptions: [{ date: '2026-04-21', working: false, name: 'Tiradentes' }],
  })).json().id;

  resourceId = (await post(`/api/projects/${projectId}/resources`, {
    code: 'SOL', name: 'Soldador', group: 'Tubulacao', maxUnits: 6, productiveHoursPerDay: 6.5,
  })).json().id;

  indexId = (await post(`/api/projects/${projectId}/productivity`, {
    code: 'IDX-SOL', description: 'Soldagem carbono', value: 1.2, perUnit: 'in-dia', basis: 'OBSERVED',
    source: 'Historico de obra anterior, base de teste automatizado', sourceDate: '2025-12-01',
  })).json().id;
});

async function buildWbs(): Promise<{ iwpId: string }> {
  const root = (await post(`/api/projects/${projectId}/wbs`, { parentId: null, type: 'PROJECT', code: 'OBRA', name: 'Obra de Teste' })).json();
  const cwa = (await post(`/api/projects/${projectId}/wbs`, { parentId: root.id, type: 'CWA', code: 'OBRA.A100', name: 'Area 100', area: 'A100' })).json();
  const cwp = (await post(`/api/projects/${projectId}/wbs`, {
    parentId: cwa.id, type: 'CWP', code: 'OBRA.A100.TUB', name: 'Tubulacao Sistema 12',
    discipline: 'PIPING', area: 'A100', system: 'SIS-12',
  })).json();
  const iwp = (await post(`/api/projects/${projectId}/wbs`, {
    parentId: cwp.id, type: 'IWP', code: 'OBRA.A100.TUB.IWP01', name: 'IWP 01',
    discipline: 'PIPING', area: 'A100', system: 'SIS-12',
    deliverable: 'Sistema 12 montado e soldado', scopeOut: 'Nao inclui pintura nem isolamento',
    qty: 300, unit: 'in-dia',
    acceptanceCriteria: [{ description: 'END aprovado', evidenceRequired: 'Laudo' }],
  })).json();
  return { iwpId: iwp.id };
}

describe('EAP e AWP', () => {
  it('constroi a hierarquia e calcula o outline', async () => {
    await buildWbs();
    const r = await get(`/api/projects/${projectId}/wbs`);
    expect(r.json().issues.filter((i: { severity: string }) => i.severity === 'ERROR')).toHaveLength(0);
    expect(r.json().outline.map((n: { outlineNumber: string }) => n.outlineNumber)).toEqual(['1', '1.1', '1.1.1', '1.1.1.1']);
  });

  it('RECUSA IWP pendurado direto no CWA', async () => {
    const root = (await post(`/api/projects/${projectId}/wbs`, { parentId: null, type: 'PROJECT', code: 'OBRA', name: 'Obra' })).json();
    const cwa = (await post(`/api/projects/${projectId}/wbs`, { parentId: root.id, type: 'CWA', code: 'A', name: 'Area', area: 'A100' })).json();
    const r = await post(`/api/projects/${projectId}/wbs`, {
      parentId: cwa.id, type: 'IWP', code: 'X', name: 'IWP errado',
      deliverable: 'x', scopeOut: 'y', qty: 1, unit: 'un',
    });
    expect(r.statusCode).toBe(422);
    expect(JSON.stringify(r.json().details)).toMatch(/niveis distintos/);
  });

  it('mostra impacto antes de mover um no', async () => {
    const root = (await post(`/api/projects/${projectId}/wbs`, { parentId: null, type: 'PROJECT', code: 'OBRA', name: 'Obra' })).json();
    const a1 = (await post(`/api/projects/${projectId}/wbs`, { parentId: root.id, type: 'CWA', code: 'A1', name: 'Area 1', area: 'A1', sortIndex: 1 })).json();
    const a2 = (await post(`/api/projects/${projectId}/wbs`, { parentId: root.id, type: 'CWA', code: 'A2', name: 'Area 2', area: 'A2', sortIndex: 2 })).json();
    const cwp = (await post(`/api/projects/${projectId}/wbs`, { parentId: a1.id, type: 'CWP', code: 'C1', name: 'CWP', discipline: 'PIPING' })).json();

    const preview = await post(`/api/projects/${projectId}/wbs/${cwp.id}/preview-move`, { newParentId: a2.id, newSortIndex: 1 });
    expect(preview.json().ok).toBe(true);
    expect(preview.json().outlineChanges.find((c: { nodeId: string }) => c.nodeId === cwp.id)).toEqual({ nodeId: cwp.id, from: '1.1.1', to: '1.2.1' });
  });
});

describe('duracao a partir dos insumos', () => {
  it('BLOQUEIA a duracao quando falta quantidade, indice ou equipe', async () => {
    const { iwpId } = await buildWbs();
    await post(`/api/projects/${projectId}/activities`, {
      code: 'A-1000', name: 'Soldagem sem insumos', wbsNodeId: iwpId, calendarId, step: 'WELDING',
    });
    const r = await post(`/api/projects/${projectId}/schedule/compute-durations`);
    expect(r.json().notCalculable).toBe(1);
    const item = r.json().results[0];
    expect(item.status).toBe('NOT_CALCULABLE');
    expect(item.missing.map((m: { field: string }) => m.field).sort()).toEqual(['crew', 'productivity', 'quantity']);
    expect(item.memo[0]).toMatch(/Nenhum valor foi arbitrado/);
  });

  it('calcula HH, capacidade e duracao com memoria quando ha todos os insumos', async () => {
    const { iwpId } = await buildWbs();
    await post(`/api/projects/${projectId}/activities`, {
      code: 'A-1010', name: 'Soldagem do Sistema 12', wbsNodeId: iwpId, calendarId,
      productivityId: indexId, step: 'WELDING', qty: 300, unit: 'in-dia',
      deliverable: 'Juntas soldadas', completionCriteria: 'END liberado',
      crew: [{ resourceId, count: 4, productiveHoursPerDay: 6.5 }],
    });
    const r = await post(`/api/projects/${projectId}/schedule/compute-durations`);
    const item = r.json().results[0];
    expect(item.status).toBe('CALCULATED');
    expect(item.workHH).toBe(360);                       // 300 in-dia x 1,2 HH/in-dia
    expect(item.durationDays).toBeCloseTo(360 / 26, 3);  // 4 x 6,5 = 26 HH/dia
    expect(item.memo.join(' ')).toMatch(/Historico de obra anterior/);
  });
});

describe('sequenciamento, CPM e qualidade', () => {
  async function threeActivities(): Promise<void> {
    const { iwpId } = await buildWbs();
    const { prisma } = await import('../src/db.js');
    for (const [code, name, step] of [
      ['A-1000', 'Montagem do Sistema 12', 'ERECTION'],
      ['A-1010', 'Soldagem do Sistema 12', 'WELDING'],
      ['A-1020', 'END do Sistema 12', 'NDE'],
    ]) {
      await post(`/api/projects/${projectId}/activities`, {
        code, name, wbsNodeId: iwpId, calendarId, productivityId: indexId, step,
        qty: 100, unit: 'in-dia', deliverable: name, completionCriteria: `${name} concluida`,
        crew: [{ resourceId, count: 4, productiveHoursPerDay: 6.5 }],
      });
    }
    // Contexto fisico das atividades vem de entidades validadas.
    for (const code of ['A-1000', 'A-1010', 'A-1020']) {
      await prisma.techEntity.create({
        data: {
          projectId, entityKey: code, kind: 'PIPING_LINE', discipline: 'PIPING',
          attributes: { objectKey: 'LINE|10-P-1201', lineNumber: '10-P-1201', testPackId: 'TP-01' },
          dataClass: 'USER_INPUT', confidence: 0.9, reviewStatus: 'APPROVED',
        },
      });
    }
    await post(`/api/projects/${projectId}/schedule/compute-durations`);
  }

  it('propoe vinculos SUGERIDOS com motivo, regra e fonte', async () => {
    await threeActivities();
    const r = await post(`/api/projects/${projectId}/sequencing/propose`);
    expect(r.json().proposedLinks).toBeGreaterThan(0);
    expect(r.json().note).toMatch(/afeta o calculo aprovado ate ser validado/);

    const links = (await get(`/api/projects/${projectId}/links`)).json();
    expect(links.every((l: { status: string }) => l.status === 'SUGGESTED')).toBe(true);
    expect(links[0].reason.length).toBeGreaterThan(20);
    expect(links[0].ruleId).toBeTruthy();
  });

  it('vinculo SUGERIDO nao entra no CPM aprovado', async () => {
    await threeActivities();
    await post(`/api/projects/${projectId}/sequencing/propose`);

    const semValidar = await post(`/api/projects/${projectId}/schedule/compute`, { projectStart: '2026-03-02T07:00:00.000Z' });
    const acts = semValidar.json().activities;
    const starts = Object.values(acts).map((a) => (a as { earlyStart: string }).earlyStart);
    expect(new Set(starts).size).toBe(1); // todas em paralelo: nenhuma logica aprovada

    const comSimulacao = await post(`/api/projects/${projectId}/schedule/compute`, {
      projectStart: '2026-03-02T07:00:00.000Z', includeSuggestedLinks: true,
    });
    const startsSim = Object.values(comSimulacao.json().activities).map((a) => (a as { earlyStart: string }).earlyStart);
    expect(new Set(startsSim).size).toBeGreaterThan(1);
  });

  it('apos validar os vinculos, o CPM encadeia e aponta o caminho critico', async () => {
    await threeActivities();
    await post(`/api/projects/${projectId}/sequencing/propose`);
    const links = (await get(`/api/projects/${projectId}/links`)).json();
    for (const l of links) {
      const r = await post(`/api/projects/${projectId}/links/${l.id}/decide`, { decision: 'VALIDATED', version: l.version });
      expect(r.statusCode).toBe(200);
    }
    const r = await post(`/api/projects/${projectId}/schedule/compute`, { projectStart: '2026-03-02T07:00:00.000Z' });
    expect(r.statusCode).toBe(200);
    expect(r.json().criticalPath.length).toBeGreaterThanOrEqual(2);
    const acts = r.json().activities;
    const montagem = Object.values(acts).find((a) => (a as { id: string }).id) as { earlyFinish: string };
    expect(montagem).toBeTruthy();
    expect(new Date(r.json().projectFinish).getTime()).toBeGreaterThan(new Date('2026-03-02T07:00:00Z').getTime());
  });

  it('"Por que esta atividade vem antes?" devolve motivo, regra e fonte', async () => {
    await threeActivities();
    await post(`/api/projects/${projectId}/sequencing/propose`);
    const acts = (await get(`/api/projects/${projectId}/activities`)).json();
    const soldagem = acts.find((a: { code: string }) => a.code === 'A-1010');
    const why = await get(`/api/projects/${projectId}/activities/${soldagem.id}/why`);
    expect(why.json().length).toBeGreaterThan(0);
    expect(why.json()[0].reason).toMatch(/precede tecnicamente|Mesmo objeto/);
    expect(why.json()[0].ruleId).toBeTruthy();
  });

  it('as verificacoes de qualidade acusam ponta solta e atividade nao calculavel', async () => {
    const { iwpId } = await buildWbs();
    await post(`/api/projects/${projectId}/activities`, { code: 'A-SOLTA', name: 'Atividade solta', wbsNodeId: iwpId, calendarId });
    await post(`/api/projects/${projectId}/schedule/compute-durations`);
    const r = await post(`/api/projects/${projectId}/schedule/compute`, { projectStart: '2026-03-02T07:00:00.000Z' });
    const codes = r.json().quality.findings.map((f: { code: string }) => f.code);
    expect(codes).toContain('OPEN_START');
    expect(codes).toContain('OPEN_FINISH');
    expect(codes).toContain('NOT_CALCULABLE');
    expect(r.json().quality.summary.blocking).toBe(true);
  });

  it('rejeitar um vinculo exige justificativa', async () => {
    await threeActivities();
    await post(`/api/projects/${projectId}/sequencing/propose`);
    const links = (await get(`/api/projects/${projectId}/links`)).json();
    const r = await post(`/api/projects/${projectId}/links/${links[0].id}/decide`, { decision: 'REJECTED', version: links[0].version });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/justificativa/);
  });
});

describe('linha de base e exportacao', () => {
  async function readySchedule(): Promise<void> {
    const { iwpId } = await buildWbs();
    for (const [code, name, step] of [['A-1000', 'Montagem', 'ERECTION'], ['A-1010', 'Soldagem', 'WELDING']]) {
      await post(`/api/projects/${projectId}/activities`, {
        code, name: `${name} do Sistema 12`, wbsNodeId: iwpId, calendarId, productivityId: indexId, step,
        qty: 150, unit: 'in-dia', deliverable: name, completionCriteria: `${name} concluida`,
        crew: [{ resourceId, count: 4, productiveHoursPerDay: 6.5 }],
      });
    }
    const acts = (await get(`/api/projects/${projectId}/activities`)).json();
    const { prisma } = await import('../src/db.js');
    await prisma.logicLink.create({
      data: {
        projectId, predecessorId: acts[0].id, successorId: acts[1].id, type: 'FS', lagMinutes: 0,
        status: 'VALIDATED', reasonKind: 'PROCESS', reason: 'Montagem precede soldagem no mesmo objeto.',
        ruleId: 'SEQ.PROCESS_CHAIN', sourceRefs: ['DOC-1'], confidence: 0.95,
      },
    });
    await post(`/api/projects/${projectId}/schedule/compute-durations`);
    await post(`/api/projects/${projectId}/schedule/compute`, { projectStart: '2026-03-02T07:00:00.000Z' });
  }

  it('RECUSA congelar baseline sem datas calculadas', async () => {
    const { iwpId } = await buildWbs();
    await post(`/api/projects/${projectId}/activities`, { code: 'A-1', name: 'X', wbsNodeId: iwpId, calendarId });
    const r = await post(`/api/projects/${projectId}/baselines`, { name: 'BL0' });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toMatch(/Rode o calculo do cronograma/);
  });

  it('congela a linha de base com uma linha por atividade', async () => {
    await readySchedule();
    const r = await post(`/api/projects/${projectId}/baselines`, { name: 'BL0 — aprovada para execucao' });
    expect(r.statusCode).toBe(201);
    expect(r.json().number).toBe(0);
    expect(r.json()._count.rows).toBe(2);
  });

  it('valida o XML antes de permitir o download', async () => {
    await readySchedule();
    const r = await get(`/api/projects/${projectId}/exports/mspdi/validate`);
    expect(r.json().modelValidation.valid).toBe(true);
    expect(r.json().xmlValidation.valid).toBe(true);
    expect(r.json().downloadable).toBe(true);
    expect(r.json().notCalculable).toHaveLength(0);
  });

  it('exporta XML MSPDI importavel, com rastreabilidade e baseline', async () => {
    await readySchedule();
    await post(`/api/projects/${projectId}/baselines`, { name: 'BL0' });
    const r = await get(`/api/projects/${projectId}/exports/mspdi`);
    expect(r.statusCode).toBe(200);
    const xml = r.body;

    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    expect(xml).toContain('<SaveVersion>14</SaveVersion>');
    expect(xml).toContain('<Alias>Codigo EAP estavel</Alias>');
    expect(xml).toContain('<Baseline>');
    expect(xml).toContain('<Name>Tiradentes</Name>');
    expect(xml).toContain('<PredecessorLink>');

    const { validateMspdiXml, importMspdi } = await import('@cronograma/core');
    const validation = validateMspdiXml(xml);
    expect(validation.valid).toBe(true);
    const imported = importMspdi(xml);
    expect(imported.tasks.length).toBe(3); // resumo + 2 atividades
    expect(imported.warnings).toHaveLength(0);
  });

  it('atividade NAO CALCULAVEL sai com duracao zero e nota explicita — nunca prazo arbitrado', async () => {
    const { iwpId } = await buildWbs();
    await post(`/api/projects/${projectId}/activities`, {
      code: 'A-SEM', name: 'Sem insumos', wbsNodeId: iwpId, calendarId, deliverable: 'x', completionCriteria: 'y',
    });
    await post(`/api/projects/${projectId}/schedule/compute-durations`);
    await post(`/api/projects/${projectId}/schedule/compute`, { projectStart: '2026-03-02T07:00:00.000Z' });

    const validate = await get(`/api/projects/${projectId}/exports/mspdi/validate`);
    expect(validate.json().notCalculable).toContain('A-SEM');
    expect(validate.json().note).toMatch(/duracao ZERO/);

    const xml = (await get(`/api/projects/${projectId}/exports/mspdi`)).body;
    expect(xml).toContain('DURACAO NAO CALCULAVEL');
    expect(xml).toContain('NAO CALCULAVEL');
  });

  it('importa XML para auditoria sem alterar o cronograma', async () => {
    await readySchedule();
    const xml = (await get(`/api/projects/${projectId}/exports/mspdi`)).body;
    const { multipart } = await import('./helpers.js');
    const { body, headers } = multipart([{ field: 'file', filename: 'externo.xml', content: xml, contentType: 'application/xml' }]);
    const r = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/imports/mspdi`,
      headers: { ...headers, authorization: `Bearer ${owner.token}` }, payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().validation.valid).toBe(true);
    expect(r.json().comparison.summary.added).toBe(0);
    expect(r.json().note).toMatch(/NAO alterou o cronograma/);
  });

  it('exporta CSV com fonte, confianca e status de validacao por linha', async () => {
    await readySchedule();
    const r = await get(`/api/projects/${projectId}/exports/activities.csv`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('status_duracao');
    expect(r.body).toContain('fonte_indice');
    expect(r.body).toContain('Historico de obra anterior');
    expect(r.body.startsWith('﻿')).toBe(true);
  });
});
