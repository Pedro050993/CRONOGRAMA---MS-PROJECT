/**
 * CPM com calendarios por atividade, vinculos FS/SS/FF/SF e defasagem em tempo util.
 *
 * Regras adotadas (premissas tecnicas explicitas):
 *  - Somente vinculos com status VALIDATED ou MODIFIED entram no calculo aprovado.
 *    Vinculo SUGGESTED pode ser simulado, mas nunca vira baseline sem aprovacao (§12.3).
 *  - A defasagem e aplicada no calendario da SUCESSORA.
 *  - Ciclo interrompe o calculo: um cronograma com ciclo nao tem caminho critico,
 *    e devolver datas nesse caso seria mentir.
 */
import { addWorkingMinutes, applyLag, nextWorkingInstant, subtractWorkingMinutes, type WorkCalendar } from '../calendar/index.js';
import type { CpmActivityResult, CpmResult, Link, NetworkActivity } from './types.js';

export class ScheduleCycleError extends Error {
  constructor(readonly cycles: string[][]) {
    super(`Rede possui ${cycles.length} ciclo(s) de precedencia: ${cycles.map((c) => c.join(' → ')).join(' | ')}. O CPM nao pode ser calculado.`);
    this.name = 'ScheduleCycleError';
  }
}

export interface CpmOptions {
  projectStart: Date;
  calendars: Record<string, WorkCalendar>;
  /** Padrao: apenas vinculos aprovados. */
  includeStatuses?: Link['status'][];
}

function calOf(opts: CpmOptions, id: string): WorkCalendar {
  const c = opts.calendars[id];
  if (!c) throw new Error(`Calendario "${id}" nao encontrado. Atividade sem calendario nao pode ser datada.`);
  return c;
}

/** Detecta ciclos por DFS com pilha de cor. */
export function findCycles(activities: NetworkActivity[], links: Link[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const a of activities) adj.set(a.id, []);
  for (const l of links) {
    if (!adj.has(l.predecessorId) || !adj.has(l.successorId)) continue;
    adj.get(l.predecessorId)!.push(l.successorId);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const dfs = (n: string): void => {
    color.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? 0;
      if (c === 0) dfs(m);
      else if (c === 1) {
        const idx = stack.indexOf(m);
        cycles.push([...stack.slice(idx), m]);
      }
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const a of activities) if ((color.get(a.id) ?? 0) === 0) dfs(a.id);
  return cycles;
}

function topoSort(activities: NetworkActivity[], links: Link[]): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const a of activities) { indeg.set(a.id, 0); adj.set(a.id, []); }
  for (const l of links) {
    if (!indeg.has(l.predecessorId) || !indeg.has(l.successorId)) continue;
    adj.get(l.predecessorId)!.push(l.successorId);
    indeg.set(l.successorId, (indeg.get(l.successorId) ?? 0) + 1);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k).sort();
  const out: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    out.push(n);
    for (const m of adj.get(n) ?? []) {
      const d = (indeg.get(m) ?? 1) - 1;
      indeg.set(m, d);
      if (d === 0) q.push(m);
    }
  }
  return out;
}

