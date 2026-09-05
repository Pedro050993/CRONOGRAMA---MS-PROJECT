import { describe, expect, it } from 'vitest';
import {
  detectColumns, findHeaderRow, importProductivityRows,
  parseBasis, parseDate, parseNumber, parseUnit,
} from '../src/productivity/import.js';
import { computeDuration } from '../src/schedule/duration.js';

const OPTS = { fileName: 'BASE-PRODUTIVIDADE-2026.xlsx', fileSha256: 'abc123def456789', codePrefix: 'IDX' };

const PLANILHA = [
  ['BASE DE PRODUTIVIDADE — TUBULACAO', '', '', '', '', ''],
  ['Emitida em 15/01/2026', '', '', '', '', ''],
  [],
  ['Codigo', 'Servico', 'Indice', 'Unidade', 'Base', 'Data'],
  ['IDX-MONT', 'Montagem de tubulacao carbono', '0,90', 'pol-dia', 'Orcado', '15/01/2026'],
  ['IDX-SOLD', 'Soldagem carbono', '1,40', 'in-dia', 'Historico', '15/01/2026'],
  ['IDX-SUP', 'Instalacao de suporte', '4,5', 'un', 'Observado', '2026-01-15'],
  ['IDX-PINT', 'Pintura', '0,35', 'm2', 'Planejado', '15/01/2026'],
];

describe('reconhecedores da importacao', () => {
  it('le numero em formato brasileiro e ingles', () => {
    expect(parseNumber('0,90')).toBe(0.9);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('4.5')).toBe(4.5);
  });

  it('devolve null em vez de chutar quando nao e numero', () => {
    expect(parseNumber('a definir')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  it('aceita apelidos usuais de unidade de obra', () => {
    expect(parseUnit('pol-dia')).toBe('in-dia');
    expect(parseUnit('Polegada-Diametro')).toBe('in-dia');
    expect(parseUnit('junta')).toBe('jt');
    expect(parseUnit('ML')).toBe('m');
    expect(parseUnit('HH/m')).toBe('m');
  });

  it('RECUSA unidade fora do registro em vez de aproximar', () => {
    expect(parseUnit('pol-diametro-equivalente')).toBeNull();
    expect(parseUnit('vara')).toBeNull();
  });

  it('mapeia base em portugues e ingles', () => {
    expect(parseBasis('Orcado')).toBe('BUDGETED');
    expect(parseBasis('historico')).toBe('OBSERVED');
    expect(parseBasis('Forecast')).toBe('FORECAST');
    expect(parseBasis('sei la')).toBeNull();
  });

  it('le data ISO e brasileira, e recusa ambigua', () => {
    expect(parseDate('2026-01-15')).toBe('2026-01-15');
    expect(parseDate('15/01/2026')).toBe('2026-01-15');
    expect(parseDate('janeiro de 2026')).toBeNull();
  });

  it('encontra o cabecalho mesmo com titulo e linhas em branco antes', () => {
    expect(findHeaderRow(PLANILHA)).toBe(3);
    const map = detectColumns(PLANILHA[3]!);
    expect(map['value']).toBe(2);
    expect(map['perUnit']).toBe(3);
    expect(map['basis']).toBe(4);
  });
});

describe('importacao de indices', () => {
  it('importa as linhas validas com fonte verificavel e evidencia da linha', () => {
    const r = importProductivityRows(PLANILHA, OPTS);
    expect(r.candidates).toHaveLength(4);

    const solda = r.candidates.find((c) => c.code === 'IDX-SOLD')!;
    expect(solda.value).toBe(1.4);
    expect(solda.perUnit).toBe('in-dia');
    expect(solda.basis).toBe('OBSERVED');
    expect(solda.sourceDate).toBe('2026-01-15');
    expect(solda.source).toContain('BASE-PRODUTIVIDADE-2026.xlsx');
    expect(solda.source).toContain('abc123def456');   // hash na fonte: verificavel
    expect(solda.evidence?.row).toBe(6);
    expect(solda.evidence?.snippet).toContain('Soldagem carbono');
  });

  it('TODO candidato nasce PENDENTE de revisao humana', () => {
    const r = importProductivityRows(PLANILHA, OPTS);
    expect(r.candidates.every((c) => c.approvalStatus === 'PENDING')).toBe(true);
  });

  it('RECUSA a linha e diz o motivo, em vez de descartar em silencio', () => {
    const comLixo = [
      ...PLANILHA,
      ['IDX-X', 'Servico com indice ilegivel', 'a definir', 'm', 'Orcado', '15/01/2026'],
      ['IDX-Y', 'Servico com unidade estranha', '2,0', 'vara', 'Orcado', '15/01/2026'],
      ['IDX-Z', 'Servico com indice zero', '0', 'm', 'Orcado', '15/01/2026'],
      ['IDX-W', '', '1,0', 'm', 'Orcado', '15/01/2026'],
    ];
    const r = importProductivityRows(comLixo, OPTS);
    expect(r.candidates).toHaveLength(4);
    expect(r.rejected).toHaveLength(4);

    const porCampo = Object.fromEntries(r.rejected.map((x) => [x.field, x.reason]));
    expect(porCampo['value']).toMatch(/não é um número reconhecível|não é positivo/);
    expect(porCampo['perUnit']).toMatch(/Nenhuma unidade parecida foi assumida/);
    expect(porCampo['description']).toMatch(/sem serviço identificado/);
    for (const rej of r.rejected) expect(rej.rowIndex).toBeGreaterThan(0);
  });

  it('ignora linha totalmente vazia sem trata-la como erro', () => {
    const r = importProductivityRows([...PLANILHA, [], ['', '', '', '', '', '']], OPTS);
    expect(r.rejected).toHaveLength(0);
    expect(r.candidates).toHaveLength(4);
  });

  it('BLOQUEIA a importacao inteira quando falta a BASE e o usuario nao a declara', () => {
    const semBase = PLANILHA.map((row, i) => (i >= 3 ? row.filter((_, c) => c !== 4) : row));
    const r = importProductivityRows(semBase, { ...OPTS });
    expect(r.candidates).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/orçado e observado não são a mesma coisa em pleito/i);
  });

  it('aceita a base declarada pelo usuario, registrando que veio dele e nao do arquivo', () => {
    const semBase = PLANILHA.map((row, i) => (i >= 3 ? row.filter((_, c) => c !== 4) : row));
    const r = importProductivityRows(semBase, { ...OPTS, declaredBasis: 'BUDGETED' });
    expect(r.candidates).toHaveLength(4);
    expect(r.suppliedByUser).toContain('basis');
    expect(r.warnings.join(' ')).toMatch(/declarada por você na importação, não lida do arquivo/);
    expect(r.candidates[0]!.confidence).toBeLessThan(1);
  });

  it('BLOQUEIA quando falta a DATA e o usuario nao a declara', () => {
    const semData = PLANILHA.map((row, i) => (i >= 3 ? row.slice(0, 5) : row));
    const r = importProductivityRows(semData, { ...OPTS });
    expect(r.candidates).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/não se sabe a que período ele se refere/i);
  });

  it('avisa e nao importa nada quando nao ha cabecalho reconhecivel', () => {
    const r = importProductivityRows([['bla', 'bla'], ['1', '2']], OPTS);
    expect(r.candidates).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/Nenhuma linha de cabeçalho reconhecida/);
  });

  it('renomeia codigo repetido em vez de sobrescrever silenciosamente', () => {
    const comRepetido = [...PLANILHA, ['IDX-SOLD', 'Soldagem inox', '2,10', 'in-dia', 'Orcado', '15/01/2026']];
    const r = importProductivityRows(comRepetido, OPTS);
    const codigos = r.candidates.map((c) => c.code);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(r.warnings.join(' ')).toMatch(/aparece mais de uma vez/);
  });

  it('gera codigo quando a planilha nao tem coluna de codigo', () => {
    const semCodigo = PLANILHA.map((row, i) => (i >= 3 ? row.slice(1) : row));
    const r = importProductivityRows(semCodigo, OPTS);
    expect(r.candidates[0]!.code).toBe('IDX-001');
    expect(r.suppliedByUser).toContain('code');
  });
});

