/**
 * Deteccao de revisao e analise de impacto (§16 e §2.3).
 *
 * Regra: uma nova revisao nunca sobrescreve a anterior. Ela gera comparacao,
 * lista de impactos e proposta de atualizacao, que so e aplicada apos aprovacao.
 */
export type IngestKind = 'DUPLICATE' | 'NEW_REVISION' | 'NEW_DOCUMENT' | 'AMBIGUOUS';

export interface DocumentFingerprint {
  fileName: string;
  folderPath: string;
  sha256: string;
  byteSize: number;
  /** Numero do documento conforme carimbo, quando extraido. */
  documentNumber?: string;
  revision?: string;
  issuedAt?: string;
}

export interface IngestDecision {
  kind: IngestKind;
  matchedDocumentId?: string;
  reason: string;
  confidence: number;
  /** O que falta para decidir com seguranca, quando AMBIGUOUS. */
  missingEvidence?: string[];
}

export interface ExistingDocument {
  id: string;
  fileName: string;
  folderPath: string;
  sha256: string;
  documentNumber?: string;
  revision?: string;
}

/** Ordem de revisao usual em documentacao de engenharia. */
export function compareRevisions(a: string | undefined, b: string | undefined): number {
  const norm = (r: string | undefined): { num: number; alpha: string } => {
    const s = (r ?? '').trim().toUpperCase().replace(/^REV[\s.:-]*/, '');
    const n = /^(\d+)$/.exec(s);
    if (n?.[1]) return { num: Number(n[1]), alpha: '' };
    const al = /^([A-Z]+)(\d*)$/.exec(s);
    if (al?.[1]) return { num: al[2] ? Number(al[2]) : 0, alpha: al[1] };
    return { num: -1, alpha: s };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.alpha && y.alpha) return x.alpha === y.alpha ? x.num - y.num : x.alpha.localeCompare(y.alpha);
  if (!x.alpha && !y.alpha) return x.num - y.num;
  // Numerica costuma suceder alfabetica (A, B, C ... 0, 1, 2) em muitos padroes;
  // como isso varia por cliente, tratamos como indeterminado.
  return 0;
}

export function classifyIncoming(fp: DocumentFingerprint, existing: ExistingDocument[]): IngestDecision {
  const sameHash = existing.find((d) => d.sha256 === fp.sha256);
  if (sameHash) {
    return {
      kind: 'DUPLICATE', matchedDocumentId: sameHash.id, confidence: 1,
      reason: `Conteudo identico (SHA-256) ao documento ja armazenado "${sameHash.fileName}". Nenhum reprocessamento necessario.`,
    };
  }

  if (fp.documentNumber) {
    const sameNumber = existing.filter((d) => d.documentNumber && d.documentNumber === fp.documentNumber);
    if (sameNumber.length > 0) {
      const latest = sameNumber.slice().sort((a, b) => compareRevisions(a.revision, b.revision))[sameNumber.length - 1]!;
      if (!fp.revision || !latest.revision) {
        return {
          kind: 'AMBIGUOUS', matchedDocumentId: latest.id, confidence: 0.5,
          reason: `Mesmo numero de documento "${fp.documentNumber}", mas a revisao nao pode ser lida em um dos lados.`,
          missingEvidence: ['Revisao no carimbo do documento novo ou do existente'],
        };
      }
      const cmp = compareRevisions(latest.revision, fp.revision);
      if (cmp < 0) {
        return {
          kind: 'NEW_REVISION', matchedDocumentId: latest.id, confidence: 0.95,
          reason: `Documento "${fp.documentNumber}" revisao ${fp.revision} sucede a revisao ${latest.revision} ja cadastrada.`,
        };
      }
      if (cmp === 0) {
        return {
          kind: 'AMBIGUOUS', matchedDocumentId: latest.id, confidence: 0.4,
          reason: `Documento "${fp.documentNumber}" revisao ${fp.revision} tem a mesma revisao do existente, mas conteudo diferente (hash divergente). Pode ser reemissao nao registrada.`,
          missingEvidence: ['Confirmacao de qual arquivo e o valido', 'Data de emissao'],
        };
      }
      return {
        kind: 'AMBIGUOUS', matchedDocumentId: latest.id, confidence: 0.6,
        reason: `Documento "${fp.documentNumber}" revisao ${fp.revision} e ANTERIOR a revisao ${latest.revision} ja cadastrada. Carregar uma revisao antiga por engano e comum.`,
        missingEvidence: ['Confirmacao de que a revisao antiga deve ser mantida'],
      };
    }
  }

  const sameName = existing.filter((d) => baseName(d.fileName) === baseName(fp.fileName) && d.folderPath === fp.folderPath);
  if (sameName.length > 0) {
    return {
      kind: 'AMBIGUOUS', matchedDocumentId: sameName[0]!.id, confidence: 0.5,
      reason: `Mesmo nome de arquivo e mesma pasta, conteudo diferente. Sem numero de documento nao da para afirmar que e nova revisao.`,
      missingEvidence: ['Numero do documento no carimbo', 'Revisao'],
    };
  }

  return { kind: 'NEW_DOCUMENT', confidence: 0.9, reason: 'Hash, numero de documento e caminho nao coincidem com nenhum documento existente.' };
}

