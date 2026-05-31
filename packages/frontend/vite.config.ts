import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const backendPort = env['PORT'] || '3001';
  const backendUrl = env['VITE_BACKEND_URL'] || `http://localhost:${backendPort}`;
  const backendWsUrl = backendUrl.replace(/^http/, 'ws');

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': backendUrl,
        '/auth': backendUrl,
        '/admin': backendUrl,
        '/flags': backendUrl,
        '/ws': { target: backendWsUrl, ws: true },
      },
    },
  };
});
