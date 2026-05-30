# Design: 001 — Firebase-Inspired Layer

## Technical Approach

Build a self-hosted backend layer across three packages: extend `packages/backend` with six new modules (db, auth, storage, flags, realtime, workers-client, tools), add `packages/workers` as a standalone SQLite-polling sidecar, and scaffold `packages/frontend` as a Vite+React SPA. Single SQLite file shared by both processes via WAL mode. All secrets injected via Infisical env vars. No new runtime infrastructure needed beyond the existing .casa intranet.

---

## 1. Architecture Overview

```
packages/frontend (Vite :5173 dev)
        │  REST + WS (JWT Bearer / ?token=)
        ▼
packages/backend (Hono :3000)
   ├── db/            ← better-sqlite3, owns migrations
   ├── auth/          ← WebAuthn + JWT
   ├── storage/       ← NAS filesystem
   ├── flags/         ← feature flags + cache
   ├── realtime/      ← WsManager + Web Push
   ├── workers/       ← JobQueueClient (enqueue only)
   └── tools/         ← LangGraph DynamicStructuredTool wrappers
        │  SQLite file (WAL)
        ▼
packages/workers (sidecar, no HTTP)
   ├── handlers/index-codebase.ts
   └── handlers/archive-sessions.ts
```

- **Port allocation**: backend `:3000`, workers no HTTP, frontend `:5173` (dev)
- **DB ownership**: backend runs migrations on startup; workers opens same file read-write (WAL allows concurrent readers + one writer)
- Note: `config.ts` currently defaults backend to `:3001` — rename env key to `PORT` and keep default `3000`.

---

## 2. Database Schema

### migrations/001_initial.sql (full DDL)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  display_name  TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,  -- extracted for uniqueness enforcement; F.1 normalizes to credentials table
  credential    TEXT NOT NULL,         -- JSON: {credentialId, publicKey, counter, transports}
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending','in_progress','done','blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id          TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  filename            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  storage_path        TEXT NOT NULL,
  signed_url_token    TEXT NOT NULL,
  signed_url_expires_at TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,  -- JSON
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_queue (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,  -- JSON
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','processing','done','failed')),
  processing_at TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,  -- incremented on each pickup; job marked failed after 3 retries (W29)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error         TEXT
);

