/**
 * Controle fisico e Curva S (§4.4 e §13.4).
 *
 * Separacao imposta: avanco fisico, custo, medicao, faturamento e caixa sao
 * dimensoes distintas e este modulo trata APENAS avanco fisico ponderado por HH.
 * Nao ha campo de custo aqui de proposito.
 */
import { addWorkingMinutes, workingMinutesBetween, type WorkCalendar } from '../calendar/index.js';

export interface ProgressActivity {
  id: string;
  name: string;
  /** HH previstos na LINHA DE BASE. */
  baselineWorkHH: number;
  baselineStart: string;
  baselineFinish: string;
  /** HH e datas do PLANO ATUAL. */
  plannedWorkHH: number;
  plannedStart: string;
  plannedFinish: string;
  /** REALIZADO. */
  actualStart?: string;
  actualFinish?: string;
  actualWorkHH?: number;
  /** SALDO informado pelo campo; se ausente, e derivado. */
  remainingWorkHH?: number;
  calendarId: string;
}

export interface CurvePoint {
  date: string;
  /** HH acumulados. */
  baselineCumHH: number;
  plannedCumHH: number;
  actualCumHH: number;
  baselinePct: number;
  plannedPct: number;
  actualPct: number | null;
}

export interface ProgressSnapshot {
  statusDate: string;
  totals: {
    baselineHH: number;
    plannedHH: number;
    actualHH: number;
    remainingHH: number;
    /** Avanco fisico ponderado por HH. */
    physicalProgress: number;
    baselineProgressAtStatus: number;
  };
  /** SPI fisico = avanco realizado / avanco previsto na data de status. */
  schedulePerformanceIndex: number | null;
  curve: CurvePoint[];
  /** Atividades cuja tendencia ultrapassa o plano atual. */
  trendingLate: { activityId: string; name: string; forecastFinish: string; plannedFinish: string; delayDays: number }[];
  warnings: string[];
}

/** Distribui HH linearmente no tempo util entre inicio e termino. */
function spreadHH(cal: WorkCalendar, start: Date, finish: Date, hh: number, buckets: Date[]): number[] {
  const totalMin = workingMinutesBetween(cal, start, finish);
  const out = new Array(buckets.length).fill(0);
  if (hh <= 0) return out;
  if (totalMin <= 0) {
    const idx = buckets.findIndex((b) => b.getTime() >= finish.getTime());
    out[idx === -1 ? buckets.length - 1 : idx] = hh;
    return out;
  }
  let prev = start;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const upto = b.getTime() < start.getTime() ? start : b.getTime() > finish.getTime() ? finish : b;
    const min = workingMinutesBetween(cal, prev, upto);
    out[i] = (min / totalMin) * hh;
    prev = upto;
  }
  return out;
}

export interface CurveOptions {
  statusDate: string;
  calendars: Record<string, WorkCalendar>;
  /** Intervalo entre pontos em dias corridos. Padrao 7 (semanal). */
  stepDays?: number;
}

