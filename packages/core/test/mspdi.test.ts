import { describe, expect, it } from 'vitest';
import { exportMspdi, minutesPerDayOf, mspDuration } from '../src/msproject/export.js';
import { compareSchedules, importMspdi } from '../src/msproject/import.js';
import { validateMspdiXml } from '../src/msproject/validate.js';
import { parseXml, child, children, textOf } from '../src/msproject/xml.js';
import type { MspProject, MspTask } from '../src/msproject/model.js';
import { standardCalendar } from '../src/calendar/index.js';

const cal = standardCalendar('CAL-1');
cal.exceptions.push({ date: '2026-04-21', working: false, name: 'Tiradentes' });

const task = (o: Partial<MspTask> & Pick<MspTask, 'uid' | 'id' | 'name'>): MspTask => ({
  wbs: String(o.id), outlineNumber: String(o.id), outlineLevel: 1,
  isSummary: false, isMilestone: false,
  start: '2026-01-05T07:00:00.000Z', finish: '2026-01-07T16:00:00.000Z',
  durationMinutes: 1440, predecessors: [], ...o,
});

const project = (): MspProject => ({
  name: 'Projeto de Montagem Eletromecanica [TESTE]',
  title: 'Ampliacao da Unidade de Refrigeracao — Area 100 [TESTE]',
  company: 'Empresa de Montagem',
  startDate: '2026-01-05T07:00:00.000Z',
  statusDate: '2026-02-02T07:00:00.000Z',
  minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20,
  defaultStartTime: '07:00', defaultFinishTime: '16:00',
  calendars: [{ uid: 1, calendar: cal, isBase: true }],
  defaultCalendarUid: 1,
  tasks: [
    task({ uid: 1, id: 1, name: 'Area 100 — Tubulacao', isSummary: true, outlineLevel: 1, wbs: '1', outlineNumber: '1' }),
    task({
      uid: 2, id: 2, name: 'Montagem da linha 10"-P-1201-A1A (acentuacao: instalacao, inspecao)',
      outlineLevel: 2, wbs: '1.1', outlineNumber: '1.1',
      workHours: 240, calendarUid: 1, critical: true, totalSlackMinutes: 0,
      extended: { Text1: 'AREA-100.TUB.SIS-12', Text2: 'PIPING', Number1: 120, Text9: 'APROVADO' },
      baseline: { number: 0, start: '2026-01-05T07:00:00.000Z', finish: '2026-01-07T16:00:00.000Z', durationMinutes: 1440, workHours: 240 },
    }),
    task({
      uid: 3, id: 3, name: 'Teste de pressao do test pack TP-01', outlineLevel: 2, wbs: '1.2', outlineNumber: '1.2',
      predecessors: [{ predecessorUid: 2, type: 'FS', lagMinutes: 480 }],
      start: '2026-01-09T07:00:00.000Z', finish: '2026-01-09T16:00:00.000Z', durationMinutes: 480, workHours: 16,
    }),
    task({
      uid: 4, id: 4, name: 'Marco: sistema 12 liberado', isMilestone: true, durationMinutes: 0,
      outlineLevel: 2, wbs: '1.3', outlineNumber: '1.3',
      start: '2026-01-09T16:00:00.000Z', finish: '2026-01-09T16:00:00.000Z',
      predecessors: [{ predecessorUid: 3, type: 'FS', lagMinutes: 0 }],
      constraintType: 'FNLT', constraintDate: '2026-01-30T16:00:00.000Z',
    }),
  ],
  resources: [
    { uid: 1, id: 1, name: 'Soldador', type: 1, maxUnits: 6, group: 'Tubulacao' },
    { uid: 2, id: 2, name: 'Ajudante', type: 1, maxUnits: 3, group: 'Tubulacao' },
  ],
  assignments: [
    { uid: 1, taskUid: 2, resourceUid: 1, units: 6, workHours: 160 },
    { uid: 2, taskUid: 2, resourceUid: 2, units: 3, workHours: 80 },
  ],
});

