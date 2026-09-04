/**
 * Verificacoes de qualidade da logica (§13.3).
 *
 * Uma data calculada nao prova viabilidade. Estas verificacoes existem para
 * separar "o cronograma fecha aritmeticamente" de "o cronograma e executavel".
 */
import type { Link, NetworkActivity } from '../network/types.js';
import { findCycles } from '../network/cpm.js';
import type { WorkCalendar } from '../calendar/index.js';

export type CheckSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface QualityFinding {
  code: string;
  severity: CheckSeverity;
  message: string;
  activityIds: string[];
}

export interface QualityInput {
  activities: NetworkActivity[];
  links: Link[];
  calendars: Record<string, WorkCalendar>;
  /** Marcos autorizados a nao ter predecessora/sucessora. */
  authorizedOpenEnds?: string[];
  /** Atividades com duracao calculada (NOT_CALCULABLE fica de fora). */
  notCalculable?: string[];
  /** Atividade → codigo de EAP. Ausencia indica atividade fora da EAP. */
  wbsByActivity?: Record<string, string>;
  /** Atividade → ids de quantidade que a originaram. */
  scopeRefsByActivity?: Record<string, string[]>;
  /** Quantidades aprovadas que nao geraram atividade. */
  orphanScopeIds?: string[];
  /** Atividades com HH previsto. */
  workHHByActivity?: Record<string, number>;
  /** Atividades com entregavel declarado. */
  deliverableByActivity?: Record<string, string>;
  /** Marcos contratuais. */
  contractualMilestones?: string[];
  /** Capacidade diaria maxima por recurso (HH/dia) e demanda por atividade. */
  resourceDemand?: { activityId: string; resourceId: string; hhPerDay: number }[];
  resourceCapacity?: Record<string, number>;
  /** Limite de duracao considerada "excessiva", em dias uteis. Padrao 44 (DCMA). */
  longDurationDays?: number;
}

const RIGID_CONSTRAINTS = new Set(['MSO', 'MFO', 'SNLT', 'FNLT']);

