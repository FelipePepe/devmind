# Delta Spec: 005-playwright-validation

> Introduces a Playwright-based validation layer that gates agent run completion on deterministic test evidence. Tests live inside the generated project, evidence is stored in the blob store (004), and all behavior is controlled by three feature flags.

---

## ### ADDED — test-proposal

**Package**: `packages/backend/src/tools/impl/`, `packages/backend/src/db/repos/project-tests.ts`, `packages/backend/src/db/migrations/023_playwright_validation.sql`

### Requirement: Acceptance Test Proposal

The agent MUST propose an acceptance test before writing application code when `validation.playwright_enabled` is ON. The test spec SHALL be written to `e2e/<slug>.spec.ts` inside the generated project's file tree (as a `project_file`) and be versioned by the 004 blob store. A `project_test` record SHALL be inserted with `source='acceptance'` and `status='draft'`.

#### Scenario: Propose test from user intent

- GIVEN a project-scoped agent run with `validation.playwright_enabled=ON`
- WHEN the agent calls `propose_acceptance_test({ intent, project_id })`
- THEN a file `e2e/<slug>.spec.ts` is written to `project_files` using only `getByRole`, `getByLabel`, or `getByText` locators
- AND a `project_test` record is inserted with `source='acceptance'`, `status='draft'`, `intent` verbatim
- AND the tool returns `{ test_id, spec_path }`

#### Scenario: Flag disabled — no test proposal

- GIVEN `validation.playwright_enabled=OFF`
- WHEN any agent run executes
- THEN `propose_acceptance_test` is not called and agent loop proceeds as pre-005

---

## ### ADDED — test-execution

**Package**: `packages/workers/src/handlers/validate-with-playwright.ts`, `packages/workers/src/playwright/`

### Requirement: Playwright Test Execution

The system MUST execute Playwright tests against the live preview runtime in a bounded browser pool. Each test run MUST produce a `project_test_run` record with `status`, `duration_ms`, `evidence_screenshot_hash`, and `error_excerpt`. The browser pool MUST have a hard size limit (default 2) and each test MUST time out at 30 seconds.

#### Scenario: Test passes

- GIVEN a project with a `project_test` in `status='draft'` or `'active'`
- AND the preview runtime is in `status='ready'`
- WHEN `run_project_tests` enqueues a `validate-with-playwright` job
- THEN the worker acquires a Chromium context, runs the spec against the preview URL
- AND captures a screenshot at the final assertion
- AND inserts `project_test_run` with `status='passed'`, `evidence_screenshot_hash` set, `evidence_video_hash=null`
- AND releases the browser context to the pool

#### Scenario: Test fails

- GIVEN the same setup but the test assertion fails
- THEN the worker captures a screenshot and a short video
- AND inserts `project_test_run` with `status='failed'`, both hashes set, `error_excerpt` = first 300 chars of failure output

#### Scenario: Preview not ready

- GIVEN a project whose preview `status != 'ready'` after 10s polling
- WHEN a test job is enqueued
- THEN the worker inserts `project_test_run` with `status='errored'`, `error_excerpt='preview not ready after 10s'`
- AND does NOT acquire a browser context

#### Scenario: Test times out

- GIVEN a test that does not complete within 30 seconds
- THEN the worker kills the browser context, spawns a fresh one
- AND inserts `project_test_run` with `status='timed_out'`

#### Scenario: Pool exhausted

- GIVEN all 2 browser contexts are busy
- WHEN a third test job starts
- THEN the job waits up to 60 seconds for a context to become available before failing with `status='errored'`

---

## ### ADDED — agent-loop-gating

**Package**: `packages/backend/src/agent/loop.ts`

### Requirement: Test-Gated Run Completion

When `validation.gate_on_tests=ON`, the agent MUST NOT close a run as successful until at least one acceptance test passes. The agent SHALL self-correct up to 3 times on failure before reporting honest failure.

#### Scenario: Test passes on first attempt

- GIVEN `validation.gate_on_tests=ON`
- WHEN the agent runs tests and the first test run returns `status='passed'`
- THEN the agent closes the run as successful and calls `attach_evidence_to_message`

#### Scenario: Test fails — self-correction

- GIVEN `validation.gate_on_tests=ON`
- AND a test run returns `status='failed'` with `error_excerpt` set
- WHEN this is attempt N < 3
- THEN the agent reads `error_excerpt`, re-enters code generation, and re-runs the test

#### Scenario: Test fails after 3 attempts

- GIVEN `validation.gate_on_tests=ON`
- AND all 3 self-correction attempts return `status='failed'`
- THEN the agent closes the run as failed, attaches evidence of the last run (screenshot + error_excerpt)
- AND reports honest failure to the user with the evidence

#### Scenario: Gate disabled

- GIVEN `validation.gate_on_tests=OFF`
- WHEN tests are run and fail
- THEN the agent still attaches evidence if `validation.attach_evidence_to_messages=ON`, but the run is closed as successful regardless

---

## ### ADDED — evidence-in-messages

