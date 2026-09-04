import { execSync } from 'node:child_process';

/**
 * Migra o banco de teste UMA vez por execucao.
 * Rodar `migrate deploy` em paralelo por arquivo colide no lock de migracao.
 */
export default function setup(): void {
  const url = process.env['TEST_DATABASE_URL']
    ?? 'postgresql://postgres@127.0.0.1:55432/cronograma_test?schema=public';
  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
