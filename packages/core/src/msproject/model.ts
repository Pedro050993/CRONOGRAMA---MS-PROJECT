import type { WorkCalendar } from '../calendar/index.js';

/** Codigos MSPDI de tipo de vinculo. */
export const MSP_LINK_TYPE = { FF: 0, FS: 1, SF: 2, SS: 3 } as const;
export const MSP_LINK_TYPE_REVERSE: Record<number, 'FF' | 'FS' | 'SF' | 'SS'> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };

/** Codigos MSPDI de restricao. */
export const MSP_CONSTRAINT = {
  ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7,
} as const;
export const MSP_CONSTRAINT_REVERSE: Record<number, keyof typeof MSP_CONSTRAINT> = {
  0: 'ASAP', 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT',
};

/** DurationFormat 7 = dias; 5 = horas. LagFormat idem. */
export const DURATION_FORMAT_DAYS = 7;
export const DURATION_FORMAT_HOURS = 5;

/**
 * FieldIDs dos campos personalizados de tarefa usados para rastreabilidade.
 * Valores do esquema MSPDI (TASK_TEXT1..TASK_TEXT10, TASK_NUMBER1..3).
 */
export const TASK_FIELD_IDS = {
  Text1: 188743731, Text2: 188743734, Text3: 188743737, Text4: 188743740, Text5: 188743743,
  Text6: 188743746, Text7: 188743749, Text8: 188743752, Text9: 188743755, Text10: 188743758,
  Number1: 188743767, Number2: 188743770, Number3: 188743773,
} as const;

export type TaskFieldName = keyof typeof TASK_FIELD_IDS;

/** Aliases de rastreabilidade exportados junto do XML. */
export const DEFAULT_FIELD_ALIASES: Record<TaskFieldName, string> = {
  Text1: 'Codigo EAP estavel',
  Text2: 'Disciplina',
  Text3: 'Area (CWA)',
  Text4: 'Sistema',
  Text5: 'Pacote (CWP/IWP)',
  Text6: 'Unidade de controle',
  Text7: 'Documento de origem',
  Text8: 'Fonte do indice de produtividade',
  Text9: 'Status de validacao humana',
  Text10: 'Criterio de conclusao',
  Number1: 'Quantidade',
  Number2: 'Indice de produtividade (HH/un)',
  Number3: 'Confianca da base (0-1)',
};

export interface MspPredecessorLink {
  predecessorUid: number;
  type: keyof typeof MSP_LINK_TYPE;
  lagMinutes: number;
}

export interface MspBaseline {
  number: number;
  start: string;
  finish: string;
  durationMinutes: number;
  workHours: number;
}

export interface MspTask {
  uid: number;
  id: number;
  name: string;
  wbs: string;
  outlineNumber: string;
  outlineLevel: number;
  isSummary: boolean;
  isMilestone: boolean;
  start: string;
  finish: string;
  durationMinutes: number;
  workHours?: number;
  percentComplete?: number;
  percentWorkComplete?: number;
  constraintType?: keyof typeof MSP_CONSTRAINT;
  constraintDate?: string;
  calendarUid?: number;
  totalSlackMinutes?: number;
  critical?: boolean;
  actualStart?: string;
  actualFinish?: string;
  actualWorkHours?: number;
  remainingWorkHours?: number;
  notes?: string;
  predecessors: MspPredecessorLink[];
  baseline?: MspBaseline;
  extended?: Partial<Record<TaskFieldName, string | number>>;
}

export interface MspResource {
  uid: number;
  id: number;
  name: string;
  /** 1 = trabalho (mao de obra/equipamento com hora), 0 = material. */
  type: 0 | 1;
  maxUnits: number;
  calendarUid?: number;
  group?: string;
}

export interface MspAssignment {
  uid: number;
  taskUid: number;
  resourceUid: number;
  /** 1.0 = 100%. */
  units: number;
  workHours: number;
  start?: string;
  finish?: string;
}

export interface MspProject {
  name: string;
  title: string;
  company?: string;
  author?: string;
  startDate: string;
  finishDate?: string;
  statusDate?: string;
  currentDate?: string;
  /** 14 = Project 2010+ (compativel com 2016). */
  saveVersion?: number;
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  defaultStartTime: string;
  defaultFinishTime: string;
  calendars: { uid: number; calendar: WorkCalendar; isBase: boolean; baseCalendarUid?: number }[];
  defaultCalendarUid: number;
  tasks: MspTask[];
  resources: MspResource[];
  assignments: MspAssignment[];
  fieldAliases?: Partial<Record<TaskFieldName, string>>;
}
