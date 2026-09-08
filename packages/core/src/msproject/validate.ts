/**
 * Validacao do pacote antes e depois da geracao do XML (§14).
 *
 * A validacao existe porque "gerou o arquivo" nao e o mesmo que "abre no Project".
 * Um XML que importa com tarefas perdidas e pior que um erro explicito.
 */
import { parseXml, child, children, textOf, numOf, sanitizeXmlText, type XmlNode } from './xml.js';
import type { MspProject } from './model.js';

export interface ValidationFinding {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  ref?: string;
}

export interface ValidationReport {
  valid: boolean;
  findings: ValidationFinding[];
  counts: { tasks: number; links: number; resources: number; assignments: number; calendars: number };
  generatedAt: string;
}

export function validateMspdiProject(project: MspProject): ValidationReport {
  const f: ValidationFinding[] = [];
  const uids = new Set<number>();
  const ids = new Set<number>();

  if (!project.name?.trim()) f.push({ code: 'PROJ_NO_NAME', severity: 'ERROR', message: 'Projeto sem nome.' });
  if (!project.tasks.length) f.push({ code: 'PROJ_NO_TASKS', severity: 'ERROR', message: 'Projeto sem tarefas.' });
  if (!project.calendars.length) f.push({ code: 'PROJ_NO_CALENDAR', severity: 'ERROR', message: 'Projeto sem calendario. O Project recusa o arquivo.' });
  if (!project.calendars.some((c) => c.uid === project.defaultCalendarUid)) {
    f.push({ code: 'PROJ_CALENDAR_MISSING', severity: 'ERROR', message: `CalendarUID padrao ${project.defaultCalendarUid} nao existe na lista de calendarios.` });
  }
  if (!(project.minutesPerDay > 0)) f.push({ code: 'PROJ_MINUTES_PER_DAY', severity: 'ERROR', message: 'MinutesPerDay deve ser positivo.' });

  for (const t of project.tasks) {
    const ref = `Tarefa UID ${t.uid} "${t.name}"`;
    if (t.uid === 0) f.push({ code: 'TASK_UID_ZERO', severity: 'ERROR', message: `${ref}: UID 0 e reservado pelo Project.`, ref: String(t.uid) });
    if (uids.has(t.uid)) f.push({ code: 'TASK_DUPLICATE_UID', severity: 'ERROR', message: `${ref}: UID repetido.`, ref: String(t.uid) });
    uids.add(t.uid);
    if (ids.has(t.id)) f.push({ code: 'TASK_DUPLICATE_ID', severity: 'ERROR', message: `${ref}: ID repetido.`, ref: String(t.id) });
    ids.add(t.id);
    if (!t.name?.trim()) f.push({ code: 'TASK_NO_NAME', severity: 'ERROR', message: `Tarefa UID ${t.uid} sem nome.`, ref: String(t.uid) });
    if (t.name !== sanitizeXmlText(t.name)) {
      f.push({ code: 'TASK_INVALID_CHARS', severity: 'WARNING', message: `${ref}: caracteres de controle invalidos removidos na exportacao.`, ref: String(t.uid) });
    }
    if (!(t.outlineLevel >= 1)) f.push({ code: 'TASK_OUTLINE_LEVEL', severity: 'ERROR', message: `${ref}: OutlineLevel deve ser >= 1.`, ref: String(t.uid) });
    if (!t.outlineNumber?.trim()) f.push({ code: 'TASK_OUTLINE_NUMBER', severity: 'ERROR', message: `${ref}: OutlineNumber ausente.`, ref: String(t.uid) });
    if (Number.isNaN(new Date(t.start).getTime())) f.push({ code: 'TASK_BAD_START', severity: 'ERROR', message: `${ref}: data de inicio invalida.`, ref: String(t.uid) });
    if (Number.isNaN(new Date(t.finish).getTime())) f.push({ code: 'TASK_BAD_FINISH', severity: 'ERROR', message: `${ref}: data de termino invalida.`, ref: String(t.uid) });
    if (new Date(t.finish).getTime() < new Date(t.start).getTime()) {
      f.push({ code: 'TASK_FINISH_BEFORE_START', severity: 'ERROR', message: `${ref}: termino anterior ao inicio.`, ref: String(t.uid) });
    }
    if (t.isMilestone && t.durationMinutes !== 0) {
      f.push({ code: 'MILESTONE_WITH_DURATION', severity: 'WARNING', message: `${ref}: marco com duracao ${t.durationMinutes} min. O Project trata marco como duracao zero.`, ref: String(t.uid) });
    }
    if (t.calendarUid !== undefined && !project.calendars.some((c) => c.uid === t.calendarUid)) {
      f.push({ code: 'TASK_CALENDAR_MISSING', severity: 'ERROR', message: `${ref}: CalendarUID ${t.calendarUid} inexistente.`, ref: String(t.uid) });
    }
  }

  let links = 0;
  for (const t of project.tasks) {
    for (const p of t.predecessors) {
      links++;
      if (!uids.has(p.predecessorUid)) {
        f.push({ code: 'LINK_DANGLING', severity: 'ERROR', message: `Tarefa UID ${t.uid} referencia predecessora UID ${p.predecessorUid}, que nao existe no arquivo.`, ref: String(t.uid) });
      }
      if (p.predecessorUid === t.uid) {
        f.push({ code: 'LINK_SELF', severity: 'ERROR', message: `Tarefa UID ${t.uid} tem vinculo consigo mesma.`, ref: String(t.uid) });
      }
    }
  }

  const rUids = new Set<number>();
  for (const r of project.resources) {
    if (r.uid === 0) f.push({ code: 'RES_UID_ZERO', severity: 'ERROR', message: `Recurso "${r.name}": UID 0 e reservado.` });
    if (rUids.has(r.uid)) f.push({ code: 'RES_DUPLICATE_UID', severity: 'ERROR', message: `Recurso "${r.name}": UID ${r.uid} repetido.` });
    rUids.add(r.uid);
    if (!r.name?.trim()) f.push({ code: 'RES_NO_NAME', severity: 'ERROR', message: `Recurso UID ${r.uid} sem nome.` });
  }

  const aUids = new Set<number>();
  for (const a of project.assignments) {
    if (aUids.has(a.uid)) f.push({ code: 'ASG_DUPLICATE_UID', severity: 'ERROR', message: `Atribuicao UID ${a.uid} repetida.` });
    aUids.add(a.uid);
    if (!uids.has(a.taskUid)) f.push({ code: 'ASG_BAD_TASK', severity: 'ERROR', message: `Atribuicao UID ${a.uid} aponta para tarefa inexistente (${a.taskUid}).` });
    if (!rUids.has(a.resourceUid)) f.push({ code: 'ASG_BAD_RESOURCE', severity: 'ERROR', message: `Atribuicao UID ${a.uid} aponta para recurso inexistente (${a.resourceUid}).` });
  }

  const hasAccents = project.tasks.some((t) => /[^\x00-\x7F]/.test(t.name));
  if (hasAccents) {
    f.push({ code: 'ENCODING_NOTE', severity: 'INFO', message: 'Ha acentuacao em nomes de tarefa. O arquivo e gravado em UTF-8 com declaracao explicita, formato lido corretamente pelo Project 2016.' });
  }

  return {
    valid: !f.some((x) => x.severity === 'ERROR'),
    findings: f,
    counts: { tasks: project.tasks.length, links, resources: project.resources.length, assignments: project.assignments.length, calendars: project.calendars.length },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Valida o XML ja gerado, relendo-o do zero.
 * Esta e a verificacao que pega erro de serializacao, nao de modelo.
 */
export function validateMspdiXml(xml: string): ValidationReport {
  const f: ValidationFinding[] = [];
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    return {
      valid: false,
      findings: [{ code: 'XML_PARSE_ERROR', severity: 'ERROR', message: e instanceof Error ? e.message : String(e) }],
      counts: { tasks: 0, links: 0, resources: 0, assignments: 0, calendars: 0 },
      generatedAt: new Date().toISOString(),
    };
  }

  if (root.name !== 'Project') f.push({ code: 'XML_ROOT', severity: 'ERROR', message: `Elemento raiz e <${root.name}>, esperado <Project>.` });
  if (root.attrs['xmlns'] !== 'http://schemas.microsoft.com/project') {
    f.push({ code: 'XML_NAMESPACE', severity: 'ERROR', message: 'Namespace ausente ou incorreto. O Project recusa o arquivo sem xmlns="http://schemas.microsoft.com/project".' });
  }
  if (!xml.startsWith('<?xml')) f.push({ code: 'XML_NO_DECL', severity: 'WARNING', message: 'Declaracao XML ausente.' });
  if (!/encoding="UTF-8"/i.test(xml.slice(0, 200))) f.push({ code: 'XML_NO_ENCODING', severity: 'ERROR', message: 'Codificacao nao declarada como UTF-8. Acentuacao pode corromper na importacao.' });

  const tasksNode = child(root, 'Tasks');
  const taskNodes = tasksNode ? children(tasksNode, 'Task') : [];
  if (taskNodes.length === 0) f.push({ code: 'XML_NO_TASKS', severity: 'ERROR', message: 'Nenhuma tarefa no XML.' });

  const uids = new Set<number>();
  for (const t of taskNodes) {
    const uid = numOf(t, 'UID');
    if (uid === undefined) { f.push({ code: 'XML_TASK_NO_UID', severity: 'ERROR', message: 'Tarefa sem UID.' }); continue; }
    if (uids.has(uid)) f.push({ code: 'XML_TASK_DUP_UID', severity: 'ERROR', message: `UID ${uid} repetido no XML.`, ref: String(uid) });
    uids.add(uid);
    if (!textOf(t, 'Name')) f.push({ code: 'XML_TASK_NO_NAME', severity: 'ERROR', message: `Tarefa UID ${uid} sem Name.`, ref: String(uid) });
    if (!textOf(t, 'Start') || !textOf(t, 'Finish')) f.push({ code: 'XML_TASK_NO_DATES', severity: 'ERROR', message: `Tarefa UID ${uid} sem Start/Finish.`, ref: String(uid) });
    const dur = textOf(t, 'Duration');
    if (dur && !/^PT\d+H\d+M\d+S$/.test(dur)) f.push({ code: 'XML_BAD_DURATION', severity: 'ERROR', message: `Tarefa UID ${uid}: duracao "${dur}" fora do formato PT#H#M#S.`, ref: String(uid) });
    for (const d of ['Start', 'Finish', 'ActualStart', 'ActualFinish', 'ConstraintDate']) {
      const v = textOf(t, d);
      if (v && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) {
        f.push({ code: 'XML_BAD_DATE', severity: 'ERROR', message: `Tarefa UID ${uid}: ${d}="${v}" fora do formato aceito pelo MSPDI (sem fuso).`, ref: String(uid) });
      }
    }
  }

  let links = 0;
  for (const t of taskNodes) {
    const uid = numOf(t, 'UID');
    for (const l of children(t, 'PredecessorLink')) {
      links++;
      const p = numOf(l, 'PredecessorUID');
      if (p === undefined) { f.push({ code: 'XML_LINK_NO_UID', severity: 'ERROR', message: `Tarefa UID ${uid}: vinculo sem PredecessorUID.` }); continue; }
      if (!uids.has(p)) f.push({ code: 'XML_LINK_DANGLING', severity: 'ERROR', message: `Tarefa UID ${uid}: predecessora UID ${p} nao existe no arquivo.`, ref: String(uid) });
      const type = numOf(l, 'Type');
      if (type === undefined || type < 0 || type > 3) f.push({ code: 'XML_LINK_BAD_TYPE', severity: 'ERROR', message: `Tarefa UID ${uid}: tipo de vinculo "${type}" invalido (0..3).`, ref: String(uid) });
    }
  }

  const calendars = child(root, 'Calendars');
  const calNodes = calendars ? children(calendars, 'Calendar') : [];
  if (calNodes.length === 0) f.push({ code: 'XML_NO_CALENDAR', severity: 'ERROR', message: 'Nenhum calendario no XML.' });

  const resNode = child(root, 'Resources');
  const resources = resNode ? children(resNode, 'Resource') : [];
  const rUids = new Set(resources.map((r) => numOf(r, 'UID')).filter((x): x is number => x !== undefined));
  const asgNode = child(root, 'Assignments');
  const assignments = asgNode ? children(asgNode, 'Assignment') : [];
  for (const a of assignments) {
    const tu = numOf(a, 'TaskUID');
    const ru = numOf(a, 'ResourceUID');
    if (tu !== undefined && !uids.has(tu)) f.push({ code: 'XML_ASG_BAD_TASK', severity: 'ERROR', message: `Atribuicao aponta para tarefa UID ${tu} inexistente.` });
    if (ru !== undefined && ru !== -1 && !rUids.has(ru)) f.push({ code: 'XML_ASG_BAD_RESOURCE', severity: 'ERROR', message: `Atribuicao aponta para recurso UID ${ru} inexistente.` });
  }

  return {
    valid: !f.some((x) => x.severity === 'ERROR'),
    findings: f,
    counts: { tasks: taskNodes.length, links, resources: resources.length, assignments: assignments.length, calendars: calNodes.length },
    generatedAt: new Date().toISOString(),
  };
}
