import { describe, expect, it } from 'vitest';
import { analyzeMove, buildOutline, stableCode, validateWbs, WbsStructureError, type WbsNode } from '../src/wbs/index.js';

const n = (id: string, type: WbsNode['type'], parentId: string | null, sortIndex: number, over: Partial<WbsNode> = {}): WbsNode => ({
  id, parentId, type, code: id, name: id, sortIndex, ...over,
});

const validTree = (): WbsNode[] => [
  n('P', 'PROJECT', null, 1),
  n('CWA1', 'CWA', 'P', 1, { area: 'Area 100' }),
  n('CWP1', 'CWP', 'CWA1', 1, { discipline: 'PIPING' }),
  n('IWP1', 'IWP', 'CWP1', 1, {
    deliverable: 'Linha 10"-P-1201 montada e soldada',
    quantity: { qty: 120, unit: 'in-dia' },
    scopeOut: 'Nao inclui isolamento nem pintura',
    acceptanceCriteria: [{ description: 'END aprovado', evidenceRequired: 'Laudo de END' }],
  }),
  n('ACT1', 'ACTIVITY', 'IWP1', 1),
];

describe('EAP / AWP', () => {
  it('aceita hierarquia Projeto > CWA > CWP > IWP > Atividade', () => {
    expect(validateWbs(validTree()).filter((i) => i.severity === 'ERROR')).toHaveLength(0);
  });

  it('RECUSA confundir CWA, CWP e IWP', () => {
    const bad = [...validTree(), n('IWP_X', 'IWP', 'CWA1', 2, { deliverable: 'x', quantity: { qty: 1, unit: 'un' } })];
    const issues = validateWbs(bad);
    expect(issues.some((i) => i.code === 'WBS_INVALID_NESTING')).toBe(true);
    expect(issues.find((i) => i.code === 'WBS_INVALID_NESTING')!.message).toMatch(/niveis distintos/);
  });

  it('exige area no CWA e disciplina no CWP', () => {
    const t = validTree();
    t[1] = n('CWA1', 'CWA', 'P', 1);
    t[2] = n('CWP1', 'CWP', 'CWA1', 1);
    const codes = validateWbs(t).map((i) => i.code);
    expect(codes).toContain('CWA_NO_AREA');
    expect(codes).toContain('CWP_NO_DISCIPLINE');
  });

  it('exige entregavel, quantidade e limite no IWP', () => {
    const t = validTree();
    t[3] = n('IWP1', 'IWP', 'CWP1', 1);
    const codes = validateWbs(t).map((i) => i.code);
    expect(codes).toContain('IWP_NO_DELIVERABLE');
    expect(codes).toContain('IWP_NO_QUANTITY');
    expect(codes).toContain('IWP_NO_BOUNDARY');
  });

  it('detecta codigo duplicado e no orfao', () => {
    const t = [...validTree(), n('ACT2', 'ACTIVITY', 'IWP1', 2, { code: 'ACT1' })];
    expect(validateWbs(t).some((i) => i.code === 'WBS_DUPLICATE_CODE')).toBe(true);
    const orphan = [...validTree(), n('X', 'ACTIVITY', 'INEXISTENTE', 1)];
    expect(validateWbs(orphan).some((i) => i.code === 'WBS_ORPHAN')).toBe(true);
  });

  it('gera OutlineNumber e OutlineLevel em pre-ordem', () => {
    const o = buildOutline(validTree());
    expect(o.map((x) => [x.id, x.outlineNumber, x.outlineLevel])).toEqual([
      ['P', '1', 1], ['CWA1', '1.1', 2], ['CWP1', '1.1.1', 3], ['IWP1', '1.1.1.1', 4], ['ACT1', '1.1.1.1.1', 5],
    ]);
  });

  it('recusa gerar outline de EAP invalida', () => {
    expect(() => buildOutline([...validTree(), n('IWP_X', 'IWP', 'CWA1', 2, { deliverable: 'x', quantity: { qty: 1, unit: 'un' }, scopeOut: 'y' })]))
      .toThrow(WbsStructureError);
  });

  it('analisa impacto de reorganizacao antes de aplicar', () => {
    const tree = [
      ...validTree(),
      n('CWA2', 'CWA', 'P', 2, { area: 'Area 200' }),
    ];
    const impact = analyzeMove(tree, 'CWP1', 'CWA2', 1);
    expect(impact.ok).toBe(true);
    expect(impact.affectedDescendants).toEqual(['IWP1', 'ACT1']);
    expect(impact.outlineChanges.find((c) => c.nodeId === 'CWP1')).toEqual({ nodeId: 'CWP1', from: '1.1.1', to: '1.2.1' });
  });

  it('rejeita movimento que quebraria a hierarquia, sem aplicar nada', () => {
    const impact = analyzeMove(validTree(), 'IWP1', 'CWA1', 1);
    expect(impact.ok).toBe(false);
    expect(impact.errors[0]).toMatch(/niveis distintos/);
  });

  it('codigo estavel nao depende da posicao entre irmaos', () => {
    expect(stableCode(['Area 100', 'Tubulacao', 'Sistema 12'])).toBe('AREA-100.TUBULACAO.SISTEMA-12');
    expect(stableCode(['Area 100', undefined, 'Sistema 12'])).toBe('AREA-100.SISTEMA-12');
  });
});
