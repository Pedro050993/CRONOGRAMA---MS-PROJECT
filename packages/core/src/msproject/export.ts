/**
 * Exportador MSPDI (XML do Microsoft Project).
 *
 * Alvo: Project 2016 lendo MSPDI com SaveVersion 14 (formato Project 2010+),
 * que e o formato lido por 2010, 2013, 2016, 2019 e Microsoft 365.
 * O XML sai em UTF-8 declarado, com acentuacao preservada.
 */
import { shiftsOn, type WorkCalendar } from '../calendar/index.js';
import {
  DEFAULT_FIELD_ALIASES, DURATION_FORMAT_DAYS, MSP_CONSTRAINT, MSP_LINK_TYPE,
  TASK_FIELD_IDS, type MspProject, type MspTask, type TaskFieldName,
} from './model.js';
import { XmlWriter } from './xml.js';
import { validateMspdiProject, type ValidationReport } from './validate.js';

/** Data no formato aceito pelo MSPDI: local, sem fuso. */
export function mspDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) throw new Error(`Data invalida para exportacao: ${String(iso)}`);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Duracao ISO-8601 no dialeto do MS Project: PT<H>H<M>M<S>S. */
export function mspDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `PT${h}H${m}M0S`;
}

function timeOnly(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : hhmm;
}

export interface ExportResult {
  xml: string;
  report: ValidationReport;
  /** Bytes UTF-8 do arquivo. */
  byteLength: number;
}

/**
 * Gera o XML e o relatorio de validacao (§14).
 * Se a validacao encontrar ERROS, o XML ainda e devolvido para inspecao, mas
 * `report.valid` fica false — cabe a API recusar a entrega do arquivo.
 */
export function exportMspdi(project: MspProject): ExportResult {
  const report = validateMspdiProject(project);
  const w = new XmlWriter();

  w.decl();
  w.open('Project', { xmlns: 'http://schemas.microsoft.com/project' });

  w.leaf('SaveVersion', project.saveVersion ?? 14);
  w.leaf('Name', project.name);
  w.leaf('Title', project.title);
  if (project.company) w.leaf('Company', project.company);
  if (project.author) w.leaf('Author', project.author);
  w.leaf('CreationDate', mspDate(project.currentDate ?? project.startDate));
  w.leaf('CurrentDate', mspDate(project.currentDate ?? project.startDate));
  w.leaf('StartDate', mspDate(project.startDate));
  if (project.finishDate) w.leaf('FinishDate', mspDate(project.finishDate));
  if (project.statusDate) w.leaf('StatusDate', mspDate(project.statusDate));
  w.leaf('ScheduleFromStart', 1);
  w.leaf('FYStartDate', 1);
  w.leaf('CriticalSlackLimit', 0);
  w.leaf('CurrencyDigits', 2);
  w.leaf('CurrencySymbol', 'R$');
  w.leaf('CurrencySymbolPosition', 0);
  w.leaf('CalendarUID', project.defaultCalendarUid);
  w.leaf('DefaultStartTime', timeOnly(project.defaultStartTime));
  w.leaf('DefaultFinishTime', timeOnly(project.defaultFinishTime));
  w.leaf('MinutesPerDay', project.minutesPerDay);
  w.leaf('MinutesPerWeek', project.minutesPerWeek);
  w.leaf('DaysPerMonth', project.daysPerMonth);
  w.leaf('DefaultTaskType', 1); // duracao fixa: a duracao vem do nosso motor, nao do MSP
  w.leaf('DefaultFixedCostAccrual', 3);
  w.leaf('DurationFormat', DURATION_FORMAT_DAYS);
  w.leaf('WorkFormat', 2);
  w.leaf('NewTasksEffortDriven', 0);
  w.leaf('NewTaskStartDate', 0);
  w.leaf('AutoAddNewResourcesAndTasks', 1);
  w.leaf('MultipleCriticalPaths', 0);
  w.leaf('HonorConstraints', 1);
  w.leaf('SplitsInProgressTasks', 1);
  w.leaf('MicrosoftProjectServerURL', 0);

  writeExtendedAttributeDeclarations(w, project);
  writeCalendars(w, project);
  writeTasks(w, project);
  writeResources(w, project);
  writeAssignments(w, project);

  w.close('Project');
  const xml = w.toString();
  return { xml, report, byteLength: new TextEncoder().encode(xml).length };
}