export function runQualityChecks(input: QualityInput): QualityFinding[] {
  const out: QualityFinding[] = [];
  const {
    activities, links, calendars,
    authorizedOpenEnds = [], notCalculable = [],
    wbsByActivity = {}, scopeRefsByActivity = {}, orphanScopeIds = [],
    workHHByActivity = {}, deliverableByActivity = {},
    contractualMilestones = [], resourceDemand = [], resourceCapacity = {},
    longDurationDays = 44,
  } = input;

  const active = links.filter((l) => l.status !== 'REJECTED');
  const ids = new Set(activities.map((a) => a.id));
  const hasPred = new Set(active.map((l) => l.successorId));
  const hasSucc = new Set(active.map((l) => l.predecessorId));
  const authorized = new Set(authorizedOpenEnds);
  const minutesPerDay = 8 * 60;

  // 1 e 2 — pontas soltas
  for (const a of activities) {
    if (authorized.has(a.id)) continue;
    if (!hasPred.has(a.id)) out.push({ code: 'OPEN_START', severity: 'ERROR', message: `"${a.name}" nao tem predecessora. Toda atividade precisa de um gatilho logico, exceto marcos autorizados.`, activityIds: [a.id] });
    if (!hasSucc.has(a.id)) out.push({ code: 'OPEN_FINISH', severity: 'ERROR', message: `"${a.name}" nao tem sucessora. Sem sucessora, o atraso dela nao aparece no caminho critico.`, activityIds: [a.id] });
  }

  // 3 — ciclos
  for (const c of findCycles(activities, active)) {
    out.push({ code: 'LOGIC_CYCLE', severity: 'ERROR', message: `Ciclo de precedencia: ${c.join(' → ')}. Com ciclo nao existe caminho critico.`, activityIds: c });
  }

  // 4 — restricoes rigidas
  const rigid = activities.filter((a) => a.constraint && RIGID_CONSTRAINTS.has(a.constraint.type));
  for (const a of rigid) {
    const sev: CheckSeverity = a.constraint?.justification?.trim() ? 'WARNING' : 'ERROR';
    out.push({
      code: 'HARD_CONSTRAINT', severity: sev,
      message: `"${a.name}" usa restricao rigida ${a.constraint!.type}${sev === 'ERROR' ? ' sem justificativa registrada' : ''}. Restricao rigida mascara o caminho critico.`,
      activityIds: [a.id],
    });
  }
  if (activities.length > 0 && rigid.length / activities.length > 0.05) {
    out.push({ code: 'HARD_CONSTRAINT_RATIO', severity: 'WARNING', message: `${rigid.length} de ${activities.length} atividades (${((rigid.length / activities.length) * 100).toFixed(1)}%) tem restricao rigida. Acima de 5% o cronograma passa a ser dirigido por datas impostas, nao por logica.`, activityIds: rigid.map((a) => a.id) });
  }

  // 5 — lags
  for (const l of active) {
    if (l.lagMinutes !== 0 && !l.rationale.reason?.trim()) {
      out.push({ code: 'LAG_NO_REASON', severity: 'ERROR', message: `Vinculo ${l.predecessorId} → ${l.successorId} tem defasagem de ${(l.lagMinutes / minutesPerDay).toFixed(1)} dias sem justificativa.`, activityIds: [l.predecessorId, l.successorId] });
    }
    if (l.lagMinutes < 0) {
      out.push({ code: 'NEGATIVE_LAG', severity: 'WARNING', message: `Vinculo ${l.predecessorId} → ${l.successorId} usa antecipacao (lag negativo). Antecipacao esconde sobreposicao real: prefira dividir a atividade.`, activityIds: [l.predecessorId, l.successorId] });
    }
  }

  // 6 — duracoes excessivas / genericas
  for (const a of activities) {
    if (a.isMilestone) continue;
    const days = a.durationMinutes / minutesPerDay;
    if (days > longDurationDays) {
      out.push({ code: 'LONG_DURATION', severity: 'WARNING', message: `"${a.name}" dura ${days.toFixed(0)} dias uteis (limite ${longDurationDays}). Atividade longa esconde progresso e nao e gerenciavel semanalmente.`, activityIds: [a.id] });
    }
    if (days > 0 && Number.isInteger(days) && [30, 60, 90, 120].includes(days)) {
      out.push({ code: 'ROUND_DURATION', severity: 'INFO', message: `"${a.name}" tem duracao redonda de ${days} dias. Verifique se veio de calculo ou de estimativa generica.`, activityIds: [a.id] });
    }
  }

  // 7 — atividades sem quantidade, HH ou entregavel
  for (const a of activities) {
    if (a.isMilestone) continue;
    if (!((workHHByActivity[a.id] ?? 0) > 0)) out.push({ code: 'NO_WORK_HH', severity: 'WARNING', message: `"${a.name}" nao tem HH previsto. Sem HH, nao ha ponderacao de avanco fisico nem histograma.`, activityIds: [a.id] });
    if (!deliverableByActivity[a.id]?.trim()) out.push({ code: 'NO_DELIVERABLE', severity: 'WARNING', message: `"${a.name}" nao declara entregavel nem criterio de conclusao.`, activityIds: [a.id] });
  }

  // 8 — duracao nao calculavel
  for (const id of notCalculable) {
    const a = activities.find((x) => x.id === id);
    out.push({ code: 'NOT_CALCULABLE', severity: 'ERROR', message: `"${a?.name ?? id}" esta com duracao NAO CALCULAVEL por falta de insumo. O sistema nao arbitra duracao.`, activityIds: [id] });
  }

  // 9 — calendarios
  for (const a of activities) {
    const cal = calendars[a.calendarId];
    if (!cal) { out.push({ code: 'MISSING_CALENDAR', severity: 'ERROR', message: `"${a.name}" referencia calendario inexistente "${a.calendarId}".`, activityIds: [a.id] }); continue; }
    const working = Object.values(cal.workWeek).some((s) => s.length > 0);
    if (!working) out.push({ code: 'EMPTY_CALENDAR', severity: 'ERROR', message: `Calendario "${cal.name}" nao tem nenhum dia util.`, activityIds: [a.id] });
  }

  // 10 — recursos superalocados
  const byRes = new Map<string, { total: number; acts: string[] }>();
  for (const d of resourceDemand) {
    const e = byRes.get(d.resourceId) ?? { total: 0, acts: [] };
    e.total += d.hhPerDay;
    e.acts.push(d.activityId);
    byRes.set(d.resourceId, e);
  }
  for (const [res, e] of byRes) {
    const cap = resourceCapacity[res];
    if (cap !== undefined && e.total > cap) {
      out.push({ code: 'RESOURCE_OVERALLOCATION', severity: 'WARNING', message: `Recurso "${res}" demandado em ${e.total.toFixed(1)} HH/dia contra capacidade de ${cap} HH/dia. A data calculada pressupoe efetivo que nao existe.`, activityIds: e.acts });
    }
  }

  // 11 e 12 — EAP e rastreabilidade
  for (const a of activities) {
    if (!wbsByActivity[a.id]) out.push({ code: 'ACTIVITY_OUTSIDE_WBS', severity: 'ERROR', message: `"${a.name}" nao pertence a nenhum no da EAP.`, activityIds: [a.id] });
    if (!a.isMilestone && (scopeRefsByActivity[a.id]?.length ?? 0) === 0) {
      out.push({ code: 'NO_SCOPE_TRACE', severity: 'WARNING', message: `"${a.name}" nao tem rastreabilidade ate um item de escopo validado.`, activityIds: [a.id] });
    }
  }
  for (const q of orphanScopeIds) {
    out.push({ code: 'SCOPE_WITHOUT_ACTIVITY', severity: 'WARNING', message: `Item de escopo "${q}" foi aprovado mas nao gerou atividade. Escopo sem atividade e prazo escondido.`, activityIds: [] });
  }

  // 13 — datas impostas sem logica
  for (const a of activities) {
    if (a.constraint?.date && !hasPred.has(a.id) && !authorized.has(a.id)) {
      out.push({ code: 'IMPOSED_DATE_NO_LOGIC', severity: 'ERROR', message: `"${a.name}" tem data imposta (${a.constraint.type}) e nenhuma predecessora. A data foi colocada para o cronograma "caber", nao derivada de logica.`, activityIds: [a.id] });
    }
  }

  // 14 — marcos contratuais sem cadeia de suporte
  for (const m of contractualMilestones) {
    if (!ids.has(m)) { out.push({ code: 'MILESTONE_MISSING', severity: 'ERROR', message: `Marco contratual "${m}" nao existe no cronograma.`, activityIds: [] }); continue; }
    if (!hasPred.has(m)) out.push({ code: 'MILESTONE_NO_CHAIN', severity: 'ERROR', message: `Marco contratual "${m}" nao tem cadeia logica de suporte. Nada no cronograma prova que a data e alcancavel.`, activityIds: [m] });
  }

  // 15 — relacoes tecnicamente incoerentes
  for (const l of active) {
    if (l.type === 'SF') {
      out.push({ code: 'SF_LINK', severity: 'WARNING', message: `Vinculo Inicio-Termino entre ${l.predecessorId} e ${l.successorId}. SF e raro em montagem e quase sempre indica erro de modelagem.`, activityIds: [l.predecessorId, l.successorId] });
    }
    if (!ids.has(l.predecessorId) || !ids.has(l.successorId)) {
      out.push({ code: 'DANGLING_LINK', severity: 'ERROR', message: `Vinculo aponta para atividade inexistente (${l.predecessorId} → ${l.successorId}).`, activityIds: [] });
    }
  }

  // 16 — vinculos sugeridos ainda nao validados
  const suggested = links.filter((l) => l.status === 'SUGGESTED');
  if (suggested.length > 0) {
    out.push({
      code: 'UNVALIDATED_LINKS', severity: 'WARNING',
      message: `${suggested.length} vinculo(s) sugeridos pela IA ainda nao foram validados por um planejador. Eles nao entram no calculo aprovado.`,
      activityIds: [...new Set(suggested.flatMap((l) => [l.predecessorId, l.successorId]))],
    });
  }

  return out;
}

export function summarizeFindings(findings: QualityFinding[]): { errors: number; warnings: number; infos: number; blocking: boolean } {
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;
  const infos = findings.filter((f) => f.severity === 'INFO').length;
  return { errors, warnings, infos, blocking: errors > 0 };
}
