const MINUTES_PER_DAY = 480;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { timeZone: 'UTC' });
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR');
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(decimals).replace('.', ',')}%`;
}

export function daysFromMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  return fmtNum(minutes / MINUTES_PER_DAY, 1);
}

export const DISCIPLINE_LABELS: Record<string, string> = {
  PIPING: 'Tubulacao', ELECTRICAL: 'Eletrica', INSTRUMENTATION: 'Instrumentacao',
  STRUCTURAL: 'Estruturas', MECHANICAL: 'Mecanica', CIVIL: 'Civil',
  PAINTING: 'Pintura', INSULATION: 'Isolamento', COMMISSIONING: 'Comissionamento', OTHER: 'Outros',
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  CONTRACT: 'Contrato', SPECIFICATION: 'Especificacao', PID: 'P&ID', PFD: 'Fluxograma',
  LINE_LIST: 'Lista de linhas', PIPING_ISOMETRIC: 'Isometrico', PIPING_PLAN: 'Planta de tubulacao',
  PLANIMETRIC: 'Planimetrico', LOCATION_PLAN: 'Planta de locacao', MODEL_3D: 'Modelo 3D',
  MATERIAL_LIST: 'Lista de materiais', DATASHEET: 'Folha de dados', EQUIPMENT_LIST: 'Lista de equipamentos',
  SUPPORT_DRAWING: 'Desenho de suportes', STRUCTURAL_DRAWING: 'Desenho de estrutura',
  SINGLE_LINE_DIAGRAM: 'Diagrama unifilar', CABLE_ROUTING: 'Encaminhamento eletrico',
  CABLE_LIST: 'Lista de cabos', INSTRUMENT_LIST: 'Lista de instrumentos',
  AUTOMATION_ARCHITECTURE: 'Arquitetura de automacao', LOOP_DIAGRAM: 'Diagrama de malha',
  INSTALLATION_DRAWING: 'Desenho de instalacao', PROCEDURE: 'Procedimento',
  INSPECTION_PLAN: 'Plano de inspecao', COMMISSIONING_PLAN: 'Plano de comissionamento',
  EXISTING_SCHEDULE: 'Cronograma existente', UNCLASSIFIED: 'Nao classificado',
};

export const STEP_LABELS: Record<string, string> = {
  ENGINEERING_RELEASE: 'Liberacao de engenharia', MATERIAL_RELEASE: 'Liberacao de material',
  FABRICATION: 'Fabricacao', PRE_ASSEMBLY: 'Pre-montagem', CIVIL_EMBEDS: 'Embutidos civis',
  CIVIL_CLOSURE: 'Fechamento civil', STRUCTURE_ERECTION: 'Montagem de estrutura',
  SUPPORT_INSTALL: 'Instalacao de suporte', EQUIPMENT_SET: 'Posicionamento de equipamento',
  EQUIPMENT_ALIGNMENT: 'Alinhamento', ERECTION: 'Montagem', WELDING: 'Soldagem',
  VISUAL_INSPECTION: 'Inspecao visual', NDE: 'END', PWHT: 'Tratamento termico',
  PUNCH_CLEARANCE: 'Liberacao de pendencias', PRESSURE_TEST: 'Teste de pressao',
  REINSTATEMENT: 'Reinstatement', PAINTING: 'Pintura', INSULATION: 'Isolamento',
  CABLE_TRAY: 'Encaminhamento', CABLE_PULLING: 'Lancamento de cabo', TERMINATION: 'Terminacao',
  ELECTRICAL_TEST: 'Teste eletrico', ENERGIZATION: 'Energizacao',
  INSTRUMENT_INSTALL: 'Instalacao de instrumento', TUBING: 'Tubing', CALIBRATION: 'Calibracao',
  LOOP_TEST: 'Loop test', PRECOMMISSIONING: 'Precomissionamento', COMMISSIONING: 'Comissionamento',
  TURNOVER: 'Turnover',
};
