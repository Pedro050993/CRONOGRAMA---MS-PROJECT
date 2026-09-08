/**
 * Portao de promocao ao plano aprovado (§4.2).
 *
 * Este modulo e o "nao" do sistema. Ele existe para que conteudo extraido por IA
 * nao alimente silenciosamente um cronograma aprovado.
 */
import { isUsableForApprovedPlan, type Provenance } from '../provenance/types.js';

export type PromotionStage =
  | 'DOCUMENT_CLASSIFICATION' | 'QUANTITY' | 'ENTITY_RELATION' | 'WBS'
  | 'LOGIC_LINK' | 'PRODUCTIVITY' | 'DURATION' | 'RESOURCE' | 'ASSUMPTION';

export interface PromotionCandidate {
  id: string;
  stage: PromotionStage;
  label: string;
  provenance: Provenance;
  /** Ids dos itens dos quais este depende (ex.: atividade depende das quantidades). */
  dependsOn?: string[];
}

export interface PromotionBlock {
  id: string;
  stage: PromotionStage;
  label: string;
  reason: string;
}

export interface PromotionResult {
  approved: string[];
  blocked: PromotionBlock[];
  /** true somente quando nada esta bloqueado. */
  canPromote: boolean;
}

/**
 * Avalia se um conjunto pode ser promovido. A dependencia e transitiva:
 * uma atividade cuja quantidade nao foi aprovada tambem nao passa.
 */
export function evaluatePromotion(candidates: PromotionCandidate[]): PromotionResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const blocked = new Map<string, PromotionBlock>();

  for (const c of candidates) {
    if (!isUsableForApprovedPlan(c.provenance)) {
      blocked.set(c.id, {
        id: c.id, stage: c.stage, label: c.label,
        reason: reasonFor(c.provenance),
      });
    }
  }

  // Propagacao transitiva
  let changed = true;
  let guard = 0;
  while (changed && guard++ < candidates.length + 1) {
    changed = false;
    for (const c of candidates) {
      if (blocked.has(c.id)) continue;
      for (const dep of c.dependsOn ?? []) {
        const b = blocked.get(dep);
        if (b) {
          blocked.set(c.id, {
            id: c.id, stage: c.stage, label: c.label,
            reason: `Depende de "${byId.get(dep)?.label ?? dep}", que esta bloqueado: ${b.reason}`,
          });
          changed = true;
          break;
        }
        if (!byId.has(dep)) {
          blocked.set(c.id, {
            id: c.id, stage: c.stage, label: c.label,
            reason: `Depende de "${dep}", que nao existe no conjunto avaliado. Rastreabilidade quebrada.`,
          });
          changed = true;
          break;
        }
      }
    }
  }

  return {
    approved: candidates.filter((c) => !blocked.has(c.id)).map((c) => c.id),
    blocked: [...blocked.values()],
    canPromote: blocked.size === 0,
  };
}

function reasonFor(p: Provenance): string {
  switch (p.dataClass) {
    case 'PENDING_INFO': return `Pendencia de informacao: ${p.note ?? 'dado ausente'}.`;
    case 'SOURCE_CONFLICT': return `Conflito entre fontes ainda nao resolvido: ${p.note ?? 'divergencia documental'}.`;
    case 'AI_INFERENCE': return 'Inferencia da IA sem aprovacao humana. §4.2 exige revisao antes do uso.';
    default:
      if (p.reviewStatus === 'REJECTED') return 'Item rejeitado na revisao.';
      if (p.reviewStatus === 'PENDING') return 'Aguardando revisao humana.';
      return `Proveniencia nao utilizavel (${p.dataClass}/${p.reviewStatus}).`;
  }
}

/** Registro de decisao — cada aprovacao/rejeicao vira um fato auditavel. */
export interface DecisionRecord {
  id: string;
  stage: PromotionStage;
  targetId: string;
  decision: 'APPROVED' | 'REJECTED' | 'CORRECTED' | 'DEFERRED';
  by: string;
  at: string;
  justification: string;
  before?: unknown;
  after?: unknown;
}

export function requireJustification(d: Omit<DecisionRecord, 'at'>): DecisionRecord {
  if (!d.justification?.trim() && d.decision !== 'APPROVED') {
    throw new Error(`Decisao "${d.decision}" sobre "${d.targetId}" exige justificativa registrada.`);
  }
  if (!d.by?.trim()) throw new Error('Decisao sem usuario responsavel.');
  return { ...d, at: new Date().toISOString() };
}
