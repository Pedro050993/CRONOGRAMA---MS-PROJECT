/**
 * Configuracao vinda do ambiente. Nenhum segredo tem valor padrao util:
 * faltando, o processo recusa subir em vez de rodar inseguro.
 */
function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}. Veja .env.example.`);
  }
  return v;
}
function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Variavel ${name} deve ser numerica.`);
  return n;
}

export const env = {
  databaseUrl: req('DATABASE_URL'),
  port: num('API_PORT', 3001),
  host: process.env['API_HOST'] ?? '0.0.0.0',
  jwtSecret: req('JWT_SECRET'),
  jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '8h',
  corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',

  storageDriver: (process.env['STORAGE_DRIVER'] ?? 'fs') as 'fs' | 's3',
  storageFsRoot: process.env['STORAGE_FS_ROOT'] ?? './storage-data',
  s3: {
    endpoint: process.env['S3_ENDPOINT'] ?? '',
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] ?? '',
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
  },
  signedUrlTtl: num('SIGNED_URL_TTL_SECONDS', 300),

  maxUploadBytes: num('MAX_UPLOAD_BYTES', 200 * 1024 * 1024),
  maxZipEntries: num('MAX_ZIP_ENTRIES', 5000),
  maxZipUncompressedBytes: num('MAX_ZIP_UNCOMPRESSED_BYTES', 2 * 1024 * 1024 * 1024),

  ocrProvider: process.env['OCR_PROVIDER'] ?? 'none',
  llmProvider: process.env['LLM_PROVIDER'] ?? 'none',
  cadConverter: process.env['CAD_CONVERTER'] ?? 'none',
  modelDeriver: process.env['MODEL_DERIVER'] ?? 'none',
} as const;

/** Capacidades realmente disponiveis neste ambiente — expostas na API para a interface nao prometer o que nao ha. */
export function capabilities(): Record<string, { available: boolean; provider: string; note: string }> {
  return {
    ocr: {
      available: env.ocrProvider !== 'none',
      provider: env.ocrProvider,
      note: env.ocrProvider === 'none'
        ? 'Nenhum provedor de OCR configurado. Regioes sem texto vetorial serao marcadas como pendencia, nunca preenchidas por suposicao.'
        : `OCR ativo via "${env.ocrProvider}".`,
    },
    llm: {
      available: env.llmProvider !== 'none',
      provider: env.llmProvider,
      note: env.llmProvider === 'none'
        ? 'Nenhum provedor de IA configurado. A extracao usa apenas regras deterministicas.'
        : `IA ativa via "${env.llmProvider}". Toda saida entra como PENDENTE de revisao humana.`,
    },
    cad: {
      available: env.cadConverter !== 'none',
      provider: env.cadConverter,
      note: env.cadConverter === 'none'
        ? 'Conversao CAD nao configurada. DWG e DXF ficam bloqueados com mensagem explicita (Fase 2).'
        : `Conversao CAD via "${env.cadConverter}".`,
    },
    model3d: {
      available: env.modelDeriver !== 'none',
      provider: env.modelDeriver,
      note: env.modelDeriver === 'none'
        ? 'Derivacao de modelo 3D nao configurada. NWD e NWC ficam bloqueados com mensagem explicita (Fase 3).'
        : `Derivacao 3D via "${env.modelDeriver}".`,
    },
  };
}
