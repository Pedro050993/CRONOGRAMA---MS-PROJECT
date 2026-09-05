/**
 * Importação de índices de produtividade a partir de tabela (§6, D6).
 *
 * A função é pura: recebe linhas já lidas de CSV, XLSX ou de uma tabela extraída de
 * PDF, e devolve candidatos + as linhas recusadas com o motivo.
 *
 * Regras que este módulo impõe:
 *  - unidade desconhecida derruba a linha (não há "unidade parecida");
 *  - valor não numérico derruba a linha (não há "provavelmente 1,2");
 *  - base e data, quando ausentes na planilha, têm de vir de uma DECLARAÇÃO do
 *    usuário no momento da importação — não de um padrão do sistema;
 *  - a fonte nunca fica vazia: na falta de coluna, é o próprio arquivo importado;
 *  - todo candidato nasce PENDING.
 */
import { UNITS } from '../units/index.js';
import type { EvidenceRef } from '../provenance/types.js';
import type { ImportResult, ProductivityBasis, ProductivityIndexRecord, RejectedRow } from './types.js';

/** Sinônimos aceitos por campo, em português e inglês. */
const HEADER_SYNONYMS: Record<string, string[]> = {
  code: ['codigo', 'código', 'code', 'cod', 'id', 'item'],
  description: ['descricao', 'descrição', 'description', 'servico', 'serviço', 'atividade', 'service', 'activity'],
  value: ['indice', 'índice', 'index', 'valor', 'value', 'hh', 'hh/un', 'produtividade', 'productivity', 'rate'],
  perUnit: ['unidade', 'unid', 'un', 'perunit', 'per unit', 'por unidade', 'uom', 'unit'],
  basis: ['base', 'basis', 'origem do indice', 'tipo'],
  source: ['fonte', 'source', 'referencia', 'referência', 'reference'],
  sourceDate: ['data', 'date', 'data da fonte', 'vigencia', 'vigência'],
  discipline: ['disciplina', 'discipline'],
  scopeNote: ['observacao', 'observação', 'obs', 'nota', 'note', 'remarks', 'abrangencia', 'abrangência'],
};

const BASIS_SYNONYMS: Record<string, ProductivityBasis> = {
  orcado: 'BUDGETED', orçado: 'BUDGETED', orcamento: 'BUDGETED', orçamento: 'BUDGETED', budget: 'BUDGETED', budgeted: 'BUDGETED',
  planejado: 'PLANNED', planned: 'PLANNED', plano: 'PLANNED',
  observado: 'OBSERVED', observed: 'OBSERVED', realizado: 'OBSERVED', historico: 'OBSERVED', histórico: 'OBSERVED', actual: 'OBSERVED',
  projetado: 'FORECAST', forecast: 'FORECAST', previsto: 'FORECAST', tendencia: 'FORECAST', tendência: 'FORECAST',
};

/** Apelidos usuais de unidade em planilha de obra → código do registro de unidades. */
const UNIT_ALIASES: Record<string, string> = {
  m: 'm', metro: 'm', metros: 'm', ml: 'm', 'm linear': 'm', mt: 'm',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kgs: 'kg',
  t: 't', ton: 't', tonelada: 't', toneladas: 't',
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', pc: 'pc', peca: 'un', peça: 'un', ea: 'un',
  jt: 'jt', junta: 'jt', juntas: 'jt', joint: 'jt', joints: 'jt',
  'in-dia': 'in-dia', 'pol-dia': 'in-dia', 'polegada-diametro': 'in-dia', 'polegada-diâmetro': 'in-dia',
  'pol.dia': 'in-dia', 'dia-in': 'in-dia', 'inch-dia': 'in-dia', 'di': 'in-dia',
  'in-jt': 'in-jt', 'pol-junta': 'in-jt', 'polegada-junta': 'in-jt',
  m2: 'm2', 'm²': 'm2', m3: 'm3', 'm³': 'm3',
  h: 'h', hora: 'h', horas: 'h', hh: 'hh',
};

export interface ImportOptions {
  /** Nome do arquivo de origem. Vira a fonte quando a planilha não traz coluna de fonte. */
  fileName: string;
  /** Hash do arquivo, para a fonte ser verificável. */
  fileSha256?: string;
  sheetName?: string;
  documentId?: string;
  /** Base declarada pelo usuário, usada apenas quando a planilha não a traz. */
  declaredBasis?: ProductivityBasis;
  /** Data da fonte declarada pelo usuário (YYYY-MM-DD), idem. */
  declaredSourceDate?: string;
  /** Prefixo do código gerado quando a planilha não tem coluna de código. */
  codePrefix?: string;
}

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Casamento por PALAVRA INTEIRA, nunca por substring.
 * "Índice" contém "id" — com busca por substring, a coluna do índice era lida como
 * coluna de código e o arquivo inteiro deixava de ser reconhecido.
 */