describe('exportacao MSPDI para MS Project 2016', () => {
  it('gera XML valido, com namespace, UTF-8 e SaveVersion 14', () => {
    const { xml, report } = exportMspdi(project());
    expect(report.valid).toBe(true);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true);
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    expect(xml).toContain('<SaveVersion>14</SaveVersion>');
  });

  it('preserva acentuacao sem mojibake', () => {
    const { xml } = exportMspdi(project());
    expect(xml).toContain('acentuacao: instalacao, inspecao');
    const reparsed = parseXml(xml);
    const tasks = children(child(reparsed, 'Tasks')!, 'Task');
    expect(textOf(tasks[1], 'Name')).toContain('10"-P-1201-A1A');
  });

  it('escapa caracteres especiais em vez de quebrar o XML', () => {
    const p = project();
    p.tasks[1]!.name = 'Linha <A&B> "critica" com \'aspas\'';
    const { xml, report } = exportMspdi(p);
    expect(report.valid).toBe(true);
    expect(xml).toContain('&lt;A&amp;B&gt;');
    const back = importMspdi(xml);
    expect(back.tasks.find((t) => t.uid === 2)!.name).toBe('Linha <A&B> "critica" com \'aspas\'');
  });

  it('escreve WBS, OutlineNumber, OutlineLevel, marco, restricao e baseline', () => {
    const { xml } = exportMspdi(project());
    expect(xml).toContain('<OutlineNumber>1.1</OutlineNumber>');
    expect(xml).toContain('<OutlineLevel>2</OutlineLevel>');
    expect(xml).toContain('<Milestone>1</Milestone>');
    expect(xml).toContain('<ConstraintType>7</ConstraintType>'); // FNLT
    expect(xml).toContain('<Baseline>');
  });

  it('escreve calendario com turnos e feriado como excecao', () => {
    const { xml } = exportMspdi(project());
    expect(xml).toContain('<FromTime>07:00:00</FromTime>');
    expect(xml).toContain('<ToTime>12:00:00</ToTime>');
    expect(xml).toContain('<Name>Tiradentes</Name>');
    expect(xml).toContain('<FromDate>2026-04-21T00:00:00</FromDate>');
  });

  it('escreve campos personalizados com FieldID e Alias de rastreabilidade', () => {
    const { xml } = exportMspdi(project());
    expect(xml).toContain('<FieldID>188743731</FieldID>');
    expect(xml).toContain('<Alias>Codigo EAP estavel</Alias>');
    expect(xml).toContain('<Value>AREA-100.TUB.SIS-12</Value>');
  });

  it('formata duracao e datas no dialeto do Project', () => {
    expect(mspDuration(1440)).toBe('PT24H0M0S');
    const { xml } = exportMspdi(project());
    expect(xml).toMatch(/<Start>2026-01-05T07:00:00<\/Start>/);
    expect(xml).not.toMatch(/<Start>[^<]*Z<\/Start>/);
  });

  it('DETECTA vinculo para tarefa inexistente e reprova o arquivo', () => {
    const p = project();
    p.tasks[2]!.predecessors = [{ predecessorUid: 999, type: 'FS', lagMinutes: 0 }];
    const { report } = exportMspdi(p);
    expect(report.valid).toBe(false);
    expect(report.findings.some((f) => f.code === 'LINK_DANGLING')).toBe(true);
  });

  it('DETECTA UID duplicado, UID zero e atribuicao orfa', () => {
    const p = project();
    p.tasks.push(task({ uid: 2, id: 9, name: 'Duplicada' }));
    p.assignments.push({ uid: 3, taskUid: 77, resourceUid: 1, units: 1, workHours: 1 });
    const { report } = exportMspdi(p);
    expect(report.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['TASK_DUPLICATE_UID', 'ASG_BAD_TASK']),
    );
    expect(report.valid).toBe(false);
  });

  it('valida o XML relendo-o do zero', () => {
    const { xml } = exportMspdi(project());
    const r = validateMspdiXml(xml);
    expect(r.valid).toBe(true);
    expect(r.counts.tasks).toBe(4);
    expect(r.counts.links).toBe(2);
    expect(r.counts.resources).toBe(2);
    expect(r.counts.calendars).toBe(1);
  });

  it('a validacao de XML pega arquivo corrompido', () => {
    const bad = validateMspdiXml('<Project><Tasks><Task><UID>1</UID></Tasks></Project>');
    expect(bad.valid).toBe(false);
    expect(bad.findings[0]!.code).toBe('XML_PARSE_ERROR');
  });
});

describe('importacao MSPDI e comparacao', () => {
  it('reimporta o que exportou sem perder informacao essencial', () => {
    const { xml } = exportMspdi(project());
    const back = importMspdi(xml);
    expect(back.tasks).toHaveLength(4);
    expect(back.name).toContain('[TESTE]');
    const t3 = back.tasks.find((t) => t.uid === 3)!;
    expect(t3.predecessors).toEqual([{ predecessorUid: 2, type: 'FS', lagMinutes: 480 }]);
    const t2 = back.tasks.find((t) => t.uid === 2)!;
    expect(t2.workHours).toBe(240);
    expect(t2.baseline?.workHours).toBe(240);
    expect(back.tasks.find((t) => t.uid === 4)!.isMilestone).toBe(true);
    expect(back.resourceNames[1]).toBe('Soldador');
    expect(back.warnings).toHaveLength(0);
  });

  it('avisa sobre predecessora inexistente no arquivo importado', () => {
    const xml = exportMspdi(project()).xml.replace('<PredecessorUID>2</PredecessorUID>', '<PredecessorUID>888</PredecessorUID>');
    expect(importMspdi(xml).warnings.some((w) => /888/.test(w))).toBe(true);
  });

  it('compara dois cronogramas e classifica as mudancas', () => {
    const before = importMspdi(exportMspdi(project()).xml).tasks;
    const p2 = project();
    p2.tasks[2]!.finish = '2026-01-14T16:00:00.000Z';
    p2.tasks[2]!.durationMinutes = 2400;
    p2.tasks.push(task({ uid: 5, id: 5, name: 'Atividade nova da revisao B' }));
    const after = importMspdi(exportMspdi(p2).xml).tasks;

    const diff = compareSchedules(before, after);
    expect(diff.some((d) => d.kind === 'ADDED' && d.taskUid === 5)).toBe(true);
    const dateChange = diff.find((d) => d.kind === 'DATE_CHANGED' && d.taskUid === 3 && d.field === 'Finish');
    expect(dateChange!.deltaDays).toBeGreaterThan(4);
    expect(diff.some((d) => d.kind === 'DURATION_CHANGED' && d.taskUid === 3)).toBe(true);
  });
});

describe('utilitarios', () => {
  it('deriva MinutesPerDay do calendario', () => {
    expect(minutesPerDayOf(cal)).toBe(480);
  });
});
