# DevMind — Copilot Instructions

## ⚡ MANDATORY WORKFLOW — Run at every session start

```bash
bash ~/.copilot/hooks/copilot/session-start.sh   # engram context
bash ~/.copilot/hooks/copilot/gitflow-check.sh   # verify branch
```

**If gitflow-check fails or says "no git repo" → fix branch/init git BEFORE touching any file.**
**At session end → `bash ~/.copilot/hooks/copilot/session-end.sh`**

---

## Architecture

pnpm monorepo with three packages that run as separate processes:

- **`packages/backend`** — Hono HTTP API + WebSocket server on the same port. Serves all REST endpoints and the `/ws` upgrade path.
- **`packages/frontend`** — React + Vite SPA. Auth state in memory (never localStorage). Communicates with backend via `apiFetch` (lib/api.ts) and `wsClient` (lib/ws.ts).
- **`packages/workers`** — Separate background sidecar. Polls `job_queue` in SQLite every 5 s, processes one job at a time. Dispatches by `job.type` in `src/index.ts → dispatch()`. Currently handles `indexCodebase` and `archiveSessions`.

Backend wiring pattern: repos and services are instantiated **once** in `src/index.ts`, then injected into router factory functions (`createXxxRouter(deps)`). Routers never import repos directly — they receive them as constructor arguments.

### Auth flow

1. Passkey / WebAuthn only — no passwords.
2. Successful login/register returns `{ accessToken, user }` and sets an httpOnly `refresh_token` cookie.
3. Access token is held in a module-level variable in `useAuth.ts` and passed via `Authorization: Bearer …` on every request.
4. On app load, `useAuth` calls `POST /auth/refresh` to rehydrate from the cookie.
5. WebSocket connections use a short-lived ticket: `POST /auth/ws-ticket` → connect to `/ws?ticket=…`. WsManager falls back to Web Push when the user has no active WS connection.

### Current status (see RECOVERY_PLAN.md)

The LangGraph agent loop is **not yet connected**. `POST /api/sessions/:id/messages` returns a stub response. The agent tools in `packages/backend/src/tools/` exist but are not wired to a chat handler.

---

## Build & Run

```bash
# Build all packages (tsc)
pnpm -r build

# Dev — backend + frontend in parallel
pnpm dev

# Dev — individual package
pnpm --filter @devmind/backend dev    # tsx watch
pnpm --filter @devmind/frontend dev   # vite
pnpm --filter @devmind/workers dev    # tsx watch

# Production
pnpm --filter @devmind/backend start  # node dist/index.js
pnpm --filter @devmind/workers start
```

No test runner is configured (see `openspec/config.yaml`). Type checking is the only automated quality gate (`pnpm -r build`).

### Secrets

Secrets are managed in **Infisical** (project slug `devmind-pxgt`, at `http://infisical.casa`). The only real values in `.env` are Infisical bootstrap credentials. Run the backend with:

```bash
infisical run -- node dist/index.js
```

Required secrets (must exist in Infisical): `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `STORAGE_BASE_PATH`. See `packages/backend/src/config.ts` for the full Zod schema.

---

## Key Conventions

### TypeScript

- Strict mode everywhere. Additional flags in `tsconfig.base.json`: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`.
- All imports use **`.js` extension** (NodeNext module resolution), including imports of `.ts` source files.
- No `any`, no `as unknown as T` casting shortcuts.

### Hono routers

- Always type routers as `new Hono<HonoEnv>()` when the route requires auth — this gives typed `c.get('userId')` and `c.get('isAdmin')`.
- Use `authMiddleware` for user-only routes, chain `adminMiddleware` after it for admin routes.
- Router files export a single factory: `export function createXxxRouter(dep1, dep2, ...): Hono<HonoEnv>`.

### Database

- Single SQLite file, WAL mode, foreign keys enabled. Opened once via `getDb()` singleton.
- Migrations: numbered SQL files in `packages/backend/src/db/migrations/` (e.g., `002_name.sql`). The migration runner in `db.ts` checks `schema_migrations` and applies each file exactly once. Add new migrations as new numbered files — never edit existing ones.
- Repo pattern: class with `constructor(private db: Database.Database)`. Query results are cast with `as Type` after `better-sqlite3` calls.

### Agent tools

Tools live in `packages/backend/src/tools/`. Each is a factory `createXxxTool(repo, userId)` returning a LangChain-compatible tool. They are assembled via `createAgentTools(services, userId)` in `tools/index.ts`. The `ToolServices` interface in that file is the canonical list of what tools can access.

### Workers job queue

- Enqueue: `jobs.enqueue('jobType', payloadObject)` — payload is JSON-stringified.
- Workers dequeue with `jobs.dequeueNext()` and dispatch on `job.type`.
- Adding a new job type: add a case to the `switch` in `packages/workers/src/index.ts`, implement the handler in `src/handlers/`.

### Design system (UI)

`DESIGN.md` is the source of truth for all visual decisions. Rules that must be followed:

- **Never hardcode colors** — always use CSS custom properties (`var(--token)`).
- Accent color is **coral** (`--accent: #D97757`) — not blue, not green.
- Spacing uses the `--space-*` scale (4 px base grid). No arbitrary values like `padding: 7px`.
- Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px`.
- Borders: `var(--border-subtle/default/strong)`.
- Fonts: `var(--font-sans)` (Inter) and `var(--font-mono)` (JetBrains Mono).

### Logging

Use `pino` logger (`import { logger } from '../logger.js'` in backend, inline `pino()` in workers). Structured fields go in the first argument object: `logger.info({ userId, sessionId }, 'message')`.

### SDD workflow

Feature changes follow Spec-Driven Development. Specs, designs, and change tracking live in `openspec/`. Run `sdd` commands to navigate the workflow before implementing significant changes.
