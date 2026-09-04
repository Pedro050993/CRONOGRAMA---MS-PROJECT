import { buildApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';

const app = await buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.port, host: env.host });
app.log.info(
  { storage: env.storageDriver, ocr: env.ocrProvider, llm: env.llmProvider, cad: env.cadConverter, model3d: env.modelDeriver },
  'API no ar — capacidades declaradas',
);
