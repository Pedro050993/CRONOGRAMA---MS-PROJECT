import type { EvidenceRef } from '../provenance/types.js';

/** Base do índice — a mesma distinção exigida em §6 (orçada, planejada, observada, projetada). */
export type ProductivityBasis = 'BUDGETED' | 'PLANNED' | 'OBSERVED' | 'FORECAST';

/**
 * Um índice importado de arquivo é EXTRAÍDO, não digitado. Ele não pode calcular
 * duração antes de um humano confirmar que a leitura está correta (§4.2).
 */
export type IndexApproval = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProductivityIndexRecord {
  code: string;
  description: string;
  /** HH por unidade de `perUnit`. */
  value: number;
  perUnit: string;
  basis: ProductivityBasis;
  /** Origem obrigatória. Sem ela o índice não calcula duração. */
  source: string;
  /** ISO-8601 (YYYY-MM-DD). */
  sourceDate: string;
  approvalStatus: IndexApproval;
  /** Onde exatamente, no arquivo, este índice foi lido. */
  evidence?: EvidenceRef & { sheet?: string; row?: number };
  confidence: number;
  /** Disciplina/área a que o índice se aplica, quando declarada na planilha. */
  discipline?: string;
  scopeNote?: string;
}

/** Linha que o sistema recusou importar, com o motivo. Nunca é descartada em silêncio. */
export interface RejectedRow {
  rowIndex: number;
  raw: string[];
  reason: string;
  field?: string;
}

export interface ImportResult {
  candidates: ProductivityIndexRecord[];
  rejected: RejectedRow[];
  /** Mapeamento coluna → campo que o sistema deduziu, para o usuário conferir. */
  columnMap: Record<string, number>;
  /** Campos que o cabeçalho não continha e precisaram vir da declaração do usuário. */
  suppliedByUser: string[];
  warnings: string[];
}