export function buildProgressSnapshot(activities: ProgressActivity[], opts: CurveOptions): ProgressSnapshot {
  const warnings: string[] = [];
  if (activities.length === 0) {
    return {
      statusDate: opts.statusDate,
      totals: { baselineHH: 0, plannedHH: 0, actualHH: 0, remainingHH: 0, physicalProgress: 0, baselineProgressAtStatus: 0 },
      schedulePerformanceIndex: null, curve: [], trendingLate: [], warnings: ['Nenhuma atividade para calcular avanco.'],
    };
  }
  const step = (opts.stepDays ?? 7) * 86400000;
  const status = new Date(opts.statusDate);

  const allDates = activities.flatMap((a) => [a.baselineStart, a.baselineFinish, a.plannedStart, a.plannedFinish, a.actualStart, a.actualFinish])
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime());
  const min = Math.min(...allDates);
  const max = Math.max(...allDates, status.getTime());

  const buckets: Date[] = [];
  for (let t = min; t <= max + step; t += step) buckets.push(new Date(t));
  if (buckets[buckets.length - 1]!.getTime() < max) buckets.push(new Date(max));

  const baselineCum = new Array(buckets.length).fill(0);
  const plannedCum = new Array(buckets.length).fill(0);
  const actualCum = new Array(buckets.length).fill(0);

  let baselineHH = 0;
  let plannedHH = 0;
  let actualHH = 0;
  let remainingHH = 0;
  let earnedHH = 0;

  for (const a of activities) {
    const cal = opts.calendars[a.calendarId];
    if (!cal) { warnings.push(`Atividade "${a.name}": calendario "${a.calendarId}" nao encontrado; excluida da curva.`); continue; }
    baselineHH += a.baselineWorkHH;
    plannedHH += a.plannedWorkHH;
    const act = a.actualWorkHH ?? 0;
    actualHH += act;

    const rem = a.remainingWorkHH ?? Math.max(0, a.plannedWorkHH - act);
    remainingHH += rem;

    // Avanco fisico do item = HH realizados / (realizados + saldo). Nunca > 1.
    const denom = act + rem;
    const pct = denom > 0 ? Math.min(1, act / denom) : (a.actualFinish ? 1 : 0);
    earnedHH += a.plannedWorkHH * pct;

    add(baselineCum, spreadHH(cal, new Date(a.baselineStart), new Date(a.baselineFinish), a.baselineWorkHH, buckets));
    add(plannedCum, spreadHH(cal, new Date(a.plannedStart), new Date(a.plannedFinish), a.plannedWorkHH, buckets));
    if (act > 0) {
      const s = new Date(a.actualStart ?? a.plannedStart);
      const f = new Date(a.actualFinish ?? opts.statusDate);
      add(actualCum, spreadHH(cal, s, f, act, buckets));
    }
  }

  const curve: CurvePoint[] = [];
  let bAcc = 0;
  let pAcc = 0;
  let aAcc = 0;
  for (let i = 0; i < buckets.length; i++) {
    bAcc += baselineCum[i] ?? 0;
    pAcc += plannedCum[i] ?? 0;
    aAcc += actualCum[i] ?? 0;
    const d = buckets[i]!;
    curve.push({
      date: d.toISOString(),
      baselineCumHH: round2(bAcc),
      plannedCumHH: round2(pAcc),
      actualCumHH: round2(aAcc),
      baselinePct: baselineHH > 0 ? round4(bAcc / baselineHH) : 0,
      plannedPct: plannedHH > 0 ? round4(pAcc / plannedHH) : 0,
      // Curva realizada nao e projetada para o futuro: apos a data de status e null.
      actualPct: d.getTime() <= status.getTime() ? (plannedHH > 0 ? round4(aAcc / plannedHH) : 0) : null,
    });
  }

  const atStatus = curve.filter((c) => new Date(c.date).getTime() <= status.getTime()).pop();
  const baselineProgressAtStatus = atStatus?.baselinePct ?? 0;
  const physicalProgress = plannedHH > 0 ? round4(earnedHH / plannedHH) : 0;

  const trendingLate: ProgressSnapshot['trendingLate'] = [];
  for (const a of activities) {
    const cal = opts.calendars[a.calendarId];
    if (!cal || a.actualFinish) continue;
    const rem = a.remainingWorkHH ?? Math.max(0, a.plannedWorkHH - (a.actualWorkHH ?? 0));
    if (rem <= 0) continue;
    const plannedFinish = new Date(a.plannedFinish);
    const plannedMinutes = workingMinutesBetween(cal, new Date(a.plannedStart), plannedFinish);
    if (plannedMinutes <= 0 || a.plannedWorkHH <= 0) continue;
    const ratePerMinute = a.plannedWorkHH / plannedMinutes;
    const from = status.getTime() > new Date(a.plannedStart).getTime() ? status : new Date(a.plannedStart);
    const forecast = addWorkingMinutes(cal, from, rem / ratePerMinute);
    if (forecast.getTime() > plannedFinish.getTime()) {
      const delayMin = workingMinutesBetween(cal, plannedFinish, forecast);
      trendingLate.push({
        activityId: a.id, name: a.name,
        forecastFinish: forecast.toISOString(),
        plannedFinish: a.plannedFinish,
        delayDays: round2(delayMin / 480),
      });
    }
  }

  return {
    statusDate: opts.statusDate,
    totals: {
      baselineHH: round2(baselineHH), plannedHH: round2(plannedHH), actualHH: round2(actualHH),
      remainingHH: round2(remainingHH), physicalProgress, baselineProgressAtStatus,
    },
    schedulePerformanceIndex: baselineProgressAtStatus > 0 ? round4(physicalProgress / baselineProgressAtStatus) : null,
    curve,
    trendingLate: trendingLate.sort((a, b) => b.delayDays - a.delayDays),
    warnings,
  };
}

function add(target: number[], src: number[]): void {
  for (let i = 0; i < target.length; i++) target[i] = (target[i] ?? 0) + (src[i] ?? 0);
}
function round2(n: number): number { return Number(n.toFixed(2)); }
function round4(n: number): number { return Number(n.toFixed(4)); }

// ---------------------------------------------------------------------------
// Protecao do realizado (§4.3)
// ---------------------------------------------------------------------------

export class RetroactiveChangeError extends Error {
  constructor(message: string) { super(message); this.name = 'RetroactiveChangeError'; }
}

export interface ActualChangeRequest {
  activityId: string;
  field: 'actualStart' | 'actualFinish' | 'actualWorkHH';
  before: string | number | null;
  after: string | number | null;
  by: string;
  justification: string;
  /** Permissao explicita para alterar realizado. */
  hasPermission: boolean;
}

/**
 * O realizado nao pode ser alterado retroativamente sem justificativa, permissao
 * e registro. Esta funcao lanca em vez de aceitar — silenciar a mudanca seria
 * apagar a historia do projeto.
 */
export function authorizeActualChange(req: ActualChangeRequest): { auditEntry: Record<string, unknown> } {
  if (!req.hasPermission) {
    throw new RetroactiveChangeError(`Usuario "${req.by}" nao tem permissao para alterar o realizado de "${req.activityId}".`);
  }
  if (!req.justification?.trim() || req.justification.trim().length < 10) {
    throw new RetroactiveChangeError(`Alteracao do realizado de "${req.activityId}" exige justificativa registrada (minimo 10 caracteres).`);
  }
  return {
    auditEntry: {
      kind: 'ACTUAL_CHANGED',
      activityId: req.activityId,
      field: req.field,
      before: req.before,
      after: req.after,
      by: req.by,
      at: new Date().toISOString(),
      justification: req.justification.trim(),
    },
  };
}
