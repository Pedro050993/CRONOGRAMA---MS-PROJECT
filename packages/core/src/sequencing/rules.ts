import type { SequencingRule } from './types.js';

/**
 * Catalogo de heuristicas (§12.2).
 *
 * Toda regra e configuravel, explicada e rejeitavel. Nenhuma e universal.
 * Observe o que NAO existe aqui: regra por diametro isolado, por ordem alfabetica
 * ou por proximidade visual. Essas foram deliberadamente omitidas (§23).
 */
export const DEFAULT_RULES: SequencingRule[] = [
  {
    id: 'SEQ.PROCESS_CHAIN',
    name: 'Cadeia de processo do mesmo objeto',
    description:
      'Etapas do mesmo objeto fisico seguem a ordem tecnica: fabricacao → montagem → soldagem → ' +
      'inspecao visual → END → PWHT → liberacao de pendencia → teste → reinstatement → pintura → isolamento. ' +
      'Vale apenas dentro do mesmo objectKey.',
    enabled: true, maxConfidence: 0.95, reasonKind: 'PROCESS',
  },
  {
    id: 'SEQ.STRUCTURE_BEFORE_SUPPORT',
    name: 'Estrutura antes do suporte que nela se apoia',
    description: 'Aplica-se somente quando o suporte referencia a estrutura em documento (caderno de suportes ou desenho).',
    enabled: true, maxConfidence: 0.9, reasonKind: 'PHYSICAL',
  },
  {
    id: 'SEQ.SUPPORT_BEFORE_PIPING',
    name: 'Suporte antes da linha que ele sustenta',
    description: 'Aplica-se somente quando o isometrico ou caderno de suportes vincula o suporte a linha.',
    enabled: true, maxConfidence: 0.9, reasonKind: 'PHYSICAL',
  },
  {
    id: 'SEQ.EQUIPMENT_BEFORE_CONNECTION',
    name: 'Equipamento posicionado antes da conexao final',
    description: 'Exige que a lista de linhas ou o P&ID documente equipamento/bocal de origem ou destino.',
    enabled: true, maxConfidence: 0.85, reasonKind: 'PHYSICAL',
  },
  {
    id: 'SEQ.HEADER_BEFORE_BRANCH',
    name: 'Tronco antes do ramal',
    description:
      'Usa a conectividade documentada (origem/destino do P&ID ou lista de linhas), NAO o diametro. ' +
      'Sem conectividade documentada, a regra nao gera vinculo: gera pergunta.',
    enabled: true, maxConfidence: 0.8, reasonKind: 'PROCESS',
  },
  {
    id: 'SEQ.EMBEDS_BEFORE_CIVIL_CLOSURE',
    name: 'Embutidos e esperas antes do fechamento civil',
    description: 'Sleeves, inserts e esperas na mesma area precedem o fechamento civil daquela area.',
    enabled: true, maxConfidence: 0.9, reasonKind: 'PHYSICAL',
  },
  {
    id: 'SEQ.TESTPACK_AFTER_MECHANICAL',
    name: 'Test pack apos conclusao mecanica do pacote',
    description: 'Teste de pressao so apos montagem, soldagem, inspecao e END de TODAS as linhas do test pack.',
    enabled: true, maxConfidence: 0.95, reasonKind: 'QUALITY',
  },
  {
    id: 'SEQ.INSULATION_AFTER_TEST',
    name: 'Isolamento apos teste e liberacao',
    description: 'Isolar antes do teste inviabiliza a inspecao. Excecao tecnica exige aprovacao registrada.',
    enabled: true, maxConfidence: 0.95, reasonKind: 'QUALITY',
  },
  {
    id: 'SEQ.INSTRUMENT_PROTECTION',
    name: 'Instrumento sensivel apos atividade mecanica de risco',
    description:
      'Instalacao de instrumento sensivel na mesma area ocorre apos as atividades mecanicas de maior risco. ' +
      'Exige que area e sistema estejam documentados nos dois lados.',
    enabled: true, maxConfidence: 0.7, reasonKind: 'SAFETY',
  },
  {
    id: 'SEQ.COMMISSIONING_AFTER_TESTPACK',
    name: 'Comissionamento do sistema apos os test packs do sistema',
    description: 'Sequencia de turnover: test packs → precomissionamento → comissionamento → turnover.',
    enabled: true, maxConfidence: 0.9, reasonKind: 'PROCESS',
  },
  {
    id: 'SEQ.ACCESS_BLOCKING',
    name: 'Trecho que bloqueia acesso antes do que fecha o espaco',
    description:
      'So gera vinculo com interferencia DOCUMENTADA (clash report ou nota construtiva) entre os dois objetos. ' +
      'Elevacao e proximidade sozinhas nao bastam: geram pergunta, nunca vinculo.',
    enabled: true, maxConfidence: 0.6, reasonKind: 'PHYSICAL',
  },
  {
    id: 'SEQ.RELEASE_BEFORE_WORK',
    name: 'Liberacao de engenharia e material antes da execucao',
    description: 'Nenhuma atividade de campo do objeto comeca antes da liberacao de projeto e material do proprio objeto.',
    enabled: true, maxConfidence: 0.9, reasonKind: 'OPERATIONAL',
  },
];

/** Ordem tecnica das etapas dentro de um mesmo objeto. Menor indice = mais cedo. */
export const STEP_ORDER: Record<string, number> = {
  ENGINEERING_RELEASE: 0, MATERIAL_RELEASE: 1, FABRICATION: 2, PRE_ASSEMBLY: 3,
  CIVIL_EMBEDS: 4, STRUCTURE_ERECTION: 5, CIVIL_CLOSURE: 6, SUPPORT_INSTALL: 7,
  EQUIPMENT_SET: 8, EQUIPMENT_ALIGNMENT: 9, ERECTION: 10, WELDING: 11,
  VISUAL_INSPECTION: 12, NDE: 13, PWHT: 14, PUNCH_CLEARANCE: 15,
  CABLE_TRAY: 16, CABLE_PULLING: 17, INSTRUMENT_INSTALL: 18, TUBING: 19,
  TERMINATION: 20, PRESSURE_TEST: 21, ELECTRICAL_TEST: 22, CALIBRATION: 23,
  LOOP_TEST: 24, REINSTATEMENT: 25, PAINTING: 26, INSULATION: 27,
  ENERGIZATION: 28, PRECOMMISSIONING: 29, COMMISSIONING: 30, TURNOVER: 31,
};