function headerMatches(cellNormalized: string, synonym: string): boolean {
  const s = normalize(synonym);
  if (cellNormalized === s) return true;
  // Sinônimo curto (id, un, hh, cod) só vale por igualdade exata: é curto demais
  // para aparecer no meio de outra palavra sem virar falso positivo.
  if (s.length <= 3) return false;
  return new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(cellNormalized);
}

/** Reconhece a linha de cabeçalho e mapeia cada campo para o índice da coluna. */
export function detectColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const taken = new Set<number>();
  // Duas passagens: primeiro os casamentos exatos, depois os por palavra inteira.
  // Assim "Índice" leva a coluna `value` antes de qualquer candidato mais frouxo.
  for (const exactOnly of [true, false]) {
    header.forEach((cell, i) => {
      const n = normalize(cell);
      if (!n || taken.has(i)) return;
      for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (map[field] !== undefined) continue;
        const hit = exactOnly
          ? synonyms.some((s) => n === normalize(s))
          : synonyms.some((s) => headerMatches(n, s));
        if (hit) {
          map[field] = i;
          taken.add(i);
          break;
        }
      }
    });
  }
  return map;
}

/** Localiza a linha de cabeçalho: a primeira que reconheça valor E unidade. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const map = detectColumns(rows[i] ?? []);
    if (map['value'] !== undefined && map['perUnit'] !== undefined) return i;
  }
  return -1;
}

/** Número em formato brasileiro ou inglês. Devolve null quando não é número. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/\s/g, '');
  if (!s) return null;
  // "1.234,56" (pt-BR) x "1,234.56" (en)
  const ptBr = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s);
  const cleaned = ptBr ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseUnit(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = normalize(raw).replace(/\.$/, '');
  if (UNITS[n]) return n;
  const alias = UNIT_ALIASES[n];
  if (alias) return alias;
  // "HH/m" ou "hh por junta": o denominador é a unidade do índice.
  const slash = n.match(/^h+\s*[/ ]\s*(.+)$/);
  if (slash?.[1]) {
    const d = slash[1].trim();
    return UNITS[d] ? d : UNIT_ALIASES[d] ?? null;
  }
  return null;
}

export function parseBasis(raw: string | undefined): ProductivityBasis | null {
  if (!raw) return null;
  return BASIS_SYNONYMS[normalize(raw)] ?? null;
}

/** Data em ISO, dd/mm/aaaa ou dd-mm-aaaa. Devolve null quando ambígua ou inválida. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    if (d > 31 || m > 12) return null;
    return `${br[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export function importProductivityRows(rows: string[][], opts: ImportOptions): ImportResult {
  const warnings: string[] = [];
  const rejected: RejectedRow[] = [];
  const candidates: ProductivityIndexRecord[] = [];
  const suppliedByUser: string[] = [];

  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) {
    return {
      candidates: [], rejected: [], columnMap: {}, suppliedByUser: [],
      warnings: [
        'Nenhuma linha de cabeçalho reconhecida. O arquivo precisa ter uma linha com, ' +
        'no mínimo, uma coluna de índice (ex.: "Índice" ou "HH") e uma de unidade ' +
        '(ex.: "Unidade"). Nenhum índice foi importado.',
      ],
    };
  }

  const header = rows[headerIndex] ?? [];
  const columnMap = detectColumns(header);

  if (columnMap['basis'] === undefined) {
    if (!opts.declaredBasis) {
      return {
        candidates: [], rejected: [], columnMap, suppliedByUser: [],
        warnings: [
          'A planilha não informa a BASE do índice (orçado, planejado, observado ou projetado) ' +
          'e nenhuma base foi declarada na importação. O sistema não adota uma por conta: ' +
          'orçado e observado não são a mesma coisa em pleito. Nenhum índice foi importado.',
        ],
      };
    }
    suppliedByUser.push('basis');
  }
  if (columnMap['sourceDate'] === undefined) {
    if (!opts.declaredSourceDate) {
      return {
        candidates: [], rejected: [], columnMap, suppliedByUser: [],
        warnings: [
          'A planilha não informa a DATA da fonte e nenhuma data foi declarada na importação. ' +
          'Um índice sem data não é defensável: não se sabe a que período ele se refere. ' +
          'Nenhum índice foi importado.',
        ],
      };
    }
    suppliedByUser.push('sourceDate');
  }
  if (columnMap['source'] === undefined) suppliedByUser.push('source');
  if (columnMap['code'] === undefined) suppliedByUser.push('code');

  const fileSource = opts.fileSha256
    ? `${opts.fileName} (SHA-256 ${opts.fileSha256.slice(0, 12)}…)`
    : opts.fileName;
  const prefix = opts.codePrefix ?? 'IDX';
  const seenCodes = new Set<string>();

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => !String(c ?? '').trim())) continue;

    const at = (field: string): string | undefined => {
      const i = columnMap[field];
      return i === undefined ? undefined : String(row[i] ?? '').trim();
    };

    const rawValue = at('value');
    const rawUnit = at('perUnit');
    const description = at('description') ?? at('code') ?? '';

    // Linha de subtotal, título de seção ou separador: sem valor e sem unidade.
    if (!rawValue && !rawUnit) continue;

    const value = parseNumber(rawValue);
    if (value === null) {
      rejected.push({ rowIndex: r + 1, raw: row, field: 'value', reason: `Índice "${rawValue ?? ''}" não é um número reconhecível. A linha não foi importada.` });
      continue;
    }
    if (!(value > 0)) {
      rejected.push({ rowIndex: r + 1, raw: row, field: 'value', reason: `Índice ${value} não é positivo. Um índice zero ou negativo não calcula duração.` });
      continue;
    }

    const perUnit = parseUnit(rawUnit);
    if (!perUnit) {
      rejected.push({
        rowIndex: r + 1, raw: row, field: 'perUnit',
        reason: `Unidade "${rawUnit ?? ''}" não está no registro de unidades do sistema. ` +
                'Nenhuma unidade parecida foi assumida: cadastre-a ou corrija a planilha.',
      });
      continue;
    }

    const basis = parseBasis(at('basis')) ?? opts.declaredBasis ?? null;
    if (!basis) {
      rejected.push({ rowIndex: r + 1, raw: row, field: 'basis', reason: `Base "${at('basis') ?? ''}" não reconhecida (esperado: orçado, planejado, observado ou projetado).` });
      continue;
    }

    const sourceDate = parseDate(at('sourceDate')) ?? opts.declaredSourceDate ?? null;
    if (!sourceDate) {
      rejected.push({ rowIndex: r + 1, raw: row, field: 'sourceDate', reason: `Data "${at('sourceDate') ?? ''}" não reconhecida (use AAAA-MM-DD ou DD/MM/AAAA).` });
      continue;
    }

    if (!description) {
      rejected.push({ rowIndex: r + 1, raw: row, field: 'description', reason: 'Linha sem descrição do serviço. Um índice sem serviço identificado não é aplicável a nenhuma atividade.' });
      continue;
    }

    let code = at('code') || `${prefix}-${String(candidates.length + 1).padStart(3, '0')}`;
    if (seenCodes.has(code)) {
      const original = code;
      let n = 2;
      while (seenCodes.has(`${original}-${n}`)) n++;
      code = `${original}-${n}`;
      warnings.push(`Código "${original}" aparece mais de uma vez no arquivo; a repetição foi renomeada para "${code}".`);
    }
    seenCodes.add(code);

    const declaredSource = at('source');
    const evidence: ProductivityIndexRecord['evidence'] = {
      documentId: opts.documentId ?? opts.fileName,
      snippet: row.filter(Boolean).join(' | ').slice(0, 300),
      ...(opts.sheetName ? { sheet: opts.sheetName } : {}),
      row: r + 1,
    } as EvidenceRef & { sheet?: string; row?: number };

    // A confiança cai quando campos essenciais vieram da declaração do usuário,
    // e não do próprio arquivo.
    const confidence = Number((1 - 0.1 * suppliedByUser.filter((f) => f === 'basis' || f === 'sourceDate').length).toFixed(2));

    candidates.push({
      code,
      description,
      value,
      perUnit,
      basis,
      source: declaredSource ? `${declaredSource} — importado de ${fileSource}` : `Importado de ${fileSource}`,
      sourceDate,
      approvalStatus: 'PENDING',
      evidence,
      confidence,
      ...(at('discipline') ? { discipline: at('discipline')! } : {}),
      ...(at('scopeNote') ? { scopeNote: at('scopeNote')! } : {}),
    });
  }

  if (candidates.length === 0 && rejected.length === 0) {
    warnings.push('Cabeçalho reconhecido, mas nenhuma linha de dados foi encontrada abaixo dele.');
  }
  if (suppliedByUser.includes('basis')) {
    warnings.push(`A base "${opts.declaredBasis}" foi declarada por você na importação, não lida do arquivo. Ela fica registrada como tal.`);
  }
  if (suppliedByUser.includes('sourceDate')) {
    warnings.push(`A data "${opts.declaredSourceDate}" foi declarada por você na importação, não lida do arquivo.`);
  }

  return { candidates, rejected, columnMap, suppliedByUser, warnings };
}
