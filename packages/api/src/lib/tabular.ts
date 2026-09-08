/**
 * Leitura de planilha para linhas de texto.
 *
 * XLSX é ZIP + XML: usamos o `unzipit` que já está no projeto e o parser XML do
 * pacote `core`. Nenhuma dependência nova entra só para ler uma tabela.
 *
 * O que este módulo NÃO faz: interpretar fórmula. Uma célula com fórmula sem valor
 * calculado em cache vira vazia, e a linha é recusada pelo importador com motivo —
 * é melhor que devolver o texto da fórmula como se fosse número.
 */
import { unzip } from 'unzipit';
import { child, children, parseXml, type XmlNode } from '@cronograma/core';

export interface Sheet {
  name: string;
  rows: string[][];
}

/** Detecta o separador olhando a primeira linha não vazia: ';' (padrão Excel pt-BR), ',' ou tab. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const counts: [string, number][] = [
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
    [',', (line.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ';';
}

/** CSV/TSV com aspas duplas e escape por duplicação, conforme RFC 4180. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === d) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** "B3" → 1 (índice da coluna, base zero). */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOfNode(node: XmlNode | undefined): string {
  if (!node) return '';
  let out = node.text;
  for (const c of node.children) out += textOfNode(c);
  return out;
}

/** Lê as planilhas de um XLSX. Ignora estilo e formatação: só interessa o conteúdo. */
export async function parseXlsx(data: Buffer): Promise<Sheet[]> {
  const { entries } = await unzip(new Uint8Array(data).buffer as ArrayBuffer);

  const sharedStrings: string[] = [];
  const sharedEntry = entries['xl/sharedStrings.xml'];
  if (sharedEntry) {
    const root = parseXml(await sharedEntry.text());
    for (const si of children(root, 'si')) sharedStrings.push(textOfNode(si));
  }

  // Nome de cada aba, na ordem em que o Excel as declara.
  const names: string[] = [];
  const workbook = entries['xl/workbook.xml'];
  if (workbook) {
    const root = parseXml(await workbook.text());
    const sheetsNode = child(root, 'sheets');
    if (sheetsNode) for (const s of children(sheetsNode, 'sheet')) names.push(s.attrs['name'] ?? '');
  }

  const sheetPaths = Object.keys(entries)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => {
      const n = (x: string): number => Number(/sheet(\d+)\.xml$/.exec(x)?.[1] ?? 0);
      return n(a) - n(b);
    });

  const sheets: Sheet[] = [];
  for (let s = 0; s < sheetPaths.length; s++) {
    const root = parseXml(await entries[sheetPaths[s]!]!.text());
    const sheetData = child(root, 'sheetData');
    const rows: string[][] = [];
    for (const r of sheetData ? children(sheetData, 'row') : []) {
      const cells: string[] = [];
      for (const c of children(r, 'c')) {
        const idx = c.attrs['r'] ? columnIndex(c.attrs['r']) : cells.length;
        const type = c.attrs['t'];
        let value = '';
        if (type === 's') {
          const i = Number(textOfNode(child(c, 'v')));
          value = sharedStrings[i] ?? '';
        } else if (type === 'inlineStr') {
          value = textOfNode(child(c, 'is'));
        } else {
          // Numérico ou fórmula: usamos o valor em cache (<v>), nunca a fórmula (<f>).
          value = textOfNode(child(c, 'v'));
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = value.trim();
      }
      rows.push(cells);
    }
    sheets.push({ name: names[s] ?? `Planilha ${s + 1}`, rows });
  }
  return sheets;
}

/** Escolhe a aba a usar: a nomeada, ou a primeira que tenha conteúdo. */
export function pickSheet(sheets: Sheet[], preferred?: string): Sheet | null {
  if (preferred) {
    const found = sheets.find((s) => s.name.trim().toLowerCase() === preferred.trim().toLowerCase());
    if (found) return found;
  }
  return sheets.find((s) => s.rows.some((r) => r.some((c) => c.trim()))) ?? null;
}
