# Design: 005 — Playwright Validation

## Technical Approach

The agent today claims completion via narration. This change introduces a closed loop: the agent proposes an acceptance test before writing code, runs that test against the live preview, and attaches the result (screenshot + status) to the closing message. The user sees deterministic evidence; the agent cannot close a run until a test passes.

The design is **additive-first**: all behavior is gated behind three feature flags, the blob store from 004 is reused for evidence storage, and the existing job queue drives the Playwright worker.

---

## 1. Target Architecture

```
runAgentLoop(projectId, runId)
  ├─ agent.propose_acceptance_test(intent)
  │    └─ writes e2e/<slug>.spec.ts into project_files
  │    └─ inserts project_test (status='draft')
  ├─ ... existing structured tool calls (code generation) ...
  ├─ agent.run_project_tests([test_id])
  │    └─ enqueues job { type: 'validate-with-playwright', project_id, test_id, run_id }
  │    └─ polls until job done (max 60s)
  │    └─ reads project_test_run.status
  │    if passed:
  │      └─ agent.attach_evidence_to_message(message_id, test_run_id)
  │      └─ finish run
  │    if failed (attempt < 3):
  │      └─ agent reads error_excerpt → iterates (back to code gen)
  │    if failed (attempt == 3):
  │      └─ agent reports honest failure with evidence
  └─ post-snapshot (004) carries screenshot_blob_hash from test_run
```

---

## 2. Data Model

### Migration 023 — `project_tests` + `project_test_runs` + `message.evidence`

```sql
CREATE TABLE project_tests (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK(source IN ('acceptance','smoke','manual')),
  title       TEXT NOT NULL,
  intent      TEXT NOT NULL,
  spec_path   TEXT NOT NULL,           -- e2e/<slug>.spec.ts inside generated project
  status      TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','disabled')),
  created_by_run_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE project_test_runs (
  id                        TEXT PRIMARY KEY,
  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_id                   TEXT NOT NULL REFERENCES project_tests(id) ON DELETE CASCADE,
  agent_run_id              TEXT,
  status                    TEXT NOT NULL CHECK(status IN ('pending','passed','failed','errored','timed_out')),
  duration_ms               INTEGER,
  evidence_screenshot_hash  TEXT,      -- blob hash in project_snapshot_blobs (from 004)
  evidence_video_hash       TEXT,      -- only on failure
  error_excerpt             TEXT,      -- first 300 chars of failure
  trace_json                TEXT,      -- compressed Playwright trace
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at               TEXT
);

-- Extend messages table (already exists)
ALTER TABLE messages ADD COLUMN evidence_json TEXT; -- nullable MessageEvidence JSON

CREATE INDEX idx_project_tests_project ON project_tests(project_id);
CREATE INDEX idx_project_test_runs_test ON project_test_runs(test_id);
CREATE INDEX idx_project_test_runs_agent_run ON project_test_runs(agent_run_id);
```

### `MessageEvidence` type

```ts
type MessageEvidence = {
  test_run_id: string;
  status: 'passed' | 'failed';
  screenshot_blob_hash: string | null;
  video_blob_hash: string | null;
  test_title: string;
  error_excerpt?: string;
};
```

---

## 3. Worker Handler

**File**: `packages/workers/src/handlers/validate-with-playwright.ts`

```
job received: { project_id, test_id, agent_run_id }
  1. fetch project_test → spec_path
  2. fetch project_file at spec_path → spec content
  3. resolve preview URL for project (GET /api/projects/:id/preview → base_url)
  4. wait for preview status = 'ready' (poll max 10s, then fail fast)
  5. acquire browser context from pool
  6. write spec to tmpfs at /tmp/devmind-pw/<run_id>/
  7. run Playwright test (Chromium only, v1) with timeout 30s
  8. capture screenshot at final assertion
  9. capture video only on failure
  10. upload screenshot + video as blobs via ProjectSnapshotBlobsRepo.writeIfMissing()
  11. insert project_test_run with status + hashes + error_excerpt
  12. release browser context to pool
  13. update job status → done
```

### Browser Pool

```
BrowserPool {
  size: 2 (default, configurable via PLAYWRIGHT_POOL_SIZE env)
  acquire(): blocks with 60s timeout if all contexts busy
  release(ctx): ctx.clearCookies(); ctx.clearPermissions()
  onJobError(): kill context, spawn fresh
}
```

