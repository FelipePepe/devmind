import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3003',
      '/auth': 'http://localhost:3003',
      '/admin': 'http://localhost:3003',
      '/ws': { target: 'ws://localhost:3003', ws: true },
    },
  },
});
