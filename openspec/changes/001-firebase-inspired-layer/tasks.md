# Tasks: 001 — Firebase-Inspired Layer

> **SUPERSEDED** — This change assumed WebAuthn passkeys and a chat-first architecture.
> The codebase has since moved to password+MFA auth (`feature/password-mfa-auth`) and a
> project-first studio architecture (`002-project-first-builder`). All relevant tasks
> were reimplemented from scratch. This document is kept for historical reference only.



## Phase 0 — Infrastructure & Setup [infra]

- [ ] 0.1 [backend] Add `@simplewebauthn/server`, `jose`, `web-push`, `@types/web-push`, `file-type` to `packages/backend/package.json` (W3: `file-type` for server-side MIME detection)
- [ ] 0.2 [frontend] Scaffold `packages/frontend/package.json` with `vite`, `react@18`, `react-dom`, `@simplewebauthn/browser`, `react-router-dom`; add `vite.config.ts` + `tsconfig.json`
- [ ] 0.3 [workers] Scaffold `packages/workers/package.json` with `better-sqlite3`, `hnswlib-node`, `tsx`, `typescript`; add `tsconfig.json`
- [ ] 0.4 [infra] Verify `pnpm-workspace.yaml` covers `packages/*` (already does — confirm no change needed; run `pnpm install -r`)
- [ ] 0.5 [backend] Update `packages/backend/src/config.ts`: add `DB_PATH`, `STORAGE_BASE_PATH`, `JWT_SECRET` (min 32 chars — W2), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (min 32 chars — W2), `FLAG_CACHE_TTL_MS`, `SIGNED_URL_TTL_MS`, `MAX_UPLOAD_BYTES` (default 104_857_600 — W1), `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_DISABLED`; change `PORT` default to `3000`
- [ ] 0.6 [infra] Add Infisical secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `JWT_SECRET`, `STORAGE_BASE_PATH`, `DB_PATH`
- [ ] 0.7 [backend] Create `packages/backend/src/db/migrations/001_initial.sql` with full DDL from design §2: 8 tables + indexes + `webauthn_challenges` table with `expires_at` (W23) + `schema_migrations` table (W24) + `credential_id TEXT NOT NULL UNIQUE` on users (W25) + `retry_count INTEGER NOT NULL DEFAULT 0` on job_queue (W29)
- [ ] 0.8 [backend] Create `packages/backend/src/db/db.ts` — `getDb()` singleton, runs versioned migrations (W24), WAL + FK pragmas; call `db.pragma('foreign_keys = ON')` and `db.pragma('busy_timeout = 5000')` immediately after `new Database()` (C2, W21); **BLOCKS** Phase 1

## Phase 1 — Database Repos [backend]
> PARALLEL: all 1.x tasks are independent; all BLOCKED by 0.8

- [ ] 1.1 [backend] Create `db/repos/users.ts` — `UsersRepo`: `create`, `findById`, `findByDisplayName`, `list`, `update`
- [ ] 1.2 [backend] Create `db/repos/sessions.ts` — `SessionsRepo`: `create`, `findByUser`, `findById`, `archive`, `deleteOld`
- [ ] 1.3 [backend] Create `db/repos/messages.ts` — `MessagesRepo`: `create`, `findBySession(id, limit)`
- [ ] 1.4 [backend] Create `db/repos/tasks.ts` — `TasksRepo`: `create`, `findBySession`, `updateStatus`
- [ ] 1.5 [backend] Create `db/repos/artifacts.ts` — `ArtifactsRepo`: `create`, `findById`, `findBySession`, `findByUser`, `delete`
- [ ] 1.6 [backend] Create `db/repos/flags.ts` — `FlagsRepo`: `get`, `set`, `list`
- [ ] 1.7 [backend] Create `db/repos/jobs.ts` — `JobsRepo`: `enqueue`, `dequeueNext` (claim + set `processing_at`), `updateStatus`, `resetStuck`, `list`
- [ ] 1.8 [backend] Create `db/repos/subscriptions.ts` — `SubscriptionsRepo`: `upsert`, `findByUser`, `delete`

## Phase 2 — Auth [backend]
> BLOCKED by 1.1

- [ ] 2.1 [backend] Create `auth/webauthn.ts` — `generateRegistrationOptions`, `verifyRegistration`, `generateAuthenticationOptions`, `verifyAuthentication`; persist challenges in `webauthn_challenges` DB table (W23 — replaces in-process Map); delete challenge row immediately after each verify call regardless of outcome (C3); add `process.exit(1)` guard for `WEBAUTHN_DISABLED=true` in production (C4)
- [ ] 2.2 [backend] Create `auth/jwt.ts` — `signTokens(userId, isAdmin)` returns `{accessToken, refreshToken}`; `verifyToken(token)` via `jose`; access 15 min, refresh 7 days
- [ ] 2.3 [backend] Create `auth/middleware.ts` — `authMiddleware` (Bearer → `c.set('userId', ...)`), `adminMiddleware` (`isAdmin` claim check); 401/403 on failure
- [ ] 2.4 [backend] Create `auth/routes.ts` — Hono router: `POST /auth/register/challenge`, `/register/verify`, `/login/challenge`, `/login/verify` (refreshToken as HttpOnly cookie — W9), `/auth/refresh` (read/set HttpOnly cookie — W9), `DELETE /auth/logout` (clear cookie — C7), `POST /auth/ws-ticket` (issue WS ticket — W8)
- [ ] 2.5 [backend] Create `auth/rate-limit.ts` — IP-level rate-limiting middleware on `/auth/register/challenge` and `/auth/login/challenge`; `Map<ip, {count, resetAt}>` with 1-min window, 10 req/min/IP; cap map at 1 000 entries (W28)

