import { describe, expect, it } from 'vitest';
import {
  analyzeRevisionImpact, classifyIncoming, compareRevisions,
  type DocumentFingerprint, type EntitySnapshot, type ExistingDocument, type ImpactTarget,
} from '../src/revisions/index.js';

const fp = (o: Partial<DocumentFingerprint> = {}): DocumentFingerprint => ({
  fileName: 'CPM-20.701_RB.pdf', folderPath: '/ISOMETRICOS/AREA100',
  sha256: 'hash-novo', byteSize: 1024, documentNumber: 'CPM-20.701', revision: 'B', ...o,
});
const existing: ExistingDocument[] = [
  { id: 'D1', fileName: 'CPM-20.701_RA.pdf', folderPath: '/ISOMETRICOS/AREA100', sha256: 'hash-antigo', documentNumber: 'CPM-20.701', revision: 'A' },
];

describe('deteccao de revisao', () => {
  it('identifica duplicata por hash', () => {
    const d = classifyIncoming(fp({ sha256: 'hash-antigo' }), existing);
    expect(d.kind).toBe('DUPLICATE');
    expect(d.confidence).toBe(1);
  });

  it('identifica nova revisao pelo numero do documento', () => {
    const d = classifyIncoming(fp(), existing);
    expect(d.kind).toBe('NEW_REVISION');
    expect(d.matchedDocumentId).toBe('D1');
  });

  it('marca como AMBIGUO quando a revisao recebida e anterior', () => {
    const d = classifyIncoming(fp({ revision: 'A', sha256: 'outro' }), [
      { ...existing[0]!, revision: 'C' },
    ]);
    expect(d.kind).toBe('AMBIGUOUS');
    expect(d.reason).toMatch(/ANTERIOR/);
  });

  it('marca como AMBIGUO quando mesma revisao tem conteudo diferente', () => {
    const d = classifyIncoming(fp({ revision: 'A' }), existing);
    expect(d.kind).toBe('AMBIGUOUS');
    expect(d.reason).toMatch(/reemissao nao registrada/);
  });

  it('marca como AMBIGUO quando a revisao nao pode ser lida, em vez de assumir', () => {
    const d = classifyIncoming(fp({ revision: undefined }), existing);
    expect(d.kind).toBe('AMBIGUOUS');
    expect(d.missingEvidence).toBeTruthy();
  });

  it('identifica documento novo', () => {
    const d = classifyIncoming(fp({ documentNumber: 'CPM-20.999', fileName: 'novo.pdf' }), existing);
    expect(d.kind).toBe('NEW_DOCUMENT');
  });

  it('ordena revisoes alfabeticas e numericas', () => {
    expect(compareRevisions('A', 'B')).toBeLessThan(0);
    expect(compareRevisions('0', '1')).toBeLessThan(0);
    expect(compareRevisions('REV. B', 'B')).toBe(0);
  });
});

describe('analise de impacto da revisao', () => {
  const prev: EntitySnapshot[] = [
    { entityKey: 'LINE|10-P-1201', fields: { schedule: 'SCH40', pipeClass: 'A1A' }, qty: 42, unit: 'm' },
    { entityKey: 'LINE|8-P-1202', fields: { schedule: 'SCH40', pipeClass: 'A1A' }, qty: 30, unit: 'm' },
    { entityKey: 'LINE|6-P-1203', fields: { schedule: 'SCH40', pipeClass: 'A1A' }, qty: 12, unit: 'm' },
  ];
  const cur: EntitySnapshot[] = [
    { entityKey: 'LINE|10-P-1201', fields: { schedule: 'SCH80', pipeClass: 'A1A' }, qty: 48, unit: 'm' },
    { entityKey: 'LINE|8-P-1202', fields: { schedule: 'SCH40', pipeClass: 'A1A' }, qty: 30, unit: 'm' },
    { entityKey: 'LINE|4-P-1204', fields: { schedule: 'SCH40', pipeClass: 'A1A' }, qty: 9, unit: 'm' },
  ];
  const targets: ImpactTarget[] = [
    { kind: 'ACTIVITY', id: 'ACT-1', label: 'Montagem 10-P-1201', entityKeys: ['LINE|10-P-1201'] },
    { kind: 'ACTIVITY', id: 'ACT-2', label: 'Montagem 8-P-1202', entityKeys: ['LINE|8-P-1202'] },
    { kind: 'WBS_NODE', id: 'IWP-9', label: 'IWP Sistema 12', entityKeys: ['LINE|10-P-1201', 'LINE|6-P-1203'] },
  ];

  it('classifica incluidos, alterados, removidos e inalterados', () => {
    const r = analyzeRevisionImpact(prev, cur, targets);
    expect(r.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 });
    const mod = r.changes.find((c) => c.entityKey === 'LINE|10-P-1201')!;
    expect(mod.fieldChanges).toEqual([{ field: 'schedule', before: 'SCH40', after: 'SCH80' }]);
    expect(mod.qtyDelta).toBe(6);
  });

  it('lista o que sera impactado e exige aprovacao antes de aplicar', () => {
    const r = analyzeRevisionImpact(prev, cur, targets);
    expect(r.requiresApproval).toBe(true);
    const ids = r.affected.map((a) => a.target.id);
    expect(ids).toContain('ACT-1');
    expect(ids).toContain('IWP-9');
    expect(ids).not.toContain('ACT-2');
  });

  it('revisao sem mudanca nao exige aprovacao', () => {
    const r = analyzeRevisionImpact(prev, prev, targets);
    expect(r.requiresApproval).toBe(false);
    expect(r.affected).toHaveLength(0);
  });
});
