import { describe, expect, it } from 'vitest';
import { runQualityChecks, summarizeFindings } from '../src/quality/checks.js';
import { standardCalendar } from '../src/calendar/index.js';
import type { Link, NetworkActivity } from '../src/network/types.js';

const cal = standardCalendar();
const calendars = { [cal.id]: cal };
const act = (id: string, days = 1, over: Partial<NetworkActivity> = {}): NetworkActivity => ({
  id, name: id, durationMinutes: days * 480, calendarId: cal.id, isMilestone: false, ...over,
});
const link = (p: string, s: string, over: Partial<Link> = {}): Link => ({
  id: `${p}-${s}`, predecessorId: p, successorId: s, type: 'FS', lagMinutes: 0, status: 'VALIDATED',
  rationale: { reasonKind: 'PHYSICAL', reason: 'motivo documentado', sourceRefs: ['DOC-1'], confidence: 0.9 },
  ...over,
});

const codes = (f: ReturnType<typeof runQualityChecks>): string[] => f.map((x) => x.code);

describe('verificacoes de qualidade da logica', () => {
  it('aponta pontas soltas, exceto marcos autorizados', () => {
    const f = runQualityChecks({
      activities: [act('A'), act('B')], links: [link('A', 'B')], calendars,
      authorizedOpenEnds: ['A'],
    });
    expect(codes(f)).toContain('OPEN_FINISH');
    expect(f.filter((x) => x.code === 'OPEN_START').map((x) => x.activityIds[0])).not.toContain('A');
  });

  it('aponta ciclo', () => {
    const f = runQualityChecks({ activities: [act('A'), act('B')], links: [link('A', 'B'), link('B', 'A')], calendars });
    expect(codes(f)).toContain('LOGIC_CYCLE');
  });

  it('trata restricao rigida sem justificativa como ERRO e com justificativa como aviso', () => {
    const sem = runQualityChecks({ activities: [act('A', 1, { constraint: { type: 'MSO', date: '2026-02-01' } })], links: [], calendars });
    expect(sem.find((x) => x.code === 'HARD_CONSTRAINT')!.severity).toBe('ERROR');
    const com = runQualityChecks({ activities: [act('A', 1, { constraint: { type: 'MSO', date: '2026-02-01', justification: 'janela de parada contratual' } })], links: [], calendars });
    expect(com.find((x) => x.code === 'HARD_CONSTRAINT')!.severity).toBe('WARNING');
  });

  it('aponta lag sem justificativa e lag negativo', () => {
    const f = runQualityChecks({
      activities: [act('A'), act('B'), act('C')],
      links: [
        link('A', 'B', { lagMinutes: 960, rationale: { reasonKind: 'PHYSICAL', reason: '', sourceRefs: [], confidence: 0.5 } }),
        link('B', 'C', { lagMinutes: -480 }),
      ],
      calendars,
    });
    expect(codes(f)).toContain('LAG_NO_REASON');
    expect(codes(f)).toContain('NEGATIVE_LAG');
  });

  it('aponta duracao excessiva e duracao redonda suspeita', () => {
    const f = runQualityChecks({ activities: [act('A', 60)], links: [], calendars });
    expect(codes(f)).toContain('LONG_DURATION');
    expect(codes(f)).toContain('ROUND_DURATION');
  });

  it('aponta duracao NAO CALCULAVEL como erro bloqueante', () => {
    const f = runQualityChecks({ activities: [act('A')], links: [], calendars, notCalculable: ['A'] });
    const finding = f.find((x) => x.code === 'NOT_CALCULABLE')!;
    expect(finding.severity).toBe('ERROR');
    expect(finding.message).toMatch(/nao arbitra duracao/);
    expect(summarizeFindings(f).blocking).toBe(true);
  });

  it('aponta atividade fora da EAP e escopo sem atividade', () => {
    const f = runQualityChecks({
      activities: [act('A')], links: [], calendars,
      wbsByActivity: {}, orphanScopeIds: ['QTY-77'],
    });
    expect(codes(f)).toContain('ACTIVITY_OUTSIDE_WBS');
    expect(codes(f)).toContain('SCOPE_WITHOUT_ACTIVITY');
  });

  it('aponta data imposta sem logica de suporte', () => {
    const f = runQualityChecks({
      activities: [act('A', 1, { constraint: { type: 'SNET', date: '2026-03-01', justification: 'x' } })],
      links: [], calendars,
    });
    expect(codes(f)).toContain('IMPOSED_DATE_NO_LOGIC');
  });

  it('aponta marco contratual sem cadeia logica', () => {
    const f = runQualityChecks({
      activities: [act('M', 0, { isMilestone: true })], links: [], calendars,
      contractualMilestones: ['M'],
    });
    expect(codes(f)).toContain('MILESTONE_NO_CHAIN');
  });

  it('aponta recurso superalocado', () => {
    const f = runQualityChecks({
      activities: [act('A'), act('B')], links: [link('A', 'B')], calendars,
      resourceDemand: [{ activityId: 'A', resourceId: 'SOLDADOR', hhPerDay: 40 }, { activityId: 'B', resourceId: 'SOLDADOR', hhPerDay: 40 }],
      resourceCapacity: { SOLDADOR: 52 },
    });
    const r = f.find((x) => x.code === 'RESOURCE_OVERALLOCATION')!;
    expect(r.message).toMatch(/efetivo que nao existe/);
  });

  it('avisa que vinculos sugeridos ainda nao entraram no calculo aprovado', () => {
    const f = runQualityChecks({
      activities: [act('A'), act('B')], links: [link('A', 'B', { status: 'SUGGESTED' })], calendars,
    });
    expect(codes(f)).toContain('UNVALIDATED_LINKS');
  });

  it('aponta calendario ausente', () => {
    const f = runQualityChecks({ activities: [act('A', 1, { calendarId: 'X' })], links: [], calendars });
    expect(codes(f)).toContain('MISSING_CALENDAR');
  });
});