**Package**: `packages/backend/src/chat/routes.ts`, `packages/frontend/src/components/chat/MessageList.tsx`

### Requirement: Evidence Attachment to Chat Messages

When `validation.attach_evidence_to_messages=ON`, the closing assistant message of an agent run MUST carry a `MessageEvidence` payload with test result, title, screenshot hash, and (on failure) error excerpt.

#### Scenario: Attach evidence after passing test

- GIVEN `validation.attach_evidence_to_messages=ON`
- WHEN the agent calls `attach_evidence_to_message({ message_id, test_run_id })`
- THEN `messages.evidence_json` is set to a `MessageEvidence` object with `status='passed'`, `screenshot_blob_hash` set, `test_title` set

#### Scenario: Frontend renders evidence inline

- GIVEN a message with `evidence_json` set
- WHEN `MessageList` renders the message
- THEN a compact block appears below the message text: pass/fail badge + test title + screenshot thumbnail
- AND on failure: the `error_excerpt` is shown in an expandable section
- AND clicking the thumbnail renders the full-size image from `GET /api/projects/:id/snapshot-blobs/:hash`

#### Scenario: No evidence — backward compat

- GIVEN a message with `evidence_json=null`
- WHEN `MessageList` renders the message
- THEN the message renders exactly as pre-005 (no regression)

---

## ### ADDED — tests-sidebar

**Package**: `packages/frontend/src/pages/Builder.tsx`, `packages/backend/src/builder/routes.ts`

### Requirement: Tests Sidebar in Builder

The Builder MUST expose a "Tests" tab showing all `project_tests` for the current project, each with last-run status, duration, and an on-demand run trigger.

#### Scenario: List tests

- GIVEN a project with one or more `project_tests`
- WHEN the user opens the Tests tab in Builder
- THEN each test is shown with title, source badge, status of last `project_test_run`, and duration

#### Scenario: Re-run test on demand

- GIVEN any `project_test` with `status='active'`
- WHEN the user clicks the "Run" button
- THEN `POST /api/projects/:id/tests/:testId/run` is called
- AND the test status updates in real time (polling or WS event) until `passed`, `failed`, `errored`, or `timed_out`

#### Scenario: No tests yet

- GIVEN a project with no `project_tests`
- WHEN the user opens the Tests tab
- THEN an empty state is shown with explanation ("Tests proposed by the agent will appear here")

---

## ### ADDED — snapshot-thumbnails

**Package**: `packages/frontend/src/pages/Builder.tsx` (snapshot timeline section)

### Requirement: Snapshot Timeline Thumbnails

Snapshot cards in the 004 timeline MUST display a thumbnail when `screenshot_blob_hash` is present on the snapshot.

#### Scenario: Snapshot with thumbnail

- GIVEN a snapshot with `screenshot_blob_hash` set (populated by a passing test run)
- WHEN the snapshot timeline renders
- THEN the snapshot card shows a thumbnail image loaded from `GET /api/projects/:id/snapshot-blobs/:hash`

#### Scenario: Snapshot without thumbnail

- GIVEN a snapshot with `screenshot_blob_hash=null`
- WHEN the timeline renders
- THEN the card shows the existing placeholder (no regression vs. pre-005)

---

## ### ADDED — backend-test-routes

**Package**: `packages/backend/src/builder/routes.ts`

### Requirement: Test Management API

The backend MUST expose CRUD and run endpoints for `project_tests`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:id/tests` | `requireAuth` | List all tests for project |
| GET | `/api/projects/:id/tests/:testId/runs` | `requireAuth` | List run history for a test |
| POST | `/api/projects/:id/tests/:testId/run` | `requireAuth` | Enqueue on-demand run |
| GET | `/api/projects/:id/tests/:testId/runs/:runId/evidence` | `requireAuth` | Redirect to blob download for screenshot |

All inputs validated with Zod. Responses use existing API envelope `{ data, error }`.

---

## ### MODIFIED — docker-workers

**Package**: `Dockerfile.workers`, `docker-compose.yml`

### Requirement: Playwright Runtime in Workers Container

The workers container MUST include Chromium and its system dependencies. `docker-compose.yml` MUST set `shm_size: 256m` and a `tmpfs` mount at `/tmp/devmind-pw` for the workers service.

#### Scenario: Container builds with Playwright

- GIVEN a fresh `docker compose build workers`
- WHEN the build completes
- THEN `pnpm exec playwright install chromium --with-deps` has run and `chromium` is resolvable from within the container

#### Scenario: Workers start clean

- GIVEN `docker compose up workers`
- WHEN the workers process starts
- THEN the browser pool initializes 0 contexts (lazy) and logs `playwright pool ready (size=2)`

---

## Non-Requirements (v1)

- Firefox, WebKit — deferred to 006
- Axe-core accessibility audits — deferred to 006
- Visual regression baselining as a hard gate — thumbnails shown but not diff-compared
- Performance budgets / Web Vitals — deferred to 006
- Mobile viewport emulation — deferred to 006
- Cross-origin network sandbox — deferred (documented risk)
