/**
 * Calendario de trabalho.
 *
 * Premissa tecnica: todas as datas trafegam em UTC e os horarios do calendario sao
 * tratados como hora-parede do calendario. Isso elimina bug de fuso/horario de verao
 * dentro do motor. A conversao para o fuso da obra e responsabilidade da interface.
 */

export interface WorkShift {
  /** "07:00" */ start: string;
  /** "17:00" */ end: string;
}

/** Indice 0 = domingo ... 6 = sabado. */
export type WorkWeek = Record<number, WorkShift[]>;

export interface CalendarException {
  /** "YYYY-MM-DD" */ date: string;
  working: boolean;
  shifts?: WorkShift[];
  name: string;
}

export interface WorkCalendar {
  id: string;
  name: string;
  workWeek: WorkWeek;
  exceptions: CalendarException[];
}

export const MINUTES_PER_HOUR = 60;

function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || !m[1] || !m[2]) throw new Error(`Horario invalido: "${hhmm}". Use HH:MM.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) throw new Error(`Horario invalido: "${hhmm}".`);
  return h * 60 + min;
}

export function shiftMinutes(s: WorkShift): number {
  const a = hhmmToMinutes(s.start);
  const b = hhmmToMinutes(s.end);
  if (b <= a) throw new Error(`Turno invalido: ${s.start}-${s.end}. Fim deve ser maior que inicio.`);
  return b - a;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function atUtc(d: Date, minutes: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCMinutes(minutes);
  return x;
}

/** Turnos vigentes na data, considerando excecoes. */
export function shiftsOn(cal: WorkCalendar, d: Date): WorkShift[] {
  const key = isoDate(d);
  const exc = cal.exceptions.find((e) => e.date === key);
  if (exc) return exc.working ? exc.shifts ?? cal.workWeek[d.getUTCDay()] ?? [] : [];
  return cal.workWeek[d.getUTCDay()] ?? [];
}

export function isWorkingDay(cal: WorkCalendar, d: Date): boolean {
  return shiftsOn(cal, d).length > 0;
}

export function workingMinutesOnDay(cal: WorkCalendar, d: Date): number {
  return shiftsOn(cal, d).reduce((s, sh) => s + shiftMinutes(sh), 0);
}

/** Media de minutos uteis por dia util, sobre uma janela de referencia (padrao 8 semanas). */
export function averageWorkingMinutesPerDay(cal: WorkCalendar, from = new Date(Date.UTC(2024, 0, 1)), weeks = 8): number {
  let total = 0;
  let days = 0;
  const cur = new Date(from.getTime());
  for (let i = 0; i < weeks * 7; i++) {
    const m = workingMinutesOnDay(cal, cur);
    if (m > 0) { total += m; days += 1; }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  if (days === 0) throw new Error(`Calendario "${cal.name}" nao possui nenhum dia util na janela de referencia.`);
  return total / days;
}

/** Move o instante para o proximo momento de trabalho (ou mantem, se ja estiver em turno). */
export function nextWorkingInstant(cal: WorkCalendar, from: Date): Date {
  const cur = new Date(from.getTime());
  for (let guard = 0; guard < 3660; guard++) {
    const shifts = shiftsOn(cal, cur).slice().sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
    const minuteOfDay = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    for (const sh of shifts) {
      const s = hhmmToMinutes(sh.start);
      const e = hhmmToMinutes(sh.end);
      if (minuteOfDay < s) return atUtc(cur, s);
      if (minuteOfDay >= s && minuteOfDay < e) return cur;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
    cur.setUTCHours(0, 0, 0, 0);
  }
  throw new Error(`Calendario "${cal.name}": nenhum dia util encontrado em 10 anos a partir de ${from.toISOString()}.`);
}

/** Soma uma duracao expressa em minutos de trabalho, respeitando turnos e excecoes. */
export function addWorkingMinutes(cal: WorkCalendar, from: Date, minutes: number): Date {
  if (minutes < 0) throw new Error('Duracao negativa nao e suportada.');
  if (minutes === 0) return nextWorkingInstant(cal, from);
  let cur = nextWorkingInstant(cal, from);
  let remaining = minutes;

  for (let guard = 0; guard < 3660 && remaining > 0; guard++) {
    const shifts = shiftsOn(cal, cur).slice().sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
    const minuteOfDay = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    let consumedToday = false;
    for (const sh of shifts) {
      const s = hhmmToMinutes(sh.start);
      const e = hhmmToMinutes(sh.end);
      const startAt = Math.max(minuteOfDay, s);
      if (startAt >= e) continue;
      const avail = e - startAt;
      if (remaining <= avail) return atUtc(cur, startAt + remaining);
      remaining -= avail;
      cur = atUtc(cur, e);
      consumedToday = true;
    }
    if (!consumedToday || remaining > 0) {
      const next = new Date(cur.getTime());
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
      cur = nextWorkingInstant(cal, next);
    }
  }
  if (remaining > 0) throw new Error('Nao foi possivel alocar a duracao no calendario informado (horizonte de 10 anos excedido).');
  return cur;
}

/** Minutos de trabalho entre dois instantes. */
export function workingMinutesBetween(cal: WorkCalendar, a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  for (let guard = 0; guard < 3660; guard++) {
    if (cur.getTime() > b.getTime()) break;
    for (const sh of shiftsOn(cal, cur)) {
      const s = atUtc(cur, hhmmToMinutes(sh.start)).getTime();
      const e = atUtc(cur, hhmmToMinutes(sh.end)).getTime();
      const lo = Math.max(s, a.getTime());
      const hi = Math.min(e, b.getTime());
      if (hi > lo) total += (hi - lo) / 60000;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.round(total);
}

/** Calendario 5x8 sem feriados — PREMISSA de sistema, nunca dado do projeto. */
export function standardCalendar(id = 'CAL-PADRAO-5X8'): WorkCalendar {
  const dayShifts: WorkShift[] = [{ start: '07:00', end: '12:00' }, { start: '13:00', end: '16:00' }];
  return {
    id,
    name: 'Padrao 5x8 (premissa do sistema, sem feriados cadastrados)',
    workWeek: { 0: [], 1: dayShifts, 2: dayShifts, 3: dayShifts, 4: dayShifts, 5: dayShifts, 6: [] },
    exceptions: [],
  };
}

function hhmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m || !m[1] || !m[2]) throw new Error(`Horario invalido: "${s}".`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function atUtcMinutes(d: Date, minutes: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCMinutes(minutes);
  return x;
}

/** Move para o instante de trabalho imediatamente anterior (ou mantem, se ja em turno). */
export function previousWorkingInstant(cal: WorkCalendar, from: Date): Date {
  const cur = new Date(from.getTime());
  for (let guard = 0; guard < 3660; guard++) {
    const shifts = shiftsOn(cal, cur).slice().sort((a, b) => hhmm(b.start) - hhmm(a.start));
    const minuteOfDay = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    for (const sh of shifts) {
      const s = hhmm(sh.start);
      const e = hhmm(sh.end);
      if (minuteOfDay > e) return atUtcMinutes(cur, e);
      if (minuteOfDay > s && minuteOfDay <= e) return cur;
    }
    cur.setUTCDate(cur.getUTCDate() - 1);
    cur.setUTCHours(23, 59, 0, 0);
  }
  throw new Error(`Calendario "${cal.name}": nenhum dia util anterior encontrado.`);
}

/** Subtrai duracao expressa em minutos de trabalho. */
export function subtractWorkingMinutes(cal: WorkCalendar, from: Date, minutes: number): Date {
  if (minutes < 0) throw new Error('Duracao negativa nao e suportada.');
  if (minutes === 0) return previousWorkingInstant(cal, from);
  let cur = previousWorkingInstant(cal, from);
  let remaining = minutes;

  for (let guard = 0; guard < 3660 && remaining > 0; guard++) {
    const shifts = shiftsOn(cal, cur).slice().sort((a, b) => hhmm(b.start) - hhmm(a.start));
    const minuteOfDay = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    let consumed = false;
    for (const sh of shifts) {
      const s = hhmm(sh.start);
      const e = hhmm(sh.end);
      const endAt = Math.min(minuteOfDay, e);
      if (endAt <= s) continue;
      const avail = endAt - s;
      if (remaining <= avail) return atUtcMinutes(cur, endAt - remaining);
      remaining -= avail;
      cur = atUtcMinutes(cur, s);
      consumed = true;
    }
    if (!consumed || remaining > 0) {
      const prev = new Date(cur.getTime());
      prev.setUTCDate(prev.getUTCDate() - 1);
      prev.setUTCHours(23, 59, 0, 0);
      cur = previousWorkingInstant(cal, prev);
    }
  }
  if (remaining > 0) throw new Error('Nao foi possivel recuar a duracao no calendario informado.');
  return cur;
}

/** Aplica defasagem (lag) positiva ou negativa em minutos de trabalho. */
export function applyLag(cal: WorkCalendar, at: Date, lagMinutes: number): Date {
  if (lagMinutes === 0) return at;
  return lagMinutes > 0 ? addWorkingMinutes(cal, at, lagMinutes) : subtractWorkingMinutes(cal, at, -lagMinutes);
}
