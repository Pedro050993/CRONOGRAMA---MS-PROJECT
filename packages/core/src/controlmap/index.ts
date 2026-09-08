/**
 * Mapas de controle configuraveis por disciplina (§11).
 *
 * O status NAO e opiniao: e derivado de criterios objetivos, com regra visivel.
 * Excecao e permitida, mas exige justificativa e fica marcada como excecao.
 */
import type { Discipline } from '../quantities/types.js';

export type StageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'NOT_APPLICABLE';

export interface ControlStageDef {
  key: string;
  label: string;
  /** Peso relativo do estagio no avanco do item (soma 1 por mapa). */
  weight: number;
  /** Evidencia exigida para declarar DONE. */
  evidenceRequired: string;
  /** Estagios que precisam estar DONE antes deste. */
  requires?: string[];
}

export interface ControlMapDef {
  id: string;
  discipline: Discipline;
  name: string;
  /** Unidade de controle (junta, linha, spool, circuito, tag). */
  controlUnit: string;
  stages: ControlStageDef[];
  /** Campos exibidos como colunas fixas. */
  fields: string[];
}

/** Mapa de tubulacao conforme §11.1. Todos os pesos sao PREMISSA configuravel. */
export const PIPING_MAP: ControlMapDef = {
  id: 'MAP.PIPING.V1',
  discipline: 'PIPING',
  name: 'Mapa de controle de tubulacao',
  controlUnit: 'junta / spool / linha',
  fields: [
    'area', 'system', 'lineNumber', 'isometric', 'spool', 'joint',
    'material', 'pipeClass', 'schedule', 'nominalDiameterIn', 'quantity', 'unit',
    'supportRef', 'testPackId', 'documentId', 'documentRevision', 'responsible',
    'baseline', 'currentPlan', 'actual', 'remaining', 'trend',
    'constraint', 'evidence', 'note',
  ],
  stages: [
    { key: 'FABRICATION', label: 'Fabricacao', weight: 0.15, evidenceRequired: 'Romaneio de spool ou registro de fabricacao' },
    { key: 'ERECTION', label: 'Montagem', weight: 0.30, evidenceRequired: 'Registro de montagem com data e responsavel', requires: ['FABRICATION'] },
    { key: 'WELDING', label: 'Soldagem', weight: 0.20, evidenceRequired: 'Registro de solda com soldador e procedimento', requires: ['ERECTION'] },
    { key: 'INSPECTION', label: 'Inspecao visual', weight: 0.05, evidenceRequired: 'Relatorio de inspecao visual', requires: ['WELDING'] },
    { key: 'NDE', label: 'END', weight: 0.10, evidenceRequired: 'Laudo de ensaio nao destrutivo', requires: ['INSPECTION'] },
    { key: 'PAINTING', label: 'Pintura', weight: 0.05, evidenceRequired: 'Registro de pintura e inspecao de espessura', requires: ['NDE'] },
    { key: 'PRESSURE_TEST', label: 'Teste', weight: 0.08, evidenceRequired: 'Certificado de teste de pressao do test pack', requires: ['NDE'] },
    { key: 'REINSTATEMENT', label: 'Reinstatement', weight: 0.04, evidenceRequired: 'Registro de reinstatement', requires: ['PRESSURE_TEST'] },
    { key: 'RELEASE', label: 'Liberacao', weight: 0.03, evidenceRequired: 'Termo de liberacao assinado', requires: ['REINSTATEMENT'] },
  ],
};

export const ELECTRICAL_MAP: ControlMapDef = {
  id: 'MAP.ELECTRICAL.V1',
  discipline: 'ELECTRICAL',
  name: 'Mapa de controle eletrico',
  controlUnit: 'circuito / cabo',
  fields: ['area', 'system', 'circuit', 'cableTag', 'from', 'to', 'section', 'lengthM', 'trayRef', 'documentId', 'documentRevision', 'responsible', 'baseline', 'currentPlan', 'actual', 'remaining', 'trend', 'constraint', 'evidence'],
  stages: [
    { key: 'SUPPORTING', label: 'Suportacao', weight: 0.15, evidenceRequired: 'Registro de instalacao de suporte' },
    { key: 'ROUTING', label: 'Encaminhamento', weight: 0.20, evidenceRequired: 'Registro de bandeja/eletroduto instalado', requires: ['SUPPORTING'] },
    { key: 'PULLING', label: 'Lancamento', weight: 0.25, evidenceRequired: 'Registro de lancamento com metragem', requires: ['ROUTING'] },
    { key: 'IDENTIFICATION', label: 'Identificacao', weight: 0.05, evidenceRequired: 'Registro de anilhamento', requires: ['PULLING'] },
    { key: 'TERMINATION', label: 'Terminacoes', weight: 0.20, evidenceRequired: 'Registro de terminacao nas duas pontas', requires: ['IDENTIFICATION'] },
    { key: 'TESTS', label: 'Testes eletricos', weight: 0.10, evidenceRequired: 'Laudo de megagem/hi-pot', requires: ['TERMINATION'] },
    { key: 'ENERGIZATION', label: 'Energizacao e liberacao', weight: 0.05, evidenceRequired: 'Termo de energizacao', requires: ['TESTS'] },
  ],
};

