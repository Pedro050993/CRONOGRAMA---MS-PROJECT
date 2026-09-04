import { describe, expect, it } from 'vitest';
import {
  assertValidProvenance, extracted, isUsableForApprovedPlan, pending,
  ProvenanceError, userInput, type Provenance,
} from '../src/provenance/types.js';

const base = (over: Partial<Provenance> = {}): Provenance => ({
  dataClass: 'EXTRACTED_FACT',
  method: 'PDF_VECTOR_TEXT',
  confidence: 0.9,
  evidence: [{ documentId: 'DOC-1', page: 2, bbox: [10, 10, 50, 50] }],
  processedAt: new Date().toISOString(),
  reviewStatus: 'PENDING',
  ...over,
});

describe('proveniencia — invariante central do sistema', () => {
  it('recusa fato extraido sem evidencia', () => {
    expect(() => assertValidProvenance(base({ evidence: [] }), 'lineNumber'))
      .toThrow(ProvenanceError);
  });

  it('recusa fato extraido sem confianca valida', () => {
    expect(() => assertValidProvenance(base({ confidence: 1.7 }))).toThrow(/confianca/);
    expect(() => assertValidProvenance(base({ confidence: undefined }))).toThrow(/confianca/);
  });

  it('recusa entrada manual sem usuario identificado', () => {
    expect(() => assertValidProvenance(base({ dataClass: 'USER_INPUT', reviewedBy: undefined })))
      .toThrow(/usuario identificado/);
  });

  it('inferencia da IA NAO alimenta plano aprovado sem revisao humana', () => {
    const ai = base({ dataClass: 'AI_INFERENCE', reviewStatus: 'PENDING' });
    expect(isUsableForApprovedPlan(ai)).toBe(false);
    expect(isUsableForApprovedPlan({ ...ai, reviewStatus: 'APPROVED', reviewedBy: 'u1' })).toBe(true);
    expect(isUsableForApprovedPlan({ ...ai, reviewStatus: 'CORRECTED', reviewedBy: 'u1' })).toBe(true);
  });

  it('pendencia e conflito nunca sao utilizaveis', () => {
    expect(isUsableForApprovedPlan(base({ dataClass: 'PENDING_INFO' }))).toBe(false);
    expect(isUsableForApprovedPlan(base({ dataClass: 'SOURCE_CONFLICT' }))).toBe(false);
  });

  it('pending() e o unico "default": produz valor nulo com motivo', () => {
    const p = pending<number>('Comprimento nao legivel no isometrico');
    expect(p.value).toBeNull();
    expect(p.provenance.dataClass).toBe('PENDING_INFO');
    expect(p.provenance.note).toMatch(/nao legivel/);
    expect(isUsableForApprovedPlan(p.provenance)).toBe(false);
  });

  it('userInput e extracted montam proveniencia valida', () => {
    expect(userInput(12, 'u-42').provenance.reviewedBy).toBe('u-42');
    const e = extracted(6, 'TABLE_PARSER', 0.82, [{ documentId: 'DOC-9', page: 1 }]);
    expect(e.provenance.reviewStatus).toBe('PENDING');
    expect(e.provenance.confidence).toBe(0.82);
  });
});
