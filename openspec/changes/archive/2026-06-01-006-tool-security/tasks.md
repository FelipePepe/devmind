# Tasks: 006 — Tool Security & Audit

> **Status (2026-05-25)**: Backend phases 0–5 implemented and the full
> monorepo builds clean (`pnpm -r build`). Only Phase 6 (manual verification
> against a running stack) remains. The UI confirmation flow stays out of
> scope and is the natural follow-up change.

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 [infra] Approve `006-tool-security` proposal, design, spec
- [x] 0.2 [infra] Confirm safety classification is required (no default)
- [x] 0.3 [infra] Confirm v1 ships a single global `tools.autonomy_level` flag
- [x] 0.4 [infra] Confirm UI confirmation flow is out of scope for this change

## Phase 1 — Audit log table + repo [backend]

- [x] 1.1 [backend] Migration `019_tool_audit.sql`: `tool_call_audit` table with the columns from spec, indexes on `(agent_run_id, started_at)`, `(session_id, started_at)`, `(tool_name, status, started_at)`, registers `tools.autonomy_level` flag with default `auto`
- [x] 1.2 [backend] `ToolCallAuditRepo` with `insertStart`, `insertFinal`, `updateFinish`, `findRecent`, plus `excerpt()` helper capping stored output at 2 KB

## Phase 2 — Safety classification per tool [backend]

- [x] 2.1 [backend] Extend `ToolDef` with required `safety: ToolSafety` and optional `inputSchema: z.ZodTypeAny`; also add optional `agentRunId` to `ToolContext`
- [x] 2.2 [backend] Classify every existing tool:
  - read: `file_read`, `file_list`, `search_code`, `vector_search`, `read_project_file`, `list_project_files`, `read_project_manifest`, `session_history`, `artifact_list`
  - write: `write_project_file`, `update_project_manifest`, `create_project_service`, `upsert_api_route`, `upsert_database_schema`, `create_database_migration`, `upsert_env_var`, `request_project_validation`, `create_project_snapshot`, `task_update`
  - destructive: `run_command`
- [x] 2.3 [backend] Registry build typechecks with the required field

## Phase 3 — Zod input validation [backend]

- [x] 3.1 [backend] `inputSchema` on `run_command` (command nonempty, args array of strings, optional cwd)
- [x] 3.2 [backend] `inputSchema` on `write_project_file` (path nonempty, content string)
- [x] 3.3 [backend] `inputSchema` on each `project-structure-tools` write tool (`update_project_manifest`, `create_project_service`, `upsert_api_route`, `upsert_database_schema`, `create_database_migration`, `upsert_env_var`, `create_project_snapshot`). All use `.passthrough()` so the gradual rollout does not reject calls that include forward-compat extras.
- [x] 3.4 [backend] `inputSchema` on `task_update` (taskId nonempty, status enum)
- [x] 3.5 [backend] `inputSchema` on `create_project_snapshot` (label optional, runId optional/null)
- [x] 3.6 [backend] Read tools intentionally omit `inputSchema`; convention is documented in `types.ts`
- [x] 3.7 [backend] `save_session` registry decision — RESOLVED: intentionally NOT registered. `tools/index.ts` wires only `session_history`/`task_update`/`artifact_list` from `impl/session-tools.ts`; sessions persist automatically via the chat pipeline, so no agent-facing `session_save` tool is needed. The top-level `tools/session-save.ts` is an unused legacy stub (flagged for removal in a cleanup follow-up).

## Phase 4 — Executor wireup [backend]

- [x] 4.1 [backend] `ToolExecutor` constructor accepts optional `ToolCallAuditRepo` and `FlagsRepo` (back-compat for callers that have neither)
- [x] 4.2 [backend] Executor flow matches the spec exactly: unknown / bad JSON / Zod fail → `insertFinal('invalid-args', ...)`; autonomy gate → `insertFinal('blocked', ...)`; happy path → `insertStart` then `updateFinish('ok' or 'error', ...)`
- [x] 4.3 [backend] `runAgentLoop` accepts `toolAudit` and `flags`, forwards them to `ToolExecutor`. `chat/routes.ts` passes them from `deps`, and includes `agentRunId` in the `ctx` so audit rows are linked back to the run.
- [x] 4.4 [backend] Audit-write failures are caught in `writeStart`/`writeFinal`/`updateFinish` and logged at WARN; never bubble up to the agent loop.

## Phase 5 — Admin endpoint [backend]

- [x] 5.1 [backend] `GET /admin/tool-audit?limit=N`, admin-gated
- [x] 5.2 [backend] `limit` parsed with `Number.parseInt`, capped at 500 by the repo (default 100)
- [x] 5.3 [backend] `ToolCallAuditRepo` wired into `createAdminRouter` and `index.ts`

## Phase 6 — Verification [infra]

> **Verified live 2026-05-29** against a running stack (Node 22, Ollama
> `qwen3-coder:30b` remote). Two bugs found and fixed during verification:
> (1) `executor.ts::autonomyLevel()` compared the raw DB value (JSON-encoded
> string) against a plain string — gate never fired; fixed by JSON.parse.
> (2) `security.ts` gated HSTS behind `NODE_ENV=production` so the header
> was absent in dev/test; fixed by making it unconditional.
> Both fixes landed in commit `aca980b`.

- [x] 6.1 [infra] run a chat session calling read+write+destructive tools; `/admin/tool-audit` shows one row per call with correct safety — **VERIFIED**: `file_list` → `safety=read,status=ok`; `run_command` → `safety=destructive,status=ok`; audit trail confirms 1 row/call.
- [x] 6.2 [infra] `run_command` with malformed args → `status='invalid-args'` + Zod issues in excerpt — **VERIFIED**: `run_command{command:[1,2,3]}` recorded `status=invalid-args`, excerpt contains Zod path/message.
- [x] 6.3 [infra] `tools.autonomy_level=block-destructive` → `run_command` → `status='blocked'` + clear error — **VERIFIED** (after gate fix `aca980b`): `status=blocked`, excerpt `'Tool run_command blocked by operator policy: tools.autonomy_level=block-destructive'`.
- [x] 6.4 [infra] Confirm `pnpm -r build` passes
- [x] 6.5 [infra] Confirm `pnpm typecheck` passes (only meaningful once PR #7 merges and brings the per-package script + CI step into develop)
- [x] 6.6 [infra] Confirm `pnpm lint` passes (same — depends on PR #7 landing `eslint.config.mjs`)
- [x] 6.7 [infra] Update `README.md` to mark phase 8 as ✅ (audit + classification + Zod + gate)