CREATE TABLE IF NOT EXISTS webpush_subscriptions (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for hot queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_session      ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user     ON artifacts(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status        ON job_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_push_user          ON webpush_subscriptions(user_id);

-- WebAuthn challenge persistence (W23 — replaces in-process Map; persists across restarts)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT,  -- nullable: registration challenges precede user creation
  challenge  TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migration version tracking (W24)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 3. Module Design — packages/backend/src/

### config.ts (modified)

Add to existing `ConfigSchema`:
```typescript
DB_PATH:              z.string().default('./data/devmind.db'),
STORAGE_BASE_PATH:    z.string(),                            // required — no default
JWT_SECRET:           z.string().min(32),                    // required; min 32 chars (W2)
VAPID_PUBLIC_KEY:     z.string(),                            // required
VAPID_PRIVATE_KEY:    z.string().min(32),                    // required; min 32 chars (W2)
FLAG_CACHE_TTL_MS:    z.coerce.number().default(300_000),    // 5 min
SIGNED_URL_TTL_MS:    z.coerce.number().default(3_600_000),  // 1 hour
MAX_UPLOAD_BYTES:     z.coerce.number().default(104_857_600), // 100 MiB (W1)
WEBAUTHN_RP_ID:       z.string().default('localhost'),
WEBAUTHN_RP_NAME:     z.string().default('DevMind'),
WEBAUTHN_DISABLED:    z.coerce.boolean().default(false),
```

### db/

```
db/
├── db.ts                   ← singleton Database, runs migrations on startup
├── migrations/
│   └── 001_initial.sql     ← full DDL above
└── repos/
    ├── users.ts
    ├── sessions.ts
    ├── messages.ts
    ├── tasks.ts
    ├── artifacts.ts
    ├── flags.ts
    ├── jobs.ts
    └── subscriptions.ts
```

**db.ts pattern**:
```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(config.DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');   // C2: per-connection — migration SQL is insufficient
    _db.pragma('busy_timeout = 5000'); // W21: avoid immediate SQLITE_BUSY on write contention
    runMigrations(_db);
  }
  return _db;
}

function runMigrations(db: Database.Database): void {
  // W24: versioned migration runner — checks schema_migrations before executing DDL
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version);
  if (!applied.includes('001_initial')) {
    db.exec(readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
    db.prepare("INSERT INTO schema_migrations (version) VALUES ('001_initial')").run();
  }
}
```

**Repo pattern** (all repos follow this):
```typescript
export class UsersRepo {
  constructor(private db: Database.Database) {}
  findById(id: string): User | undefined { ... }
  create(input: CreateUserInput): User { ... }
  update(id: string, patch: Partial<User>): User { ... }
  delete(id: string): void { ... }
  list(): User[] { ... }
}
```

### auth/

- **`webauthn.ts`**: wraps `@simplewebauthn/server` — `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`. Challenges are persisted in the `webauthn_challenges` DB table with `expires_at`; **challenge rows MUST be deleted immediately after the corresponding `verify` call completes, regardless of success or failure** (C3 — one-time use; no replay within TTL window). On startup, if `WEBAUTHN_DISABLED === true && NODE_ENV === 'production'`, call `process.exit(1)` with a clear error message (C4).
- **`jwt.ts`**: uses `jose` — `sign(userId, isAdmin): {accessToken, refreshToken}`, `verify(token): {userId, isAdmin}`. Access: 15 min, Refresh: 7 days.
- **`middleware.ts`**: Hono middleware reads `Authorization: Bearer <token>`, calls `verify()`, sets `c.set('userId', ...)`. Returns 401 on failure. Admin guard is a second middleware checking `isAdmin` claim. **Known limitation (W11)**: `isAdmin` is baked into the JWT access token with 15-minute lifetime; admin revocation delay of up to 15 min is accepted for intranet use. Full DB-lookup revocation is deferred.
- **`auth-rate-limit.ts`**: IP-level rate-limiting middleware (W28) applied to `/auth/register/challenge` and `/auth/login/challenge`. Uses `Map<ip, {count: number, resetAt: number}>` with 1-minute window; rejects with HTTP 429 after 10 requests/min/IP. Map capped at 1 000 entries (evict oldest on overflow).

### storage/

- **`storage.ts`**: `StorageService` — `upload(userId, sessionId, file): Artifact`, `download(userId, artifactId, token): ReadableStream`, `list(userId, sessionId?): Artifact[]`, `generateSignedUrl(userId: string, artifactId: string): string`. Path: `{STORAGE_BASE_PATH}/{userId}/{artifactId}/{filename}`.
  - **W20 path sanitization**: `upload()` MUST apply `path.basename()` to filename; reject filenames containing `/` or null bytes with HTTP 400.
  - **W3 MIME detection**: `upload()` MUST use the `file-type` library to detect MIME type from raw file bytes; client-supplied `Content-Type` is discarded. `download()` MUST set `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
  - **W10 ownership**: all repo queries use `findById(userId, artifactId)` — `AND user_id = :userId` applied at repo layer; returns 404 on mismatch (not 403) to prevent enumeration.
  - **W26 signed URL regeneration**: `generateSignedUrl(userId, artifactId)` issues a fresh signed token for an existing artifact; the `artifact_download` tool calls this instead of requiring a pre-existing valid token.
- **`signed-url.ts`**: `generateToken(artifactId, userId, expiresAt): string` — HMAC-SHA256 over `${artifactId}:${userId}:${expiresAt}` using `node:crypto`. `verifyToken(token: string, artifactId: string, userId: string, now?: number): boolean` — verifies HMAC signature AND checks `expiresAt > (now ?? Date.now())`; returns `false` (→ HTTP 403) if either check fails (C1).

### flags/

- **`flags.ts`**: `FlagsService` — internal `Map<string, {value: unknown, fetchedAt: number}>`. `getFlag(key)` checks TTL, falls back to DB. `setFlag(key, value)` updates DB + deletes cache entry. `listFlags()` reads DB directly.

### realtime/

- **`ws-manager.ts`**: `WsManager` — `connections: Map<string, Set<WebSocket>>`. `register/unregister/broadcast`. Broadcast falls back to `PushService.sendPush()` if no active sockets. Also maintains `wsTickets: Map<string, { userId: string; expiresAt: number }>` for the WS ticket exchange (W8): opaque tickets are issued by `POST /auth/ws-ticket`, short-lived (30 s), single-use; `GET /ws?ticket=` exchanges the ticket for a `userId` on upgrade.
- **`web-push.ts`**: `PushService` — `subscribe(userId, sub)`, `sendPush(userId, payload)` via `web-push` lib. VAPID keys from config.

### workers/ (client only)

- **`queue.ts`**: `JobQueueClient` — `enqueue(type: string, payload: unknown): string` (returns jobId), `getJob(id): Job | undefined`, `resetStuckJobs()` (sets `status=pending` where `status=processing AND processing_at < now()-5min`).

### tools/

```
tools/
├── index.ts               ← exports array of all 7 tools
├── session-save.ts
├── session-history.ts
├── task-update.ts
├── artifact-upload.ts
├── artifact-download.ts
├── artifact-list.ts
└── get-flags.ts
```

Each tool uses `DynamicStructuredTool` from `@langchain/core/tools` with a Zod `schema` and an `async func`. Tool receives `userId` via closure (injected when agent is constructed per-request).

---

## 4. Module Design — packages/workers/

```
packages/workers/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                     ← main poll loop
    ├── jobs.ts                      ← JobQueueClient (duplicated from backend — no shared package yet)
    └── handlers/
        ├── index-codebase.ts        ← hnswlib indexing
        └── archive-sessions.ts      ← marks sessions archived_at
```

**index.ts poll loop**:
```typescript
let isRunning = false;
let tickCount  = 0;

async function tick(): Promise<void> {
  if (isRunning) {          // C5: skip tick if previous dispatch still in flight
    setTimeout(tick, 5_000);
    return;
  }
  isRunning = true;
  try {
    jobs.resetStuckJobs();
    const job = dequeueNext();
    if (job) await dispatch(job);
    tickCount++;
    if (tickCount % 100 === 0) db.pragma('wal_checkpoint(PASSIVE)'); // W27: periodic WAL flush
  } finally {
    isRunning = false;
    setTimeout(tick, 5_000); // C5: recursive setTimeout avoids concurrent ticks
  }
}

setTimeout(tick, 5_000); // start poll loop
```

**archive-sessions.ts**: runs via job type `archiveSessions`. Sets `archived_at = datetime('now')` on sessions where `created_at < datetime('now', '-90 days') AND archived_at IS NULL`.

**Self-enqueue logic (C6)**: on worker startup AND after each `archiveSessions` job completes, the handler executes:
```sql
SELECT id FROM job_queue
WHERE type = 'archiveSessions'
  AND status IN ('pending', 'done')
  AND created_at >= date('now')
LIMIT 1
```
If no row is returned, a new `archiveSessions` job is enqueued immediately. This guarantees exactly one run per calendar day with no external scheduler.

**jobs.ts (workers duplicate)**: mirrors `JobQueueClient` from backend. MUST call `db.pragma('foreign_keys = ON')` and `db.pragma('busy_timeout = 5000')` immediately after `new Database()` (C2, W21). Also increments `retry_count` on job pickup and marks `failed` after 3 retries (W29).

---

## 5. Module Design — packages/frontend/

```
packages/frontend/
├── package.json   (vite, react 18, @simplewebauthn/browser)
├── vite.config.ts
└── src/
    ├── lib/
    │   ├── api.ts          ← typed fetch wrapper (base URL, auth header injection)
    │   └── ws.ts           ← WebSocket client with exponential backoff reconnect
    ├── hooks/
    │   ├── useAuth.ts      ← passkey login/logout, JWT in memory, auto-refresh
    │   ├── useSession.ts   ← fetch messages + WS token stream subscription
    │   └── useFlags.ts     ← GET /api/flags, re-fetch every 5 min; useEffect MUST return clearInterval cleanup (W22)
    └── pages/
        ├── Chat.tsx
        └── admin/
            ├── Users.tsx
            ├── Flags.tsx
            └── Jobs.tsx
```

JWT stored in module-level variable inside `useAuth.ts` — never `localStorage`. `ws.ts` first calls `POST /auth/ws-ticket` (Bearer) to obtain a short-lived opaque ticket, then connects with `?ticket=<ticket>` (W8).

---

## 6. API Routes (Hono)

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| POST | `/auth/register/challenge` | none | WebAuthn registration options (rate-limited W28) |
| POST | `/auth/register/verify` | none | Verify + create user/credential |
| POST | `/auth/login/challenge` | none | WebAuthn authentication options (rate-limited W28) |
| POST | `/auth/login/verify` | none | Verify + issue JWT pair; `accessToken` in body, `refreshToken` as HttpOnly SameSite=Strict cookie (W9) |
| POST | `/auth/refresh` | refresh token (HttpOnly cookie) | Rotate access token; set new refreshToken cookie (W9) |
| DELETE | `/auth/logout` | Bearer | Clear refreshToken cookie (Set-Cookie: expired); access token survives until expiry — stateless (C7) |
| POST | `/auth/ws-ticket` | Bearer | Issue short-lived (30 s) opaque WS ticket → `{ ticket }` (W8) |
| GET | `/api/sessions` | Bearer | List user sessions |
| POST | `/api/sessions` | Bearer | Create session |
| GET | `/api/sessions/:id/messages` | Bearer | List messages (with ownership check) |
| POST | `/api/artifacts/upload` | Bearer | Upload file → StorageService (MAX_UPLOAD_BYTES enforced W1; path sanitized W20; MIME detected W3) |
| GET | `/api/artifacts/:id/download` | signed token (query) | Stream file (Content-Disposition: attachment; X-Content-Type-Options: nosniff W3) |
| GET | `/api/flags` | Bearer | listFlags() |
| GET | `/ws` | WS ticket (?ticket=) | WebSocket upgrade → ticket exchange → WsManager.register (W8) |
| GET | `/admin/flags` | Bearer + isAdmin | listFlags() |
| POST | `/admin/flags` | Bearer + isAdmin | setFlag() |
| PATCH | `/admin/flags/:key` | Bearer + isAdmin | setFlag() |
| GET | `/admin/users` | Bearer + isAdmin | UsersRepo.list() |
| GET | `/admin/jobs` | Bearer + isAdmin | JobsRepo.list() |

---

## 7. Architectural Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| SQLite concurrency | WAL mode | WAL2, Litestream | WAL allows concurrent readers from workers sidecar without blocking backend writes; no replication needed on intranet |
| Signed URL auth | HMAC-SHA256 (node:crypto) | DB-lookup tokens, pre-signed S3 URLs | No DB lookup on download path; token is self-verifying; intranet-only so no CDN needed |
| JWT storage (frontend) | Module-level memory variable | localStorage, httpOnly cookie | WebAuthn handles credential storage; memory avoids CSRF; avoids XSS persistence; acceptable because single-tab intranet app |
| Workers isolation | Separate process | Embedded worker_threads | CPU-intensive vector indexing cannot block HTTP event loop; crash isolation; simpler restart strategy |
| Shared package strategy | Duplicate `queue.ts` | `packages/shared` | Avoids premature abstraction; single file is small; add shared package when >2 duplicates appear |
| WebAuthn challenge store | `webauthn_challenges` DB table with `expires_at` | Redis, In-process Map | Persists across restarts (W23 — in-process Map loses in-flight challenges on restart); intranet DB latency is acceptable; challenge DELETED after each verify call (one-time use, C3) |
| Credential storage | Inline in users.credential (JSON) | Separate credentials table | One credential per user for MVP; can normalize later if multi-device needed |

---

## Data Flow

### Agent token stream
```
LangGraph agent
    │ broadcast(userId, {type:"token", content:"..."})
    ▼
WsManager
    ├── open sockets → ws.send(JSON)    → Frontend appends token
    └── no sockets   → PushService      → Web Push notification
```

### File upload
```
POST /api/artifacts/upload
    │ multipart form
    ▼
StorageService.upload()
    ├── mkdir {STORAGE_BASE_PATH}/{userId}/{artifactId}/
    ├── writeFile
    ├── generateToken(artifactId, userId, expiresAt)
    └── ArtifactsRepo.create()  →  returns Artifact + signedUrl
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/backend/src/config.ts` | Modify | Add 10 new env fields |
| `packages/backend/src/db/db.ts` | Create | DB singleton + migration runner |
| `packages/backend/src/db/migrations/001_initial.sql` | Create | Full schema DDL |
| `packages/backend/src/db/repos/*.ts` | Create | 8 typed repository classes |
| `packages/backend/src/auth/webauthn.ts` | Create | WebAuthn registration + auth |
| `packages/backend/src/auth/jwt.ts` | Create | JWT sign/verify via jose |
| `packages/backend/src/auth/middleware.ts` | Create | Hono auth + admin guards |
| `packages/backend/src/storage/storage.ts` | Create | StorageService |
| `packages/backend/src/storage/signed-url.ts` | Create | HMAC token gen/verify |
| `packages/backend/src/flags/flags.ts` | Create | FlagsService + TTL cache |
| `packages/backend/src/realtime/ws-manager.ts` | Create | WsManager |
| `packages/backend/src/realtime/web-push.ts` | Create | PushService |
| `packages/backend/src/workers/queue.ts` | Create | JobQueueClient |
| `packages/backend/src/tools/*.ts` | Create | 7 LangGraph tools + index |
| `packages/backend/package.json` | Modify | Add `@simplewebauthn/server`, `jose`, `web-push`, `@types/web-push` |
| `packages/workers/package.json` | Create | New sidecar package |
| `packages/workers/src/index.ts` | Create | Poll loop |
| `packages/workers/src/jobs.ts` | Create | Duplicated JobQueueClient |
| `packages/workers/src/handlers/*.ts` | Create | 2 job handlers |
| `packages/frontend/package.json` | Create | New React/Vite package |
| `packages/frontend/src/**` | Create | React app, hooks, pages |

---

## Interfaces / Contracts

```typescript
// Shared event shape over WebSocket
type WsEvent =
  | { type: 'token';    sessionId: string; content: string }
  | { type: 'done';     sessionId: string }
  | { type: 'error';    sessionId: string; message: string }
  | { type: 'task';     task: Task }

// Job types registered in workers
type JobType = 'indexCodebase' | 'archiveSessions'

// StorageService.upload return
interface UploadResult {
  artifact: Artifact;
  signedUrl: string;  // /api/artifacts/{id}/download?token=...&expires=...
}
```

---

## Testing Strategy

No test runner present (per config.yaml). Tests deferred to after vitest setup.

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | HMAC token gen/verify, flag cache TTL, JWT sign/verify | vitest (to be added) |
| Integration | DB repos round-trip, storage upload/download | vitest + temp SQLite file |
| E2E | WebAuthn flow, WebSocket token stream | Playwright (future) |

---

## Migration / Rollout

Schema is additive-only. Migration runner in `db.ts` runs `001_initial.sql` with `IF NOT EXISTS` guards — idempotent on re-deploy. Routes registered per-module in `packages/backend/src/index.ts` — disable any module by removing its route mount. Workers sidecar started independently; stopping it leaves DB intact.

---

## Open Questions

- [ ] Multi-device passkeys per user — current design stores one credential per user row. If multi-device is needed, normalize to a separate `credentials` table.
- [ ] Refresh token rotation persistence — current design issues stateless JWTs. If token revocation is needed, add a `refresh_tokens` table.
