import { describe, expect, it } from 'vitest';
import { computeCpm, findCycles, ScheduleCycleError } from '../src/network/cpm.js';
import type { Link, NetworkActivity } from '../src/network/types.js';
import { standardCalendar } from '../src/calendar/index.js';

const cal = standardCalendar();
const calendars = { [cal.id]: cal };
const D = 480; // minutos uteis por dia

const act = (id: string, days: number, over: Partial<NetworkActivity> = {}): NetworkActivity => ({
  id, name: id, durationMinutes: days * D, calendarId: cal.id, isMilestone: days === 0, ...over,
});

const link = (p: string, s: string, over: Partial<Link> = {}): Link => ({
  id: `${p}-${s}`, predecessorId: p, successorId: s, type: 'FS', lagMinutes: 0, status: 'VALIDATED',
  rationale: { reasonKind: 'PHYSICAL', reason: 'teste', sourceRefs: ['DOC-1'], confidence: 1 },
  ...over,
});

describe('CPM', () => {
  const start = new Date('2026-01-05T07:00:00Z'); // segunda

  it('calcula datas em cadeia FS respeitando o calendario', () => {
    const acts = [act('A', 2), act('B', 3), act('C', 1)];
    const links = [link('A', 'B'), link('B', 'C')];
    const r = computeCpm(acts, links, { projectStart: start, calendars });
    expect(r.activities['A']!.earlyStart).toBe('2026-01-05T07:00:00.000Z');
    expect(r.activities['A']!.earlyFinish).toBe('2026-01-06T16:00:00.000Z');
    // A termina as 16:00 de 06/01; B so pode comecar no turno seguinte
    expect(r.activities['B']!.earlyStart).toBe('2026-01-07T07:00:00.000Z');
    expect(r.activities['C']!.earlyFinish).toBe('2026-01-12T16:00:00.000Z');
    expect(r.projectFinish).toBe('2026-01-12T16:00:00.000Z');
  });

  it('identifica caminho critico e folga do ramo nao critico', () => {
    // A -> B(5d) -> D ; A -> C(2d) -> D
    const acts = [act('A', 1), act('B', 5), act('C', 2), act('D', 1)];
    const links = [link('A', 'B'), link('A', 'C'), link('B', 'D'), link('C', 'D')];
    const r = computeCpm(acts, links, { projectStart: start, calendars });
    expect(r.activities['B']!.isCritical).toBe(true);
    expect(r.activities['C']!.isCritical).toBe(false);
    expect(r.activities['C']!.totalFloatMinutes).toBe(3 * D);
    expect(r.criticalPath).toEqual(['A', 'B', 'D']);
  });

  it('aplica defasagem em tempo util', () => {
    const acts = [act('A', 1), act('B', 1)];
    const links = [link('A', 'B', { lagMinutes: 2 * D })];
    const r = computeCpm(acts, links, { projectStart: start, calendars });
    // A termina 05/01 16:00; +2 dias uteis de defasagem -> 07/01 16:00, proximo turno 08/01 07:00
    expect(r.activities['B']!.earlyStart).toBe('2026-01-08T07:00:00.000Z');
  });

  it('trata SS e FF', () => {
    const acts = [act('A', 4), act('B', 2)];
    const ss = computeCpm(acts, [link('A', 'B', { type: 'SS', lagMinutes: D })], { projectStart: start, calendars });
    expect(ss.activities['B']!.earlyStart).toBe('2026-01-06T07:00:00.000Z');

    const ff = computeCpm(acts, [link('A', 'B', { type: 'FF' })], { projectStart: start, calendars });
    expect(ff.activities['B']!.earlyFinish).toBe(ff.activities['A']!.earlyFinish);
  });

  it('IGNORA vinculos ainda nao validados no calculo aprovado', () => {
    const acts = [act('A', 2), act('B', 2)];
    const suggested = [link('A', 'B', { status: 'SUGGESTED' })];
    const r = computeCpm(acts, suggested, { projectStart: start, calendars });
    expect(r.activities['B']!.earlyStart).toBe(r.activities['A']!.earlyStart);

    const simulated = computeCpm(acts, suggested, { projectStart: start, calendars, includeStatuses: ['SUGGESTED'] });
    expect(new Date(simulated.activities['B']!.earlyStart).getTime())
      .toBeGreaterThanOrEqual(new Date(simulated.activities['A']!.earlyFinish).getTime());
    expect(simulated.activities['B']!.earlyStart).not.toBe(r.activities['B']!.earlyStart);
  });

  it('RECUSA calcular quando ha ciclo, em vez de devolver datas erradas', () => {
    const acts = [act('A', 1), act('B', 1), act('C', 1)];
    const links = [link('A', 'B'), link('B', 'C'), link('C', 'A')];
    expect(findCycles(acts, links)).toHaveLength(1);
    expect(() => computeCpm(acts, links, { projectStart: start, calendars })).toThrow(ScheduleCycleError);
  });

  it('respeita restricao SNET', () => {
    const acts = [act('A', 1), act('B', 1, { constraint: { type: 'SNET', date: '2026-01-15T07:00:00Z', justification: 'janela de parada' } })];
    const r = computeCpm(acts, [link('A', 'B')], { projectStart: start, calendars });
    expect(r.activities['B']!.earlyStart).toBe('2026-01-15T07:00:00.000Z');
  });

  it('marco tem duracao zero e nao desloca a rede', () => {
    const acts = [act('A', 2), act('M', 0), act('B', 1)];
    const r = computeCpm(acts, [link('A', 'M'), link('M', 'B')], { projectStart: start, calendars });
    expect(r.activities['M']!.earlyStart).toBe(r.activities['M']!.earlyFinish);
    // A termina 06/01 16:00 -> marco e B caem no turno seguinte, sem consumir prazo
    expect(r.activities['M']!.earlyStart).toBe('2026-01-07T07:00:00.000Z');
    expect(r.activities['B']!.earlyStart).toBe(r.activities['M']!.earlyFinish);
  });

  it('recusa atividade com calendario inexistente', () => {
    expect(() => computeCpm([act('A', 1, { calendarId: 'INEXISTENTE' })], [], { projectStart: start, calendars }))
      .toThrow(/nao encontrado/);
  });
});
