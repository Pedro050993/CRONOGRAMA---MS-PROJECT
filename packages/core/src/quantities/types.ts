import type { Provenance } from '../provenance/types.js';
import type { Measure } from '../units/index.js';

export type Discipline =
  | 'PIPING' | 'ELECTRICAL' | 'INSTRUMENTATION' | 'STRUCTURAL'
  | 'MECHANICAL' | 'CIVIL' | 'PAINTING' | 'INSULATION' | 'COMMISSIONING' | 'OTHER';

export type SourceKind =
  | 'LINE_LIST' | 'ISOMETRIC' | 'MTO' | 'PLAN' | 'PID' | 'MODEL_3D'
  | 'CABLE_LIST' | 'INSTRUMENT_LIST' | 'MANUAL' | 'IMPORTED_SCHEDULE';

/** Item quantitativo atomico, sempre ligado a uma entidade fisica identificavel. */
export interface QuantityItem {
  id: string;
  /**
   * Chave natural da COISA FISICA no campo (nao do registro).
   * Dois registros com a mesma entityKey descrevem o mesmo objeto: somar os dois
   * e dupla contagem. Ex.: `JOINT|CPM-20.701|J-012`, `LINE|10"-P-1201-A1A`.
   */
  entityKey: string;
  discipline: Discipline;
  sourceKind: SourceKind;
  documentId: string;
  documentRevision?: string;
  area?: string;
  system?: string;
  subsystem?: string;
  lineNumber?: string;
  tag?: string;
  material?: string;
  pipeClass?: string;
  schedule?: string;
  nominalDiameterIn?: number;
  itemType?: string;
  workPackageId?: string;
  controlUnit?: string;
  measure: Measure;
  provenance: Provenance;
  /** Regra que produziu a quantidade, quando derivada. */
  calcMemo?: CalcMemo;
}

/** Memoria de calculo — obrigatoria em toda quantidade derivada (§9). */
export interface CalcMemo {
  formula: string;
  inputs: Record<string, number | string | null>;
  result: number;
  unit: string;
  /** Referencia da regra/premissa aplicada. */
  ruleId: string;
  ruleSource: string;
  computedAt: string;
}

export type RollupDimension =
  | 'discipline' | 'area' | 'system' | 'subsystem' | 'lineNumber' | 'tag'
  | 'documentId' | 'material' | 'pipeClass' | 'schedule'
  | 'nominalDiameterIn' | 'itemType' | 'workPackageId' | 'controlUnit' | 'sourceKind';

export interface RollupRow {
  key: Record<string, string>;
  qty: number;
  unit: string;
  itemCount: number;
  sourceKinds: SourceKind[];
  documentIds: string[];
  /** Menor confianca entre os itens agregados — a linha nao vale mais que seu pior insumo. */
  minConfidence: number | null;
  /** Quantos itens ainda nao foram aprovados por humano. */
  pendingReviewCount: number;
}

export interface RollupResult {
  rows: RollupRow[];
  /** Itens excluidos por proveniencia inutilizavel (pendencia/conflito/rejeitado). */
  excluded: { item: QuantityItem; reason: string }[];
  totals: { qty: number; unit: string; itemCount: number };
}

export type DoubleCountSeverity = 'CONFIRMED' | 'SUSPECTED';

export interface DoubleCountFinding {
  entityKey: string;
  severity: DoubleCountSeverity;
  message: string;
  items: { id: string; sourceKind: SourceKind; documentId: string; qty: number; unit: string }[];
  /** Regra de precedencia aplicavel, se ja aprovada pelo usuario. */
  resolvedBy?: string;
}
