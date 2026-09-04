import { describe, expect, it } from 'vitest';
import { evaluatePromotion, requireJustification, type PromotionCandidate } from '../src/governance/promotion.js';
import type { Provenance } from '../src/provenance/types.js';

const p = (over: Partial<Provenance> = {}): Provenance => ({
  dataClass: 'EXTRACTED_FACT', method: 'TABLE_PARSER', confidence: 0.9,
  evidence: [{ documentId: 'D1' }], processedAt: '2026-01-01T00:00:00Z',
  reviewStatus: 'APPROVED', reviewedBy: 'u1', ...over,
});

const c = (id: string, over: Partial<PromotionCandidate> = {}): PromotionCandidate => ({
  id, stage: 'QUANTITY', label: id, provenance: p(), ...over,
});

describe('portao de promocao ao plano aprovado', () => {
  it('promove quando toda a cadeia esta aprovada', () => {
    const r = evaluatePromotion([
      c('QTY-1'),
      c('ACT-1', { stage: 'DURATION', dependsOn: ['QTY-1'] }),
    ]);
    expect(r.canPromote).toBe(true);
    expect(r.approved).toEqual(['QTY-1', 'ACT-1']);
  });

  it('BLOQUEIA inferencia da IA nao revisada e propaga o bloqueio', () => {
    const r = evaluatePromotion([
      c('QTY-1', { provenance: p({ dataClass: 'AI_INFERENCE', reviewStatus: 'PENDING' }) }),
      c('ACT-1', { stage: 'DURATION', label: 'Montagem L-1201', dependsOn: ['QTY-1'] }),
    ]);
    expect(r.canPromote).toBe(false);
    expect(r.blocked.map((b) => b.id).sort()).toEqual(['ACT-1', 'QTY-1']);
    expect(r.blocked.find((b) => b.id === 'QTY-1')!.reason).toMatch(/sem aprovacao humana/);
    expect(r.blocked.find((b) => b.id === 'ACT-1')!.reason).toMatch(/Depende de "QTY-1"/);
  });

  it('BLOQUEIA pendencia e conflito de fontes', () => {
    const r = evaluatePromotion([
      c('QTY-P', { provenance: p({ dataClass: 'PENDING_INFO', note: 'comprimento ilegivel' }) }),
      c('QTY-C', { provenance: p({ dataClass: 'SOURCE_CONFLICT', note: 'lista de linhas x isometrico' }) }),
    ]);
    expect(r.blocked).toHaveLength(2);
    expect(r.blocked[0]!.reason).toMatch(/comprimento ilegivel|divergencia|lista de linhas/);
  });

  it('BLOQUEIA quando a rastreabilidade esta quebrada', () => {
    const r = evaluatePromotion([c('ACT-1', { dependsOn: ['QTY-INEXISTENTE'] })]);
    expect(r.blocked[0]!.reason).toMatch(/Rastreabilidade quebrada/);
  });

  it('exige justificativa e responsavel em rejeicao e correcao', () => {
    expect(() => requireJustification({ id: 'D1', stage: 'QUANTITY', targetId: 'QTY-1', decision: 'REJECTED', by: 'u1', justification: '' }))
      .toThrow(/justificativa/);
    expect(() => requireJustification({ id: 'D1', stage: 'QUANTITY', targetId: 'QTY-1', decision: 'APPROVED', by: '', justification: '' }))
      .toThrow(/usuario responsavel/);
    const ok = requireJustification({ id: 'D1', stage: 'QUANTITY', targetId: 'QTY-1', decision: 'CORRECTED', by: 'u1', justification: 'Comprimento corrigido conforme isometrico rev. B' });
    expect(ok.at).toBeTruthy();
  });
});
