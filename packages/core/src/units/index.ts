/**
 * Registro de unidades e grandezas.
 *
 * Regra (§9): nao converter nem somar unidades diferentes sem regra e memoria de
 * calculo. Aqui isso e imposto pelo tipo e pelo erro, nao pela boa vontade de quem usa.
 */

export type Dimension =
  | 'LENGTH'
  | 'MASS'
  | 'COUNT'
  | 'JOINT'
  | 'WELD_INCH'
  | 'LABOR'
  | 'AREA'
  | 'VOLUME'
  | 'TIME';

export interface UnitDef {
  code: string;
  label: string;
  dimension: Dimension;
  /** Fator para a unidade base da grandeza. */
  toBase: number;
  base: string;
}

const U = (code: string, label: string, dimension: Dimension, toBase: number, base: string): UnitDef =>
  ({ code, label, dimension, toBase, base });

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  [
    U('m', 'metro', 'LENGTH', 1, 'm'),
    U('mm', 'milimetro', 'LENGTH', 0.001, 'm'),
    U('cm', 'centimetro', 'LENGTH', 0.01, 'm'),
    U('km', 'quilometro', 'LENGTH', 1000, 'm'),
    U('in', 'polegada', 'LENGTH', 0.0254, 'm'),
    U('kg', 'quilograma', 'MASS', 1, 'kg'),
    U('t', 'tonelada', 'MASS', 1000, 'kg'),
    U('un', 'unidade', 'COUNT', 1, 'un'),
    U('pc', 'peca', 'COUNT', 1, 'un'),
    U('jt', 'junta', 'JOINT', 1, 'jt'),
    U('in-dia', 'polegada-diametro', 'WELD_INCH', 1, 'in-dia'),
    U('in-jt', 'polegada-junta', 'WELD_INCH', 1, 'in-dia'),
    U('hh', 'homem-hora', 'LABOR', 1, 'hh'),
    U('hd', 'homem-dia', 'LABOR', 8, 'hh'),
    U('m2', 'metro quadrado', 'AREA', 1, 'm2'),
    U('m3', 'metro cubico', 'VOLUME', 1, 'm3'),
    U('h', 'hora', 'TIME', 1, 'h'),
    U('d', 'dia', 'TIME', 24, 'h'),
  ].map((u) => [u.code, u]),
);

export class IncompatibleUnitsError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(
      `Unidades incompativeis: "${from}" e "${to}" pertencem a grandezas diferentes ` +
        `(${UNITS[from]?.dimension ?? '?'} vs ${UNITS[to]?.dimension ?? '?'}). ` +
        `Converter exige uma regra explicita com memoria de calculo.`,
    );
    this.name = 'IncompatibleUnitsError';
  }
}

export class UnknownUnitError extends Error {
  constructor(code: string) {
    super(`Unidade desconhecida: "${code}". Cadastre a unidade antes de usa-la.`);
    this.name = 'UnknownUnitError';
  }
}

export function unitOf(code: string): UnitDef {
  const u = UNITS[code];
  if (!u) throw new UnknownUnitError(code);
  return u;
}

export function dimensionOf(code: string): Dimension {
  return unitOf(code).dimension;
}

/**
 * `in-jt` e `in-dia` compartilham a grandeza WELD_INCH mas NAO sao intercambiaveis
 * sem regra: polegada-junta ja considera a junta completa; polegada-diametro e o
 * somatorio de DN. Convertê-las exige regra de projeto, entao bloqueamos.
 */
const NON_INTERCHANGEABLE: ReadonlyArray<readonly [string, string]> = [['in-dia', 'in-jt']];

function blocked(a: string, b: string): boolean {
  return NON_INTERCHANGEABLE.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

export function convert(qty: number, from: string, to: string): number {
  const f = unitOf(from);
  const t = unitOf(to);
  if (f.dimension !== t.dimension) throw new IncompatibleUnitsError(from, to);
  if (blocked(from, to)) {
    throw new IncompatibleUnitsError(from, to);
  }
  return (qty * f.toBase) / t.toBase;
}

export interface Measure {
  qty: number;
  unit: string;
}

/**
 * Soma medidas. Recusa somar grandezas distintas — devolver "0" ou ignorar o
 * item incompativel seria falsificar quantitativo.
 */
export function sumMeasures(measures: Measure[], targetUnit: string): Measure {
  const target = unitOf(targetUnit);
  let total = 0;
  for (const m of measures) {
    const u = unitOf(m.unit);
    if (u.dimension !== target.dimension) throw new IncompatibleUnitsError(m.unit, targetUnit);
    total += convert(m.qty, m.unit, targetUnit);
  }
  return { qty: round(total, 6), unit: targetUnit };
}

export function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** DN nominal (polegadas) a partir de rotulos usuais de projeto. */
const DN_TABLE: Record<string, number> = {
  '15': 0.5, '20': 0.75, '25': 1, '32': 1.25, '40': 1.5, '50': 2, '65': 2.5,
  '80': 3, '90': 3.5, '100': 4, '125': 5, '150': 6, '200': 8, '250': 10,
  '300': 12, '350': 14, '400': 16, '450': 18, '500': 20, '600': 24,
  '650': 26, '700': 28, '750': 30, '800': 32, '900': 36, '1000': 40, '1200': 48,
};

/**
 * Converte rotulo de diametro em polegadas.
 * Aceita: `6"`, `6 in`, `DN150`, `150`, `1 1/2"`, `1.5`.
 * Retorna null quando nao ha certeza — o chamador deve abrir pendencia.
 */
export function parseNominalDiameterInches(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = String(label).trim().toUpperCase().replace(/\s+/g, ' ');

  const dn = s.match(/^DN\s*(\d{2,4})$/);
  if (dn?.[1]) return DN_TABLE[dn[1]] ?? null;

  const frac = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(?:"|IN|POL)?$/);
  if (frac?.[1] && frac[2] && frac[3]) {
    const d = Number(frac[3]);
    return d === 0 ? null : Number(frac[1]) + Number(frac[2]) / d;
  }
  const onlyFrac = s.match(/^(\d+)\/(\d+)\s*(?:"|IN|POL)?$/);
  if (onlyFrac?.[1] && onlyFrac[2]) {
    const d = Number(onlyFrac[2]);
    return d === 0 ? null : Number(onlyFrac[1]) / d;
  }
  const inch = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:"|IN|POL)$/);
  if (inch?.[1]) return Number(inch[1].replace(',', '.'));

  const bare = s.match(/^(\d{1,4})$/);
  if (bare?.[1]) {
    const n = Number(bare[1]);
    // Ambiguidade real: "150" pode ser DN150 (6") ou 150". Resolvemos pela tabela
    // apenas quando o numero nao e um diametro plausivel em polegadas.
    if (DN_TABLE[bare[1]] !== undefined && n > 48) return DN_TABLE[bare[1]];
    if (n <= 48) return n;
    return DN_TABLE[bare[1]] ?? null;
  }
  return null;
}
