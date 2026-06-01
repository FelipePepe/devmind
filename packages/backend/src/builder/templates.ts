export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  files: Array<{ path: string; content: string; language: string }>;
  manifest?: {
    appType: string;
    stack: Record<string, unknown>;
    commands: Record<string, string>;
    entrypoints: Record<string, string>;
  };
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Blank project',
    description: 'Empty project — just a canvas. Let the agent scaffold it from scratch.',
    files: [],
  },
  {
    id: 'web-app',
    name: 'Web app (HTML + CSS + JS)',
    description: 'Single-page app with a Vite-style HTML entry, CSS reset, and a main.js module.',
    files: [
      {
        path: 'index.html',
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="main.js"></script>
</body>
</html>`,
      },
      {
        path: 'style.css',
        language: 'css',
        content: `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; line-height: 1.5; color: #1a1a1a; background: #fff; }
#app { max-width: 960px; margin: 0 auto; padding: 2rem; }`,
      },
      {
        path: 'main.js',
        language: 'javascript',
        content: `const app = document.getElementById('app');
app.innerHTML = '<h1>Hello, world!</h1>';`,
      },
    ],
    manifest: {
      appType: 'web',
      stack: { runtime: 'browser', bundler: 'none' },
      commands: { dev: 'npx serve .', build: 'echo static' },
      entrypoints: { main: 'index.html' },
    },
  },
  {
    id: 'node-api',
    name: 'Node.js REST API',
    description: 'Minimal Express API with a health endpoint, dotenv config, and nodemon dev script.',
    files: [
      {
        path: 'src/index.ts',
        language: 'typescript',
        content: `import express from 'express';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});`,
      },
      {
        path: 'package.json',
        language: 'json',
        content: JSON.stringify({
          name: 'api',
          version: '1.0.0',
          scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' },
          dependencies: { express: '^4.18.2' },
          devDependencies: { '@types/express': '^4.17.21', 'tsx': '^4.7.0', 'typescript': '^5.3.3' },
        }, null, 2),
      },
      {
        path: 'tsconfig.json',
        language: 'json',
        content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', outDir: 'dist', strict: true } }, null, 2),
      },
      {
        path: '.env.example',
        language: 'dotenv',
        content: 'PORT=3000\nNODE_ENV=development',
      },
    ],
    manifest: {
      appType: 'backend',
      stack: { runtime: 'node', framework: 'express', language: 'typescript' },
      commands: { dev: 'npm run dev', build: 'npm run build', start: 'npm start' },
      entrypoints: { main: 'src/index.ts' },
    },
  },
  {
    id: 'fullstack',
    name: 'Fullstack (React + Express)',
    description: 'Monorepo with a Vite React frontend and an Express TypeScript backend.',
    files: [
      {
        path: 'packages/frontend/index.html',
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`,
      },
      {
        path: 'packages/frontend/src/main.tsx',
        language: 'typescriptreact',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);`,
      },
      {
        path: 'packages/frontend/src/App.tsx',
        language: 'typescriptreact',
        content: `export default function App() {
  return <h1>Hello from React</h1>;
}`,
      },
      {
        path: 'packages/frontend/package.json',
        language: 'json',
        content: JSON.stringify({ name: 'frontend', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18', 'react-dom': '^18' }, devDependencies: { '@types/react': '^18', '@types/react-dom': '^18', 'vite': '^5', '@vitejs/plugin-react': '^4' } }, null, 2),
      },
      {
        path: 'packages/backend/src/index.ts',
        language: 'typescript',
        content: `import express from 'express';
const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(3001, () => console.log('API on :3001'));`,
      },
      {
        path: 'packages/backend/package.json',
        language: 'json',
        content: JSON.stringify({ name: 'backend', scripts: { dev: 'tsx watch src/index.ts', build: 'tsc' }, dependencies: { express: '^4' }, devDependencies: { '@types/express': '^4', tsx: '^4', typescript: '^5' } }, null, 2),
      },
      {
        path: 'package.json',
        language: 'json',
        content: JSON.stringify({ name: 'app', workspaces: ['packages/*'], scripts: { dev: 'concurrently "npm run dev -w frontend" "npm run dev -w backend"' }, devDependencies: { concurrently: '^8' } }, null, 2),
      },
    ],
    manifest: {
      appType: 'fullstack',
      stack: { frontend: 'react+vite', backend: 'express', language: 'typescript', monorepo: 'npm workspaces' },
      commands: { dev: 'npm run dev', build: 'npm run build -w frontend && npm run build -w backend' },
      entrypoints: { frontend: 'packages/frontend/src/main.tsx', backend: 'packages/backend/src/index.ts' },
    },
  },
];
