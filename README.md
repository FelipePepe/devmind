# DevMind

Suite de programación local con IA para la intranet `.casa`. Asistente de código que corre íntegramente en tu infraestructura — sin cloud externo.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Hono + SQLite (better-sqlite3) |
| Frontend | React + Vite |
| Workers | Background job queue (SQLite) |
| IA | Ollama local (Qwen, nomic-embed-text) |
| Auth | WebAuthn (passkeys) + JWT |
| Búsqueda semántica | HNSW (hnswlib-node) + embeddings |
| Secrets | Infisical (self-hosted) |
| Runtime | Node.js 22, TypeScript strict, pnpm workspaces |

## Arquitectura

```
packages/
  backend/   — API REST + WebSocket (Hono, puerto 3001)
  frontend/  — SPA React/Vite (puerto 5173)
  workers/   — Sidecar de jobs: indexación, archivado (polling cada 5 s)
```

El backend expone todos los endpoints REST y el path `/ws`. Los workers comparten la misma base SQLite y procesan jobs en segundo plano. El frontend se comunica con el backend vía `apiFetch` y `wsClient`.

## Requisitos

- Node.js 22+
- pnpm 10+
- [Ollama](https://ollama.ai) corriendo localmente
- [Infisical](http://infisical.casa) configurado (o variables de entorno directas para desarrollo)

## Arranque local

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/FelipePepe/devmind.git
cd devmind
pnpm install

# 2. Configurar secretos
cp .env.example .env
# Rellenar INFISICAL_CLIENT_ID y INFISICAL_CLIENT_SECRET
# (o añadir las variables de backend directamente en .env para dev rápido)

# 3. Arrancar en modo desarrollo
pnpm dev                          # backend + frontend en paralelo

# O por paquete:
pnpm --filter @devmind/backend dev
pnpm --filter @devmind/frontend dev
pnpm --filter @devmind/workers dev
```

## Producción

```bash
pnpm build                                 # compila todos los paquetes (tsc)
infisical run -- node packages/backend/dist/index.js
infisical run -- node packages/workers/dist/index.js
```

## Secretos requeridos (Infisical)

Proyecto: `devmind` · slug: `devmind-pxgt` · URL: `http://infisical.casa`

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Firma de tokens JWT |
| `VAPID_PUBLIC_KEY` | Web Push (notificaciones) |
| `VAPID_PRIVATE_KEY` | Web Push (notificaciones) |
| `STORAGE_BASE_PATH` | Ruta base para artefactos |
| `OLLAMA_BASE_URL` | URL de Ollama (default: `http://localhost:11434`) |
| `OLLAMA_CODING_MODEL` | Modelo de código (e.g. `qwen2.5-coder:7b`) |
| `OLLAMA_EMBED_MODEL` | Modelo de embeddings (e.g. `nomic-embed-text`) |
| `WORKSPACE_ROOT` | Directorio raíz del workspace del agente |
| `VECTOR_DB_PATH` | Ruta del índice HNSW |
| `SQLITE_PATH` | Ruta de la base de datos SQLite |

Ver `.env.example` para la lista completa.

## Modelos Ollama recomendados

```bash
ollama pull qwen2.5-coder:7b     # código
ollama pull qwen3:latest          # razonamiento
ollama pull qwen2.5-vl:7b        # visión
ollama pull nomic-embed-text      # embeddings (vector search)
```

## Diseño

Ver [`DESIGN.md`](./DESIGN.md) — fuente de verdad del sistema de tokens visuales (colores, tipografía, espaciado). Accent color: coral `#D97757`. Tema: warm dark IDE-first.

## Roadmap

Estado de implementación siguiendo el [`RECOVERY_PLAN.md`](./RECOVERY_PLAN.md):

| Fase | Descripción | Estado |
|---|---|---|
| 1 | Base estable + build | ✅ |
| 2 | Chat SSE streaming | ✅ |
| 3 | Runtime de agente + tools | ✅ |
| 4 | Frontend layout 3 paneles | 🔲 |
| 5 | Persistencia y artefactos | 🔲 |
| 6 | Indexación semántica (HNSW) | ✅ |
| 7 | Workers reales | 🔲 |
| 8 | Seguridad y gobierno de tools | 🔲 |
| 9 | Firebase como v2 | 🔲 |
| 10 | Tests, CI, release | 🔲 |
