import { execSync } from 'node:child_process';
import { join } from 'node:path';

const E2E_DB = process.env['E2E_DATABASE_URL']
  ?? 'postgresql://postgres@127.0.0.1:55432/cronograma_e2e?schema=public';

/**
 * Prepara o e2e: banco migrado e limpo, e o frontend reconstruido apontando para a
 * API da suite. O build fica aqui, e nao no `webServer`, porque um servidor de
 * preview reaproveitado faria o Playwright pular o comando e servir um bundle velho —
 * foi exatamente isso que fez o login falhar em silencio.
 */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), 'packages', 'api'),
    env: { ...process.env, DATABASE_URL: E2E_DB },
    stdio: 'ignore',
  });
  execSync('npx vite build', {
    cwd: join(process.cwd(), 'packages', 'web'),
    env: { ...process.env, VITE_API_BASE: 'http://127.0.0.1:3101' },
    stdio: 'ignore',
  });

  execSync(
    `psql "${E2E_DB.replace('?schema=public', '')}" -c "DO \\$\\$ DECLARE r record; BEGIN ` +
    `FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP ` +
    `EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE'; END LOOP; END \\$\\$;"`,
    { stdio: 'ignore', shell: '/bin/bash' },
  );
}
