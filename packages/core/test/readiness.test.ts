import { describe, expect, it } from 'vitest';
import {
  buildLookahead, computePpc, evaluateReadiness, READINESS_DIMENSIONS,
  type ConstraintRecord, type ReadinessAssessment,
} from '../src/readiness/index.js';

const allReady = (): ReadinessAssessment[] =>
  READINESS_DIMENSIONS.map((d) => ({ dimension: d.key, verdict: 'READY' as const, assessedBy: 'u1', assessedAt: '2026-02-01' }));

const constraint = (o: Partial<ConstraintRecord> = {}): ConstraintRecord => ({
  id: 'C1', description: 'Falta liberacao de material do spool SP-12', targetKind: 'IWP', targetId: 'IWP-1',
  category: 'MATERIAL', owner: 'suprimentos', neededBy: '2026-02-10', status: 'OPEN',
  potentialImpact: 'Para a frente de montagem do sistema 12', origin: 'Reuniao de restricoes 05/02',
  createdAt: '2026-02-01', updatedAt: '2026-02-01', ...o,
});

describe('prontidao de IWP', () => {
  it('so fica pronto quando TODAS as dimensoes foram avaliadas e estao prontas', () => {
    const r = evaluateReadiness('IWP-1', allReady(), []);
    expect(r.ready).toBe(true);
    expect(r.score).toBe('12/12');
  });

  it('dimensao NAO AVALIADA bloqueia — nao avaliado nao e pronto', () => {
    const r = evaluateReadiness('IWP-1', allReady().slice(0, 10), []);
    expect(r.ready).toBe(false);
    expect(r.blockedReason).toMatch(/NAO avaliada/);
    expect(r.blockedReason).toMatch(/Nao avaliado nao equivale a pronto/);
  });

  it('restricao aberta derruba a dimensao mesmo se marcada como pronta', () => {
    const r = evaluateReadiness('IWP-1', allReady(), [constraint()]);
    expect(r.ready).toBe(false);
    const mat = r.dimensions.find((d) => d.dimension === 'MATERIAL')!;
    expect(mat.verdict).toBe('NOT_READY');
    expect(mat.blockers[0]).toMatch(/SP-12/);
  });

  it('restricao removida nao bloqueia', () => {
    const r = evaluateReadiness('IWP-1', allReady(), [constraint({ status: 'REMOVED', removalEvidence: 'NF 1234' })]);
    expect(r.ready).toBe(true);
  });
});

describe('lookahead e PPC', () => {
  const activities = [
    { id: 'A1', name: 'Montagem sistema 12', plannedStart: '2026-02-16T07:00:00Z' },
    { id: 'A2', name: 'Montagem sistema 13', plannedStart: '2026-03-20T07:00:00Z' },
  ];

  it('so vira compromisso quando ha prontidao e nenhuma promessa posterior ao inicio', () => {
    const r = buildLookahead(activities, { A1: allReady() }, [], '2026-03-01T00:00:00Z');
    expect(r).toHaveLength(1);
    expect(r[0]!.canCommit).toBe(true);
  });

  it('promessa de remocao posterior ao inicio impede o compromisso', () => {
    const r = buildLookahead(activities, { A1: allReady() }, [
      constraint({ targetId: 'A1', promisedBy: '2026-02-25', neededBy: '2026-02-10' }),
    ], '2026-03-01T00:00:00Z');
    expect(r[0]!.canCommit).toBe(false);
    expect(r[0]!.reason).toMatch(/promessa posterior/);
  });

  it('calcula PPC e agrupa causas de nao cumprimento', () => {
    const r = computePpc([
      { activityId: 'A', completed: true },
      { activityId: 'B', completed: false, nonCompletionCause: 'Falta de material' },
      { activityId: 'C', completed: false, nonCompletionCause: 'Falta de material' },
      { activityId: 'D', completed: false },
    ]);
    expect(r.ppc).toBe(0.25);
    expect(r.causes['Falta de material']).toBe(2);
    expect(r.causes['(causa nao registrada)']).toBe(1);
  });
});
