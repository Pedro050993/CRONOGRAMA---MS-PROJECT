import { isUsableForApprovedPlan } from '../provenance/types.js';
import { convert, dimensionOf, IncompatibleUnitsError, round, unitOf } from '../units/index.js';
import type {
  DoubleCountFinding, QuantityItem, RollupDimension, RollupResult, RollupRow,
} from './types.js';

export interface RollupOptions {
  groupBy: RollupDimension[];
  targetUnit: string;
  /** Se true, inclui itens ainda nao aprovados (marcados na contagem). Padrao: true. */
  includePendingReview?: boolean;
  /** Precedencia documental aprovada. Sem ela, dupla contagem nao e resolvida sozinha. */
  precedence?: PrecedenceRule | null;
}

/** Regra de precedencia entre fontes — so vale depois de configurada e aprovada (§7.5). */
export interface PrecedenceRule {
  id: string;
  approvedBy: string;
  approvedAt: string;
  /** Da fonte mais forte para a mais fraca. */
  order: string[];
}

function keyOf(item: QuantityItem, dims: RollupDimension[]): Record<string, string> {
  const k: Record<string, string> = {};
  for (const d of dims) {
    const v = (item as unknown as Record<string, unknown>)[d];
    k[d] = v === undefined || v === null || v === '' ? '(nao informado)' : String(v);
  }
  return k;
}

/**
 * Consolida quantidades.
 *
 * Nao converte entre grandezas diferentes: um item em `kg` nunca entra num total em `m`.
 * Itens de outra grandeza sao **excluidos e listados**, nunca convertidos por conveniencia.
 */
