/**
 * Importador MSPDI — para auditoria, comparacao e atualizacao (§14).
 *
 * A importacao NAO sobrescreve o cronograma do projeto: ela produz um objeto
 * comparavel. Aplicar as diferencas e um ato deliberado do planejador.
 */
import { child, children, numOf, parseXml, textOf } from './xml.js';
import { MSP_CONSTRAINT_REVERSE, MSP_LINK_TYPE_REVERSE, type MspProject, type MspTask } from './model.js';
import type { WorkShift } from '../calendar/index.js';

export interface ImportedProject {
  name: string;
  title: string;
  startDate?: string;
  statusDate?: string;
  saveVersion?: number;
  tasks: MspTask[];
  resourceNames: Record<number, string>;
  calendarNames: Record<number, string>;
  warnings: string[];
}

function parseMspDuration(v: string | undefined): number {
  if (!v) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Math.round(Number(m[3] ?? 0) / 60);
}

function parseMspDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function importMspdi(xml: string): ImportedProject {
  const root = parseXml(xml);
  const warnings: string[] = [];
  if (root.name !== 'Project') throw new Error(`XML nao e MSPDI: elemento raiz <${root.name}>.`);
  if (root.attrs['xmlns'] && root.attrs['xmlns'] !== 'http://schemas.microsoft.com/project') {
    warnings.push(`Namespace inesperado: ${root.attrs['xmlns']}`);
  }

  const calendarNames: Record<number, string> = {};
  const calNode = child(root, 'Calendars');
  for (const c of calNode ? children(calNode, 'Calendar') : []) {
    const uid = numOf(c, 'UID');
    if (uid !== undefined) calendarNames[uid] = textOf(c, 'Name') ?? `Calendario ${uid}`;
  }

  const resourceNames: Record<number, string> = {};
  const resNode = child(root, 'Resources');
  for (const r of resNode ? children(resNode, 'Resource') : []) {
    const uid = numOf(r, 'UID');
    if (uid !== undefined) resourceNames[uid] = textOf(r, 'Name') ?? `Recurso ${uid}`;
  }

  const tasks: MspTask[] = [];
  const tasksNode = child(root, 'Tasks');
  for (const t of tasksNode ? children(tasksNode, 'Task') : []) {
    const uid = numOf(t, 'UID');
    if (uid === undefined) { warnings.push('Tarefa sem UID ignorada.'); continue; }
    if (textOf(t, 'IsNull') === '1') continue;

    const start = parseMspDate(textOf(t, 'Start'));
    const finish = parseMspDate(textOf(t, 'Finish'));
    if (!start || !finish) warnings.push(`Tarefa UID ${uid} sem datas legiveis.`);

    const baselineNode = children(t, 'Baseline')[0];
    const constraintCode = numOf(t, 'ConstraintType');

    const task: MspTask = {
      uid,
      id: numOf(t, 'ID') ?? uid,
      name: textOf(t, 'Name') ?? `(sem nome UID ${uid})`,
      wbs: textOf(t, 'WBS') ?? '',
      outlineNumber: textOf(t, 'OutlineNumber') ?? '',
      outlineLevel: numOf(t, 'OutlineLevel') ?? 1,
      isSummary: textOf(t, 'Summary') === '1',
      isMilestone: textOf(t, 'Milestone') === '1',
      start: start ?? new Date(0).toISOString(),
      finish: finish ?? new Date(0).toISOString(),
      durationMinutes: parseMspDuration(textOf(t, 'Duration')),
      predecessors: children(t, 'PredecessorLink').map((l) => ({
        predecessorUid: numOf(l, 'PredecessorUID') ?? -1,
        type: MSP_LINK_TYPE_REVERSE[numOf(l, 'Type') ?? 1] ?? 'FS',
        lagMinutes: (numOf(l, 'LinkLag') ?? 0) / 10,
      })),
    };

    const work = textOf(t, 'Work');
    if (work) task.workHours = parseMspDuration(work) / 60;
    const pc = numOf(t, 'PercentComplete');
    if (pc !== undefined) task.percentComplete = pc;
    const pwc = numOf(t, 'PercentWorkComplete');
    if (pwc !== undefined) task.percentWorkComplete = pwc;
    const ts = numOf(t, 'TotalSlack');
    if (ts !== undefined) task.totalSlackMinutes = ts;
    if (textOf(t, 'Critical') !== undefined) task.critical = textOf(t, 'Critical') === '1';
    const cu = numOf(t, 'CalendarUID');
    if (cu !== undefined) task.calendarUid = cu;
    if (constraintCode !== undefined) task.constraintType = MSP_CONSTRAINT_REVERSE[constraintCode] ?? 'ASAP';
    const cd = parseMspDate(textOf(t, 'ConstraintDate'));
    if (cd) task.constraintDate = cd;
    const as = parseMspDate(textOf(t, 'ActualStart'));
    if (as) task.actualStart = as;
    const af = parseMspDate(textOf(t, 'ActualFinish'));
    if (af) task.actualFinish = af;
    const aw = textOf(t, 'ActualWork');
    if (aw) task.actualWorkHours = parseMspDuration(aw) / 60;
    const rw = textOf(t, 'RemainingWork');
    if (rw) task.remainingWorkHours = parseMspDuration(rw) / 60;
    const notes = textOf(t, 'Notes');
    if (notes) task.notes = notes;

    if (baselineNode) {
      const bs = parseMspDate(textOf(baselineNode, 'Start'));
      const bf = parseMspDate(textOf(baselineNode, 'Finish'));
      if (bs && bf) {
        task.baseline = {
          number: numOf(baselineNode, 'Number') ?? 0,
          start: bs, finish: bf,
          durationMinutes: parseMspDuration(textOf(baselineNode, 'Duration')),
          workHours: parseMspDuration(textOf(baselineNode, 'Work')) / 60,
        };
      }
    }
    tasks.push(task);
  }

  const known = new Set(tasks.map((t) => t.uid));
  for (const t of tasks) {
    for (const p of t.predecessors) {
      if (!known.has(p.predecessorUid)) warnings.push(`Tarefa UID ${t.uid}: predecessora UID ${p.predecessorUid} nao existe no arquivo importado.`);
    }
  }

  return {
    name: textOf(root, 'Name') ?? '(sem nome)',
    title: textOf(root, 'Title') ?? textOf(root, 'Name') ?? '(sem titulo)',
    ...(parseMspDate(textOf(root, 'StartDate')) ? { startDate: parseMspDate(textOf(root, 'StartDate'))! } : {}),
    ...(parseMspDate(textOf(root, 'StatusDate')) ? { statusDate: parseMspDate(textOf(root, 'StatusDate'))! } : {}),
    ...(numOf(root, 'SaveVersion') !== undefined ? { saveVersion: numOf(root, 'SaveVersion')! } : {}),
    tasks, resourceNames, calendarNames, warnings,
  };
}

