import { defineConfig } from '@playwright/test';

const E2E_DB = process.env['E2E_DATABASE_URL']
  ?? 'postgresql://postgres@127.0.0.1:55432/cronograma_e2e?schema=public';

const apiEnv = {
  ...process.env,
  DATABASE_URL: E2E_DB,
  JWT_SECRET: 'segredo-e2e-0123456789abcdefghijklmnopqrstuv',
  API_PORT: '3101',
  API_HOST: '127.0.0.1',
  CORS_ORIGIN: 'http://127.0.0.1:5273',
  STORAGE_DRIVER: 'fs',
  STORAGE_FS_ROOT: './.e2e-storage',
  LOG_LEVEL: 'warn',
} as Record<string, string>;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5273',
    // O ambiente ja traz o Chromium instalado; apontamos direto para o binario
    // em vez de baixar outro build so porque a versao do pacote mudou.
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } }
      : {}),
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'UTC',
  },
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: [
    {
      command: 'npx tsx packages/api/src/server.ts',
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: apiEnv,
    },
    {
      command: 'npx vite preview --port 5273 --host 127.0.0.1 --strictPort',
      cwd: './packages/web',
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