export function rollup(items: QuantityItem[], opts: RollupOptions): RollupResult {
  const includePending = opts.includePendingReview ?? true;
  const targetDim = dimensionOf(opts.targetUnit);
  const excluded: RollupResult['excluded'] = [];
  const buckets = new Map<string, RollupRow>();

  for (const item of items) {
    if (!isUsableForApprovedPlan(item.provenance) && !includePending) {
      excluded.push({ item, reason: `Proveniencia nao utilizavel: ${item.provenance.dataClass}/${item.provenance.reviewStatus}` });
      continue;
    }
    if (item.provenance.dataClass === 'PENDING_INFO' || item.provenance.dataClass === 'SOURCE_CONFLICT') {
      excluded.push({ item, reason: `Item sem valor confirmado (${item.provenance.dataClass}).` });
      continue;
    }
    let qtyInTarget: number;
    try {
      if (dimensionOf(item.measure.unit) !== targetDim) throw new IncompatibleUnitsError(item.measure.unit, opts.targetUnit);
      qtyInTarget = convert(item.measure.qty, item.measure.unit, opts.targetUnit);
    } catch (e) {
      excluded.push({ item, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const key = keyOf(item, opts.groupBy);
    const hash = JSON.stringify(key);
    const row = buckets.get(hash) ?? {
      key, qty: 0, unit: opts.targetUnit, itemCount: 0,
      sourceKinds: [], documentIds: [], minConfidence: null, pendingReviewCount: 0,
    };
    row.qty += qtyInTarget;
    row.itemCount += 1;
    if (!row.sourceKinds.includes(item.sourceKind)) row.sourceKinds.push(item.sourceKind);
    if (!row.documentIds.includes(item.documentId)) row.documentIds.push(item.documentId);
    const c = item.provenance.confidence;
    if (typeof c === 'number') row.minConfidence = row.minConfidence === null ? c : Math.min(row.minConfidence, c);
    if (item.provenance.reviewStatus === 'PENDING') row.pendingReviewCount += 1;
    buckets.set(hash, row);
  }

  const rows = [...buckets.values()].map((r) => ({ ...r, qty: round(r.qty, 4) }));
  rows.sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
  return {
    rows,
    excluded,
    totals: {
      qty: round(rows.reduce((s, r) => s + r.qty, 0), 4),
      unit: opts.targetUnit,
      itemCount: rows.reduce((s, r) => s + r.itemCount, 0),
    },
  };
}

/**
 * Deteccao de dupla contagem.
 *
 * CONFIRMED: mesma entityKey, mesma grandeza, vinda de fontes diferentes.
 *   Somar = contar duas vezes o mesmo objeto fisico.
 * SUSPECTED: mesma entityKey na mesma fonte com quantidades divergentes
 *   (pode ser folha duplicada de isometrico ou revisao nao substituida).
 */
export function detectDoubleCount(
  items: QuantityItem[],
  precedence?: PrecedenceRule | null,
): DoubleCountFinding[] {
  const byEntity = new Map<string, QuantityItem[]>();
  for (const it of items) {
    const dim = (() => { try { return dimensionOf(it.measure.unit); } catch { return 'UNKNOWN'; } })();
    const k = `${it.entityKey}::${dim}`;
    const arr = byEntity.get(k) ?? [];
    arr.push(it);
    byEntity.set(k, arr);
  }

  const findings: DoubleCountFinding[] = [];
  for (const [k, group] of byEntity) {
    if (group.length < 2) continue;
    const entityKey = k.split('::')[0] ?? k;
    const sources = [...new Set(group.map((g) => g.sourceKind))];
    const detail = group.map((g) => ({
      id: g.id, sourceKind: g.sourceKind, documentId: g.documentId,
      qty: g.measure.qty, unit: g.measure.unit,
    }));

    if (sources.length > 1) {
      const resolved = precedence ? resolveByPrecedence(sources, precedence) : null;
      findings.push({
        entityKey,
        severity: 'CONFIRMED',
        message:
          `A entidade "${entityKey}" aparece em ${sources.length} fontes distintas ` +
          `(${sources.join(', ')}). Somar todas conta o mesmo objeto fisico mais de uma vez.` +
          (resolved
            ? ` Precedencia aprovada "${precedence?.id}" elege "${resolved}".`
            : ` Nenhuma regra de precedencia aprovada: o conflito permanece aberto.`),
        items: detail,
        ...(resolved ? { resolvedBy: `${precedence?.id}:${resolved}` } : {}),
      });
    } else {
      const qtys = [...new Set(group.map((g) => `${g.measure.qty}${g.measure.unit}`))];
      findings.push({
        entityKey,
        severity: 'SUSPECTED',
        message:
          qtys.length > 1
            ? `A entidade "${entityKey}" aparece ${group.length} vezes na fonte ${sources[0]} com quantidades divergentes (${qtys.join(' | ')}). Verifique folha duplicada ou revisao nao substituida.`
            : `A entidade "${entityKey}" aparece ${group.length} vezes na fonte ${sources[0]} com a mesma quantidade. Provavel folha duplicada.`,
        items: detail,
      });
    }
  }
  findings.sort((a, b) => (a.severity === b.severity ? a.entityKey.localeCompare(b.entityKey) : a.severity === 'CONFIRMED' ? -1 : 1));
  return findings;
}

function resolveByPrecedence(sources: string[], rule: PrecedenceRule): string | null {
  for (const s of rule.order) if (sources.includes(s)) return s;
  return null;
}

/**
 * Aplica precedencia aprovada, devolvendo o conjunto sem dupla contagem.
 * Sem regra aprovada, devolve os itens intactos e sinaliza — nunca escolhe
 * um vencedor silenciosamente (§7.5).
 */
export function deduplicateByPrecedence(
  items: QuantityItem[],
  precedence: PrecedenceRule | null,
): { items: QuantityItem[]; dropped: QuantityItem[]; unresolved: DoubleCountFinding[] } {
  const findings = detectDoubleCount(items, precedence);
  if (!precedence) return { items, dropped: [], unresolved: findings.filter((f) => f.severity === 'CONFIRMED') };

  const dropIds = new Set<string>();
  for (const f of findings) {
    if (f.severity !== 'CONFIRMED' || !f.resolvedBy) continue;
    const winner = f.resolvedBy.split(':')[1];
    for (const it of f.items) if (it.sourceKind !== winner) dropIds.add(it.id);
  }
  return {
    items: items.filter((i) => !dropIds.has(i.id)),
    dropped: items.filter((i) => dropIds.has(i.id)),
    unresolved: findings.filter((f) => f.severity === 'CONFIRMED' && !f.resolvedBy),
  };
}

/**
 * Deriva polegada-diametro de soldagem: Σ (numero de juntas × DN em polegadas).
 * Nao e conversao de unidade: e regra de engenharia, e por isso emite memoria de calculo.
 * Junta sem DN conhecido NAO entra no total — vira pendencia listada.
 */
export function deriveWeldInchDiameter(
  items: QuantityItem[],
  ruleSource = 'Regra padrao: pol-dia = Σ(juntas × DN[in]). Fonte: pratica de soldagem industrial.',
): { total: number; unit: 'in-dia'; memo: import('./types.js').CalcMemo; skipped: QuantityItem[] } {
  let total = 0;
  const skipped: QuantityItem[] = [];
  let joints = 0;
  for (const it of items) {
    if (unitOf(it.measure.unit).dimension !== 'JOINT') { skipped.push(it); continue; }
    if (typeof it.nominalDiameterIn !== 'number' || !(it.nominalDiameterIn > 0)) { skipped.push(it); continue; }
    total += it.measure.qty * it.nominalDiameterIn;
    joints += it.measure.qty;
  }
  return {
    total: round(total, 3),
    unit: 'in-dia',
    memo: {
      formula: 'pol_dia = Σ (juntas_i × DN_i[in])',
      inputs: { juntas_consideradas: joints, itens_considerados: items.length - skipped.length, itens_sem_DN: skipped.length },
      result: round(total, 3),
      unit: 'in-dia',
      ruleId: 'PIPING.WELD_INCH_DIA.V1',
      ruleSource,
      computedAt: new Date().toISOString(),
    },
    skipped,
  };
}