## Phase 3 — Storage [backend]
> BLOCKED by 1.5

- [ ] 3.1 [backend] Create `storage/signed-url.ts` — `generateToken(artifactId, userId, expiresAt): string` via HMAC-SHA256 (`node:crypto`); `verifyToken(token, artifactId, userId, now?: number): boolean` — checks HMAC AND `expiresAt > (now ?? Date.now())` (C1); add `generateSignedUrl(userId, artifactId)` to `StorageService` for fresh token generation (W26)
- [ ] 3.2 [backend] Create `storage/storage.ts` — `StorageService`: `upload(userId, sessionId, file): UploadResult`; enforce `MAX_UPLOAD_BYTES` before streaming (W1); apply `path.basename()` to filename, reject `/` or null bytes with 400 (W20); detect MIME via `file-type` library, discard client `Content-Type` (W3); `download(userId, artifactId, token): ReadableStream` sets `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (W3); all DB reads include `user_id` filter, return 404 on mismatch (W10); `list(userId, sessionId?)`: path template `{STORAGE_BASE_PATH}/{userId}/{artifactId}/{filename}`

## Phase 4 — Feature Flags [backend]
> BLOCKED by 1.6

- [ ] 4.1 [backend] Create `flags/flags.ts` — `FlagsService`: `Map<string, {value, fetchedAt}>` cache with TTL from config; `getFlag`, `setFlag`, `listFlags`
- [ ] 4.2 [backend] Create `flags/routes.ts` — `GET /api/flags` (auth), `GET /admin/flags`, `POST /admin/flags`, `PATCH /admin/flags/:key` (auth + admin)

## Phase 5 — Realtime [backend]
> BLOCKED by 2.3; PARALLEL with Phase 3 and 4

- [ ] 5.1 [backend] Create `realtime/ws-manager.ts` — `WsManager`: `connections: Map<userId, Set<WebSocket>>`; `register`, `unregister`, `broadcast` (falls back to PushService if no sockets); `wsTickets: Map<ticket, {userId, expiresAt}>` for WS ticket exchange (W8)
- [ ] 5.2 [backend] Create `realtime/web-push.ts` — `PushService`: `subscribe(userId, sub)`, `sendPush(userId, payload)` via `web-push` + VAPID keys from config
- [ ] 5.3 [backend] Create `realtime/routes.ts` — `GET /ws` (WS ticket `?ticket=` → `WsManager.register` — W8), `POST /api/push/subscribe`
- [ ] 5.5 [backend] Implement `POST /auth/ws-ticket` in `auth/routes.ts` — Bearer-authenticated; issues a 30 s opaque ticket stored in `WsManager.wsTickets`; ticket consumed on WS upgrade (W8)

## Phase 6 — Job Queue [backend + workers]
> 6.1 BLOCKED by 1.7; 6.2–6.4 BLOCKED by 6.1

- [ ] 6.1 [backend] Create `workers/queue.ts` — `JobQueueClient`: `enqueue(type, payload): string`, `getJob(id)`, `resetStuckJobs()` (processing > 5 min → pending); increment `retry_count` on pickup; mark `failed` after 3 retries (W29)
- [ ] 6.2 [workers] Create `packages/workers/src/jobs.ts` — duplicate `JobQueueClient`; call `db.pragma('foreign_keys = ON')` and `db.pragma('busy_timeout = 5000')` immediately after `new Database()` (C2, W21); increment `retry_count` on pickup, mark `failed` after 3 retries (W29); every 100 ticks call `db.pragma('wal_checkpoint(PASSIVE)')` (W27)
- [ ] 6.3 [workers] Create `packages/workers/src/index.ts` — poll loop using recursive `setTimeout` + `isRunning` flag (C5 — skip tick if previous dispatch still in flight); `resetStuckJobs` on startup; `dispatch(job)` switch on `type`
- [ ] 6.4 [workers] Create `packages/workers/src/handlers/index-codebase.ts` — `indexCodebase(payload)` via `hnswlib-node`
- [ ] 6.5 [workers] Create `packages/workers/src/handlers/archive-sessions.ts` — `archiveSessions()`: sets `archived_at` on sessions older than 90 days; self-enqueue logic (C6): on startup AND after job completes, query `SELECT id FROM job_queue WHERE type='archiveSessions' AND status IN ('pending','done') AND created_at >= date('now') LIMIT 1`; if no result, enqueue new job

## Phase 7 — Agent Tools [backend]
> BLOCKED by Phase 2, 3, 4, 6.1 (all services must exist)

- [ ] 7.1 [backend] Create `tools/session-save.ts` + `tools/session-history.ts` — `DynamicStructuredTool` wrapping `SessionsRepo` + `MessagesRepo`
- [ ] 7.2 [backend] Create `tools/task-update.ts` — wraps `TasksRepo.updateStatus`
- [ ] 7.3 [backend] Create `tools/artifact-upload.ts`, `artifact-download.ts`, `artifact-list.ts` — wraps `StorageService`; `artifact_download` calls `StorageService.generateSignedUrl(userId, artifactId)` to always return a fresh signed URL (W26 — no pre-existing token required)
- [ ] 7.4 [backend] Create `tools/get-flags.ts` — wraps `FlagsService.listFlags`
- [ ] 7.5 [backend] Create `tools/index.ts` — export all 7 tools; inject `userId` via closure on agent construction

## Phase 8 — API Routes Wiring [backend]
> BLOCKED by Phase 2–7 (all routes + services)

- [ ] 8.1 [backend] Create/update `packages/backend/src/index.ts` — Hono app; instantiate services; mount auth, flags, storage, realtime, admin routers
- [ ] 8.2 [backend] Create `storage/routes.ts` — `POST /api/artifacts/upload` (auth), `GET /api/artifacts/:id/download` (signed token query param)
- [ ] 8.3 [backend] Create `sessions/routes.ts` — `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id/messages` (auth + ownership check)
- [ ] 8.4 [backend] Create `admin/routes.ts` — `GET /admin/users`, `GET /admin/jobs` (auth + admin)

## Phase 9 — Frontend [frontend]
> PARALLEL with Phase 6–8; BLOCKED by 0.2

- [ ] 9.1 [frontend] Create `packages/frontend/src/lib/api.ts` — typed `apiFetch(path, opts)` with base URL + `Authorization: Bearer` injection
- [ ] 9.2 [frontend] Create `packages/frontend/src/lib/ws.ts` — WebSocket client with exponential-backoff reconnect + event emitter; connects via `?token=`
- [ ] 9.3 [frontend] Create `packages/frontend/src/hooks/useAuth.ts` — passkey register/login/logout via `@simplewebauthn/browser`; module-level JWT (never localStorage)
- [ ] 9.4 [frontend] Create `packages/frontend/src/hooks/useSession.ts` — fetch messages + subscribe to WS `token`/`done`/`error` events
- [ ] 9.5 [frontend] Create `packages/frontend/src/hooks/useFlags.ts` — `GET /api/flags`; re-fetch every 5 min; useEffect MUST return `() => clearInterval(id)` cleanup function to prevent accumulation on remount (W22)
- [ ] 9.6 [frontend] Create `packages/frontend/src/pages/Chat.tsx` — real-time token rendering using `useSession`
- [ ] 9.7 [frontend] Create `packages/frontend/src/pages/admin/Flags.tsx`, `Users.tsx`, `Jobs.tsx` — admin panel pages
- [ ] 9.8 [frontend] Create `packages/frontend/src/App.tsx` — `react-router-dom` routes; admin route guard (redirect if `!isAdmin`)

## Phase 10 — Integration & Verification [infra]
> BLOCKED by Phase 8 + 9

- [ ] 10.1 [infra] Run `pnpm -r build` — fix all TypeScript errors until zero failures
- [ ] 10.2 [infra] Smoke test: register passkey → login → create session → send message → observe WS token stream
- [ ] 10.3 [infra] Smoke test: upload artifact → receive signed URL → download via signed URL
- [ ] 10.4 [infra] Smoke test: `POST /admin/flags` → wait 5 min → `get_flags` tool returns updated value
- [ ] 10.5 [infra] Smoke test: enqueue `indexCodebase` job → workers sidecar picks it up → status transitions to `done`
- [ ] 10.6 [infra] Verify isolation: user A cannot `GET /api/sessions/:id/messages` for user B's session (expect 403)

## Future Tasks (Not in Scope)

- [ ] F.1 [backend] Multi-device passkeys — normalize `credential` out of `users` into a separate `credentials` table; update `UsersRepo` and `auth/webauthn.ts`
- [ ] F.2 [backend] Refresh token revocation — add `refresh_tokens` table with `revoked_at`; update `auth/jwt.ts` + `/auth/refresh` + `/auth/logout` to check revocation

---

## Parallelism Map

| Can run in parallel | Tasks |
|---|---|
| Phase 0 (0.1–0.6) | All independent after kickoff |
| Phase 1 (1.1–1.8) | All independent once 0.8 done |
| Phase 3, 4, 5 | Independent of each other; BLOCKED by Phase 1 |
| Phase 6.2–6.5 | BLOCKED by 6.1 only |
| Phase 7, 9 | Can start independently once their blockers done |

**Total tasks**: 49 leaf tasks + 2 future tasks
**Phases**: 11 (0–10) + F
