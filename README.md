# DevMind

Suite de programación local con IA para la intranet `.casa`. Asistente de código que corre íntegramente en tu infraestructura — sin cloud externo.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Hono + SQLite (better-sqlite3) |
| Frontend | React + Vite + Zustand |
| Workers | Background job queue (SQLite) |
| IA | Ollama local (Qwen, nomic-embed-text) |
| Auth | Password + MFA (TOTP) + JWT |
| Búsqueda semántica | HNSW (hnswlib-node) + embeddings |
| Secrets | Infisical (self-hosted) |
| Runtime | Node.js 22, TypeScript strict, pnpm workspaces |

## Dirección del producto — Project-First Builder

DevMind migró de una arquitectura centrada en chat a una arquitectura centrada en proyectos. El objeto raíz del sistema es el **proyecto**, no la sesión de chat.

```
proyecto
  → pantallas (screens)
  → recursos del app (colecciones, storage, canales, jobs)
  → preview (estado del runtime de preview)
  → sesiones de agente (chat project-scoped)
  → artefactos generados
```

El chat actúa como interfaz de refinamiento del proyecto, no como contenedor del estado del producto. Los proyectos existen independientemente del historial de chat.

## Arquitectura

```
packages/
  backend/   — API REST + WebSocket (Hono, puerto 3001)
               builder/: CRUD de proyectos, screens, previews, app-resources
               chat/:   agente project-scoped con SSE streaming
               workers/: cola de generación y preview
  frontend/  — SPA React/Vite (puerto 5173)
               /projects: entrada principal del producto
               /builder/:id: shell del builder (sidebar, preview, agente)
               /chat: legacy session chat (en migración)
  workers/   — Sidecar de jobs: generación, preview, indexación, archivado (polling cada 5 s)
```

El backend expone todos los endpoints REST y el path `/ws`. Los workers comparten la misma base SQLite y procesan jobs en segundo plano. El frontend usa Zustand para el estado global (auth, sesión, chat).

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

## Estado actual del producto

| Área | Estado | Notas |
|---|---|---|
| Auth (password + TOTP + JWT) | ✅ | Login, registro, MFA, refresh |
| Chat SSE streaming | ✅ | Agente con tools, streaming de tokens |
| Runtime de agente + tools | ✅ | Ollama, loop de tools, persistencia |
| Frontend Zustand stores | ✅ | auth, chat, session stores |
| **Builder — proyectos y screens** | ✅ | CRUD completo, frontend `/projects` + `/builder/:id` |
| **Builder — preview runtime** | ✅ | Preview estático con tickets firmados, estado runtime full-stack y fallback explícito |
| **Builder — app resources** | ✅ | Collections, storage, channels, jobs, auth config por proyecto |
| **Builder — full-stack generator** | ✅ | Manifest, servicios, API routes, BBDD SQLite, env vars, validación y snapshots |
| Indexación semántica (HNSW) | ✅ | Embeddings Ollama, búsqueda vectorial |
| Workers — jobs reales de generación | ✅ | Generación manifest-aware, materialización en workspace, validación y rebuild preview |
| Seguridad y gobierno de tools | 🔲 | |
| Tests, CI, release | 🔲 | |

Ver [`RECOVERY_PLAN.md`](./RECOVERY_PLAN.md) para el contexto histórico de la migración.
