import { describe, expect, it } from 'vitest';
import { explainPredecessors, proposeSequence } from '../src/sequencing/engine.js';
import { DEFAULT_RULES } from '../src/sequencing/rules.js';
import type { ActivityContext } from '../src/sequencing/types.js';

const ctx = (o: Partial<ActivityContext> & Pick<ActivityContext, 'activityId' | 'step'>): ActivityContext => ({
  name: o.activityId, discipline: 'PIPING', sourceRefs: ['DOC-1'], confidence: 0.9, ...o,
} as ActivityContext);

describe('sequenciamento construtivo', () => {
  it('encadeia etapas do mesmo objeto na ordem tecnica', () => {
    const r = proposeSequence([
      ctx({ activityId: 'W', step: 'WELDING', objectKey: 'L-1201' }),
      ctx({ activityId: 'E', step: 'ERECTION', objectKey: 'L-1201' }),
      ctx({ activityId: 'N', step: 'NDE', objectKey: 'L-1201' }),
    ]);
    const pairs = r.links.map((l) => `${l.predecessorId}->${l.successorId}`);
    expect(pairs).toContain('E->W');
    expect(pairs).toContain('W->N');
    expect(pairs).not.toContain('W->E');
  });

  it('TODO vinculo carrega motivo, fonte, confianca e nasce SUGGESTED', () => {
    const r = proposeSequence([
      ctx({ activityId: 'E', step: 'ERECTION', objectKey: 'L1' }),
      ctx({ activityId: 'W', step: 'WELDING', objectKey: 'L1' }),
    ]);
    for (const l of r.links) {
      expect(l.status).toBe('SUGGESTED');
      expect(l.rationale.reason.length).toBeGreaterThan(10);
      expect(l.rationale.sourceRefs.length).toBeGreaterThan(0);
      expect(l.rationale.confidence).toBeGreaterThan(0);
      expect(l.rationale.ruleId).toBeTruthy();
    }
  });

  it('suporte antes da linha SOMENTE com vinculo documentado', () => {
    const comRef = proposeSequence([
      ctx({ activityId: 'SUP', step: 'SUPPORT_INSTALL', objectKey: 'SUP-045', tag: 'SUP-045' }),
      ctx({ activityId: 'MONT', step: 'ERECTION', objectKey: 'L-1201', lineNumber: 'L-1201', supportRefs: ['SUP-045'] }),
    ]);
    expect(comRef.links.some((l) => l.predecessorId === 'SUP' && l.successorId === 'MONT')).toBe(true);

    const semRef = proposeSequence([
      ctx({ activityId: 'SUP', step: 'SUPPORT_INSTALL', objectKey: 'SUP-045', tag: 'SUP-045' }),
      ctx({ activityId: 'MONT', step: 'ERECTION', objectKey: 'L-1201', lineNumber: 'L-1201' }),
    ]);
    expect(semRef.links.some((l) => l.predecessorId === 'SUP' && l.successorId === 'MONT')).toBe(false);
  });

  it('tronco antes do ramal usa conectividade documentada, NAO diametro', () => {
    const r = proposeSequence([
      ctx({ activityId: 'HDR', step: 'ERECTION', objectKey: 'H1', lineNumber: '24-P-1000' }),
      ctx({ activityId: 'BR', step: 'ERECTION', objectKey: 'B1', lineNumber: '4-P-1001', parentLineNumber: '24-P-1000' }),
      // Linha de grande diametro SEM relacao documentada: nao pode virar predecessora
      ctx({ activityId: 'BIG', step: 'ERECTION', objectKey: 'X1', lineNumber: '36-P-9999' }),
    ]);
    expect(r.links.some((l) => l.predecessorId === 'HDR' && l.successorId === 'BR')).toBe(true);
    expect(r.links.some((l) => l.predecessorId === 'BIG')).toBe(false);
  });

  it('abre PERGUNTA quando o tronco documentado nao tem atividade', () => {
    const r = proposeSequence([
      ctx({ activityId: 'BR', step: 'ERECTION', objectKey: 'B1', lineNumber: '4-P-1001', parentLineNumber: '24-P-1000' }),
    ]);
    expect(r.links).toHaveLength(0);
    expect(r.questions[0]!.question).toMatch(/24-P-1000/);
    expect(r.questions[0]!.missingEvidence.length).toBeGreaterThan(0);
  });

  it('NAO cria vinculo por proximidade: exige interferencia documentada e elevacao', () => {
    const semEvidencia = proposeSequence([
      ctx({ activityId: 'A', step: 'ERECTION', objectKey: 'LA', area: 'A1', elevationM: 12 }),
      ctx({ activityId: 'B', step: 'ERECTION', objectKey: 'LB', area: 'A1', elevationM: 4 }),
    ]);
    expect(semEvidencia.links.some((l) => l.rationale.ruleId === 'SEQ.ACCESS_BLOCKING')).toBe(false);

    const comEvidencia = proposeSequence([
      ctx({ activityId: 'A', step: 'ERECTION', objectKey: 'LA', area: 'A1', elevationM: 12, documentedInterferences: ['LB'] }),
      ctx({ activityId: 'B', step: 'ERECTION', objectKey: 'LB', area: 'A1', elevationM: 4 }),
    ]);
    const blocking = comEvidencia.links.find((l) => l.rationale.ruleId === 'SEQ.ACCESS_BLOCKING');
    expect(blocking?.predecessorId).toBe('A');
    expect(blocking?.rationale.reason).toMatch(/Interferencia documentada/);
  });

  it('interferencia documentada sem elevacao vira PERGUNTA, nao chute', () => {
    const r = proposeSequence([
      ctx({ activityId: 'A', step: 'ERECTION', objectKey: 'LA', area: 'A1', documentedInterferences: ['LB'] }),
      ctx({ activityId: 'B', step: 'ERECTION', objectKey: 'LB', area: 'A1' }),
    ]);
    expect(r.links.some((l) => l.rationale.ruleId === 'SEQ.ACCESS_BLOCKING')).toBe(false);
    expect(r.questions.some((q) => /qual bloqueia o acesso|Qual monta primeiro/i.test(q.question))).toBe(true);
  });

  it('teste de pressao apos toda a mecanica do mesmo test pack', () => {
    const r = proposeSequence([
      ctx({ activityId: 'M1', step: 'ERECTION', objectKey: 'L1', testPackId: 'TP-01' }),
      ctx({ activityId: 'M2', step: 'WELDING', objectKey: 'L2', testPackId: 'TP-01' }),
      ctx({ activityId: 'T', step: 'PRESSURE_TEST', objectKey: 'TP-01', testPackId: 'TP-01' }),
    ]);
    expect(r.links.some((l) => l.predecessorId === 'M1' && l.successorId === 'T')).toBe(true);
    expect(r.links.some((l) => l.predecessorId === 'M2' && l.successorId === 'T')).toBe(true);
  });

  it('isolamento so apos teste', () => {
    const r = proposeSequence([
      ctx({ activityId: 'T', step: 'PRESSURE_TEST', objectKey: 'L1' }),
      ctx({ activityId: 'I', step: 'INSULATION', objectKey: 'L1' }),
    ]);
    const l = r.links.find((x) => x.rationale.ruleId === 'SEQ.INSULATION_AFTER_TEST');
    expect(l?.predecessorId).toBe('T');
    expect(l?.rationale.reason).toMatch(/impede a inspecao/);
  });

  it('regra desabilitada nao gera vinculo', () => {
    const rules = DEFAULT_RULES.map((r) => (r.id === 'SEQ.PROCESS_CHAIN' ? { ...r, enabled: false } : r));
    const r = proposeSequence([
      ctx({ activityId: 'E', step: 'ERECTION', objectKey: 'L1' }),
      ctx({ activityId: 'W', step: 'WELDING', objectKey: 'L1' }),
    ], { rules });
    expect(r.links).toHaveLength(0);
  });

  it('"Por que esta atividade vem antes?" devolve a cadeia de justificativas', () => {
    const contexts = [
      ctx({ activityId: 'E', step: 'ERECTION', objectKey: 'L1' }),
      ctx({ activityId: 'W', step: 'WELDING', objectKey: 'L1' }),
    ];
    const r = proposeSequence(contexts);
    const why = explainPredecessors('W', r.links, contexts);
    expect(why).toHaveLength(1);
    expect(why[0]!.predecessorName).toBe('E');
    expect(why[0]!.link.rationale.reason).toMatch(/precede tecnicamente/);
  });

  it('confianca do vinculo nunca supera a confianca dos contextos', () => {
    const r = proposeSequence([
      ctx({ activityId: 'E', step: 'ERECTION', objectKey: 'L1', confidence: 0.4 }),
      ctx({ activityId: 'W', step: 'WELDING', objectKey: 'L1', confidence: 0.95 }),
    ]);
    expect(r.links[0]!.rationale.confidence).toBeLessThanOrEqual(0.4);
  });
});
