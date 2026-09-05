/**
 * Motor de duracao (§13.2).
 *
 *   Trabalho previsto (HH) = Quantidade × Indice (HH/unidade)
 *   Capacidade diaria (HH/dia) = Σ (recursos × horas produtivas por recurso por dia)
 *   Duracao (dias uteis) = Trabalho remanescente (HH) ÷ Capacidade diaria (HH/dia)
 *
 * Faltando qualquer insumo, o resultado e NOT_CALCULABLE com a lista do que falta.
 * O motor nao arbitra valor. Nunca.
 */
import { round, unitOf } from '../units/index.js';
import type { Measure } from '../units/index.js';

export interface ProductivityIndex {
  /** HH por unidade de `perUnit`. */
  value: number;
  perUnit: string;
  /** Origem obrigatoria: historico, orcamento, norma, benchmark. Sem fonte, nao entra. */
  source: string;
  sourceDate: string;
  /** Orcada | planejada | observada | projetada (§ produtividade). */
  basis: 'BUDGETED' | 'PLANNED' | 'OBSERVED' | 'FORECAST';
  /**
   * Indice lido de um arquivo e EXTRACAO, nao digitacao: precisa de confirmacao
   * humana antes de calcular prazo (§4.2). Ausente = digitado direto, ja confiavel.
   */
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface CrewMember {
  resourceId: string;
  resourceName: string;
  count: number;
  /**
   * HORAS PRODUTIVAS por recurso por dia. Nao e hora paga nem hora disponivel.
   * A diferenca e explicita para impedir a confusao apontada em §13.2.
   */
  productiveHoursPerDay: number;
}

/** Fator de eficiencia/praticabilidade — so aceito com fonte e aprovacao (§ produtividade). */
export interface EfficiencyFactor {
  value: number;
  source: string;
  approvedBy: string;
  approvedAt: string;
}

export interface DurationInputs {
  quantity: Measure | null;
  productivity: ProductivityIndex | null;
  crew: CrewMember[] | null;
  /** HH ja realizados, para calcular o saldo. Padrao 0. */
  actualWorkHH?: number;
  efficiency?: EfficiencyFactor | null;
  /** Minutos uteis medios por dia do calendario — usado para converter dias em datas. */
  calendarId?: string;
}

export type DurationStatus = 'CALCULATED' | 'NOT_CALCULABLE';

export interface MissingInput {
  field: 'quantity' | 'productivity' | 'crew' | 'efficiency';
  reason: string;
}

export interface DurationResult {
  status: DurationStatus;
  /** HH totais previstos. null quando NOT_CALCULABLE. */
  workHH: number | null;
  remainingWorkHH: number | null;
  dailyCapacityHH: number | null;
  durationWorkingDays: number | null;
  missing: MissingInput[];
  memo: string[];
}

export class ForbiddenAssumptionError extends Error {
  constructor(message: string) { super(message); this.name = 'ForbiddenAssumptionError'; }
}

export function computeDuration(input: DurationInputs): DurationResult {
  const missing: MissingInput[] = [];
  const memo: string[] = [];

  const q = input.quantity;
  if (!q || !(q.qty > 0)) {
    missing.push({ field: 'quantity', reason: 'Quantidade ausente, zero ou nao validada.' });
  }
  const p = input.productivity;
  if (!p || !(p.value > 0)) {
    missing.push({ field: 'productivity', reason: 'Indice de produtividade ausente ou nao positivo.' });
  } else if (!p.source?.trim()) {
    missing.push({ field: 'productivity', reason: 'Indice informado sem fonte. §13.2 exige fonte e data.' });
  } else if (p.approvalStatus === 'PENDING') {
    missing.push({
      field: 'productivity',
      reason: `Indice "${p.source}" foi importado de arquivo e ainda nao foi confirmado por um revisor. ` +
              'Leitura de planilha e extracao, nao digitacao: ela nao calcula prazo antes de ser conferida.',
    });
  } else if (p.approvalStatus === 'REJECTED') {
    missing.push({ field: 'productivity', reason: `Indice "${p.source}" foi rejeitado na revisao e nao pode calcular duracao.` });
  }
  const crew = input.crew ?? [];
  if (crew.length === 0) {
    missing.push({ field: 'crew', reason: 'Equipe nao definida (recursos e horas produtivas por dia).' });
  } else {
    for (const c of crew) {
      if (!(c.count > 0)) missing.push({ field: 'crew', reason: `Recurso "${c.resourceName}" com quantidade invalida.` });
      if (!(c.productiveHoursPerDay > 0)) missing.push({ field: 'crew', reason: `Recurso "${c.resourceName}" sem horas produtivas por dia.` });
    }
  }

  if (input.efficiency) {
    const e = input.efficiency;
    if (!e.source?.trim() || !e.approvedBy?.trim()) {
      throw new ForbiddenAssumptionError(
        'Fator de eficiencia sem fonte e aprovacao registradas. ' +
        'Praticabilidade de 60%, 70% ou qualquer outro valor exige memoria de calculo e aprovacao (§6 e §13.2).',
      );
    }
    if (!(e.value > 0) || e.value > 2) {
      throw new ForbiddenAssumptionError(`Fator de eficiencia fora de faixa plausivel: ${e.value}.`);
    }
  }

  if (q && p && q.unit !== p.perUnit) {
    try {
      if (unitOf(q.unit).dimension !== unitOf(p.perUnit).dimension) {
        missing.push({
          field: 'productivity',
          reason: `Indice em HH/${p.perUnit} nao e aplicavel a quantidade em ${q.unit} (grandezas diferentes).`,
        });
      }
    } catch (e) {
      missing.push({ field: 'productivity', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  if (missing.length > 0) {
    return {
      status: 'NOT_CALCULABLE',
      workHH: null, remainingWorkHH: null, dailyCapacityHH: null, durationWorkingDays: null,
      missing,
      memo: ['Duracao NAO calculada: insumos essenciais ausentes. Nenhum valor foi arbitrado.'],
    };
  }

  const qty = q!;
  const prod = p!;
  const qtyInIndexUnit = qty.unit === prod.perUnit
    ? qty.qty
    : (qty.qty * unitOf(qty.unit).toBase) / unitOf(prod.perUnit).toBase;

  const workHH = round(qtyInIndexUnit * prod.value, 2);
  memo.push(`Trabalho = ${round(qtyInIndexUnit, 4)} ${prod.perUnit} × ${prod.value} HH/${prod.perUnit} = ${workHH} HH`);
  memo.push(`Indice: base ${prod.basis}, fonte "${prod.source}" (${prod.sourceDate}).`);

  const actual = Math.max(0, input.actualWorkHH ?? 0);
  const remaining = round(Math.max(0, workHH - actual), 2);
  if (actual > 0) memo.push(`Saldo = ${workHH} HH previstos − ${actual} HH realizados = ${remaining} HH`);

  const rawCapacity = crew.reduce((s, c) => s + c.count * c.productiveHoursPerDay, 0);
  memo.push(
    `Capacidade diaria = ${crew.map((c) => `${c.count} × ${c.productiveHoursPerDay} h/dia (${c.resourceName})`).join(' + ')} = ${round(rawCapacity, 2)} HH/dia (horas PRODUTIVAS)`,
  );

  let capacity = rawCapacity;
  if (input.efficiency) {
    capacity = rawCapacity * input.efficiency.value;
    memo.push(
      `Fator de eficiencia ${input.efficiency.value} aplicado (fonte: ${input.efficiency.source}; aprovado por ${input.efficiency.approvedBy} em ${input.efficiency.approvedAt}) → ${round(capacity, 2)} HH/dia`,
    );
  }

  const durationDays = round(remaining / capacity, 3);
  memo.push(`Duracao = ${remaining} HH ÷ ${round(capacity, 2)} HH/dia = ${durationDays} dias uteis`);

  return {
    status: 'CALCULATED',
    workHH,
    remainingWorkHH: remaining,
    dailyCapacityHH: round(capacity, 4),
    durationWorkingDays: durationDays,
    missing: [],
    memo,
  };
}

/** Efetivo necessario para caber numa janela — util em analise de restricao de prazo. */
export function requiredCapacityForWindow(workHH: number, workingDays: number): number {
  if (!(workingDays > 0)) throw new Error('Janela de dias uteis deve ser positiva.');
  return round(workHH / workingDays, 2);
}
