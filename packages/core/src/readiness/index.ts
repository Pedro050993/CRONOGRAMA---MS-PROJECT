/**
 * Restricoes e prontidao (§17).
 *
 * Um IWP so pode ser declarado pronto depois que cada dimensao de prontidao for
 * AVALIADA. "Nao avaliado" nunca conta como "ok".
 */
export type ConstraintCategory =
  | 'ENGINEERING' | 'MATERIAL' | 'ACCESS' | 'LABOR' | 'EQUIPMENT' | 'SCAFFOLD_RIGGING'
  | 'SAFETY_PERMIT' | 'QUALITY_INSPECTION' | 'PREDECESSOR' | 'INTERFACE'
  | 'OPERATIONAL' | 'DOCUMENTATION' | 'CONTRACTUAL' | 'WEATHER';

export type ConstraintStatus = 'OPEN' | 'IN_PROGRESS' | 'REMOVED' | 'ACCEPTED_RISK' | 'CANCELLED';

export interface ConstraintRecord {
  id: string;
  description: string;
  targetKind: 'IWP' | 'CWP' | 'ACTIVITY';
  targetId: string;
  category: ConstraintCategory;
  owner: string;
  neededBy: string;
  promisedBy?: string;
  status: ConstraintStatus;
  removalEvidence?: string;
  potentialImpact: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export const READINESS_DIMENSIONS: { key: ConstraintCategory; label: string }[] = [
  { key: 'ENGINEERING', label: 'Engenharia' },
  { key: 'MATERIAL', label: 'Material' },
  { key: 'ACCESS', label: 'Acesso e area' },
  { key: 'LABOR', label: 'Mao de obra' },
  { key: 'EQUIPMENT', label: 'Equipamentos e ferramentas' },
  { key: 'SCAFFOLD_RIGGING', label: 'Andaime e icamento' },
  { key: 'SAFETY_PERMIT', label: 'Seguranca e permissoes' },
  { key: 'QUALITY_INSPECTION', label: 'Qualidade e inspecao' },
  { key: 'PREDECESSOR', label: 'Predecessoras' },
  { key: 'INTERFACE', label: 'Interfaces com outras disciplinas' },
  { key: 'OPERATIONAL', label: 'Condicao operacional' },
  { key: 'DOCUMENTATION', label: 'Documentacao e aprovacao' },
];

export type DimensionVerdict = 'READY' | 'NOT_READY' | 'NOT_ASSESSED';

export interface ReadinessAssessment {
  dimension: ConstraintCategory;
  verdict: DimensionVerdict;
  assessedBy?: string;
  assessedAt?: string;
  note?: string;
}

export interface ReadinessResult {
  targetId: string;
  ready: boolean;
  score: string;
  dimensions: { dimension: ConstraintCategory; label: string; verdict: DimensionVerdict; blockers: string[] }[];
  openConstraints: ConstraintRecord[];
  /** Motivo objetivo de bloqueio, quando nao pronto. */
  blockedReason?: string;
}

/**
 * Avalia prontidao. Uma dimensao sem avaliacao registrada BLOQUEIA o pacote.
 * Isso e deliberado: pacote liberado com dimensao "esquecida" e a origem
 * classica de frente parada.
 */
export function evaluateReadiness(
  targetId: string,
  assessments: ReadinessAssessment[],
  constraints: ConstraintRecord[],
): ReadinessResult {
  const byDim = new Map(assessments.map((a) => [a.dimension, a]));
  const open = constraints.filter((c) => c.targetId === targetId && (c.status === 'OPEN' || c.status === 'IN_PROGRESS'));

  const dimensions = READINESS_DIMENSIONS.map(({ key, label }) => {
    const a = byDim.get(key);
    const blockers = open.filter((c) => c.category === key).map((c) => c.description);
    let verdict: DimensionVerdict = a?.verdict ?? 'NOT_ASSESSED';
    if (verdict === 'READY' && blockers.length > 0) verdict = 'NOT_READY';
    return { dimension: key, label, verdict, blockers };
  });

  const notReady = dimensions.filter((d) => d.verdict === 'NOT_READY');
  const notAssessed = dimensions.filter((d) => d.verdict === 'NOT_ASSESSED');
  const ready = notReady.length === 0 && notAssessed.length === 0;

  const parts: string[] = [];
  if (notReady.length) parts.push(`${notReady.length} dimensao(oes) NAO pronta(s): ${notReady.map((d) => d.label).join(', ')}`);
  if (notAssessed.length) parts.push(`${notAssessed.length} dimensao(oes) NAO avaliada(s): ${notAssessed.map((d) => d.label).join(', ')}. Nao avaliado nao equivale a pronto.`);

  return {
    targetId,
    ready,
    score: `${dimensions.filter((d) => d.verdict === 'READY').length}/${dimensions.length}`,
    dimensions,
    openConstraints: open,
    ...(ready ? {} : { blockedReason: parts.join(' | ') }),
  };
}

/** Lookahead: transforma atividade em compromisso apenas se as restricoes forem removiveis a tempo. */
export interface LookaheadEntry {
  activityId: string;
  name: string;
  plannedStart: string;
  readiness: ReadinessResult;
  canCommit: boolean;
  reason: string;
}

export function buildLookahead(
  activities: { id: string; name: string; plannedStart: string }[],
  assessmentsByActivity: Record<string, ReadinessAssessment[]>,
  constraints: ConstraintRecord[],
  horizonEnd: string,
): LookaheadEntry[] {
  const horizon = new Date(horizonEnd).getTime();
  return activities
    .filter((a) => new Date(a.plannedStart).getTime() <= horizon)
    .map((a) => {
      const readiness = evaluateReadiness(a.id, assessmentsByActivity[a.id] ?? [], constraints);
      const lateConstraints = readiness.openConstraints.filter(
        (c) => new Date(c.promisedBy ?? c.neededBy).getTime() > new Date(a.plannedStart).getTime(),
      );
      const canCommit = readiness.ready && lateConstraints.length === 0;
      return {
        activityId: a.id,
        name: a.name,
        plannedStart: a.plannedStart,
        readiness,
        canCommit,
        reason: canCommit
          ? 'Todas as dimensoes avaliadas e prontas; nenhuma restricao aberta com promessa posterior ao inicio.'
          : lateConstraints.length > 0
            ? `Restricao com promessa posterior ao inicio planejado: ${lateConstraints.map((c) => `${c.description} (promessa ${c.promisedBy ?? c.neededBy})`).join('; ')}`
            : readiness.blockedReason ?? 'Prontidao insuficiente.',
      };
    });
}

/** PPC — percentual do plano concluido (Last Planner). */
export function computePpc(commitments: { activityId: string; completed: boolean; nonCompletionCause?: string }[]): {
  ppc: number; total: number; completed: number; causes: Record<string, number>;
} {
  const total = commitments.length;
  const completed = commitments.filter((c) => c.completed).length;
  const causes: Record<string, number> = {};
  for (const c of commitments) {
    if (c.completed) continue;
    const k = c.nonCompletionCause?.trim() || '(causa nao registrada)';
    causes[k] = (causes[k] ?? 0) + 1;
  }
  return { ppc: total > 0 ? Number((completed / total).toFixed(4)) : 0, total, completed, causes };
}
