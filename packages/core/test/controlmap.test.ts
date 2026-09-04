import { describe, expect, it } from 'vitest';
import { evaluateItem, PIPING_MAP, weightedPhysicalProgress, type ControlMapItem } from '../src/controlmap/index.js';

const item = (stages: ControlMapItem['stages'], plannedHH = 100): ControlMapItem => ({
  id: 'IT-1', mapId: PIPING_MAP.id, controlKey: 'L-1201', fields: {}, stages, plannedHH,
});

describe('mapas de controle', () => {
  it('avanco e ponderado pelos pesos dos estagios', () => {
    const e = evaluateItem(item({
      FABRICATION: { status: 'DONE', evidenceRef: 'ROM-1' },
      ERECTION: { status: 'DONE', evidenceRef: 'RM-1' },
    }), PIPING_MAP);
    expect(e.physicalProgress).toBeCloseTo(0.45, 4);
  });

  it('estagio DONE sem evidencia gera violacao', () => {
    const e = evaluateItem(item({ FABRICATION: { status: 'DONE' } }), PIPING_MAP);
    expect(e.violations[0]).toMatch(/sem a evidencia exigida/);
  });

  it('quebra de sequencia tecnica deixa o item VERMELHO com regra visivel', () => {
    const e = evaluateItem(item({ WELDING: { status: 'DONE', evidenceRef: 'S-1' } }), PIPING_MAP, 0);
    expect(e.semaphore).toBe('RED');
    expect(e.semaphoreRule).toMatch(/sequencia tecnica quebrada/);
    expect(e.violations.some((v) => /Montagem/.test(v))).toBe(true);
  });

  it('estagio em andamento nao contabiliza avanco sem medicao objetiva', () => {
    const e = evaluateItem(item({ ERECTION: { status: 'IN_PROGRESS' } }), PIPING_MAP);
    expect(e.physicalProgress).toBe(0);
    expect(e.violations[0]).toMatch(/sem medicao objetiva/);
  });

  it('semaforo fica CINZA quando nao ha base objetiva para julgar', () => {
    const e = evaluateItem(item({ FABRICATION: { status: 'DONE', evidenceRef: 'x' } }), PIPING_MAP);
    expect(e.semaphore).toBe('GREY');
    expect(e.semaphoreRule).toMatch(/nao atribui cor sem base objetiva/);
  });

  it('semaforo segue limiares explicitos de atraso', () => {
    const s = { FABRICATION: { status: 'DONE' as const, evidenceRef: 'x' } };
    expect(evaluateItem(item(s), PIPING_MAP, 1).semaphore).toBe('GREEN');
    expect(evaluateItem(item(s), PIPING_MAP, 5).semaphore).toBe('YELLOW');
    expect(evaluateItem(item(s), PIPING_MAP, 12).semaphore).toBe('RED');
    expect(evaluateItem(item(s), PIPING_MAP, 12).semaphoreRule).toMatch(/limite 10/);
  });

  it('excecao aprovada e registrada, nao escondida', () => {
    const e = evaluateItem(item({
      FABRICATION: { status: 'DONE', exception: { justification: 'spool importado ja fabricado', approvedBy: 'eng', approvedAt: '2026-02-01' } },
    }), PIPING_MAP);
    expect(e.exceptions[0]).toMatch(/spool importado/);
    expect(e.violations).toHaveLength(0);
  });

  it('estagio nao aplicavel sai da base de ponderacao', () => {
    const semPintura = evaluateItem({
      ...item({ FABRICATION: { status: 'DONE', evidenceRef: 'x' }, PAINTING: { status: 'NOT_APPLICABLE' } }),
    }, PIPING_MAP);
    expect(semPintura.physicalProgress).toBeCloseTo(0.15 / 0.95, 4);
  });

  it('avanco fisico do conjunto e ponderado por HH e exclui item sem HH', () => {
    const defs = { [PIPING_MAP.id]: PIPING_MAP };
    const a: ControlMapItem = { ...item({ FABRICATION: { status: 'DONE', evidenceRef: 'x' }, ERECTION: { status: 'DONE', evidenceRef: 'x' } }, 300), id: 'A' };
    const b: ControlMapItem = { ...item({}, 100), id: 'B' };
    const c: ControlMapItem = { ...item({ FABRICATION: { status: 'DONE', evidenceRef: 'x' } }), id: 'C', plannedHH: 0 };
    const r = weightedPhysicalProgress([a, b, c], defs);
    expect(r.totalHH).toBe(400);
    expect(r.earnedHH).toBe(135);
    expect(r.progress).toBeCloseTo(0.3375, 4);
    expect(r.excludedItemIds).toEqual(['C']);
  });
});
