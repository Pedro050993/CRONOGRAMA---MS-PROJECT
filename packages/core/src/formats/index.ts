/**
 * Suporte por formato — e, principalmente, a declaracao honesta do que NAO e suportado.
 *
 * §23: nao afirmar que le DWG ou NWD sem um pipeline real. Aqui a limitacao e um
 * valor de retorno, nao uma omissao.
 */
export type FormatSupportLevel = 'SUPPORTED' | 'REQUIRES_EXTERNAL_SERVICE' | 'UNSUPPORTED';

export interface FormatSupport {
  extension: string;
  label: string;
  level: FormatSupportLevel;
  phase: 1 | 2 | 3 | 4;
  /** Mensagem exibida ao usuario quando o arquivo nao pode ser processado. */
  blockedMessage?: string;
  /** Formatos alternativos tecnicamente adequados. */
  alternatives?: string[];
  adapter?: 'ocr' | 'cad' | 'model';
}

export const FORMAT_SUPPORT: FormatSupport[] = [
  { extension: 'pdf', label: 'PDF (vetorial ou digitalizado)', level: 'SUPPORTED', phase: 1 },
  { extension: 'png', label: 'Imagem PNG', level: 'SUPPORTED', phase: 1 },
  { extension: 'jpg', label: 'Imagem JPEG', level: 'SUPPORTED', phase: 1 },
  { extension: 'jpeg', label: 'Imagem JPEG', level: 'SUPPORTED', phase: 1 },
  { extension: 'tif', label: 'Imagem TIFF', level: 'SUPPORTED', phase: 1 },
  { extension: 'tiff', label: 'Imagem TIFF', level: 'SUPPORTED', phase: 1 },
  { extension: 'xlsx', label: 'Planilha Excel', level: 'SUPPORTED', phase: 1 },
  { extension: 'csv', label: 'CSV', level: 'SUPPORTED', phase: 1 },
  { extension: 'xml', label: 'XML do MS Project (MSPDI)', level: 'SUPPORTED', phase: 1 },
  {
    extension: 'dxf', label: 'CAD 2D — DXF', level: 'REQUIRES_EXTERNAL_SERVICE', phase: 2, adapter: 'cad',
    blockedMessage:
      'Leitura de DXF entra na Fase 2. O arquivo foi armazenado integro e versionado, mas ainda nao ha extracao de layers, blocos e coordenadas. ' +
      'Para avancar agora, envie o PDF vetorial correspondente.',
    alternatives: ['PDF vetorial'],
  },
  {
    extension: 'dwg', label: 'CAD 2D — DWG (proprietario)', level: 'REQUIRES_EXTERNAL_SERVICE', phase: 2, adapter: 'cad',
    blockedMessage:
      'DWG e formato proprietario e NAO pode ser lido no navegador nem por este servidor sem um conversor licenciado (ODA File Converter ou Autodesk APS), ' +
      'que ainda nao esta configurado neste ambiente. O arquivo foi armazenado integro e versionado, mas nao foi interpretado. ' +
      'Envie DXF, DWF ou PDF vetorial para prosseguir sem esperar a Fase 2.',
    alternatives: ['DXF', 'DWF', 'PDF vetorial'],
  },
  {
    extension: 'nwd', label: 'Modelo Navisworks — NWD (proprietario)', level: 'REQUIRES_EXTERNAL_SERVICE', phase: 3, adapter: 'model',
    blockedMessage:
      'NWD e formato proprietario da Autodesk e nao tem leitura nativa em HTML nem neste servidor. ' +
      'A extracao exige servico autorizado de derivacao (Autodesk APS Model Derivative), previsto para a Fase 3 e ainda nao configurado. ' +
      'O arquivo foi armazenado integro. Para obter arvore, propriedades e quantitativos agora, envie IFC, ou exportacoes estruturadas do modelo (CSV de propriedades, relatorio de clash).',
    alternatives: ['IFC', 'CSV de propriedades exportado do Navisworks', 'Relatorio de clash em XML/HTML'],
  },
  {
    extension: 'nwc', label: 'Modelo Navisworks — NWC (proprietario)', level: 'REQUIRES_EXTERNAL_SERVICE', phase: 3, adapter: 'model',
    blockedMessage:
      'NWC e formato proprietario de cache do Navisworks, sem leitura nativa. Exige servico autorizado de derivacao (Fase 3). ' +
      'O arquivo foi armazenado integro. Envie IFC ou exportacoes estruturadas para prosseguir.',
    alternatives: ['IFC', 'NWD com derivacao configurada', 'CSV de propriedades'],
  },
  {
    extension: 'ifc', label: 'Modelo IFC', level: 'REQUIRES_EXTERNAL_SERVICE', phase: 3, adapter: 'model',
    blockedMessage: 'Leitura de IFC entra na Fase 3. O arquivo foi armazenado integro e versionado.',
    alternatives: ['CSV de propriedades'],
  },
];

const BY_EXT = new Map(FORMAT_SUPPORT.map((f) => [f.extension, f]));

export function supportFor(fileName: string): FormatSupport {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  return (
    BY_EXT.get(ext) ?? {
      extension: ext,
      label: `Formato .${ext}`,
      level: 'UNSUPPORTED',
      phase: 4,
      blockedMessage:
        `O formato ".${ext}" nao esta na lista de formatos previamente configurados. ` +
        'O arquivo foi armazenado integro e versionado, mas nao foi interpretado. ' +
        'Cadastre o formato na administracao ou envie PDF, imagem, XLSX ou CSV.',
      alternatives: ['PDF', 'PNG/JPG/TIFF', 'XLSX', 'CSV'],
    }
  );
}

export function isProcessableNow(fileName: string): boolean {
  return supportFor(fileName).level === 'SUPPORTED';
}