export type ScheduleDiffKind = 'ADDED' | 'REMOVED' | 'DATE_CHANGED' | 'DURATION_CHANGED' | 'WORK_CHANGED' | 'LOGIC_CHANGED' | 'NAME_CHANGED';

export interface ScheduleDiffEntry {
  kind: ScheduleDiffKind;
  taskUid: number;
  taskName: string;
  field?: string;
  before?: string | number | null;
  after?: string | number | null;
  /** Deslocamento em dias uteis aproximados, quando aplicavel. */
  deltaDays?: number;
}

/** Compara dois cronogramas por UID. Usado em auditoria e em analise de impacto. */
export function compareSchedules(before: MspTask[], after: MspTask[]): ScheduleDiffEntry[] {
  const b = new Map(before.map((t) => [t.uid, t]));
  const a = new Map(after.map((t) => [t.uid, t]));
  const out: ScheduleDiffEntry[] = [];

  for (const [uid, t] of a) {
    const prev = b.get(uid);
    if (!prev) { out.push({ kind: 'ADDED', taskUid: uid, taskName: t.name }); continue; }
    if (prev.name !== t.name) out.push({ kind: 'NAME_CHANGED', taskUid: uid, taskName: t.name, field: 'Name', before: prev.name, after: t.name });
    if (prev.start !== t.start) {
      out.push({ kind: 'DATE_CHANGED', taskUid: uid, taskName: t.name, field: 'Start', before: prev.start, after: t.start, deltaDays: dayDelta(prev.start, t.start) });
    }
    if (prev.finish !== t.finish) {
      out.push({ kind: 'DATE_CHANGED', taskUid: uid, taskName: t.name, field: 'Finish', before: prev.finish, after: t.finish, deltaDays: dayDelta(prev.finish, t.finish) });
    }
    if (prev.durationMinutes !== t.durationMinutes) {
      out.push({ kind: 'DURATION_CHANGED', taskUid: uid, taskName: t.name, field: 'Duration', before: prev.durationMinutes, after: t.durationMinutes });
    }
    if ((prev.workHours ?? null) !== (t.workHours ?? null)) {
      out.push({ kind: 'WORK_CHANGED', taskUid: uid, taskName: t.name, field: 'Work', before: prev.workHours ?? null, after: t.workHours ?? null });
    }
    const pl = linkKey(prev);
    const al = linkKey(t);
    if (pl !== al) out.push({ kind: 'LOGIC_CHANGED', taskUid: uid, taskName: t.name, field: 'Predecessors', before: pl, after: al });
  }
  for (const [uid, t] of b) if (!a.has(uid)) out.push({ kind: 'REMOVED', taskUid: uid, taskName: t.name });
  return out;
}

function linkKey(t: MspTask): string {
  return [...t.predecessors]
    .sort((x, y) => x.predecessorUid - y.predecessorUid)
    .map((p) => `${p.predecessorUid}${p.type}${p.lagMinutes}`)
    .join(',');
}

function dayDelta(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number((ms / 86400000).toFixed(2));
}