function writeExtendedAttributeDeclarations(w: XmlWriter, project: MspProject): void {
  const used = new Set<TaskFieldName>();
  for (const t of project.tasks) {
    for (const k of Object.keys(t.extended ?? {}) as TaskFieldName[]) used.add(k);
  }
  if (used.size === 0) return;
  w.open('ExtendedAttributes');
  for (const name of used) {
    w.open('ExtendedAttribute');
    w.leaf('FieldID', TASK_FIELD_IDS[name]);
    w.leaf('FieldName', name);
    w.leaf('Alias', project.fieldAliases?.[name] ?? DEFAULT_FIELD_ALIASES[name]);
    w.close('ExtendedAttribute');
  }
  w.close('ExtendedAttributes');
}

const MSP_WEEKDAY = [1, 2, 3, 4, 5, 6, 7]; // 1 = domingo no MSPDI; JS getUTCDay 0 = domingo

function writeCalendars(w: XmlWriter, project: MspProject): void {
  w.open('Calendars');
  for (const entry of project.calendars) {
    const cal: WorkCalendar = entry.calendar;
    w.open('Calendar');
    w.leaf('UID', entry.uid);
    w.leaf('Name', cal.name);
    w.leaf('IsBaseCalendar', entry.isBase ? 1 : 0);
    w.leaf('BaseCalendarUID', entry.isBase ? -1 : entry.baseCalendarUid ?? project.defaultCalendarUid);
    w.open('WeekDays');
    for (let js = 0; js < 7; js++) {
      const shifts = cal.workWeek[js] ?? [];
      w.open('WeekDay');
      w.leaf('DayType', MSP_WEEKDAY[js]!);
      w.leaf('DayWorking', shifts.length > 0 ? 1 : 0);
      if (shifts.length > 0) {
        w.open('WorkingTimes');
        for (const s of shifts) {
          w.open('WorkingTime');
          w.leaf('FromTime', timeOnly(s.start));
          w.leaf('ToTime', timeOnly(s.end));
          w.close('WorkingTime');
        }
        w.close('WorkingTimes');
      }
      w.close('WeekDay');
    }
    w.close('WeekDays');

    if (cal.exceptions.length > 0) {
      w.open('Exceptions');
      for (const exc of cal.exceptions) {
        w.open('Exception');
        w.leaf('EnteredByOccurrences', 0);
        w.open('TimePeriod');
        w.leaf('FromDate', `${exc.date}T00:00:00`);
        w.leaf('ToDate', `${exc.date}T23:59:00`);
        w.close('TimePeriod');
        w.leaf('Occurrences', 1);
        w.leaf('Name', exc.name);
        w.leaf('Type', 1);
        w.leaf('DayWorking', exc.working ? 1 : 0);
        if (exc.working && exc.shifts?.length) {
          w.open('WorkingTimes');
          for (const s of exc.shifts) {
            w.open('WorkingTime');
            w.leaf('FromTime', timeOnly(s.start));
            w.leaf('ToTime', timeOnly(s.end));
            w.close('WorkingTime');
          }
          w.close('WorkingTimes');
        }
        w.close('Exception');
      }
      w.close('Exceptions');
    }
    w.close('Calendar');
  }
  w.close('Calendars');
}