describe('portao de aprovacao do indice importado', () => {
  const base = {
    quantity: { qty: 100, unit: 'in-dia' },
    crew: [{ resourceId: 'S', resourceName: 'Soldador', count: 4, productiveHoursPerDay: 6.5 }],
  };
  const indice = {
    value: 1.4, perUnit: 'in-dia', source: 'Importado de BASE-2026.xlsx',
    sourceDate: '2026-01-15', basis: 'OBSERVED' as const,
  };

  it('indice importado e NAO confirmado nao calcula prazo', () => {
    const r = computeDuration({ ...base, productivity: { ...indice, approvalStatus: 'PENDING' } });
    expect(r.status).toBe('NOT_CALCULABLE');
    expect(r.missing[0]!.reason).toMatch(/nao foi confirmado por um revisor/);
  });

  it('indice rejeitado tambem nao calcula', () => {
    const r = computeDuration({ ...base, productivity: { ...indice, approvalStatus: 'REJECTED' } });
    expect(r.status).toBe('NOT_CALCULABLE');
    expect(r.missing[0]!.reason).toMatch(/rejeitado na revisao/);
  });

  it('depois de aprovado, calcula normalmente', () => {
    const r = computeDuration({ ...base, productivity: { ...indice, approvalStatus: 'APPROVED' } });
    expect(r.status).toBe('CALCULATED');
    expect(r.workHH).toBe(140);
  });

  it('indice digitado direto (sem status) continua calculando', () => {
    const r = computeDuration({ ...base, productivity: indice });
    expect(r.status).toBe('CALCULATED');
  });
});
