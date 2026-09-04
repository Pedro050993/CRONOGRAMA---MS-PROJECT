import type { Link, LinkRationale } from '../network/types.js';
import { DEFAULT_RULES, STEP_ORDER } from './rules.js';
import type { ActivityContext, SequencingQuestion, SequencingResult, SequencingRule } from './types.js';

export interface SequencingOptions {
  rules?: SequencingRule[];
  /** Prefixo dos ids gerados. */
  idPrefix?: string;
}

interface Candidate {
  pred: string;
  succ: string;
  ruleId: string;
  reason: string;
  reasonKind: LinkRationale['reasonKind'];
  confidence: number;
  sourceRefs: string[];
  lagMinutes?: number;
}

/**
 * Motor de sequenciamento construtivo (§12).
 *
 * Contrato: nenhum vinculo e emitido sem (a) uma regra habilitada, (b) um motivo
 * em texto e (c) referencia documental. Quando a evidencia nao sustenta a relacao,
 * o motor emite uma PERGUNTA em vez de um vinculo.
 */
export function proposeSequence(contexts: ActivityContext[], opts: SequencingOptions = {}): SequencingResult {
  const rules = new Map((opts.rules ?? DEFAULT_RULES).filter((r) => r.enabled).map((r) => [r.id, r]));
  const prefix = opts.idPrefix ?? 'LNK';
  const candidates: Candidate[] = [];
  const questions: SequencingQuestion[] = [];

  const byObject = groupBy(contexts, (c) => c.objectKey ?? `__${c.activityId}`);
  const byArea = groupBy(contexts, (c) => c.area ?? '__sem_area');
  const bySystem = groupBy(contexts, (c) => c.commissioningSystemId ?? c.system ?? '__sem_sistema');
  const byTestPack = groupBy(contexts, (c) => c.testPackId ?? '__sem_testpack');
  const byLine = new Map<string, ActivityContext[]>();
  for (const c of contexts) if (c.lineNumber) push(byLine, c.lineNumber, c);
  const byTag = new Map<string, ActivityContext[]>();
  for (const c of contexts) if (c.tag) push(byTag, c.tag, c);

  // --- SEQ.PROCESS_CHAIN: etapas do mesmo objeto ---
  if (rules.has('SEQ.PROCESS_CHAIN')) {
    const rule = rules.get('SEQ.PROCESS_CHAIN')!;
    for (const [key, group] of byObject) {
      if (key.startsWith('__') || group.length < 2) continue;
      const sorted = [...group].sort((a, b) => (STEP_ORDER[a.step] ?? 99) - (STEP_ORDER[b.step] ?? 99));
      for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i - 1]!;
        const s = sorted[i]!;
        if ((STEP_ORDER[p.step] ?? 99) === (STEP_ORDER[s.step] ?? 99)) continue;
        candidates.push({
          pred: p.activityId, succ: s.activityId, ruleId: rule.id, reasonKind: rule.reasonKind,
          reason: `Mesmo objeto "${key}": "${stepLabel(p.step)}" precede tecnicamente "${stepLabel(s.step)}".`,
          confidence: Math.min(rule.maxConfidence, p.confidence, s.confidence),
          sourceRefs: uniq([...p.sourceRefs, ...s.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.STRUCTURE_BEFORE_SUPPORT ---
  applyRefRule(rules.get('SEQ.STRUCTURE_BEFORE_SUPPORT'), contexts, candidates, {
    successorFilter: (c) => c.step === 'SUPPORT_INSTALL',
    refsOf: (c) => c.structureRefs ?? [],
    predecessorFilter: (c) => c.step === 'STRUCTURE_ERECTION',
    keyOf: (c) => [c.objectKey, c.tag].filter(Boolean) as string[],
    reason: (p, s, ref) => `O suporte de "${s.objectKey ?? s.tag}" apoia-se na estrutura "${ref}", documentada em ${p.sourceRefs.join(', ') || 'desenho de estrutura'}.`,
  });

  // --- SEQ.SUPPORT_BEFORE_PIPING ---
  applyRefRule(rules.get('SEQ.SUPPORT_BEFORE_PIPING'), contexts, candidates, {
    successorFilter: (c) => c.step === 'ERECTION' && c.discipline === 'PIPING',
    refsOf: (c) => c.supportRefs ?? [],
    predecessorFilter: (c) => c.step === 'SUPPORT_INSTALL',
    keyOf: (c) => [c.objectKey, c.tag].filter(Boolean) as string[],
    reason: (_p, s, ref) => `A linha "${s.lineNumber ?? s.objectKey}" e sustentada pelo suporte "${ref}", vinculado no isometrico/caderno de suportes.`,
  });

  // --- SEQ.EQUIPMENT_BEFORE_CONNECTION ---
  applyRefRule(rules.get('SEQ.EQUIPMENT_BEFORE_CONNECTION'), contexts, candidates, {
    successorFilter: (c) => c.step === 'ERECTION' && (c.connectsToEquipment?.length ?? 0) > 0,
    refsOf: (c) => c.connectsToEquipment ?? [],
    predecessorFilter: (c) => c.step === 'EQUIPMENT_SET' || c.step === 'EQUIPMENT_ALIGNMENT',
    keyOf: (c) => [c.tag, c.objectKey].filter(Boolean) as string[],
    reason: (_p, s, ref) => `A linha "${s.lineNumber ?? s.objectKey}" conecta-se ao equipamento "${ref}" (origem/destino documentado). Conectar antes do equipamento posicionado gera retrabalho de ajuste.`,
  });

  // --- SEQ.HEADER_BEFORE_BRANCH (conectividade documentada, nunca diametro) ---
  const branchRule = rules.get('SEQ.HEADER_BEFORE_BRANCH');
  if (branchRule) {
    for (const c of contexts) {
      if (c.step !== 'ERECTION' || !c.parentLineNumber) continue;
      const parents = (byLine.get(c.parentLineNumber) ?? []).filter((p) => p.step === 'ERECTION');
      if (parents.length === 0) {
        questions.push({
          id: `Q-${c.activityId}-HEADER`,
          activityIds: [c.activityId],
          question: `A linha "${c.lineNumber}" deriva de "${c.parentLineNumber}", mas nao ha atividade de montagem para o tronco. O tronco esta fora do escopo ou faltou pacote?`,
          whyItMatters: 'Sem o tronco no cronograma, o ramal fica sem predecessora real e o caminho critico fica falso.',
          missingEvidence: [`Atividade de montagem da linha ${c.parentLineNumber}`],
        });
        continue;
      }
      for (const p of parents) {
        candidates.push({
          pred: p.activityId, succ: c.activityId, ruleId: branchRule.id, reasonKind: branchRule.reasonKind,
          reason: `"${c.lineNumber}" e ramal documentado de "${c.parentLineNumber}" (conectividade do P&ID / lista de linhas). A ordem NAO deriva do diametro.`,
          confidence: Math.min(branchRule.maxConfidence, p.confidence, c.confidence),
          sourceRefs: uniq([...p.sourceRefs, ...c.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.EMBEDS_BEFORE_CIVIL_CLOSURE ---
  const embedRule = rules.get('SEQ.EMBEDS_BEFORE_CIVIL_CLOSURE');
  if (embedRule) {
    for (const [area, group] of byArea) {
      if (area.startsWith('__')) continue;
      const embeds = group.filter((c) => c.step === 'CIVIL_EMBEDS');
      const closures = group.filter((c) => c.step === 'CIVIL_CLOSURE');
      for (const e of embeds) for (const cl of closures) {
        candidates.push({
          pred: e.activityId, succ: cl.activityId, ruleId: embedRule.id, reasonKind: embedRule.reasonKind,
          reason: `Embutidos/esperas da area "${area}" precedem o fechamento civil da mesma area. Fechar antes obriga demolicao.`,
          confidence: Math.min(embedRule.maxConfidence, e.confidence, cl.confidence),
          sourceRefs: uniq([...e.sourceRefs, ...cl.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.TESTPACK_AFTER_MECHANICAL ---
  const tpRule = rules.get('SEQ.TESTPACK_AFTER_MECHANICAL');
  if (tpRule) {
    const MECH: string[] = ['ERECTION', 'WELDING', 'VISUAL_INSPECTION', 'NDE', 'PWHT', 'PUNCH_CLEARANCE'];
    for (const [tp, group] of byTestPack) {
      if (tp.startsWith('__')) continue;
      const tests = group.filter((c) => c.step === 'PRESSURE_TEST');
      const mech = group.filter((c) => MECH.includes(c.step));
      for (const t of tests) for (const m of mech) {
        if (m.activityId === t.activityId) continue;
        candidates.push({
          pred: m.activityId, succ: t.activityId, ruleId: tpRule.id, reasonKind: tpRule.reasonKind,
          reason: `Test pack "${tp}": o teste de pressao so pode ocorrer apos "${stepLabel(m.step)}" de "${m.objectKey ?? m.lineNumber}", que integra o mesmo pacote de teste.`,
          confidence: Math.min(tpRule.maxConfidence, t.confidence, m.confidence),
          sourceRefs: uniq([...t.sourceRefs, ...m.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.INSULATION_AFTER_TEST ---
  const insRule = rules.get('SEQ.INSULATION_AFTER_TEST');
  if (insRule) {
    for (const [key, group] of byObject) {
      if (key.startsWith('__')) continue;
      const ins = group.filter((c) => c.step === 'INSULATION');
      const test = group.filter((c) => c.step === 'PRESSURE_TEST');
      for (const i of ins) for (const t of test) {
        candidates.push({
          pred: t.activityId, succ: i.activityId, ruleId: insRule.id, reasonKind: insRule.reasonKind,
          reason: `Isolar "${key}" antes do teste de pressao impede a inspecao de vazamento e gera retrabalho. Excecao exige aprovacao tecnica registrada.`,
          confidence: Math.min(insRule.maxConfidence, i.confidence, t.confidence),
          sourceRefs: uniq([...i.sourceRefs, ...t.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.COMMISSIONING_AFTER_TESTPACK ---
  const comRule = rules.get('SEQ.COMMISSIONING_AFTER_TESTPACK');
  if (comRule) {
    for (const [sys, group] of bySystem) {
      if (sys.startsWith('__')) continue;
      const commissioning = group.filter((c) => c.step === 'PRECOMMISSIONING' || c.step === 'COMMISSIONING');
      const tests = group.filter((c) => c.step === 'PRESSURE_TEST' || c.step === 'LOOP_TEST' || c.step === 'ELECTRICAL_TEST');
      for (const cm of commissioning) for (const t of tests) {
        candidates.push({
          pred: t.activityId, succ: cm.activityId, ruleId: comRule.id, reasonKind: comRule.reasonKind,
          reason: `Sistema de turnover "${sys}": "${stepLabel(cm.step)}" depende da conclusao de "${stepLabel(t.step)}" do mesmo sistema.`,
          confidence: Math.min(comRule.maxConfidence, cm.confidence, t.confidence),
          sourceRefs: uniq([...cm.sourceRefs, ...t.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.INSTRUMENT_PROTECTION ---
  const protRule = rules.get('SEQ.INSTRUMENT_PROTECTION');
  if (protRule) {
    for (const [area, group] of byArea) {
      if (area.startsWith('__')) continue;
      const instruments = group.filter((c) => c.step === 'INSTRUMENT_INSTALL');
      const risky = group.filter((c) => c.step === 'WELDING' || c.step === 'EQUIPMENT_SET' || c.step === 'STRUCTURE_ERECTION');
      for (const i of instruments) for (const r of risky) {
        if (!i.system || !r.system || i.system !== r.system) continue;
        candidates.push({
          pred: r.activityId, succ: i.activityId, ruleId: protRule.id, reasonKind: protRule.reasonKind,
          reason: `Area "${area}", sistema "${i.system}": instrumento "${i.tag}" e sensivel a "${stepLabel(r.step)}". Instalar depois evita dano e recalibracao.`,
          confidence: Math.min(protRule.maxConfidence, i.confidence, r.confidence),
          sourceRefs: uniq([...i.sourceRefs, ...r.sourceRefs]),
        });
      }
    }
  }

  // --- SEQ.ACCESS_BLOCKING: so com interferencia documentada ---
  const accRule = rules.get('SEQ.ACCESS_BLOCKING');
  if (accRule) {
    for (const c of contexts) {
      const interferences = c.documentedInterferences ?? [];
      if (interferences.length === 0) continue;
      for (const ref of interferences) {
        const others = contexts.filter((o) => o.activityId !== c.activityId && (o.objectKey === ref || o.lineNumber === ref || o.tag === ref));
        if (others.length === 0) {
          questions.push({
            id: `Q-${c.activityId}-CLASH-${ref}`,
            activityIds: [c.activityId],
            question: `Ha interferencia documentada entre "${c.objectKey ?? c.lineNumber}" e "${ref}", mas "${ref}" nao tem atividade no cronograma. Qual das duas monta primeiro?`,
            whyItMatters: 'Interferencia sem sequencia definida vira parada de frente em campo.',
            missingEvidence: [`Atividade correspondente a ${ref}`, 'Definicao de qual objeto monta primeiro'],
          });
          continue;
        }
        for (const o of others) {
          const [pred, succ] = decideBlockingOrder(c, o);
          if (!pred || !succ) {
            questions.push({
              id: `Q-${c.activityId}-${o.activityId}-ORDER`,
              activityIds: [c.activityId, o.activityId],
              question: `"${c.objectKey ?? c.lineNumber}" e "${o.objectKey ?? o.lineNumber}" tem interferencia documentada, mas a evidencia disponivel nao define qual bloqueia o acesso do outro. Qual monta primeiro?`,
              whyItMatters: 'Escolher pela geometria sem evidencia seria inventar precedencia.',
              missingEvidence: ['Elevacao de ambos os objetos', 'Rota de acesso de montagem', 'Nota construtiva ou clash com direcao'],
            });
            continue;
          }
          candidates.push({
            pred: pred.activityId, succ: succ.activityId, ruleId: accRule.id, reasonKind: accRule.reasonKind,
            reason: `Interferencia documentada entre "${pred.objectKey ?? pred.lineNumber}" (elev. ${pred.elevationM} m) e "${succ.objectKey ?? succ.lineNumber}" (elev. ${succ.elevationM} m). O trecho mais alto/interno monta antes porque o outro fecha o acesso.`,
            confidence: Math.min(accRule.maxConfidence, pred.confidence, succ.confidence),
            sourceRefs: uniq([...pred.sourceRefs, ...succ.sourceRefs]),
          });
        }
      }
    }
  }

  // --- SEQ.RELEASE_BEFORE_WORK ---
  const relRule = rules.get('SEQ.RELEASE_BEFORE_WORK');
  if (relRule) {
    for (const [key, group] of byObject) {
      if (key.startsWith('__')) continue;
      const releases = group.filter((c) => c.step === 'ENGINEERING_RELEASE' || c.step === 'MATERIAL_RELEASE');
      const work = group.filter((c) => (STEP_ORDER[c.step] ?? 99) > 1);
      for (const r of releases) for (const w of work) {
        candidates.push({
          pred: r.activityId, succ: w.activityId, ruleId: relRule.id, reasonKind: relRule.reasonKind,
          reason: `"${stepLabel(w.step)}" de "${key}" depende da ${r.step === 'ENGINEERING_RELEASE' ? 'liberacao de engenharia' : 'liberacao de material'} do proprio objeto.`,
          confidence: Math.min(relRule.maxConfidence, r.confidence, w.confidence),
          sourceRefs: uniq([...r.sourceRefs, ...w.sourceRefs]),
        });
      }
    }
  }

  // --- Consolidacao ---
  // Quando mais de uma regra sustenta o mesmo par, vence a de maior confianca.
  // Em empate, vence a regra MAIS ESPECIFICA: a cadeia generica de processo explica
  // menos ao planejador do que "isolar antes do teste impede a inspecao".
  // As demais justificativas nao sao descartadas: entram no texto do motivo.
  const grouped = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.pred === c.succ) continue;
    push(grouped, `${c.pred}→${c.succ}`, c);
  }

  const chosen: Candidate[] = [];
  for (const group of grouped.values()) {
    const sorted = [...group].sort(
      (a, b) => b.confidence - a.confidence || specificity(a.ruleId) - specificity(b.ruleId),
    );
    const best = { ...sorted[0]! };
    const others = sorted.slice(1).filter((o) => o.ruleId !== best.ruleId);
    if (others.length > 0) {
      best.reason += ` Tambem sustentado por: ${others.map((o) => o.reason).join(' ')}`;
      best.sourceRefs = uniq([...best.sourceRefs, ...others.flatMap((o) => o.sourceRefs)]);
    }
    chosen.push(best);
  }

  const links: Link[] = chosen.map((c, i) => ({
    id: `${prefix}-${String(i + 1).padStart(5, '0')}`,
    predecessorId: c.pred,
    successorId: c.succ,
    type: 'FS',
    lagMinutes: c.lagMinutes ?? 0,
    status: 'SUGGESTED',
    rationale: {
      reasonKind: c.reasonKind,
      reason: c.reason,
      ruleId: c.ruleId,
      sourceRefs: c.sourceRefs,
      confidence: Number(c.confidence.toFixed(3)),
    },
  }));

  const stats = new Map<string, number>();
  for (const l of links) stats.set(l.rationale.ruleId!, (stats.get(l.rationale.ruleId!) ?? 0) + 1);

  return {
    links,
    questions,
    ruleStats: [...stats.entries()].map(([ruleId, linksGenerated]) => ({ ruleId, linksGenerated })).sort((a, b) => b.linksGenerated - a.linksGenerated),
  };
}

/**
 * "Por que esta atividade vem antes?" (§12.3).
 * Devolve a cadeia de justificativas que sustenta a posicao da atividade.
 */
export function explainPredecessors(
  activityId: string,
  links: Link[],
  contexts: ActivityContext[],
): { link: Link; predecessorName: string; ruleId?: string }[] {
  const byId = new Map(contexts.map((c) => [c.activityId, c]));
  return links
    .filter((l) => l.successorId === activityId && l.status !== 'REJECTED')
    .map((l) => ({
      link: l,
      predecessorName: byId.get(l.predecessorId)?.name ?? l.predecessorId,
      ...(l.rationale.ruleId ? { ruleId: l.rationale.ruleId } : {}),
    }));
}

/** Elevacao sozinha nao decide: exige diferenca significativa E evidencia dos dois lados. */
function decideBlockingOrder(a: ActivityContext, b: ActivityContext): [ActivityContext | null, ActivityContext | null] {
  if (typeof a.elevationM !== 'number' || typeof b.elevationM !== 'number') return [null, null];
  if (Math.abs(a.elevationM - b.elevationM) < 0.5) return [null, null];
  return a.elevationM > b.elevationM ? [a, b] : [b, a];
}

interface RefRuleSpec {
  successorFilter: (c: ActivityContext) => boolean;
  refsOf: (c: ActivityContext) => string[];
  predecessorFilter: (c: ActivityContext) => boolean;
  keyOf: (c: ActivityContext) => string[];
  reason: (pred: ActivityContext, succ: ActivityContext, ref: string) => string;
}

function applyRefRule(rule: SequencingRule | undefined, contexts: ActivityContext[], out: Candidate[], spec: RefRuleSpec): void {
  if (!rule) return;
  const index = new Map<string, ActivityContext[]>();
  for (const c of contexts) {
    if (!spec.predecessorFilter(c)) continue;
    for (const k of spec.keyOf(c)) push(index, k, c);
  }
  for (const s of contexts) {
    if (!spec.successorFilter(s)) continue;
    for (const ref of spec.refsOf(s)) {
      for (const p of index.get(ref) ?? []) {
        if (p.activityId === s.activityId) continue;
        out.push({
          pred: p.activityId, succ: s.activityId, ruleId: rule.id, reasonKind: rule.reasonKind,
          reason: spec.reason(p, s, ref),
          confidence: Math.min(rule.maxConfidence, p.confidence, s.confidence),
          sourceRefs: uniq([...p.sourceRefs, ...s.sourceRefs]),
        });
      }
    }
  }
}

/** Regras genericas explicam menos; em empate de confianca, perdem para as especificas. */
const GENERIC_RULES = new Set(['SEQ.PROCESS_CHAIN', 'SEQ.RELEASE_BEFORE_WORK']);
function specificity(ruleId: string): number {
  return GENERIC_RULES.has(ruleId) ? 1 : 0;
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) push(m, key(x), x);
  return m;
}
function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const a = m.get(k) ?? [];
  a.push(v);
  m.set(k, a);
}
function uniq(a: string[]): string[] { return [...new Set(a)]; }

const STEP_LABELS: Record<string, string> = {
  ENGINEERING_RELEASE: 'liberacao de engenharia', MATERIAL_RELEASE: 'liberacao de material',
  FABRICATION: 'fabricacao', PRE_ASSEMBLY: 'pre-montagem', CIVIL_EMBEDS: 'embutidos civis',
  CIVIL_CLOSURE: 'fechamento civil', STRUCTURE_ERECTION: 'montagem de estrutura',
  SUPPORT_INSTALL: 'instalacao de suporte', EQUIPMENT_SET: 'posicionamento de equipamento',
  EQUIPMENT_ALIGNMENT: 'alinhamento de equipamento', ERECTION: 'montagem', WELDING: 'soldagem',
  VISUAL_INSPECTION: 'inspecao visual', NDE: 'END', PWHT: 'tratamento termico',
  PUNCH_CLEARANCE: 'liberacao de pendencias', PRESSURE_TEST: 'teste de pressao',
  REINSTATEMENT: 'reinstatement', PAINTING: 'pintura', INSULATION: 'isolamento',
  CABLE_TRAY: 'encaminhamento', CABLE_PULLING: 'lancamento de cabo', TERMINATION: 'terminacao',
  ELECTRICAL_TEST: 'teste eletrico', ENERGIZATION: 'energizacao',
  INSTRUMENT_INSTALL: 'instalacao de instrumento', TUBING: 'tubing', CALIBRATION: 'calibracao',
  LOOP_TEST: 'loop test', PRECOMMISSIONING: 'precomissionamento', COMMISSIONING: 'comissionamento',
  TURNOVER: 'turnover',
};
function stepLabel(s: string): string { return STEP_LABELS[s] ?? s; }