function baseName(f: string): string {
  return f.replace(/\.[^.]+$/, '').trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Analise de impacto
// ---------------------------------------------------------------------------

export interface EntitySnapshot {
  entityKey: string;
  /** Campos comparaveis, ja normalizados. */
  fields: Record<string, string | number | null>;
  /** Quantidade associada, quando houver. */
  qty?: number;
  unit?: string;
}

export type EntityChangeKind = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface EntityChange {
  entityKey: string;
  kind: EntityChangeKind;
  fieldChanges: { field: string; before: string | number | null; after: string | number | null }[];
  qtyDelta?: number;
  unit?: string;
}

export interface ImpactTarget {
  /** O que consome a entidade: quantitativo, pacote, atividade, mapa de controle. */
  kind: 'QUANTITY' | 'WBS_NODE' | 'ACTIVITY' | 'CONTROL_MAP_ITEM' | 'LINK';
  id: string;
  label: string;
  entityKeys: string[];
}

export interface RevisionImpact {
  changes: EntityChange[];
  summary: { added: number; removed: number; modified: number; unchanged: number };
  affected: { target: ImpactTarget; because: string[] }[];
  /** Impacto so e aplicado apos aprovacao explicita. */
  requiresApproval: boolean;
}

export function analyzeRevisionImpact(
  previous: EntitySnapshot[],
  current: EntitySnapshot[],
  targets: ImpactTarget[],
): RevisionImpact {
  const prev = new Map(previous.map((e) => [e.entityKey, e]));
  const cur = new Map(current.map((e) => [e.entityKey, e]));
  const changes: EntityChange[] = [];

  for (const [key, c] of cur) {
    const p = prev.get(key);
    if (!p) {
      changes.push({ entityKey: key, kind: 'ADDED', fieldChanges: [], ...(c.qty !== undefined ? { qtyDelta: c.qty, unit: c.unit } : {}) });
      continue;
    }
    const fieldChanges: EntityChange['fieldChanges'] = [];
    const keys = new Set([...Object.keys(p.fields), ...Object.keys(c.fields)]);
    for (const f of keys) {
      const before = p.fields[f] ?? null;
      const after = c.fields[f] ?? null;
      if (before !== after) fieldChanges.push({ field: f, before, after });
    }
    const qtyDelta = c.qty !== undefined && p.qty !== undefined ? Number((c.qty - p.qty).toFixed(4)) : undefined;
    if (fieldChanges.length > 0 || (qtyDelta !== undefined && qtyDelta !== 0)) {
      changes.push({ entityKey: key, kind: 'MODIFIED', fieldChanges, ...(qtyDelta !== undefined ? { qtyDelta, unit: c.unit } : {}) });
    } else {
      changes.push({ entityKey: key, kind: 'UNCHANGED', fieldChanges: [] });
    }
  }
  for (const [key, p] of prev) {
    if (!cur.has(key)) changes.push({ entityKey: key, kind: 'REMOVED', fieldChanges: [], ...(p.qty !== undefined ? { qtyDelta: -p.qty, unit: p.unit } : {}) });
  }

  const changedKeys = new Set(changes.filter((c) => c.kind !== 'UNCHANGED').map((c) => c.entityKey));
  const affected = targets
    .map((target) => ({
      target,
      because: target.entityKeys.filter((k) => changedKeys.has(k)),
    }))
    .filter((a) => a.because.length > 0);

  const summary = {
    added: changes.filter((c) => c.kind === 'ADDED').length,
    removed: changes.filter((c) => c.kind === 'REMOVED').length,
    modified: changes.filter((c) => c.kind === 'MODIFIED').length,
    unchanged: changes.filter((c) => c.kind === 'UNCHANGED').length,
  };

  return {
    changes,
    summary,
    affected,
    requiresApproval: summary.added + summary.removed + summary.modified > 0,
  };
}
