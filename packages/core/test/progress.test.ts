import { describe, expect, it } from 'vitest';
import { authorizeActualChange, buildProgressSnapshot, RetroactiveChangeError, type ProgressActivity } from '../src/progress/index.js';
import { standardCalendar } from '../src/calendar/index.js';

const cal = standardCalendar();
const calendars = { [cal.id]: cal };

const a = (o: Partial<ProgressActivity> & Pick<ProgressActivity, 'id'>): ProgressActivity => ({
  name: o.id, calendarId: cal.id,
  baselineWorkHH: 100, baselineStart: '2026-01-05T07:00:00Z', baselineFinish: '2026-01-16T16:00:00Z',
  plannedWorkHH: 100, plannedStart: '2026-01-05T07:00:00Z', plannedFinish: '2026-01-16T16:00:00Z',
  ...o,
});

describe('avanco fisico e Curva S', () => {
  it('separa linha de base, plano atual e realizado', () => {
    const s = buildProgressSnapshot([
      a({ id: 'A', plannedWorkHH: 120, plannedFinish: '2026-01-23T16:00:00Z', actualWorkHH: 60, remainingWorkHH: 60, actualStart: '2026-01-05T07:00:00Z' }),
    ], { statusDate: '2026-01-16T16:00:00Z', calendars });

    expect(s.totals.baselineHH).toBe(100);
    expect(s.totals.plannedHH).toBe(120);
    expect(s.totals.actualHH).toBe(60);
    expect(s.totals.remainingHH).toBe(60);
    expect(s.totals.physicalProgress).toBe(0.5);
  });

  it('avanco fisico e ponderado por HH, nao por contagem de atividades', () => {
    const s = buildProgressSnapshot([
      a({ id: 'GRANDE', plannedWorkHH: 900, actualWorkHH: 0, remainingWorkHH: 900 }),
      a({ id: 'PEQUENA', plannedWorkHH: 100, actualWorkHH: 100, remainingWorkHH: 0, actualFinish: '2026-01-10T16:00:00Z' }),
    ], { statusDate: '2026-01-16T16:00:00Z', calendars });
    expect(s.totals.physicalProgress).toBe(0.1); // e nao 0.5
  });

  it('nao projeta a curva realizada para depois da data de status', () => {
    const s = buildProgressSnapshot([a({ id: 'A', actualWorkHH: 40, remainingWorkHH: 60 })], {
      statusDate: '2026-01-12T16:00:00Z', calendars,
    });
    const futuros = s.curve.filter((c) => new Date(c.date).getTime() > new Date('2026-01-12T16:00:00Z').getTime());
    expect(futuros.length).toBeGreaterThan(0);
    expect(futuros.every((c) => c.actualPct === null)).toBe(true);
  });

  it('calcula SPI fisico contra a linha de base na data de status', () => {
    const s = buildProgressSnapshot([a({ id: 'A', actualWorkHH: 25, remainingWorkHH: 75 })], {
      statusDate: '2026-01-12T16:00:00Z', calendars,
    });
    expect(s.totals.physicalProgress).toBe(0.25);
    expect(s.schedulePerformanceIndex).not.toBeNull();
    expect(s.schedulePerformanceIndex!).toBeLessThan(1);
  });

  it('aponta tendencia de atraso a partir do saldo e do ritmo planejado', () => {
    const s = buildProgressSnapshot([
      a({ id: 'A', actualWorkHH: 10, remainingWorkHH: 90, actualStart: '2026-01-05T07:00:00Z' }),
    ], { statusDate: '2026-01-14T16:00:00Z', calendars });
    expect(s.trendingLate).toHaveLength(1);
    expect(s.trendingLate[0]!.delayDays).toBeGreaterThan(0);
    expect(new Date(s.trendingLate[0]!.forecastFinish).getTime())
      .toBeGreaterThan(new Date('2026-01-16T16:00:00Z').getTime());
  });

  it('avisa quando a atividade tem calendario inexistente, em vez de silenciar', () => {
    const s = buildProgressSnapshot([a({ id: 'A', calendarId: 'X' })], { statusDate: '2026-01-12T16:00:00Z', calendars });
    expect(s.warnings[0]).toMatch(/calendario "X" nao encontrado/);
  });
});

describe('protecao do realizado', () => {
  const base = {
    activityId: 'A', field: 'actualWorkHH' as const, before: 100, after: 80, by: 'u1',
    justification: 'Correcao de apontamento em duplicidade do RDO 12/02',
    hasPermission: true,
  };

  it('registra a alteracao com valor anterior, novo, autor e justificativa', () => {
    const r = authorizeActualChange(base);
    expect(r.auditEntry).toMatchObject({ kind: 'ACTUAL_CHANGED', before: 100, after: 80, by: 'u1' });
    expect(r.auditEntry['justification']).toMatch(/RDO 12\/02/);
  });

  it('RECUSA alterar o realizado sem permissao', () => {
    expect(() => authorizeActualChange({ ...base, hasPermission: false })).toThrow(RetroactiveChangeError);
  });

  it('RECUSA alterar o realizado sem justificativa', () => {
    expect(() => authorizeActualChange({ ...base, justification: 'ajuste' })).toThrow(/justificativa/);
  });
});
