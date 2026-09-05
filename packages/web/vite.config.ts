import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * O proxy precisa ser declarado nas DUAS chaves: `server` (vite dev) e `preview`
 * (build servido localmente). O preview nao herda a configuracao do dev server,
 * e sem isso as chamadas a /api caem no proprio frontend e retornam 404.
 * Em producao quem faz esse encaminhamento e o nginx (infra/nginx.conf).
 */
const proxy = {
  '/api': {
    target: process.env['VITE_API_URL'] ?? 'http://localhost:3001',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5273, proxy },
  build: { outDir: 'dist', sourcemap: true },
});