export function computeCpm(activities: NetworkActivity[], links: Link[], opts: CpmOptions): CpmResult {
  const allowed = new Set<Link['status']>(opts.includeStatuses ?? ['VALIDATED', 'MODIFIED']);
  const activeLinks = links.filter((l) => allowed.has(l.status));

  const cycles = findCycles(activities, activeLinks);
  if (cycles.length > 0) throw new ScheduleCycleError(cycles);

  const byId = new Map(activities.map((a) => [a.id, a]));
  const preds = new Map<string, Link[]>();
  const succs = new Map<string, Link[]>();
  for (const a of activities) { preds.set(a.id, []); succs.set(a.id, []); }
  for (const l of activeLinks) {
    if (!byId.has(l.predecessorId) || !byId.has(l.successorId)) continue;
    preds.get(l.successorId)!.push(l);
    succs.get(l.predecessorId)!.push(l);
  }

  const order = topoSort(activities, activeLinks);
  const es = new Map<string, Date>();
  const ef = new Map<string, Date>();

  // --- Passagem para frente ---
  for (const id of order) {
    const a = byId.get(id)!;
    const cal = calOf(opts, a.calendarId);
    let start = nextWorkingInstant(cal, opts.projectStart);

    for (const l of preds.get(id) ?? []) {
      const pEs = es.get(l.predecessorId);
      const pEf = ef.get(l.predecessorId);
      if (!pEs || !pEf) continue;
      let candidate: Date;
      switch (l.type) {
        case 'FS': candidate = applyLag(cal, pEf, l.lagMinutes); break;
        case 'SS': candidate = applyLag(cal, pEs, l.lagMinutes); break;
        case 'FF': candidate = subtractWorkingMinutes(cal, applyLag(cal, pEf, l.lagMinutes), a.durationMinutes); break;
        case 'SF': candidate = subtractWorkingMinutes(cal, applyLag(cal, pEs, l.lagMinutes), a.durationMinutes); break;
      }
      if (candidate.getTime() > start.getTime()) start = candidate;
    }

    if (a.actualStart) start = new Date(a.actualStart);
    start = applyStartConstraint(cal, a, start);

    es.set(id, start);
    ef.set(id, a.actualFinish ? new Date(a.actualFinish) : addWorkingMinutes(cal, start, a.durationMinutes));
  }

  const projectFinishTime = Math.max(...[...ef.values()].map((d) => d.getTime()));
  const projectStartTime = Math.min(...[...es.values()].map((d) => d.getTime()));

  // --- Passagem para tras ---
  const lf = new Map<string, Date>();
  const ls = new Map<string, Date>();
  for (const id of [...order].reverse()) {
    const a = byId.get(id)!;
    const cal = calOf(opts, a.calendarId);
    let finish = new Date(projectFinishTime);

    for (const l of succs.get(id) ?? []) {
      const sLs = ls.get(l.successorId);
      const sLf = lf.get(l.successorId);
      if (!sLs || !sLf) continue;
      const sCal = calOf(opts, byId.get(l.successorId)!.calendarId);
      let candidate: Date;
      switch (l.type) {
        case 'FS': candidate = applyLag(sCal, sLs, -l.lagMinutes); break;
        case 'SS': candidate = addWorkingMinutes(cal, applyLag(sCal, sLs, -l.lagMinutes), a.durationMinutes); break;
        case 'FF': candidate = applyLag(sCal, sLf, -l.lagMinutes); break;
        case 'SF': candidate = addWorkingMinutes(cal, applyLag(sCal, sLf, -l.lagMinutes), a.durationMinutes); break;
      }
      if (candidate.getTime() < finish.getTime()) finish = candidate;
    }

    finish = applyFinishConstraint(cal, a, finish);
    lf.set(id, finish);
    ls.set(id, subtractWorkingMinutes(cal, finish, a.durationMinutes));
  }

  // --- Folgas ---
  const result: Record<string, CpmActivityResult> = {};
  for (const a of activities) {
    const cal = calOf(opts, a.calendarId);
    const aEs = es.get(a.id)!;
    const aEf = ef.get(a.id)!;
    const aLs = ls.get(a.id)!;
    const aLf = lf.get(a.id)!;
    const totalFloat = workingMinutesDiff(cal, aEf, aLf);

    let freeFloat = totalFloat;
    const outs = succs.get(a.id) ?? [];
    if (outs.length > 0) {
      freeFloat = Math.min(
        ...outs.map((l) => {
          const sEs = es.get(l.successorId);
          if (!sEs) return totalFloat;
          const sCal = calOf(opts, byId.get(l.successorId)!.calendarId);
          const required = l.type === 'FS' || l.type === 'FF'
            ? applyLag(sCal, aEf, l.lagMinutes)
            : applyLag(sCal, aEs, l.lagMinutes);
          return workingMinutesDiff(sCal, required, sEs);
        }),
      );
    }

    result[a.id] = {
      id: a.id,
      earlyStart: aEs.toISOString(),
      earlyFinish: aEf.toISOString(),
      lateStart: aLs.toISOString(),
      lateFinish: aLf.toISOString(),
      totalFloatMinutes: totalFloat,
      freeFloatMinutes: Math.max(0, freeFloat),
      isCritical: totalFloat <= 0,
    };
  }

  return {
    activities: result,
    projectStart: new Date(projectStartTime).toISOString(),
    projectFinish: new Date(projectFinishTime).toISOString(),
    criticalPath: buildCriticalPath(activities, activeLinks, result),
    cycles: [],
  };
}

