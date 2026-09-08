/**
 * EAP e estrutura AWP (§10).
 *
 * Diferenciacao imposta pelo tipo: CWA (area de construcao), CWP (pacote por
 * disciplina/sistema) e IWP (pacote executavel em campo) sao niveis distintos.
 * O sistema recusa hierarquias que os confundam.
 */
import type { Discipline } from '../quantities/types.js';

export type WbsNodeType = 'PROJECT' | 'PHASE' | 'CWA' | 'CWP' | 'IWP' | 'ACTIVITY';

/** Hierarquia permitida: pai → filhos validos. */
const ALLOWED_CHILDREN: Record<WbsNodeType, WbsNodeType[]> = {
  PROJECT: ['PHASE', 'CWA'],
  PHASE: ['CWA'],
  CWA: ['CWP'],
  CWP: ['IWP', 'ACTIVITY'],
  IWP: ['ACTIVITY'],
  ACTIVITY: [],
};

export interface AcceptanceCriterion {
  description: string;
  evidenceRequired: string;
}

export interface WbsNode {
  id: string;
  parentId: string | null;
  type: WbsNodeType;
  /** Codigo unico e estavel. Nunca reaproveitado apos exclusao. */
  code: string;
  name: string;
  discipline?: Discipline;
  area?: string;
  system?: string;
  subsystem?: string;
  /** Limites do pacote: o que esta dentro e o que esta fora. */
  scopeIn?: string;
  scopeOut?: string;
  deliverable?: string;
  quantity?: { qty: number; unit: string };
  documentIds?: string[];
  crewRef?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  /** Ordem entre irmaos. */
  sortIndex: number;
  /** Rastreabilidade ate a origem do escopo. */
  quantityItemIds?: string[];
}

export class WbsStructureError extends Error {
  constructor(message: string, readonly nodeId?: string) { super(message); this.name = 'WbsStructureError'; }
}

