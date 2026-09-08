import type { Discipline } from '../quantities/types.js';
import type { Link } from '../network/types.js';

/** Etapa construtiva de um objeto fisico. Define a cadeia natural de processo. */
export type ConstructionStep =
  | 'ENGINEERING_RELEASE' | 'MATERIAL_RELEASE' | 'FABRICATION' | 'PRE_ASSEMBLY'
  | 'CIVIL_EMBEDS' | 'CIVIL_CLOSURE' | 'STRUCTURE_ERECTION' | 'SUPPORT_INSTALL'
  | 'EQUIPMENT_SET' | 'EQUIPMENT_ALIGNMENT' | 'ERECTION' | 'WELDING'
  | 'VISUAL_INSPECTION' | 'NDE' | 'PWHT' | 'PUNCH_CLEARANCE'
  | 'PRESSURE_TEST' | 'REINSTATEMENT' | 'PAINTING' | 'INSULATION'
  | 'CABLE_TRAY' | 'CABLE_PULLING' | 'TERMINATION' | 'ELECTRICAL_TEST' | 'ENERGIZATION'
  | 'INSTRUMENT_INSTALL' | 'TUBING' | 'CALIBRATION' | 'LOOP_TEST'
  | 'PRECOMMISSIONING' | 'COMMISSIONING' | 'TURNOVER';

/** Contexto fisico de uma atividade. Todo campo aqui deve vir de documento validado. */
export interface ActivityContext {
  activityId: string;
  name: string;
  discipline: Discipline;
  step: ConstructionStep;
  area?: string;
  system?: string;
  subsystem?: string;
  /** Objeto fisico ao qual a atividade se aplica (linha, spool, tag, circuito). */
  objectKey?: string;
  lineNumber?: string;
  spoolId?: string;
  tag?: string;
  /** Suportes documentados que sustentam este objeto. */
  supportRefs?: string[];
  /** Estruturas documentadas que sustentam os suportes. */
  structureRefs?: string[];
  /** Equipamento e bocal de conexao, quando documentados na lista de linhas/P&ID. */
  connectsToEquipment?: string[];
  /** Linha-tronco documentada da qual este ramal deriva (origem no P&ID / lista de linhas). */
  parentLineNumber?: string;
  testPackId?: string;
  commissioningSystemId?: string;
  /** Elevacao em metros, quando extraida de isometrico/modelo. */
  elevationM?: number;
  /** Interferencias documentadas (clash, nota construtiva). NAO e proximidade visual. */
  documentedInterferences?: string[];
  /** Referencias documentais que sustentam o contexto. */
  sourceRefs: string[];
  /** Confianca agregada do contexto (menor confianca dos campos usados). */
  confidence: number;
}

export interface SequencingRule {
  id: string;
  name: string;
  /** Explicacao em linguagem de obra, exibida ao planejador. */
  description: string;
  enabled: boolean;
  /** Confianca maxima que a regra pode atribuir. */
  maxConfidence: number;
  reasonKind: import('../network/types.js').LinkRationale['reasonKind'];
  /** Defasagem padrao em minutos de trabalho. */
  defaultLagMinutes?: number;
}

/** Pergunta aberta quando a evidencia nao sustenta um vinculo (§12.3). */
export interface SequencingQuestion {
  id: string;
  activityIds: string[];
  question: string;
  whyItMatters: string;
  missingEvidence: string[];
}

export interface SequencingResult {
  links: Link[];
  questions: SequencingQuestion[];
  /** Regras aplicadas e quantos vinculos cada uma gerou. */
  ruleStats: { ruleId: string; linksGenerated: number }[];
}