export const INSTRUMENTATION_MAP: ControlMapDef = {
  id: 'MAP.INSTRUMENTATION.V1',
  discipline: 'INSTRUMENTATION',
  name: 'Mapa de controle de instrumentacao',
  controlUnit: 'tag / malha',
  fields: ['area', 'system', 'tag', 'loop', 'instrumentType', 'panel', 'card', 'channel', 'documentId', 'documentRevision', 'responsible', 'baseline', 'currentPlan', 'actual', 'remaining', 'trend', 'constraint', 'evidence'],
  stages: [
    { key: 'SUPPORT', label: 'Suporte', weight: 0.10, evidenceRequired: 'Registro de suporte instalado' },
    { key: 'MECHANICAL_INSTALL', label: 'Instalacao mecanica', weight: 0.20, evidenceRequired: 'Registro de instalacao do instrumento', requires: ['SUPPORT'] },
    { key: 'TUBING', label: 'Tubing', weight: 0.15, evidenceRequired: 'Registro de tubing com teste de estanqueidade', requires: ['MECHANICAL_INSTALL'] },
    { key: 'CABLE', label: 'Cabo', weight: 0.15, evidenceRequired: 'Registro de lancamento de cabo', requires: ['MECHANICAL_INSTALL'] },
    { key: 'TERMINATION', label: 'Terminacao', weight: 0.10, evidenceRequired: 'Registro de terminacao', requires: ['CABLE'] },
    { key: 'CALIBRATION', label: 'Calibracao', weight: 0.10, evidenceRequired: 'Certificado de calibracao', requires: ['MECHANICAL_INSTALL'] },
    { key: 'CONTINUITY', label: 'Continuidade', weight: 0.05, evidenceRequired: 'Registro de teste de continuidade', requires: ['TERMINATION'] },
    { key: 'LOOP_TEST', label: 'Loop test', weight: 0.10, evidenceRequired: 'Folha de loop test assinada', requires: ['CONTINUITY', 'CALIBRATION'] },
    { key: 'HANDOVER', label: 'Comissionamento e entrega', weight: 0.05, evidenceRequired: 'Termo de aceite', requires: ['LOOP_TEST'] },
  ],
};

export const DEFAULT_MAPS: ControlMapDef[] = [PIPING_MAP, ELECTRICAL_MAP, INSTRUMENTATION_MAP];

export interface StageState {
  status: StageStatus;
  completedAt?: string;
  evidenceRef?: string;
  by?: string;
  /** Excecao aprovada quando o estagio foi declarado sem a evidencia padrao. */
  exception?: { justification: string; approvedBy: string; approvedAt: string };
}

export interface ControlMapItem {
  id: string;
  mapId: string;
  controlKey: string;
  fields: Record<string, string | number | null>;
  stages: Record<string, StageState>;
  /** HH previsto do item — base de ponderacao do avanco fisico. */
  plannedHH?: number;
  actualHH?: number;
}

export type Semaphore = 'GREEN' | 'YELLOW' | 'RED' | 'GREY';

export interface ItemEvaluation {
  itemId: string;
  physicalProgress: number;
  semaphore: Semaphore;
  /** Regra que produziu o semaforo — sempre visivel (§11). */
  semaphoreRule: string;
  violations: string[];
  exceptions: string[];
}

export interface SemaphoreThresholds {
  /** Atraso em dias uteis a partir do qual fica amarelo. Padrao 3. */
  yellowDelayDays: number;
  /** Atraso a partir do qual fica vermelho. Padrao 10. */
  redDelayDays: number;
}

export const DEFAULT_THRESHOLDS: SemaphoreThresholds = { yellowDelayDays: 3, redDelayDays: 10 };

