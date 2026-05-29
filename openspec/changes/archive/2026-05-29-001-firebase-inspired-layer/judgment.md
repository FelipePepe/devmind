# Judgment Day — `001-firebase-inspired-layer`

> Protocol: dual adversarial review (blind parallel judges)
> Judge A: Security & Correctness adversary
> Judge B: Architecture & Reliability adversary
> Skill Resolution: injected from `.atl/skill-registry.md`

---

## Judgment Summary

- **Total findings**: 37 (7 critical, 17 real warnings, 5 theoretical warnings, 7 suggestions, 1 contradiction)
- **Confirmed** (both judges): 2 critical, 3 real warnings
- **Suspect A only**: 2 critical, 4 real warnings, 2 theoretical, 3 suggestions
- **Suspect B only**: 3 critical, 10 real warnings, 3 theoretical, 4 suggestions
- **Contradictions**: 1

### Verdict: 🔴 BLOCK

7 criticals (2 confirmed, 5 suspect) — must fix before `sdd-apply`.

---

## Findings Table

| # | Finding | Judge A | Judge B | Severity | Status |
|---|---------|---------|---------|----------|--------|
| 1 | `verifyToken` never checks expiry — signed URLs are eternal | ✅ | ✅ | 🔴 CRITICAL | **Confirmed** |
| 2 | `PRAGMA foreign_keys = ON` is per-connection — migration SQL doesn't enforce it on app connections | ✅ | ✅ | 🔴 CRITICAL | **Confirmed** |
| 3 | No file size limit on artifact upload — heap/disk exhaustion | ✅ | ✅ | 🟡 WARNING (real) | **Confirmed** |
| 4 | `JWT_SECRET: z.string()` accepts 1-char secret — no minimum entropy | ✅ | ✅ | 🟡 WARNING (real) | **Confirmed** (A: real; B: theoretical — using A's higher classification) |
| 5 | MIME type stored from client-controlled Content-Type header — stored XSS vector | ✅ | ✅ | 🟡 WARNING (real) | **Confirmed** (A: WARNING real; B: SUGGESTION — using A's higher classification) |
| 6 | WebAuthn challenge not deleted after use — replay within 5-min window | ✅ | ❌ | 🔴 CRITICAL | Suspect (A only) |
| 7 | `WEBAUTHN_DISABLED=true` is a full auth bypass with no `NODE_ENV=production` guard | ✅ | ❌ | 🔴 CRITICAL | Suspect (A only) |
| 8 | JWT access token in `?token=` URL query param — logged by every proxy and reverse proxy | ✅ | ❌ | 🟡 WARNING (real) | Suspect (A only) |
| 9 | Refresh token storage location never specified — implementers will default to `localStorage` | ✅ | ❌ | 🟡 WARNING (real) | Suspect (A only) |
| 10 | Artifact download ownership: `SELECT WHERE id = ?` without `user_id` filter → cross-user access | ✅ | ❌ | 🟡 WARNING (real) | Suspect (A only) |
| 11 | `isAdmin` baked into JWT — admin cannot be revoked until token expiry (15 min) | ✅ | ❌ | 🟡 WARNING (real) | Suspect (A only) |
| 12 | Job dequeue is non-atomic SELECT + UPDATE — two workers could claim same job | ✅ | ❌ | 🟡 WARNING (theoretical) | Suspect (A only) |
| 13 | HMAC input `artifactId:userId:expiresAt` — colon in IDs could produce identical inputs | ✅ | ❌ | 🟡 WARNING (theoretical) | Suspect (A only) |
| 14 | `DEVMIND_API_KEY` empty-string default silently disables key auth | ✅ | ❌ | 🔵 SUGGESTION | Suspect (A only) |
| 15 | `listFlags()` bypasses cache — admin panel and agents see different values during TTL | ✅ | ❌ | 🔵 SUGGESTION | Suspect (A only) |
| 16 | One credential per user row — adding a second device requires schema surgery | ✅ | ❌ | 🔵 SUGGESTION | Suspect (A only) |
| 17 | `setInterval` does not `await` dispatch — concurrent job execution + self-reset on slow jobs | ❌ | ✅ | 🔴 CRITICAL | Suspect (B only) |
| 18 | `archiveSessions` daily schedule mechanism undefined — no query, no table, no spec | ❌ | ✅ | 🔴 CRITICAL | Suspect (B only) |
| 19 | `DELETE /auth/logout` documented as "invalidate refresh token" — stateless JWT means it's a no-op | ❌ | ✅ | 🔴 CRITICAL | Suspect (B only) |
| 20 | Path traversal via `filename` in storage path — `../../../etc/cron.d/evil` accepted | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 21 | No `busyTimeout` set — `SQLITE_BUSY` thrown immediately on write contention | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 22 | `useFlags` setInterval not cleared on unmount — intervals accumulate on each mount/unmount cycle | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 23 | WebAuthn challenge Map lost on process restart — all in-flight registrations/logins fail | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 24 | Single SQL migration file, no versioning — future `ALTER TABLE` re-runs fail on existing column | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 25 | Credential deduplication (HTTP 409) is app-only — no DB UNIQUE constraint on credential_id | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 26 | Signed URL permanently expires after 1h — no `generateSignedUrl` for existing artifacts | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 27 | WAL checkpoint never called — WAL file grows unboundedly, risking NAS disk exhaustion | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 28 | No rate limiting on `/auth/register/challenge` — challenge Map inflated to heap exhaustion | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 29 | No `retry_count` column — a crashing job loops forever between `processing` → reset → `processing` | ❌ | ✅ | 🟡 WARNING (real) | Suspect (B only) |
| 30 | `FlagsService` cache lives in backend process only — workers process can never read or invalidate it | ❌ | ✅ | 🟡 WARNING (theoretical) | Suspect (B only) |
| 31 | `webpush_subscriptions` table exists in DDL but is absent from spec's table list and acceptance criteria | ❌ | ✅ | 🟡 WARNING (theoretical) | Suspect (B only) |
| 32 | `GET /api/sessions/:id/messages` ownership check described but query never specified — easy to implement without `user_id` filter | ❌ | ✅ | 🟡 WARNING (theoretical) | Suspect (B only) |
| 33 | Refresh token in request body — logged by proxies and debug middleware | ❌ | ✅ | 🔵 SUGGESTION | Suspect (B only) |
| 34 | Missing `idx_jobs_processing` on `processing_at` — `resetStuckJobs` does full scan | ❌ | ✅ | 🔵 SUGGESTION | Suspect (B only) |
| 35 | `artifact_download` tool calls `StorageService.download(userId, artifactId, token)` but has no token — API gap | ❌ | ✅ | 🔵 SUGGESTION | Suspect (B only) |
| 36 | No graceful shutdown task — open WS connections dropped uncleanly on SIGTERM | ❌ | ✅ | 🔵 SUGGESTION | Suspect (B only) |
| 37 | **[CONTRADICTION]** WAL pragma persistence: A says "migration SQL is unreliable for WAL enforcement"; B says "WAL IS persistent (stored in DB header)" | ✅ | ✅ | — | **Contradiction** |

---

## Contradiction Analysis

**Finding #37 — WAL pragma persistence**

- **Judge A**: `PRAGMA journal_mode = WAL` in migration SQL is unreliable (WARNING real)
- **Judge B**: WAL mode IS persistent (stored in DB header) — explicitly says "WAL itself is fine"

**Resolution**: Judge B is correct. SQLite WAL mode is stored in the database file header and persists across connections — unlike `foreign_keys` which is connection-level. **Judge A's WARNING(real) on WAL is invalid.** The `PRAGMA journal_mode = WAL` in migration SQL works correctly for first-run initialization. Finding #2 (PRAGMA foreign_keys per-connection) remains valid and confirmed; only the WAL aspect of A's finding is wrong.

**Action**: Discard A's WAL-reliability warning. Add only `db.pragma('foreign_keys = ON')` on every connection open.

---

## Confirmed Findings (both judges)

### 🔴 CRITICAL

#### C1 — `verifyToken` never checks expiration
**File**: `packages/backend/src/storage/signed-url.ts` + `storage/storage.ts`

The design defines `verifyToken(token, artifactId, userId): boolean` with no `now` parameter and no expiry check. The HMAC includes `expiresAt` in its input but nothing compares it against `Date.now()`. The `SIGNED_URL_TTL_MS` config field is stored in the artifact row (`signed_url_expires_at`) but never read at download time. All signed URLs are cryptographically valid forever.

*Fix*: Add `expiresAt` and `now` as explicit parameters to `verifyToken`; check `expiresAt > now` before returning true. Update all callers.

---

#### C2 — `PRAGMA foreign_keys = ON` must be set per-connection
**File**: `packages/backend/src/db/db.ts` + `packages/workers/src/jobs.ts`

SQLite foreign key enforcement resets to OFF on every new connection. The migration SQL sets it once on the backend's migration run. The workers sidecar opens its own connection and never sets it. All FK constraints (sessions→users, messages→sessions, artifacts→users) are silently unenforced in the workers process.

*Fix*: Call `db.pragma('foreign_keys = ON')` immediately after `new Database()` in **both** `db.ts` and the workers' DB initializer. Do not rely on migration SQL for connection-level pragmas.

---

### 🟡 WARNING (real)

#### W1 — No file size limit on artifact upload
**File**: `packages/backend/src/storage/storage.ts`, `storage/routes.ts`, `packages/backend/src/config.ts`

No `MAX_UPLOAD_BYTES` config field exists. No size check before streaming. A user can upload arbitrarily large files, exhausting Node.js heap or NAS disk.

*Fix*: Add `MAX_UPLOAD_BYTES: z.coerce.number().default(100_000_000)` to ConfigSchema; enforce before or during multipart streaming in the upload route.

---

#### W2 — `JWT_SECRET` has no minimum length validation
**File**: `packages/backend/src/config.ts`

`JWT_SECRET: z.string()` accepts any string including single characters or empty strings if Infisical injection fails silently. A short HMAC-SHA256 key is trivially brute-forceable.

*Fix*: Change to `z.string().min(32)`. Apply the same to `VAPID_PRIVATE_KEY`.

---

#### W3 — MIME type taken from client-controlled `Content-Type` header
**File**: `packages/backend/src/storage/storage.ts`

The upload stores whatever MIME type the client claims. A malicious user can upload an HTML/JS file labeled as `text/plain`. If the download route sets `Content-Type` from the stored value, browsers may execute the content. On an intranet, this enables stored XSS delivery.

*Fix*: Detect MIME type server-side from file bytes (e.g., `file-type` library); set `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on all download responses.

---

## Judge A Only

| # | Severity | Finding |
|---|----------|---------|
| 6 | 🔴 CRITICAL | WebAuthn challenge not deleted after use — captured assertion replayable within 5-min window |
| 7 | 🔴 CRITICAL | `WEBAUTHN_DISABLED=true` has no `NODE_ENV=production` guard — full auth bypass if misconfigured |
| 8 | 🟡 WARNING (real) | JWT in `?token=` URL query param for WS — logged verbatim in every proxy/access log |
| 9 | 🟡 WARNING (real) | Refresh token storage location never specified — implementers will use `localStorage` |
| 10 | 🟡 WARNING (real) | Artifact ownership: repo queries may lack `AND user_id = ?` → cross-user download via artifact ID |
| 11 | 🟡 WARNING (real) | `isAdmin` baked into JWT — admin revocation impossible until token expires |
| 12 | 🟡 WARNING (theoretical) | Job dequeue non-atomic (SELECT then UPDATE) — two workers could claim same job |
| 13 | 🟡 WARNING (theoretical) | HMAC string `a:b:c` — colon in IDs produces identical inputs (currently safe with hex IDs) |
| 14 | 🔵 SUGGESTION | `DEVMIND_API_KEY` empty-string default silently disables key auth if not injected |
| 15 | 🔵 SUGGESTION | `listFlags()` bypasses cache — admin panel and agent see inconsistent values during TTL window |
| 16 | 🔵 SUGGESTION | One credential per user row — adding a second device requires destructive schema migration |

---

## Judge B Only

| # | Severity | Finding |
|---|----------|---------|
| 17 | 🔴 CRITICAL | `setInterval` not awaiting `dispatch()` — concurrent job execution; slow jobs reset and re-run themselves |
| 18 | 🔴 CRITICAL | `archiveSessions` daily schedule mechanism completely undefined — self-enqueue logic has no spec |
| 19 | 🔴 CRITICAL | `DELETE /auth/logout` documented as "invalidate refresh token" but stateless JWT makes it a no-op |
| 20 | 🟡 WARNING (real) | Path traversal via `filename` in storage path — `path.basename()` never called |
| 21 | 🟡 WARNING (real) | No `busyTimeout` set on either connection — `SQLITE_BUSY` thrown immediately on write contention |
| 22 | 🟡 WARNING (real) | `useFlags` setInterval not cleared on unmount — intervals accumulate on each navigation cycle |
| 23 | 🟡 WARNING (real) | WebAuthn challenge Map lost on process restart — in-flight auth flows fail with no recovery path |
| 24 | 🟡 WARNING (real) | Single migration file, no versioning — future `ALTER TABLE ADD COLUMN` will fail on re-run |
| 25 | 🟡 WARNING (real) | Credential deduplication (HTTP 409) app-only — no DB UNIQUE constraint on credential ID |
| 26 | 🟡 WARNING (real) | No `generateSignedUrl()` method — after 1h TTL, artifact is permanently inaccessible via any signed URL |
| 27 | 🟡 WARNING (real) | WAL checkpoint never triggered explicitly — WAL file grows unboundedly on NAS |
| 28 | 🟡 WARNING (real) | No rate limiting on public auth endpoints — challenge Map inflated to heap exhaustion |
| 29 | 🟡 WARNING (real) | No `retry_count` — crashing job loops forever between `processing → reset → processing` |
| 30 | 🟡 WARNING (theoretical) | `FlagsService` cache is backend-process-only — any future worker flag read creates a ghost cache |
| 31 | 🟡 WARNING (theoretical) | `webpush_subscriptions` table absent from spec's table list and acceptance criteria |
| 32 | 🟡 WARNING (theoretical) | `GET /api/sessions/:id/messages` ownership check described but no query spec — easy to omit `user_id` filter |
| 33 | 🔵 SUGGESTION | Refresh token in request body — logged by proxies, use `HttpOnly` cookie instead |
| 34 | 🔵 SUGGESTION | Missing `idx_jobs_processing` index on `processing_at` — `resetStuckJobs` does full scan at scale |
| 35 | 🔵 SUGGESTION | `artifact_download` agent tool has no token — design gap; needs `generateSignedUrl()` on StorageService |
| 36 | 🔵 SUGGESTION | No graceful shutdown task — WS clients disconnected without close frames on SIGTERM |

---

## Recommended Fixes Before `sdd-apply`

**Only CRITICAL and WARNING(real) items listed.**

### Critical Fixes

1. **`verifyToken` expiry check** *(Confirmed C1)*
   - Add `expiresAt: number` param to `verifyToken`; check against `Date.now()` before returning true
   - Update `StorageService.download()` to extract `expiresAt` from the URL/token and pass it

2. **`PRAGMA foreign_keys = ON` per-connection** *(Confirmed C2)*
   - Call `db.pragma('foreign_keys = ON')` after `new Database()` in `packages/backend/src/db/db.ts`
   - Call `db.pragma('foreign_keys = ON')` after `new Database()` in `packages/workers/src/jobs.ts`
   - Do NOT rely on migration SQL for this

3. **WebAuthn challenge one-time use** *(Suspect A — C6)*
   - Delete challenge from Map immediately after `verifyRegistrationResponse` / `verifyAuthenticationResponse` is called, regardless of success or failure

4. **`WEBAUTHN_DISABLED` production guard** *(Suspect A — C7)*
   - Add startup check: if `WEBAUTHN_DISABLED === true && process.env.NODE_ENV === 'production'`, call `process.exit(1)` with a clear error message

5. **Workers poll loop concurrency** *(Suspect B — C17)*
   - Replace `setInterval` with recursive `setTimeout` + an `isRunning` flag; skip tick if previous dispatch is still in flight

6. **`archiveSessions` daily schedule** *(Suspect B — C18)*
   - Define the exact mechanism: query `job_queue` for a `done` `archiveSessions` job with `created_at >= date('now')` before self-enqueueing; add this query to spec and task 6.5

7. **Logout no-op documentation or fix** *(Suspect B — C19)*
   - Either: add `refresh_tokens` revocation table (promote F.2 to in-scope), OR explicitly document in the API table that logout is client-side only and the refresh token JWT survives server-side; update spec accordingly

### Warning Fixes

8. **File size limit** *(Confirmed W1)*
   - Add `MAX_UPLOAD_BYTES: z.coerce.number().default(104_857_600)` to ConfigSchema
   - Enforce in `POST /api/artifacts/upload` before streaming

9. **JWT_SECRET minimum length** *(Confirmed W2)*
   - Change `z.string()` to `z.string().min(32)` for `JWT_SECRET`; same for `VAPID_PRIVATE_KEY`

10. **Server-side MIME type detection** *(Confirmed W3)*
    - Use `file-type` (or similar) on raw bytes to determine MIME type; discard client-supplied `Content-Type`
    - Set `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on all download responses

11. **Path traversal on filename** *(Suspect B — W20)*
    - Apply `path.basename(filename)` in `StorageService.upload()` before constructing the filesystem path
    - Reject filenames containing `/` or null bytes

12. **SQLite busy timeout** *(Suspect B — W21)*
    - Add `db.pragma('busy_timeout = 5000')` after every `new Database()` call (backend + workers)

13. **`useFlags` interval cleanup** *(Suspect B — W22)*
    - Return `() => clearInterval(id)` from the `useEffect` in `useFlags.ts`

14. **WebAuthn challenge persistence** *(Suspect B — W23)*
    - Either persist challenges in a `webauthn_challenges` table with `expires_at`, or explicitly document and test the failure mode on process restart (with a client-visible error message and retry prompt)

15. **Migration versioning** *(Suspect B — W24)*
    - Add a `schema_migrations` table and a migration runner that tracks applied versions before any future `ALTER TABLE` statement is needed (deferred future tasks F.1, F.2 require it)

16. **Credential UNIQUE constraint** *(Suspect B — W25)*
    - Add `UNIQUE(credential_id)` enforcement at DB level; either normalize credentials to a separate table or add a SQLite generated column with a unique index

17. **Artifact signed URL regeneration** *(Suspect B — W26)*
    - Add `generateSignedUrl(userId, artifactId): string` to `StorageService` that generates a fresh token without requiring an existing valid one; expose from `artifact_download` agent tool

18. **WAL checkpoint** *(Suspect B — W27)*
    - Add periodic `db.pragma('wal_checkpoint(PASSIVE)')` in the workers poll loop (e.g., every N ticks)

19. **Auth endpoint rate limiting** *(Suspect B — W28)*
    - Add IP-level rate limiting middleware on `/auth/register/challenge` and `/auth/login/challenge`; cap the challenge Map size (e.g., 1000 entries)

20. **Job retry limit** *(Suspect B — W29)*
    - Add `retry_count INTEGER NOT NULL DEFAULT 0` to `job_queue` DDL; increment on each pickup; mark `failed` after N retries regardless of handler outcome

21. **JWT in WS URL** *(Suspect A — W8)*
    - Replace `?token=` with a short-lived opaque ticket: issue via authenticated REST endpoint before WS upgrade; WS upgrade exchanges ticket for session

22. **Refresh token storage specification** *(Suspect A — W9)*
    - Explicitly specify `HttpOnly SameSite=Strict` cookie for refresh token storage; document in spec and implement in `/auth/login/verify` response headers

23. **Artifact ownership at repo layer** *(Suspect A — W10)*
    - All `ArtifactsRepo` queries for download/read MUST include `AND user_id = :userId`; add integration test verifying cross-user access returns 403

24. **`isAdmin` revocation** *(Suspect A — W11)*
    - Either add DB lookup for `is_admin` on `adminMiddleware` (with a short TTL cache), OR document the 15-minute revocation delay as a known limitation in the spec

---

## Score Summary

| Category | Confirmed | Suspect A | Suspect B | Contradiction |
|----------|-----------|-----------|-----------|---------------|
| 🔴 CRITICAL | 2 | 2 | 3 | — |
| 🟡 WARNING (real) | 3 | 4 | 10 | — |
| 🟡 WARNING (theoretical) | 0 | 2 | 3 | — |
| 🔵 SUGGESTION | 0 | 3 | 4 | — |
| — | — | — | — | 1 |
| **Total** | **5** | **11** | **20** | **1** |

---

## 🔴 VERDICT: BLOCK

> **7 critical issues found (2 confirmed, 5 suspect). 17 real warnings. Do not proceed with `sdd-apply` until at minimum the confirmed criticals and high-confidence suspects are resolved.**
>
> Minimum bar to unblock: fix C1, C2, W1, W2, W3 (all confirmed) + the 5 suspect criticals (#6, #7, #17, #18, #19).
> Recommended: also fix W20 (path traversal), W21 (busyTimeout), W22 (interval leak), W26 (signed URL regeneration), W10 (artifact ownership query).

---

*Generated by judgment-day protocol v1.4 — Round 1*
*Judge A: Security & Correctness | Judge B: Architecture & Reliability*
*Both judges operated blind (no cross-contamination)*