export interface WbsValidationIssue {
  nodeId: string;
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

/** Valida a arvore inteira. Erros impedem a geracao de cronograma aprovado. */
export function validateWbs(nodes: WbsNode[]): WbsValidationIssue[] {
  const issues: WbsValidationIssue[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const codes = new Map<string, string[]>();

  for (const n of nodes) {
    const arr = codes.get(n.code) ?? [];
    arr.push(n.id);
    codes.set(n.code, arr);
  }
  for (const [code, ids] of codes) {
    if (ids.length > 1) {
      for (const id of ids) {
        issues.push({ nodeId: id, code: 'WBS_DUPLICATE_CODE', severity: 'ERROR', message: `Codigo de EAP "${code}" repetido em ${ids.length} nos. Cada codigo deve ser unico e estavel.` });
      }
    }
  }

  const roots = nodes.filter((n) => n.parentId === null);
  if (roots.length === 0 && nodes.length > 0) {
    issues.push({ nodeId: nodes[0]!.id, code: 'WBS_NO_ROOT', severity: 'ERROR', message: 'A EAP nao possui no raiz.' });
  }
  if (roots.length > 1) {
    for (const r of roots) issues.push({ nodeId: r.id, code: 'WBS_MULTIPLE_ROOTS', severity: 'ERROR', message: 'A EAP possui mais de um no raiz.' });
  }

  for (const n of nodes) {
    if (n.parentId !== null) {
      const p = byId.get(n.parentId);
      if (!p) {
        issues.push({ nodeId: n.id, code: 'WBS_ORPHAN', severity: 'ERROR', message: `No "${n.code}" referencia pai inexistente.` });
        continue;
      }
      if (!ALLOWED_CHILDREN[p.type].includes(n.type)) {
        issues.push({
          nodeId: n.id, code: 'WBS_INVALID_NESTING', severity: 'ERROR',
          message: `"${n.type}" nao pode ser filho de "${p.type}". CWA, CWP e IWP sao niveis distintos e nao podem ser confundidos (§10).`,
        });
      }
    }
    if (n.type === 'IWP') {
      if (!n.deliverable?.trim()) issues.push({ nodeId: n.id, code: 'IWP_NO_DELIVERABLE', severity: 'ERROR', message: `IWP "${n.code}" sem entregavel verificavel.` });
      if (!n.quantity) issues.push({ nodeId: n.id, code: 'IWP_NO_QUANTITY', severity: 'ERROR', message: `IWP "${n.code}" sem quantidade e unidade.` });
      if (!n.acceptanceCriteria?.length) issues.push({ nodeId: n.id, code: 'IWP_NO_ACCEPTANCE', severity: 'WARNING', message: `IWP "${n.code}" sem criterios de aceite.` });
      if (!n.scopeOut?.trim()) issues.push({ nodeId: n.id, code: 'IWP_NO_BOUNDARY', severity: 'WARNING', message: `IWP "${n.code}" sem limite declarado (o que NAO faz parte). Pacote sem fronteira esconde interface.` });
    }
    if (n.type === 'CWP' && !n.discipline) {
      issues.push({ nodeId: n.id, code: 'CWP_NO_DISCIPLINE', severity: 'ERROR', message: `CWP "${n.code}" sem disciplina. CWP e pacote por disciplina/sistema.` });
    }
    if (n.type === 'CWA' && !n.area?.trim()) {
      issues.push({ nodeId: n.id, code: 'CWA_NO_AREA', severity: 'ERROR', message: `CWA "${n.code}" sem area fisica. CWA e area de construcao.` });
    }
  }

  const cycles = detectWbsCycle(nodes);
  for (const id of cycles) issues.push({ nodeId: id, code: 'WBS_CYCLE', severity: 'ERROR', message: 'Ciclo na hierarquia da EAP.' });

  return issues;
}

function detectWbsCycle(nodes: WbsNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bad: string[] = [];
  for (const n of nodes) {
    const seen = new Set<string>([n.id]);
    let cur = n.parentId;
    let guard = 0;
    while (cur && guard++ < nodes.length + 1) {
      if (seen.has(cur)) { bad.push(n.id); break; }
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return bad;
}

export interface OutlinedNode extends WbsNode {
  /** "1.2.3" — usado no MS Project como WBS e OutlineNumber. */
  outlineNumber: string;
  outlineLevel: number;
  path: string[];
}

/** Calcula OutlineNumber/OutlineLevel em ordem hierarquica (pre-ordem). */
export function buildOutline(nodes: WbsNode[]): OutlinedNode[] {
  const issues = validateWbs(nodes).filter((i) => i.severity === 'ERROR');
  if (issues.length > 0) {
    throw new WbsStructureError(`EAP invalida: ${issues.map((i) => i.message).join(' | ')}`);
  }
  const children = new Map<string | null, WbsNode[]>();
  for (const n of nodes) {
    const arr = children.get(n.parentId) ?? [];
    arr.push(n);
    children.set(n.parentId, arr);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.sortIndex - b.sortIndex || a.code.localeCompare(b.code));

  const out: OutlinedNode[] = [];
  const walk = (parentId: string | null, prefix: string, level: number, path: string[]): void => {
    const kids = children.get(parentId) ?? [];
    kids.forEach((n, i) => {
      const outlineNumber = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.push({ ...n, outlineNumber, outlineLevel: level, path: [...path, n.name] });
      walk(n.id, outlineNumber, level + 1, [...path, n.name]);
    });
  };
  walk(null, '', 1, []);
  return out;
}

/**
 * Gera codigo de EAP estavel a partir do caminho semantico.
 * Estavel = nao muda quando um irmao e inserido antes, ao contrario do OutlineNumber.
 */
export function stableCode(parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('.');
}

/** Reorganizacao manual com analise de impacto (§10). */
export interface MoveImpact {
  ok: boolean;
  errors: string[];
  affectedDescendants: string[];
  outlineChanges: { nodeId: string; from: string; to: string }[];
}

export function analyzeMove(nodes: WbsNode[], nodeId: string, newParentId: string | null, newSortIndex: number): MoveImpact {
  const before = buildOutline(nodes);
  const beforeMap = new Map(before.map((n) => [n.id, n.outlineNumber]));
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, errors: [`No "${nodeId}" nao encontrado.`], affectedDescendants: [], outlineChanges: [] };

  const moved = nodes.map((n) => (n.id === nodeId ? { ...n, parentId: newParentId, sortIndex: newSortIndex } : n));
  const errors = validateWbs(moved).filter((i) => i.severity === 'ERROR').map((i) => i.message);
  if (errors.length > 0) return { ok: false, errors, affectedDescendants: [], outlineChanges: [] };

  const after = buildOutline(moved);
  const changes = after
    .filter((n) => beforeMap.get(n.id) !== n.outlineNumber)
    .map((n) => ({ nodeId: n.id, from: beforeMap.get(n.id) ?? '(novo)', to: n.outlineNumber }));

  const descendants: string[] = [];
  const collect = (id: string): void => {
    for (const n of moved) if (n.parentId === id) { descendants.push(n.id); collect(n.id); }
  };
  collect(nodeId);

  return { ok: true, errors: [], affectedDescendants: descendants, outlineChanges: changes };
}
