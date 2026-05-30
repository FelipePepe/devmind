# Proposal: 005-playwright-validation

## Intent

Convert DevMind from "a generator that emits code" into **a generator that proves the code does what the user asked for**. Today the agent declares completion based on its own narration — there is no executable evidence that the generated app actually behaves as intended. This change introduces Playwright as a first-class validation layer that:

- writes acceptance tests **from the user's intent** before code is generated
- runs those tests against the live preview in a sandboxed worker
- captures screenshots and short videos as evidence
- attaches that evidence to chat messages and project snapshots
- stores tests as a durable project resource that ships with the generated app

The product effect is closing the credibility gap. The user sees a screenshot of the working feature inside the chat, can scrub a timeline of past states with visual thumbnails, and the agent stops claiming success until a deterministic test has passed.

## Scope

### In Scope

- `packages/workers/src/handlers/` — new `validate-with-playwright.ts` job handler that drives the preview runtime
- `packages/workers/src/playwright/` — Playwright runner, browser pool, video/screenshot capture
- `packages/backend/src/db/migrations/` — schema for `project_tests`, `project_test_runs`, and the screenshot link on snapshots
- `packages/backend/src/db/repos/` — `ProjectTestsRepo`, `ProjectTestRunsRepo`
- `packages/backend/src/builder/routes.ts` — endpoints for test list, test runs, evidence download
- `packages/backend/src/tools/impl/` — agent tools `propose_acceptance_test`, `run_project_tests`, `attach_evidence_to_message`
- `packages/backend/src/agent/loop.ts` — intent → test → code → run loop; gate completion on test pass
- `packages/backend/src/chat/routes.ts` — message payload extended with `evidence` (screenshot / video / test result)
- `packages/frontend/src/pages/Builder.tsx` — tests sidebar tab; snapshot timeline thumbnails (consumes 004's `screenshot_blob_hash`)
- `packages/frontend/src/components/chat/MessageList.tsx` — render evidence attachments inline
- `Dockerfile.workers` and `docker-compose.yml` — install Playwright browser deps in the workers container

### Out of Scope

- Cross-browser matrix (v1: Chromium only; Firefox/WebKit deferred to 006)
- Accessibility audits via axe-core (deferred to 006)
- Performance budgets and Web Vitals capture (deferred to 006)
- Mobile viewport emulation (deferred to 006)
- Form fuzzing / property-based input generation (deferred to 006)
- Network request fuzzing / chaos testing
- Visual regression baselining as a hard gate (visual diff is shown in UI but not a pass/fail signal in v1)
- Production / hosted-app monitoring outside the `.casa` preview runtime

## Problem Statement

The agent currently has three blind spots between writing code and the user reading the next assistant message:

1. **No runtime confirmation.** The agent reasons about the code it wrote and then claims the feature works. If a route returns 500, if a button has the wrong handler, if state never updates, the agent does not know — only the user does, after manually clicking.
2. **No evidence in the conversation.** The agent says "I added a login form". The user has to leave the chat, click into the preview, find the form, try it, come back. Every successful step has a tax.
3. **No durable acceptance criteria.** "Users should be able to log in" is a sentence in chat history. Two prompts later, when the agent refactors auth, nothing checks that this still works.

These gaps mean the builder loses trust quickly. The user learns that "done" doesn't mean done, and starts prompting defensively ("really done? are you sure? show me?"). The product needs a closed loop where the agent's claim of completion is **backed by something the user did not have to verify**.

Playwright is the natural fit: it can drive a real browser against the existing preview runtime, capture deterministic evidence, and store reusable tests. The preview runtime already exists (from 003), the snapshot system already exists (from 004 with the deferred screenshot hook), and the agent tool registry already exists. This change connects them.

## Proposed Direction

Introduce a **test-as-evidence** model where every meaningful agent run is gated on at least one Playwright test passing, and the run produces evidence (screenshot or short video) that is attached to the closing assistant message.

### Domain model

```text
project_test
  id, project_id
  source            ← enum: 'acceptance' (from user intent) | 'smoke' (auto-generated) | 'manual' (user-edited)
  title             ← short human-readable
  intent            ← original user phrase that motivated the test (verbatim)
  spec_path         ← path inside the generated project (lives with the app)
  status            ← enum: 'draft' | 'active' | 'disabled'
  created_by_run_id ← agent run that proposed it

project_test_run
  id, project_id, test_id, agent_run_id
  status            ← 'pending' | 'passed' | 'failed' | 'errored' | 'timed_out'
  duration_ms
  evidence_screenshot_hash  ← blob hash (stored in project_snapshot_blobs from 004)
  evidence_video_hash       ← optional, blob hash
  error_excerpt     ← first ~300 chars of failure if not passed
  trace_json        ← compressed Playwright trace, lazily fetched
  created_at, finished_at
```

### Agent loop integration

The current `runAgentLoop` becomes:

```text
1. parse user intent
2. agent.propose_acceptance_test(intent) → creates project_test in 'draft'
3. agent writes / edits code via existing structured tools
4. agent.run_project_tests([test_id]) → enqueues a worker job, blocks for result
5. if test passed:
     - capture post-snapshot (004) with screenshot from test_run
     - agent.attach_evidence_to_message(message_id, test_run_id)
     - finish run
   if test failed:
     - agent reads error_excerpt, iterates (back to step 3)
     - max 3 self-correction attempts
   if 3 attempts fail:
     - agent reports failure honestly with evidence
     - user decides next action
```

A feature flag `validation.gate_on_tests` controls whether failure blocks completion (default ON for project-scoped runs, OFF for chat-only runs). A second flag `validation.attach_evidence_to_messages` controls the chat payload extension.

### Worker handler

`validate-with-playwright.ts` job:

1. resolves the preview runtime URL for the project
2. checks out the test spec from `project_files` (it lives inside the generated app)
3. spawns Playwright against the preview using a pooled browser context
4. captures screenshot at the final assertion and video on failure
5. uploads both as blobs into `project_snapshot_blobs`
6. writes `project_test_run` with hashes and status
7. closes the browser context, returns to pool

A bounded browser pool (default 2 concurrent) prevents resource exhaustion. Each test has a hard timeout (default 30s) and a per-project run quota (default 20/minute).

### Tests live inside the generated project

Test specs are written to `e2e/*.spec.ts` inside the generated app's file tree, not into DevMind's own storage. They are versioned by 004 like any other file. When the user exports or publishes the project, the tests go with it. When they open the project in their own editor, the tests are runnable with `pnpm playwright test`.

DevMind's database stores only the **metadata** (`project_test`) and **runs** (`project_test_run`). The test code itself is part of the user's project.

### Evidence in chat

`message.evidence` becomes an optional structured field:

```ts
type MessageEvidence = {
  test_run_id: string;
  status: 'passed' | 'failed';
  screenshot_blob_hash: string | null;
  video_blob_hash: string | null;
  test_title: string;
};
```

The frontend renders this inline: a thumbnail (clickable to full size), the test title, and a pass/fail badge. For failures, the error excerpt is shown.

### Acceptance test authoring

The `propose_acceptance_test` tool receives the user intent and a structured context (current manifest, services, recent file changes). It produces a Playwright spec that:

- prefers `getByRole`, `getByLabel`, `getByText` over CSS selectors (resilience to refactor)
- includes one positive assertion per intent phrase
- runs against the preview base URL, never hardcoded ports

The agent system prompt is extended with examples of well-formed acceptance tests for common DevMind intents (login, CRUD form, list filter, navigation).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/workers/src/handlers/validate-with-playwright.ts` | High | New handler: full Playwright orchestration |
| `packages/workers/src/playwright/` | High | New module: runner, browser pool, evidence capture |
| `packages/workers/package.json` | Medium | Add `playwright` dep, install browsers in postinstall |
| `Dockerfile.workers` | Medium | Add system deps required by Chromium (fonts, libnss, etc.) |
| `docker-compose.yml` | Low | Possibly extend workers tmpfs / shm size for browser stability |
| `packages/backend/src/db/migrations/` | High | Migration 019: `project_tests`, `project_test_runs`, message.evidence column |
| `packages/backend/src/db/repos/` | High | New repos for tests and test runs |
| `packages/backend/src/agent/loop.ts` | High | Test-gated completion, evidence attachment |
| `packages/backend/src/tools/impl/project-structure-tools.ts` | Medium | New tools: propose, run, attach evidence |
| `packages/backend/src/builder/routes.ts` | Medium | Test list, run history, evidence download endpoints |
| `packages/backend/src/chat/routes.ts` | Low | Extend message payload with evidence field |
| `packages/frontend/src/pages/Builder.tsx` | High | New `tests` sidebar tab; snapshot thumbnails consume 004's hook |
| `packages/frontend/src/components/chat/MessageList.tsx` | Medium | Render evidence attachment block |
| `packages/frontend/src/types/index.ts` | Low | New types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Playwright browser install bloats workers container by 300–500 MB | High | Use `mcr.microsoft.com/playwright` base image or a multi-stage Dockerfile that strips unused browsers (keep Chromium only in v1) |
| Browser process leaks / hangs exhaust workers resources | High | Bounded pool, hard per-test timeout, kill orphan processes on job error, shm sizing |
| Auto-tests slow down every agent run | Medium | Tests run in parallel with code generation where possible; failure-gated only for project-scoped runs |
| Generated tests are flaky (timing, race conditions) | High | Strict use of role/label locators; built-in `waitForLoadState`; retries OFF in v1 to surface flakiness explicitly |
| Test gating frustrates users who want a quick prototype | Medium | Feature flag `validation.gate_on_tests` per-project; "skip tests" toggle in builder for prototyping mode |
| Evidence storage explodes (videos can be 1–5 MB each) | Medium | Default: video only on failure; success keeps a single PNG; retention shares 004's pruning |
| Tests inside the user project conflict with their own future testing setup | Medium | Tests live in `e2e/` (conventional Playwright dir); detected via manifest; user can opt out |
| Network sandbox: tests reach external services unintentionally | Medium | Default Playwright route handler blocks non-`.casa` hosts unless explicitly allowed by manifest |
| Cold start cost on first test of a session is large | Low | Keep one warm browser context in the pool; cold-start surfaced in UI as "warming up tests…" |
| Tests fail because the preview runtime is not ready yet | Medium | Worker waits for `preview.status = 'ready'` before launching browser; fails fast with clear error otherwise |

## Rollback Plan

This change is **additive-first** and gated behind feature flags throughout:

- `validation.playwright_enabled` (master switch) — OFF by default until container deps verified
- `validation.gate_on_tests` — OFF until acceptance-test generation quality is validated
- `validation.attach_evidence_to_messages` — OFF until chat UI lands

If a phase fails after merge:

- Flip flags off → agent loop reverts to current behavior; chat messages omit evidence; tests still readable but not enforced.
- New tables stay; no destructive migration.
- The Playwright npm dep and Docker image weight cannot easily be rolled back, but they are inert if the master flag is off.

The hook column added in 004 (`screenshot_blob_hash`) remains nullable; if 005 is fully rolled back, snapshots simply have no thumbnails.

## Success Criteria

- [ ] When the user states an intent, the agent proposes a Playwright spec stored under `e2e/` in the generated project before writing application code
- [ ] After a successful agent run, the closing assistant message carries a passing test result and a screenshot as evidence
- [ ] After a failed run, the agent self-corrects up to 3 times before reporting honest failure with the error excerpt and screenshot
- [ ] Snapshot timeline (from 004) displays thumbnails for every snapshot taken at a test pass moment
- [ ] The tests sidebar tab shows the full list of project tests with last-run status, duration, and links to evidence
- [ ] A user can re-run any test on demand from the UI and see updated evidence
- [ ] Generated tests survive project export and are runnable via `pnpm playwright test` outside DevMind
- [ ] Workers container builds and starts cleanly with Playwright browser deps included
- [ ] Default browser pool size and timeouts prevent resource exhaustion under 5 concurrent agent runs
- [ ] All Playwright behavior is gated behind the three feature flags; flipping them off reverts to pre-005 behavior