function writeTasks(w: XmlWriter, project: MspProject): void {
  w.open('Tasks');
  for (const t of [...project.tasks].sort((a, b) => a.id - b.id)) {
    w.open('Task');
    w.leaf('UID', t.uid);
    w.leaf('ID', t.id);
    w.leaf('Name', t.name);
    w.leaf('Type', 1); // duracao fixa
    w.leaf('IsNull', 0);
    w.leaf('CreateDate', mspDate(project.currentDate ?? project.startDate));
    w.leaf('WBS', t.wbs);
    w.leaf('OutlineNumber', t.outlineNumber);
    w.leaf('OutlineLevel', t.outlineLevel);
    w.leaf('Priority', 500);
    w.leaf('Start', mspDate(t.start));
    w.leaf('Finish', mspDate(t.finish));
    w.leaf('Duration', mspDuration(t.durationMinutes));
    w.leaf('DurationFormat', DURATION_FORMAT_DAYS);
    if (typeof t.workHours === 'number') w.leaf('Work', mspDuration(t.workHours * 60));
    w.leaf('Milestone', t.isMilestone ? 1 : 0);
    w.leaf('Summary', t.isSummary ? 1 : 0);
    w.leaf('Manual', 0);
    w.leaf('Active', 1);
    if (typeof t.critical === 'boolean') w.leaf('Critical', t.critical ? 1 : 0);
    if (typeof t.totalSlackMinutes === 'number') w.leaf('TotalSlack', Math.round(t.totalSlackMinutes));
    w.leaf('EffortDriven', 0);
    w.leaf('EstimatedDuration', 0);
    w.leaf('FixedCostAccrual', 3);
    w.leaf('ConstraintType', MSP_CONSTRAINT[t.constraintType ?? 'ASAP']);
    if (t.constraintDate) w.leaf('ConstraintDate', mspDate(t.constraintDate));
    if (t.calendarUid !== undefined) w.leaf('CalendarUID', t.calendarUid);
    w.leaf('PercentComplete', Math.round(t.percentComplete ?? 0));
    w.leaf('PercentWorkComplete', Math.round(t.percentWorkComplete ?? 0));
    if (t.actualStart) w.leaf('ActualStart', mspDate(t.actualStart));
    if (t.actualFinish) w.leaf('ActualFinish', mspDate(t.actualFinish));
    if (typeof t.actualWorkHours === 'number') w.leaf('ActualWork', mspDuration(t.actualWorkHours * 60));
    if (typeof t.remainingWorkHours === 'number') w.leaf('RemainingWork', mspDuration(t.remainingWorkHours * 60));
    if (t.notes) w.leaf('Notes', t.notes);

    for (const p of t.predecessors) {
      w.open('PredecessorLink');
      w.leaf('PredecessorUID', p.predecessorUid);
      w.leaf('Type', MSP_LINK_TYPE[p.type]);
      w.leaf('CrossProject', 0);
      w.leaf('LinkLag', Math.round(p.lagMinutes * 10)); // MSPDI: decimos de minuto
      w.leaf('LagFormat', DURATION_FORMAT_DAYS);
      w.close('PredecessorLink');
    }

    if (t.baseline) {
      w.open('Baseline');
      w.leaf('Number', t.baseline.number);
      w.leaf('Start', mspDate(t.baseline.start));
      w.leaf('Finish', mspDate(t.baseline.finish));
      w.leaf('Duration', mspDuration(t.baseline.durationMinutes));
      w.leaf('DurationFormat', DURATION_FORMAT_DAYS);
      w.leaf('Work', mspDuration(t.baseline.workHours * 60));
      w.close('Baseline');
    }

    for (const [name, value] of Object.entries(t.extended ?? {}) as [TaskFieldName, string | number][]) {
      if (value === undefined || value === null || value === '') continue;
      w.open('ExtendedAttribute');
      w.leaf('FieldID', TASK_FIELD_IDS[name]);
      w.leaf('Value', String(value));
      w.close('ExtendedAttribute');
    }

    w.close('Task');
  }
  w.close('Tasks');
}

function writeResources(w: XmlWriter, project: MspProject): void {
  w.open('Resources');
  for (const r of project.resources) {
    w.open('Resource');
    w.leaf('UID', r.uid);
    w.leaf('ID', r.id);
    w.leaf('Name', r.name);
    w.leaf('Type', r.type);
    w.leaf('IsNull', 0);
    if (r.group) w.leaf('Group', r.group);
    w.leaf('MaxUnits', r.maxUnits.toFixed(6));
    if (r.calendarUid !== undefined) w.leaf('CalendarUID', r.calendarUid);
    w.close('Resource');
  }
  w.close('Resources');
}

function writeAssignments(w: XmlWriter, project: MspProject): void {
  w.open('Assignments');
  for (const a of project.assignments) {
    w.open('Assignment');
    w.leaf('UID', a.uid);
    w.leaf('TaskUID', a.taskUid);
    w.leaf('ResourceUID', a.resourceUid);
    w.leaf('Units', a.units.toFixed(6));
    w.leaf('Work', mspDuration(a.workHours * 60));
    if (a.start) w.leaf('Start', mspDate(a.start));
    if (a.finish) w.leaf('Finish', mspDate(a.finish));
    w.close('Assignment');
  }
  w.close('Assignments');
}

/** Minutos uteis por dia derivados do calendario, para preencher MinutesPerDay. */
export function minutesPerDayOf(cal: WorkCalendar, sample = new Date(Date.UTC(2026, 0, 5))): number {
  for (let i = 0; i < 14; i++) {
    const d = new Date(sample.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const shifts = shiftsOn(cal, d);
    if (shifts.length > 0) {
      return shifts.reduce((s, sh) => {
        const [ah, am] = sh.start.split(':').map(Number);
        const [bh, bm] = sh.end.split(':').map(Number);
        return s + ((bh ?? 0) * 60 + (bm ?? 0)) - ((ah ?? 0) * 60 + (am ?? 0));
      }, 0);
    }
  }
  throw new Error(`Calendario "${cal.name}" sem dia util nas duas primeiras semanas de referencia.`);
}
