import { describe, expect, it } from 'vitest';
import { detectDoubleCount, deduplicateByPrecedence, deriveWeldInchDiameter, rollup, type PrecedenceRule } from '../src/quantities/rollup.js';
import type { QuantityItem } from '../src/quantities/types.js';
import type { Provenance } from '../src/provenance/types.js';

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  dataClass: 'EXTRACTED_FACT', method: 'TABLE_PARSER', confidence: 0.9,
  evidence: [{ documentId: 'DOC-1', page: 1 }],
  processedAt: '2026-01-01T00:00:00.000Z', reviewStatus: 'APPROVED', reviewedBy: 'u1',
  ...over,
});

const item = (o: Partial<QuantityItem> & Pick<QuantityItem, 'id' | 'entityKey' | 'measure'>): QuantityItem => ({
  discipline: 'PIPING', sourceKind: 'ISOMETRIC', documentId: 'DOC-1',
  provenance: prov(), ...o,
} as QuantityItem);

describe('quantitativos', () => {
  it('consolida por dimensoes solicitadas', () => {
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' }, area: 'A1', discipline: 'PIPING' }),
      item({ id: '2', entityKey: 'L2', measure: { qty: 5, unit: 'm' }, area: 'A1', discipline: 'PIPING' }),
      item({ id: '3', entityKey: 'L3', measure: { qty: 7, unit: 'm' }, area: 'A2', discipline: 'PIPING' }),
    ];
    const r = rollup(items, { groupBy: ['area'], targetUnit: 'm' });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.key.area === 'A1')?.qty).toBe(15);
    expect(r.totals.qty).toBe(22);
  });

  it('exclui — e reporta — item de grandeza incompativel em vez de converter na marra', () => {
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' } }),
      item({ id: '2', entityKey: 'L2', measure: { qty: 800, unit: 'kg' } }),
    ];
    const r = rollup(items, { groupBy: ['discipline'], targetUnit: 'm' });
    expect(r.totals.qty).toBe(10);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.reason).toMatch(/incompativeis/);
  });

  it('exclui item pendente ou em conflito do total', () => {
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' } }),
      item({ id: '2', entityKey: 'L2', measure: { qty: 99, unit: 'm' }, provenance: prov({ dataClass: 'PENDING_INFO' }) }),
      item({ id: '3', entityKey: 'L3', measure: { qty: 50, unit: 'm' }, provenance: prov({ dataClass: 'SOURCE_CONFLICT' }) }),
    ];
    const r = rollup(items, { groupBy: ['discipline'], targetUnit: 'm' });
    expect(r.totals.qty).toBe(10);
    expect(r.excluded).toHaveLength(2);
  });

  it('propaga a MENOR confianca e conta itens nao revisados', () => {
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' }, provenance: prov({ confidence: 0.95 }) }),
      item({ id: '2', entityKey: 'L2', measure: { qty: 10, unit: 'm' }, provenance: prov({ confidence: 0.42, reviewStatus: 'PENDING' }) }),
    ];
    const r = rollup(items, { groupBy: ['discipline'], targetUnit: 'm' });
    expect(r.rows[0]!.minConfidence).toBe(0.42);
    expect(r.rows[0]!.pendingReviewCount).toBe(1);
  });

  it('detecta dupla contagem entre fontes diferentes (MTO x isometrico)', () => {
    const items = [
      item({ id: '1', entityKey: 'JOINT|CPM-20.701|J-012', measure: { qty: 1, unit: 'jt' }, sourceKind: 'ISOMETRIC' }),
      item({ id: '2', entityKey: 'JOINT|CPM-20.701|J-012', measure: { qty: 1, unit: 'jt' }, sourceKind: 'MTO', documentId: 'DOC-2' }),
    ];
    const f = detectDoubleCount(items);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('CONFIRMED');
    expect(f[0]!.message).toMatch(/mais de uma vez/);
    expect(f[0]!.resolvedBy).toBeUndefined();
  });

  it('detecta folha duplicada de isometrico como suspeita', () => {
    const items = [
      item({ id: '1', entityKey: 'SPOOL|SP-01', measure: { qty: 3, unit: 'jt' } }),
      item({ id: '2', entityKey: 'SPOOL|SP-01', measure: { qty: 3, unit: 'jt' } }),
    ];
    const f = detectDoubleCount(items);
    expect(f[0]!.severity).toBe('SUSPECTED');
    expect(f[0]!.message).toMatch(/folha duplicada/);
  });

  it('NAO elege fonte vencedora sem regra de precedencia aprovada', () => {
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' }, sourceKind: 'ISOMETRIC' }),
      item({ id: '2', entityKey: 'L1', measure: { qty: 12, unit: 'm' }, sourceKind: 'LINE_LIST' }),
    ];
    const r = deduplicateByPrecedence(items, null);
    expect(r.items).toHaveLength(2);
    expect(r.dropped).toHaveLength(0);
    expect(r.unresolved).toHaveLength(1);
  });

  it('aplica precedencia SOMENTE apos ela ser aprovada', () => {
    const rule: PrecedenceRule = {
      id: 'PREC.ISO_OVER_LINELIST', approvedBy: 'planejador', approvedAt: '2026-01-05T12:00:00Z',
      order: ['ISOMETRIC', 'LINE_LIST', 'MTO'],
    };
    const items = [
      item({ id: '1', entityKey: 'L1', measure: { qty: 10, unit: 'm' }, sourceKind: 'ISOMETRIC' }),
      item({ id: '2', entityKey: 'L1', measure: { qty: 12, unit: 'm' }, sourceKind: 'LINE_LIST' }),
    ];
    const r = deduplicateByPrecedence(items, rule);
    expect(r.items.map((i) => i.id)).toEqual(['1']);
    expect(r.dropped.map((i) => i.id)).toEqual(['2']);
    expect(r.unresolved).toHaveLength(0);
  });

  it('deriva polegada-diametro com memoria de calculo e deixa de fora junta sem DN', () => {
    const items = [
      item({ id: '1', entityKey: 'J1', measure: { qty: 4, unit: 'jt' }, nominalDiameterIn: 6 }),
      item({ id: '2', entityKey: 'J2', measure: { qty: 2, unit: 'jt' }, nominalDiameterIn: 10 }),
      item({ id: '3', entityKey: 'J3', measure: { qty: 5, unit: 'jt' } }),
    ];
    const r = deriveWeldInchDiameter(items);
    expect(r.total).toBe(44);
    expect(r.unit).toBe('in-dia');
    expect(r.memo.formula).toMatch(/juntas_i/);
    expect(r.memo.inputs['itens_sem_DN']).toBe(1);
    expect(r.skipped.map((s) => s.id)).toEqual(['3']);
  });
});