Initialized once at workers startup. Chromium only in v1. `shm-size: 256m` in docker-compose to prevent `/dev/shm` exhaustion.

---

## 4. Agent Tools

### `propose_acceptance_test`

- Input: `{ intent: string, project_id: string }`
- Generates a Playwright spec using role/label locators (`getByRole`, `getByLabel`, `getByText`)
- Writes file to `e2e/<slug>.spec.ts` in `project_files` (versioned by 004 like any other file)
- Inserts `project_test` with `source='acceptance'`, `status='draft'`
- Returns `{ test_id, spec_path }`

### `run_project_tests`

- Input: `{ test_ids: string[], project_id: string, agent_run_id: string }`
- Enqueues one job per test_id in the SQLite job queue
- Polls `project_test_runs` until all done or timeout (60s total)
- Returns `{ results: Array<{ test_id, status, error_excerpt, screenshot_blob_hash }> }`

### `attach_evidence_to_message`

- Input: `{ message_id: string, test_run_id: string }`
- Reads `project_test_run` → builds `MessageEvidence`
- Updates `messages.evidence_json`
- Returns `{ ok: true }`

---

## 5. Agent Loop Integration

In `packages/backend/src/agent/loop.ts`:

- After code generation phase: call `run_project_tests`
- Track `self_correction_attempts` (max 3) per run
- If `validation.gate_on_tests=ON` and all tests fail after 3 attempts → close run with `status='failed'`, attach evidence of last attempt
- If `validation.gate_on_tests=OFF` → run completes regardless; evidence still attached if tests were run

The post-snapshot (004) is taken after test pass; `screenshot_blob_hash` on the snapshot comes from `evidence_screenshot_hash` of the passing test run.

---

## 6. Feature Flags

| Flag | Default | Effect |
|------|---------|--------|
| `validation.playwright_enabled` | OFF | Master switch — enables the worker handler and agent tools |
| `validation.gate_on_tests` | OFF | Blocks agent run completion until tests pass (after enabled) |
| `validation.attach_evidence_to_messages` | OFF | Extends message payload with evidence field |

All three default OFF. Production rollout order: enable `playwright_enabled` → validate container, then enable `gate_on_tests` → validate UX, then enable `attach_evidence_to_messages`.

---

## 7. Frontend Changes

### Builder.tsx — Tests sidebar tab

New tab alongside the existing timeline tab. Shows:
- List of `project_tests` with last-run status badge + duration
- "Run" button per test → calls `POST /api/projects/:id/tests/:testId/run`
- Evidence viewer: thumbnail (full-size on click) + error excerpt on failure

### MessageList.tsx — Evidence attachment

When `message.evidence_json` is set:
- Renders a compact block below message text: pass/fail badge + test title + screenshot thumbnail
- On fail: expandable error excerpt
- Thumbnail click → full-size blob from `GET /api/projects/:id/snapshot-blobs/:hash`

### Snapshot timeline (004) — Thumbnails

Snapshot cards in the timeline display `screenshot_blob_hash` thumbnail when present. No layout change — thumbnail replaces the empty grey placeholder already in the design.

---

## 8. Docker Changes

### `Dockerfile.workers`

```dockerfile
# After existing node deps install:
RUN pnpm exec playwright install chromium --with-deps
```

Uses `mcr.microsoft.com/playwright:v1.x-noble` as base OR adds system deps inline. Chromium only in v1 (~280 MB additional).

### `docker-compose.yml`

```yaml
workers:
  shm_size: '256m'        # prevent /dev/shm exhaustion under Playwright
  tmpfs:
    - /tmp/devmind-pw     # test spec scratch space, cleared per-run
```

---

## 9. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test code storage | Inside generated project (`project_files`) | Tests ship with the app; versioned by 004; runnable outside DevMind |
| Evidence storage | Reuse `project_snapshot_blobs` from 004 | Avoids new storage layer; retention shares pruning |
| Browser | Chromium only | Simplest path; Firefox/WebKit deferred to 006 |
| Retries | OFF in v1 | Surfaces flakiness explicitly rather than hiding it |
| Pool size | 2 | Prevents resource exhaustion; configurable via env |
| Video | Failure only | Success keeps a PNG; video (1–5 MB) only when needed for debugging |