function workingMinutesDiff(cal: WorkCalendar, from: Date, to: Date): number {
  if (to.getTime() === from.getTime()) return 0;
  const sign = to.getTime() > from.getTime() ? 1 : -1;
  const a = sign > 0 ? from : to;
  const b = sign > 0 ? to : from;
  let total = 0;
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  for (let guard = 0; guard < 3660; guard++) {
    if (cur.getTime() > b.getTime()) break;
    for (const sh of shiftsOfDay(cal, cur)) {
      const lo = Math.max(sh[0], a.getTime());
      const hi = Math.min(sh[1], b.getTime());
      if (hi > lo) total += (hi - lo) / 60000;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return sign * Math.round(total);
}

function shiftsOfDay(cal: WorkCalendar, d: Date): [number, number][] {
  const key = d.toISOString().slice(0, 10);
  const exc = cal.exceptions.find((e) => e.date === key);
  const shifts = exc ? (exc.working ? exc.shifts ?? cal.workWeek[d.getUTCDay()] ?? [] : []) : cal.workWeek[d.getUTCDay()] ?? [];
  return shifts.map((s) => {
    const [sh, sm] = s.start.split(':').map(Number);
    const [eh, em] = s.end.split(':').map(Number);
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return [base + ((sh ?? 0) * 60 + (sm ?? 0)) * 60000, base + ((eh ?? 0) * 60 + (em ?? 0)) * 60000] as [number, number];
  });
}

function applyStartConstraint(cal: WorkCalendar, a: NetworkActivity, start: Date): Date {
  const c = a.constraint;
  if (!c?.date) return start;
  const d = nextWorkingInstant(cal, new Date(c.date));
  switch (c.type) {
    case 'SNET': return d.getTime() > start.getTime() ? d : start;
    case 'MSO': return d;
    case 'FNET': { const s = subtractWorkingMinutes(cal, d, a.durationMinutes); return s.getTime() > start.getTime() ? s : start; }
    case 'MFO': return subtractWorkingMinutes(cal, new Date(c.date), a.durationMinutes);
    default: return start;
  }
}

function applyFinishConstraint(cal: WorkCalendar, a: NetworkActivity, finish: Date): Date {
  const c = a.constraint;
  if (!c?.date) return finish;
  const d = new Date(c.date);
  switch (c.type) {
    case 'FNLT': return d.getTime() < finish.getTime() ? d : finish;
    case 'MFO': return d;
    case 'SNLT': { const f = addWorkingMinutes(cal, d, a.durationMinutes); return f.getTime() < finish.getTime() ? f : finish; }
    case 'MSO': return addWorkingMinutes(cal, nextWorkingInstant(cal, d), a.durationMinutes);
    default: return finish;
  }
}

function buildCriticalPath(activities: NetworkActivity[], links: Link[], res: Record<string, CpmActivityResult>): string[] {
  const critical = activities.filter((a) => res[a.id]?.isCritical).map((a) => a.id);
  const set = new Set(critical);
  const adj = new Map<string, string[]>();
  for (const id of critical) adj.set(id, []);
  for (const l of links) {
    if (set.has(l.predecessorId) && set.has(l.successorId)) adj.get(l.predecessorId)!.push(l.successorId);
  }
  const hasPred = new Set(links.filter((l) => set.has(l.predecessorId) && set.has(l.successorId)).map((l) => l.successorId));
  const starts = critical.filter((id) => !hasPred.has(id));
  let best: string[] = [];
  const walk = (id: string, path: string[]): void => {
    const next = adj.get(id) ?? [];
    if (next.length === 0) { if (path.length > best.length) best = [...path]; return; }
    for (const n of next) walk(n, [...path, n]);
  };
  for (const s of starts) walk(s, [s]);
  return best.length > 0 ? best : critical.sort((a, b) => (res[a]!.earlyStart < res[b]!.earlyStart ? -1 : 1));
}
