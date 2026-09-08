/**
 * Armazenamento de objetos por tras de um adaptador substituivel (§3).
 * O conteudo e enderecado por hash: o original nunca e sobrescrito.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../env.js';

export interface StorageAdapter {
  readonly driver: string;
  put(key: string, data: Buffer, contentType: string): Promise<{ key: string; byteSize: number }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Chave enderecada por conteudo: mesmo arquivo, mesma chave, sem duplicar bytes. */
export function contentKey(projectId: string, hash: string, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `projects/${projectId}/originals/${hash.slice(0, 2)}/${hash}.${ext}`;
}

class FsStorage implements StorageAdapter {
  readonly driver = 'fs';
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root))) throw new Error('Chave de armazenamento invalida (path traversal).');
    return full;
  }

  async put(key: string, data: Buffer): Promise<{ key: string; byteSize: number }> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'w' });
    return { key, byteSize: data.byteLength };
  }
  async get(key: string): Promise<Buffer> { return readFile(this.path(key)); }
  async exists(key: string): Promise<boolean> {
    try { await stat(this.path(key)); return true; } catch { return false; }
  }
  /** No driver de arquivo a "URL assinada" e a rota autenticada da propria API. */
  async signedUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }
}

class S3Storage implements StorageAdapter {
  readonly driver = 's3';
  // Importado sob demanda para nao exigir o SDK em ambientes que usam apenas fs.
  private clientPromise: Promise<any> | null = null;

  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        return new S3Client({
          region: env.s3.region,
          ...(env.s3.endpoint ? { endpoint: env.s3.endpoint } : {}),
          forcePathStyle: env.s3.forcePathStyle,
          credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
        });
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<{ key: string; byteSize: number }> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await this.client();
    await c.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: data, ContentType: contentType }));
    return { key, byteSize: data.byteLength };
  }
  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await this.client();
    const r = await c.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await this.client();
    try { await c.send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key })); return true; } catch { return false; }
  }
  async signedUrl(key: string, ttl = env.signedUrlTtl): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const c = await this.client();
    return getSignedUrl(c, new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }), { expiresIn: ttl });
  }
}

let instance: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (instance) return instance;
  if (env.storageDriver === 's3') {
    if (!env.s3.bucket || !env.s3.accessKeyId) {
      throw new Error('STORAGE_DRIVER=s3 exige S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY. Veja .env.example.');
    }
    instance = new S3Storage();
  } else {
    instance = new FsStorage(join(process.cwd(), env.storageFsRoot));
  }
  return instance;
}

/** Somente para teste: troca o adaptador. */
export function setStorage(a: StorageAdapter | null): void { instance = a; }
