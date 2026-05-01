# Proposal: DevMind Firebase-inspired Layer

## Intent

DevMind needs a self-hosted backend layer analogous to Firebase — covering persistence, auth, real-time, storage, feature flags, and async jobs — to serve a multi-user LLM assistant with WebAuthn login, live agent streaming, and file artifact management on the .casa intranet.

## Scope

### In Scope
- `packages/backend/src/db/` — SQLite repos: users, sessions, messages, tasks
- `packages/backend/src/auth/` — WebAuthn + JWT sessions middleware
- `packages/backend/src/storage/` — NAS filesystem service + signed URL generation
- `packages/backend/src/flags/` — Feature flags SQLite table + 5-min in-memory cache
- `packages/backend/src/realtime/` — WebSocket manager + Web Push notifications
- `packages/backend/src/workers/` — SQLite job queue client (enqueue/dequeue)
- `packages/backend/src/tools/` — Agent tools: `session_save`, `session_history`, `task_update`, `artifact_upload`, `artifact_download`, `artifact_list`, `get_flags`
- `packages/workers/` — Sidecar process: job processor (`indexCodebase`), cleanup (`archive sessions >90d`)
- `packages/frontend/` — React/Vite app with `useAuth`, `useCollection`, `useFlags` hooks
- Admin panel (part of frontend): users, feature flags, job queue views

### Out of Scope
- External cloud integrations (Firebase, S3, AWS)
- Email/SMTP notifications
- CI/CD pipelines
- Mobile native clients

## Capabilities

### New Capabilities
- `auth-webauthn`: WebAuthn passkey registration/authentication + JWT session issuance
- `db-sqlite-repos`: Typed SQLite repositories for users, sessions, messages, tasks
- `storage-filesystem`: NAS file storage with signed URL generation (upload/download/list)
- `feature-flags`: SQLite-backed flags with 5-min cache, readable by agents via `get_flags`
- `realtime-ws`: Bidirectional WebSocket server + Web Push for agent streaming and notifications
- `job-queue`: SQLite-backed async job queue; sidecar worker process consuming jobs
- `agent-tools`: LangGraph-compatible tool wrappers exposing backend services to LLM agents
- `frontend-app`: React/Vite SPA with auth hooks, collection hooks, admin panel

### Modified Capabilities
None

## Approach

- All packages in existing pnpm monorepo; add `packages/frontend` and `packages/workers`
- SQLite via `better-sqlite3` for all persistence; single DB file, separate tables per domain
- WebAuthn via `@simplewebauthn/server`; JWT via `jose`; secrets from Infisical
- WebSocket via Hono `upgradeWebSocket`; Web Push via `web-push`
- Workers sidecar: standalone Node process polling SQLite queue, same DB file as backend

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend/src/` | New | 6 new modules (auth, db, storage, flags, realtime, workers, tools) |
| `packages/frontend/` | New | React/Vite app + admin panel |
| `packages/workers/` | New | Sidecar job processor |
| `packages/backend/src/config.ts` | Modified | Add DB path, storage path, WebPush keys, feature flag TTL |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SQLite write contention (backend + workers) | Med | WAL mode + retry logic in queue client |
| WebAuthn browser support on intranet | Low | Test on chrome/firefox; fallback to JWT-only in dev |
| Signed URL security on intranet | Low | HMAC + expiry; bound to `.casa` only |
| Worker process crash leaves jobs stuck | Med | `processing_at` timeout + heartbeat reset |

## Rollback Plan

Each module is independently importable. Disable: comment out route registration in `packages/backend/src/index.ts`. Workers sidecar: stop process (no DB schema mutations are additive-only, revert with `ALTER TABLE DROP COLUMN` or restore SQLite backup).

## Dependencies

- `@simplewebauthn/server`, `jose`, `web-push`, `better-sqlite3` (backend)
- `vite`, `react`, `@simplewebauthn/browser` (frontend)
- Infisical project `devmind-pxgt` — new secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `JWT_SECRET`, `STORAGE_BASE_PATH`

## Success Criteria

- [ ] WebSocket: user sees agent token stream in real time
- [ ] WebAuthn: passwordless login works in browser on .casa intranet
- [ ] Sessions and messages persist in SQLite, accessible cross-device on intranet
- [ ] `artifact_upload` saves file to NAS, returns signed URL valid for configurable TTL
- [ ] `get_flags` returns feature flags; flag change reflects in agent within 5 min without redeploy
- [ ] `indexCodebase` job runs in workers sidecar without blocking HTTP backend
- [ ] Cleanup job archives sessions >90 days old
- [ ] Multi-user isolation: each user only accesses their own sessions/messages/artifacts
