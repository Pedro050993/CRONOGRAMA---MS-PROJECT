/**
 * Modelo de proveniencia — a peca central do sistema.
 *
 * Regra inegociavel (§4.1): nenhum valor entra no dominio sem declarar de onde veio.
 * Um numero sem `Provenance` nao e um numero: e um chute com aparencia de fato.
 */

/** Como a informacao passou a existir no sistema. */
export type DataClass =
  /** Extraido de documento, com evidencia localizavel. */
  | 'EXTRACTED_FACT'
  /** Digitado por usuario identificado. */
  | 'USER_INPUT'
  /** Deduzido pela IA a partir de evidencia — nunca vale como fato. */
  | 'AI_INFERENCE'
  /** Condicao adotada para permitir a analise. */
  | 'PLANNING_ASSUMPTION'
  /** Resultado de regra configuravel do sistema. */
  | 'CONFIGURABLE_RULE'
  /** Falta o dado. Substitui qualquer valor default. */
  | 'PENDING_INFO'
  /** Fontes divergem e nenhuma foi eleita. */
  | 'SOURCE_CONFLICT';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'CORRECTED' | 'REJECTED' | 'FLAGGED';

export type ExtractionMethod =
  | 'PDF_VECTOR_TEXT'
  | 'OCR'
  | 'TABLE_PARSER'
  | 'REGEX_RULE'
  | 'LLM'
  | 'CAD_ATTRIBUTE'
  | 'MODEL_PROPERTY'
  | 'MANUAL_ENTRY'
  | 'IMPORTED_SCHEDULE'
  | 'COMPUTED';

/** Localizacao exata da evidencia dentro do documento de origem. */
export interface EvidenceRef {
  documentId: string;
  /** Codigo do documento como consta no carimbo (ex.: CPM-20.701). */
  documentNumber?: string;
  revision?: string;
  /** 1-based. */
  page?: number;
  sheet?: string;
  /** [x0, y0, x1, y1] em pontos PDF ou pixels da imagem. */
  bbox?: [number, number, number, number];
  layer?: string;
  objectId?: string;
  /** Trecho textual literal que sustenta o valor. */
  snippet?: string;
}

export interface Provenance {
  dataClass: DataClass;
  method: ExtractionMethod;
  /** 0..1. Obrigatorio para EXTRACTED_FACT e AI_INFERENCE. */
  confidence?: number;
  evidence: EvidenceRef[];
  processedAt: string;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Justificativa de correcao, rejeicao ou excecao. */
  note?: string;
}

/** Valor sempre acompanhado da sua origem. */
export interface Sourced<T> {
  value: T | null;
  provenance: Provenance;
}

export class ProvenanceError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

/** Classes que podem alimentar calculo aprovado sem revisao adicional. */
const TRUSTWORTHY: DataClass[] = ['EXTRACTED_FACT', 'USER_INPUT', 'CONFIGURABLE_RULE', 'PLANNING_ASSUMPTION'];

/**
 * Valida um registro de proveniencia. Lanca em vez de "corrigir" silenciosamente:
 * um dado mal-proveniente deve travar o fluxo, nao virar default.
 */
export function assertValidProvenance(p: Provenance, field = 'value'): void {
  if (p.dataClass === 'EXTRACTED_FACT' || p.dataClass === 'AI_INFERENCE') {
    if (p.evidence.length === 0) {
      throw new ProvenanceError(
        `Campo "${field}": ${p.dataClass} exige ao menos uma evidencia de origem.`,
        field,
      );
    }
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
      throw new ProvenanceError(`Campo "${field}": confianca deve estar entre 0 e 1.`, field);
    }
  }
  if (p.dataClass === 'USER_INPUT' && !p.reviewedBy) {
    throw new ProvenanceError(`Campo "${field}": USER_INPUT exige usuario identificado.`, field);
  }
}

/**
 * Um valor so pode alimentar quantitativo/cronograma aprovado se:
 *  - a classe for confiavel; e
 *  - inferencia da IA tiver passado por revisao humana explicita.
 */
export function isUsableForApprovedPlan(p: Provenance): boolean {
  if (p.dataClass === 'PENDING_INFO' || p.dataClass === 'SOURCE_CONFLICT') return false;
  if (p.dataClass === 'AI_INFERENCE') {
    return p.reviewStatus === 'APPROVED' || p.reviewStatus === 'CORRECTED';
  }
  if (!TRUSTWORTHY.includes(p.dataClass)) return false;
  return p.reviewStatus !== 'REJECTED' && p.reviewStatus !== 'PENDING'
    ? true
    : p.dataClass === 'USER_INPUT' || p.dataClass === 'CONFIGURABLE_RULE';
}

/** Cria uma pendencia — o unico "valor default" permitido pelo sistema. */
export function pending<T>(reason: string, evidence: EvidenceRef[] = []): Sourced<T> {
  return {
    value: null,
    provenance: {
      dataClass: 'PENDING_INFO',
      method: 'MANUAL_ENTRY',
      evidence,
      processedAt: new Date().toISOString(),
      reviewStatus: 'FLAGGED',
      note: reason,
    },
  };
}

export function userInput<T>(value: T, userId: string, note?: string): Sourced<T> {
  return {
    value,
    provenance: {
      dataClass: 'USER_INPUT',
      method: 'MANUAL_ENTRY',
      evidence: [],
      processedAt: new Date().toISOString(),
      reviewStatus: 'APPROVED',
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
      note,
    },
  };
}

export function extracted<T>(
  value: T,
  method: ExtractionMethod,
  confidence: number,
  evidence: EvidenceRef[],
): Sourced<T> {
  const provenance: Provenance = {
    dataClass: 'EXTRACTED_FACT',
    method,
    confidence,
    evidence,
    processedAt: new Date().toISOString(),
    reviewStatus: 'PENDING',
  };
  assertValidProvenance(provenance);
  return { value, provenance };
}