/**
 * Avalia um item: avanco ponderado, violacoes de sequencia e semaforo com regra explicita.
 * `delayDays` vem do cronograma; se ausente, o semaforo fica GREY (sem base para julgar).
 */
export function evaluateItem(
  item: ControlMapItem,
  def: ControlMapDef,
  delayDays?: number,
  thresholds: SemaphoreThresholds = DEFAULT_THRESHOLDS,
): ItemEvaluation {
  const violations: string[] = [];
  const exceptions: string[] = [];
  let progress = 0;
  let applicableWeight = 0;

  for (const stage of def.stages) {
    const st = item.stages[stage.key] ?? { status: 'NOT_STARTED' as StageStatus };
    if (st.status === 'NOT_APPLICABLE') continue;
    applicableWeight += stage.weight;
    if (st.status === 'DONE') {
      progress += stage.weight;
      if (!st.evidenceRef && !st.exception) {
        violations.push(`Estagio "${stage.label}" marcado como concluido sem a evidencia exigida (${stage.evidenceRequired}).`);
      }
      if (st.exception) {
        exceptions.push(`"${stage.label}": excecao aprovada por ${st.exception.approvedBy} — ${st.exception.justification}`);
      }
      for (const req of stage.requires ?? []) {
        const prev = item.stages[req];
        if (!prev || prev.status !== 'DONE') {
          const prevLabel = def.stages.find((s) => s.key === req)?.label ?? req;
          violations.push(`"${stage.label}" concluido antes de "${prevLabel}". A sequencia tecnica foi quebrada.`);
        }
      }
    } else if (st.status === 'IN_PROGRESS') {
      // Avanco parcial nao e arbitrado pelo sistema: sem medicao objetiva, conta zero.
      violations.push(`Estagio "${stage.label}" em andamento sem medicao objetiva. Nao contabilizado no avanco.`);
    }
  }

  const physicalProgress = applicableWeight > 0 ? Number((progress / applicableWeight).toFixed(4)) : 0;

  let semaphore: Semaphore = 'GREY';
  let rule = 'Sem dado de atraso disponivel: o sistema nao atribui cor sem base objetiva.';
  if (violations.some((v) => v.includes('sequencia tecnica foi quebrada'))) {
    semaphore = 'RED';
    rule = 'VERMELHO: sequencia tecnica quebrada (estagio concluido antes do pre-requisito).';
  } else if (typeof delayDays === 'number') {
    if (delayDays >= thresholds.redDelayDays) {
      semaphore = 'RED';
      rule = `VERMELHO: atraso de ${delayDays} dias uteis >= limite ${thresholds.redDelayDays}.`;
    } else if (delayDays >= thresholds.yellowDelayDays) {
      semaphore = 'YELLOW';
      rule = `AMARELO: atraso de ${delayDays} dias uteis entre ${thresholds.yellowDelayDays} e ${thresholds.redDelayDays}.`;
    } else {
      semaphore = 'GREEN';
      rule = `VERDE: atraso de ${delayDays} dias uteis abaixo do limite ${thresholds.yellowDelayDays}.`;
    }
  }

  return { itemId: item.id, physicalProgress, semaphore, semaphoreRule: rule, violations, exceptions };
}

/**
 * Avanco fisico do conjunto, ponderado por HH (§4.4).
 * Itens sem HH previsto sao excluidos e reportados: ponderar por contagem seria
 * tratar uma junta de 1" igual a uma de 24".
 */
export function weightedPhysicalProgress(
  items: ControlMapItem[],
  defs: Record<string, ControlMapDef>,
): { progress: number; totalHH: number; earnedHH: number; excludedItemIds: string[] } {
  let totalHH = 0;
  let earnedHH = 0;
  const excluded: string[] = [];
  for (const item of items) {
    const def = defs[item.mapId];
    if (!def) { excluded.push(item.id); continue; }
    if (!(item.plannedHH! > 0)) { excluded.push(item.id); continue; }
    const ev = evaluateItem(item, def);
    totalHH += item.plannedHH!;
    earnedHH += item.plannedHH! * ev.physicalProgress;
  }
  return {
    progress: totalHH > 0 ? Number((earnedHH / totalHH).toFixed(4)) : 0,
    totalHH: Number(totalHH.toFixed(2)),
    earnedHH: Number(earnedHH.toFixed(2)),
    excludedItemIds: excluded,
  };
}
