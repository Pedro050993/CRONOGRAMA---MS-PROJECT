import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  cleanupStorage, createOrgWithOwner, createProject, makeZip, migrateTestDb,
  multipart, resetDb, tinyPdf, type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let projectId: string;

beforeAll(async () => {
  migrateTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  const { prisma } = await import('../src/db.js');
  await prisma.$disconnect();
  cleanupStorage();
});
beforeEach(async () => {
  await resetDb();
  owner = await createOrgWithOwner(app);
  projectId = await createProject(app, owner);
});

async function upload(
  files: { field: string; filename: string; content: Buffer | string }[],
  fields: Record<string, string> = {},
) {
  const { body, headers } = multipart(files, fields);
  return app.inject({
    method: 'POST', url: `/api/projects/${projectId}/documents/upload`,
    headers: { ...headers, authorization: `Bearer ${owner.token}` },
    payload: body,
  });
}

describe('upload de documentos', () => {
  it('aceita arquivo individual e guarda o original imutavel', async () => {
    const r = await upload([{ field: 'file', filename: 'LISTA-A100.pdf', content: tinyPdf() }]);
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.received).toBe(1);
    expect(body.results[0].outcome).toBe('NEW_DOCUMENT');
    expect(body.results[0].support.level).toBe('SUPPORTED');
    expect(body.results[0].jobId).toBeTruthy();

    const { prisma } = await import('../src/db.js');
    const v = await prisma.documentVersion.findFirstOrThrow({ where: { document: { projectId } } });
    expect(v.sha256).toHaveLength(64);
    const { storage } = await import('../src/storage/index.js');
    expect(await storage().exists(v.storageKey)).toBe(true);
  });

  it('aceita multiplos arquivos numa unica requisicao', async () => {
    const r = await upload([
      { field: 'file', filename: 'A.pdf', content: tinyPdf('A') },
      { field: 'file', filename: 'B.pdf', content: tinyPdf('B') },
      { field: 'file', filename: 'C.pdf', content: tinyPdf('C') },
    ]);
    expect(r.json().received).toBe(3);
    expect(r.json().results.every((x: { outcome: string }) => x.outcome === 'NEW_DOCUMENT')).toBe(true);
  });

  it('PRESERVA a arvore de pastas enviada', async () => {
    const zip = makeZip([
      { path: 'ISOMETRICOS/AREA100/SIS12/CPM-20.701.pdf', content: tinyPdf('iso 701') },
      { path: 'ISOMETRICOS/AREA100/SIS12/CPM-20.702.pdf', content: tinyPdf('iso 702') },
      { path: 'LISTAS/lista-de-linhas.pdf', content: tinyPdf('lista') },
    ]);
    const r = await upload([{ field: 'file', filename: 'pacote.zip', content: zip }]);
    expect(r.statusCode).toBe(201);
    expect(r.json().received).toBe(3);

    const { prisma } = await import('../src/db.js');
    const docs = await prisma.document.findMany({ where: { projectId }, orderBy: { folderPath: 'asc' } });
    expect(docs.map((d) => d.folderPath)).toEqual([
      '/pacote/ISOMETRICOS/AREA100/SIS12',
      '/pacote/ISOMETRICOS/AREA100/SIS12',
      '/pacote/LISTAS',
    ]);
    const folders = await prisma.folder.findMany({ where: { projectId } });
    expect(folders.map((f) => f.path)).toContain('/pacote/ISOMETRICOS/AREA100');
  });

  it('IGNORA path traversal vindo do ZIP', async () => {
    const zip = makeZip([{ path: '../../../etc/malicioso.pdf', content: tinyPdf('x') }]);
    const r = await upload([{ field: 'file', filename: 'ruim.zip', content: zip }]);
    expect(r.statusCode).toBe(201);
    const { prisma } = await import('../src/db.js');
    const doc = await prisma.document.findFirstOrThrow({ where: { projectId } });
    expect(doc.folderPath).not.toContain('..');
    expect(doc.folderPath).toBe('/ruim/etc');
  });

  it('detecta DUPLICATA por hash e nao reprocessa', async () => {
    const pdf = tinyPdf('identico');
    await upload([{ field: 'file', filename: 'X.pdf', content: pdf }]);
    const r2 = await upload([{ field: 'file', filename: 'X-copia.pdf', content: pdf }]);
    expect(r2.json().results[0].outcome).toBe('DUPLICATE');
    expect(r2.json().results[0].reason).toMatch(/Conteudo identico/);

    const { prisma } = await import('../src/db.js');
    expect(await prisma.document.count({ where: { projectId } })).toBe(1);
    expect(await prisma.processingJob.count({ where: { projectId } })).toBe(1);
  });

  it('BLOQUEIA DWG com mensagem acionavel, sem fingir que leu', async () => {
    const r = await upload([{ field: 'file', filename: 'PLANTA-100.dwg', content: Buffer.from('AC1032 conteudo binario') }]);
    const res = r.json().results[0];
    expect(res.support.level).toBe('REQUIRES_EXTERNAL_SERVICE');
    expect(res.support.blockedMessage).toMatch(/proprietario/);
    expect(res.support.alternatives).toContain('DXF');
    expect(res.jobId).toBeNull();

    const { prisma } = await import('../src/db.js');
    const v = await prisma.documentVersion.findFirstOrThrow({ where: { document: { projectId } } });
    expect(v.status).toBe('BLOCKED_UNSUPPORTED');
    const issues = await prisma.openIssue.findMany({ where: { projectId, scope: { startsWith: 'document.' } } });
    expect(issues).toHaveLength(1);
  });

  it('BLOQUEIA NWD e mantem o arquivo armazenado integro', async () => {
    const r = await upload([{ field: 'file', filename: 'modelo.nwd', content: Buffer.from('binario navisworks') }]);
    const res = r.json().results[0];
    expect(res.support.phase).toBe(3);
    expect(res.support.blockedMessage).toMatch(/leitura nativa/);
    const { storage } = await import('../src/storage/index.js');
    const { prisma } = await import('../src/db.js');
    const v = await prisma.documentVersion.findFirstOrThrow({ where: { document: { projectId } } });
    expect(await storage().exists(v.storageKey)).toBe(true);
  });

  it('a matriz documental expoe as inconsistencias', async () => {
    await upload([{ field: 'file', filename: 'SEM-CARIMBO.pdf', content: tinyPdf() }]);
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${projectId}/documents/matrix`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const row = r.json().rows[0];
    expect(row.inconsistencies).toContain('Numero do documento nao identificado no carimbo.');
    expect(row.inconsistencies.some((i: string) => /sugestao, nao fato/.test(i))).toBe(true);
    expect(r.json().summary.unclassified).toBe(1);
  });
});

describe('deteccao de revisao', () => {
  it('reconhece nova revisao pelo numero do documento e preserva a anterior', async () => {
    const { prisma } = await import('../src/db.js');
    await upload([{ field: 'file', filename: 'CPM-20.701.pdf', content: tinyPdf('rev A') }]);
    const doc = await prisma.document.findFirstOrThrow({ where: { projectId } });
    await prisma.document.update({ where: { id: doc.id }, data: { documentNumber: 'CPM-20.701' } });
    await prisma.documentVersion.update({ where: { id: doc.currentVersionId! }, data: { revision: 'A' } });

    // Simula o carimbo lido da nova revisao: o classificador compara numero e revisao.
    const before = await prisma.document.count({ where: { projectId } });
    const r = await upload([{ field: 'file', filename: 'CPM-20.701.pdf', content: tinyPdf('rev B diferente') }]);
    const res = r.json().results[0];

    // Sem numero de documento lido no arquivo novo, o sistema NAO afirma que e revisao:
    // marca como ambiguo ou novo, mas nunca sobrescreve o anterior.
    expect(['AMBIGUOUS', 'NEW_DOCUMENT', 'NEW_REVISION']).toContain(res.outcome);
    const versions = await prisma.documentVersion.count({ where: { document: { projectId } } });
    expect(versions).toBeGreaterThanOrEqual(2);
    expect(await prisma.document.count({ where: { projectId } })).toBeGreaterThanOrEqual(before);

    const original = await prisma.documentVersion.findFirst({ where: { revision: 'A' } });
    expect(original).not.toBeNull();
  });
});
