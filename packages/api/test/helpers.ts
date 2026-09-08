import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TEST_DB = process.env['TEST_DATABASE_URL']
  ?? 'postgresql://postgres@127.0.0.1:55432/cronograma_test?schema=public';

process.env['DATABASE_URL'] = TEST_DB;
process.env['JWT_SECRET'] = 'segredo-de-teste-0123456789abcdefghijklmnop';
process.env['STORAGE_DRIVER'] = 'fs';
process.env['STORAGE_FS_ROOT'] = mkdtempSync(join(tmpdir(), 'cronograma-storage-'));
process.env['LOG_LEVEL'] = 'silent';

/**
 * As migracoes rodam uma unica vez em `test/global-setup.ts`.
 * Mantido como no-op para os arquivos de teste continuarem legiveis.
 */
export function migrateTestDb(): void {}

export async function resetDb(): Promise<void> {
  const { prisma } = await import('../src/db.js');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function cleanupStorage(): void {
  const root = process.env['STORAGE_FS_ROOT'];
  if (root) rmSync(root, { recursive: true, force: true });
}

export interface TestUser {
  token: string;
  id: string;
  email: string;
}

export async function createOrgWithOwner(app: FastifyInstance, email = 'dono@teste.local'): Promise<TestUser> {
  const r = await app.inject({
    method: 'POST', url: '/api/auth/register-organization',
    payload: { organizationName: 'Org de Teste', name: 'Dono de Teste', email, password: 'senha-de-teste-123' },
  });
  if (r.statusCode !== 201) throw new Error(`register-organization falhou: ${r.statusCode} ${r.body}`);
  const b = r.json();
  return { token: b.token, id: b.user.id, email };
}

export async function createUser(app: FastifyInstance, owner: TestUser, email: string, name: string): Promise<TestUser> {
  const r = await app.inject({
    method: 'POST', url: '/api/users',
    headers: { authorization: `Bearer ${owner.token}` },
    payload: { name, email, password: 'senha-de-teste-123' },
  });
  if (r.statusCode !== 201) throw new Error(`criar usuario falhou: ${r.statusCode} ${r.body}`);
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email, password: 'senha-de-teste-123' },
  });
  const b = login.json();
  return { token: b.token, id: b.user.id, email };
}

export async function createProject(app: FastifyInstance, user: TestUser, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({
    method: 'POST', url: '/api/projects',
    headers: { authorization: `Bearer ${user.token}` },
    payload: {
      name: 'Obra de Teste',
      client: 'Cliente de Teste',
      contract: 'CT-TESTE-001',
      scopeSummary: 'Montagem de tubulacao para teste automatizado',
      site: 'Planta de teste',
      disciplines: ['PIPING'],
      definitionOfDone: 'Sistema liberado com termo assinado',
      contractStart: '2026-03-02T07:00:00.000Z',
      contractFinish: '2026-06-30T16:00:00.000Z',
      ...overrides,
    },
  });
  if (r.statusCode !== 201) throw new Error(`criar projeto falhou: ${r.statusCode} ${r.body}`);
  return r.json().project.id;
}

export async function addMember(app: FastifyInstance, admin: TestUser, projectId: string, userId: string, role: string): Promise<void> {
  const r = await app.inject({
    method: 'POST', url: `/api/projects/${projectId}/members`,
    headers: { authorization: `Bearer ${admin.token}` },
    payload: { userId, role },
  });
  if (r.statusCode !== 201) throw new Error(`adicionar membro falhou: ${r.statusCode} ${r.body}`);
}

/** Monta um corpo multipart simples para os testes de upload. */
export function multipart(
  files: { field: string; filename: string; content: Buffer | string; contentType?: string }[],
  fields: Record<string, string> = {},
): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----teste${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.contentType ?? 'application/octet-stream'}\r\n\r\n`,
    ));
    parts.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * Gera um ZIP minimo (metodo "store", sem compressao) para os testes de upload.
 * Evita dependencia extra so para montar fixture.
 */
export function makeZip(entries: { path: string; content: string | Buffer }[]): Buffer {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf: Buffer): number => {
    let c = -1;
    for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xff]!;
    return (c ^ -1) >>> 0;
  };

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8');
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);   // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** PDF minimo valido, para exercitar o caminho de upload sem depender de fixture externa. */
export function tinyPdf(text = 'Lista de linhas de teste'): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
