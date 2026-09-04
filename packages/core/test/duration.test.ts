import { describe, expect, it } from 'vitest';
import { computeDuration, ForbiddenAssumptionError, requiredCapacityForWindow } from '../src/schedule/duration.js';

const prod = { value: 1.2, perUnit: 'in-dia', source: 'Historico Megasteam 2024-2025, obra X', sourceDate: '2025-12-01', basis: 'OBSERVED' as const };
const crew = [
  { resourceId: 'SOL', resourceName: 'Soldador', count: 6, productiveHoursPerDay: 6.5 },
  { resourceId: 'AJU', resourceName: 'Ajudante', count: 3, productiveHoursPerDay: 6.5 },
];

describe('motor de duracao', () => {
  it('calcula HH, capacidade e duracao com memoria de calculo', () => {
    const r = computeDuration({ quantity: { qty: 500, unit: 'in-dia' }, productivity: prod, crew });
    expect(r.status).toBe('CALCULATED');
    expect(r.workHH).toBe(600);
    expect(r.dailyCapacityHH).toBe(58.5);
    expect(r.durationWorkingDays).toBeCloseTo(600 / 58.5, 3);
    expect(r.memo.join(' ')).toMatch(/HH PRODUTIVAS|horas PRODUTIVAS/);
    expect(r.memo.join(' ')).toMatch(/Historico Megasteam/);
  });

  it('BLOQUEIA a duracao quando falta quantidade', () => {
    const r = computeDuration({ quantity: null, productivity: prod, crew });
    expect(r.status).toBe('NOT_CALCULABLE');
    expect(r.durationWorkingDays).toBeNull();
    expect(r.missing.map((m) => m.field)).toContain('quantity');
    expect(r.memo[0]).toMatch(/Nenhum valor foi arbitrado/);
  });

  it('BLOQUEIA quando falta indice, equipe ou horas produtivas', () => {
    expect(computeDuration({ quantity: { qty: 10, unit: 'in-dia' }, productivity: null, crew }).status).toBe('NOT_CALCULABLE');
    expect(computeDuration({ quantity: { qty: 10, unit: 'in-dia' }, productivity: prod, crew: [] }).status).toBe('NOT_CALCULABLE');
    const semHoras = computeDuration({
      quantity: { qty: 10, unit: 'in-dia' }, productivity: prod,
      crew: [{ resourceId: 'S', resourceName: 'Soldador', count: 2, productiveHoursPerDay: 0 }],
    });
    expect(semHoras.status).toBe('NOT_CALCULABLE');
    expect(semHoras.missing.some((m) => /horas produtivas/.test(m.reason))).toBe(true);
  });

  it('BLOQUEIA indice sem fonte, mesmo com valor valido', () => {
    const r = computeDuration({
      quantity: { qty: 10, unit: 'in-dia' },
      productivity: { ...prod, source: '' },
      crew,
    });
    expect(r.status).toBe('NOT_CALCULABLE');
    expect(r.missing.some((m) => /fonte/.test(m.reason))).toBe(true);
  });

  it('BLOQUEIA indice cuja unidade nao se aplica a quantidade', () => {
    const r = computeDuration({
      quantity: { qty: 10, unit: 'kg' },
      productivity: { ...prod, perUnit: 'in-dia' },
      crew,
    });
    expect(r.status).toBe('NOT_CALCULABLE');
    expect(r.missing.some((m) => /nao e aplicavel/.test(m.reason))).toBe(true);
  });

  it('REJEITA fator de praticabilidade sem fonte e aprovacao', () => {
    expect(() => computeDuration({
      quantity: { qty: 100, unit: 'in-dia' }, productivity: prod, crew,
      efficiency: { value: 0.7, source: '', approvedBy: '', approvedAt: '2026-01-01' },
    })).toThrow(ForbiddenAssumptionError);
  });

  it('aceita fator de eficiencia com fonte e aprovacao, registrando na memoria', () => {
    const r = computeDuration({
      quantity: { qty: 100, unit: 'in-dia' }, productivity: prod, crew,
      efficiency: { value: 0.7, source: 'Apontamento de campo jan-mar/2026', approvedBy: 'gerente', approvedAt: '2026-04-01' },
    });
    expect(r.status).toBe('CALCULATED');
    expect(r.dailyCapacityHH).toBeCloseTo(58.5 * 0.7, 4);
    expect(r.memo.join(' ')).toMatch(/aprovado por gerente/);
  });

  it('usa o SALDO, nao o previsto, quando ha HH realizados', () => {
    const r = computeDuration({ quantity: { qty: 500, unit: 'in-dia' }, productivity: prod, crew, actualWorkHH: 200 });
    expect(r.workHH).toBe(600);
    expect(r.remainingWorkHH).toBe(400);
    expect(r.durationWorkingDays).toBeCloseTo(400 / 58.5, 3);
  });

  it('calcula capacidade necessaria para caber numa janela', () => {
    expect(requiredCapacityForWindow(600, 10)).toBe(60);
    expect(() => requiredCapacityForWindow(600, 0)).toThrow();
  });
});
