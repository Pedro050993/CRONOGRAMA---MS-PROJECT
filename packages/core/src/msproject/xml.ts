/**
 * Serializador e parser XML minimos para o subconjunto MSPDI.
 *
 * Por que nao usar uma biblioteca: o pacote `core` e proposital e integralmente
 * livre de dependencias, para que a regra de negocio seja auditavel e reproduzivel.
 * O subconjunto exigido pelo MSPDI (elementos, texto, entidades, CDATA, comentario,
 * declaracao) e pequeno e esta coberto por teste.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * Remove caracteres proibidos em XML 1.0 (controles fora de TAB/LF/CR e nao-caracteres).
 * Acentuacao e preservada: o problema de acentuacao em MSPDI e de codificacao,
 * nao de conteudo, e o arquivo sai em UTF-8 declarado.
 */
const INVALID_XML_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');
export function sanitizeXmlText(s: string): string {
  return s.replace(INVALID_XML_CHARS, '');
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export class XmlParseError extends Error {
  constructor(message: string, readonly position: number) {
    super(`${message} (posicao ${position})`);
    this.name = 'XmlParseError';
  }
}

export function parseXml(input: string): XmlNode {
  let i = 0;
  const n = input.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const skipWs = (): void => { while (i < n && /\s/.test(input[i]!)) i++; };

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) break;

    if (stack.length > 0 && lt > i) {
      stack[stack.length - 1]!.text += unescapeXml(input.slice(i, lt));
    }
    i = lt;

    if (input.startsWith('<?', i)) { const e = input.indexOf('?>', i); if (e === -1) throw new XmlParseError('Declaracao XML nao fechada', i); i = e + 2; continue; }
    if (input.startsWith('<!--', i)) { const e = input.indexOf('-->', i); if (e === -1) throw new XmlParseError('Comentario nao fechado', i); i = e + 3; continue; }
    if (input.startsWith('<![CDATA[', i)) {
      const e = input.indexOf(']]>', i);
      if (e === -1) throw new XmlParseError('CDATA nao fechado', i);
      if (stack.length > 0) stack[stack.length - 1]!.text += input.slice(i + 9, e);
      i = e + 3; continue;
    }
    if (input.startsWith('<!', i)) { const e = input.indexOf('>', i); if (e === -1) throw new XmlParseError('Declaracao nao fechada', i); i = e + 1; continue; }

    if (input.startsWith('</', i)) {
      const e = input.indexOf('>', i);
      if (e === -1) throw new XmlParseError('Tag de fechamento nao fechada', i);
      const name = input.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top) throw new XmlParseError(`Fechamento sem abertura: </${name}>`, i);
      if (top.name !== name) throw new XmlParseError(`Tag mal aninhada: esperava </${top.name}>, veio </${name}>`, i);
      i = e + 1;
      continue;
    }

    i++;
    const start = i;
    while (i < n && !/[\s/>]/.test(input[i]!)) i++;
    const name = input.slice(start, i);
    if (!name) throw new XmlParseError('Nome de elemento vazio', start);

    const attrs: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (i >= n) throw new XmlParseError('Tag nao fechada', start);
      if (input[i] === '>' || input.startsWith('/>', i)) break;
      const aStart = i;
      while (i < n && !/[\s=/>]/.test(input[i]!)) i++;
      const aName = input.slice(aStart, i);
      skipWs();
      if (input[i] === '=') {
        i++; skipWs();
        const q = input[i];
        if (q !== '"' && q !== "'") throw new XmlParseError(`Valor de atributo sem aspas em "${aName}"`, i);
        i++;
        const vStart = i;
        while (i < n && input[i] !== q) i++;
        attrs[aName] = unescapeXml(input.slice(vStart, i));
        i++;
      } else attrs[aName] = '';
    }

    const selfClosing = input.startsWith('/>', i);
    i += selfClosing ? 2 : 1;

    const node: XmlNode = { name, attrs, children: [], text: '' };
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node);
    else if (root) throw new XmlParseError('Documento com mais de um elemento raiz', start);
    else root = node;
    if (!selfClosing) stack.push(node);
  }

  if (stack.length > 0) throw new XmlParseError(`Elemento nao fechado: <${stack[stack.length - 1]!.name}>`, n);
  if (!root) throw new XmlParseError('Documento XML sem elemento raiz', 0);
  return root;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}
export function textOf(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const c = child(node, name);
  return c ? c.text.trim() : undefined;
}
export function numOf(node: XmlNode | undefined, name: string): number | undefined {
  const t = textOf(node, name);
  if (t === undefined || t === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** Construtor de XML com indentacao previsivel. */
export class XmlWriter {
  private parts: string[] = [];
  private depth = 0;
  constructor(private readonly indentStr = '  ') {}

  decl(): this { this.parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'); return this; }

  open(name: string, attrs: Record<string, string> = {}): this {
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
    this.parts.push(`${this.pad()}<${name}${a}>`);
    this.depth++;
    return this;
  }
  close(name: string): this { this.depth--; this.parts.push(`${this.pad()}</${name}>`); return this; }

  leaf(name: string, value: string | number | undefined | null): this {
    if (value === undefined || value === null || value === '') return this;
    this.parts.push(`${this.pad()}<${name}>${escapeXml(sanitizeXmlText(String(value)))}</${name}>`);
    return this;
  }
  toString(): string { return this.parts.join('\n') + '\n'; }
  private pad(): string { return this.indentStr.repeat(this.depth); }
}
