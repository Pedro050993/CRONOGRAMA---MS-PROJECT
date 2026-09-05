import { execSync } from 'node:child_process';
import { join } from 'node:path';

const E2E_DB = process.env['E2E_DATABASE_URL']
  ?? 'postgresql://postgres@127.0.0.1:55432/cronograma_e2e?schema=public';

/** Migra e zera o banco de e2e antes da suite. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    cwd: join(process.cwd(), 'packages', 'api'),
    env: { ...process.env, DATABASE_URL: E2E_DB },
    stdio: 'ignore',
  });
  execSync(
    `psql "${E2E_DB.replace('?schema=public', '')}" -c "DO \\$\\$ DECLARE r record; BEGIN ` +
    `FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP ` +
    `EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE'; END LOOP; END \\$\\$;"`,
    { stdio: 'ignore', shell: '/bin/bash' },
  );
}
