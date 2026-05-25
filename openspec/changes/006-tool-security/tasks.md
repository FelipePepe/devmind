# Tasks: 006 — Tool Security & Audit

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 [infra] Approve `006-tool-security` proposal, design, spec
- [x] 0.2 [infra] Confirm safety classification is required (no default)
- [x] 0.3 [infra] Confirm v1 ships a single global `tools.autonomy_level` flag
- [x] 0.4 [infra] Confirm UI confirmation flow is out of scope for this change

## Phase 1 — Audit log table + repo [backend]

- [ ] 1.1 [backend] Add migration `019_tool_audit.sql`:
  - `tool_call_audit` table with all columns from spec
  - indexes on `(agent_run_id, started_at)`, `(session_id, started_at)`, `(tool_name, status, started_at)`
  - register `tools.autonomy_level` feature flag with default `auto`
- [ ] 1.2 [backend] Add `ToolCallAuditRepo` with:
  - `insertStart({...}): string` (returns id) — inserts provisional row
  - `insertFinal({...}): void` — for paths that complete in one shot (invalid-args, blocked)
  - `updateFinish(id, {status, output_excerpt, error, duration_ms})`
  - `findRecent(limit): ToolCallAudit[]`

## Phase 2 — Safety classification per tool [backend]

- [ ] 2.1 [backend] Extend `ToolDef` with required `safety: ToolSafety` and optional `inputSchema: z.ZodTypeAny`
- [ ] 2.2 [backend] Classify every existing tool per the table in spec:
  - read: `file_read`, `file_list`, `search_code`, `vector_search`, `read_project_file`, `list_project_files`, `get_session_history`
  - write: `save_session`, `task_update`, `write_project_file`, all `project-structure-tools` upserts, `create_project_snapshot`
  - destructive: `run_command`
- [ ] 2.3 [backend] Verify the registry build still passes typecheck after adding the required field

## Phase 3 — Zod input validation [backend]

- [ ] 3.1 [backend] Add `inputSchema` to `run_command` (command in allowlist, args array, optional cwd inside workspace)
- [ ] 3.2 [backend] Add `inputSchema` to `write_project_file` (path nonempty, content string)
- [ ] 3.3 [backend] Add `inputSchema` to the `project-structure-tools` upserts (one schema per tool)
- [ ] 3.4 [backend] Add `inputSchema` to `task_update` and `save_session`
- [ ] 3.5 [backend] Add `inputSchema` to `create_project_snapshot`
- [ ] 3.6 [backend] Read tools keep `inputSchema` undefined; document the convention in `types.ts`

## Phase 4 — Executor wireup [backend]

- [ ] 4.1 [backend] Inject `ToolCallAuditRepo` and `FlagsRepo` into `ToolExecutor` constructor
- [ ] 4.2 [backend] Implement the executor flow exactly as the spec section "Executor contract" describes:
  - unknown tool / bad JSON / Zod fail → `insertFinal('invalid-args', ...)`
  - autonomy gate → `insertFinal('blocked', ...)`
  - normal path → `insertStart` then `updateFinish('ok' or 'error', ...)`
- [ ] 4.3 [backend] Wire the new constructor args at the call site in `chat/routes.ts` and anywhere else `new ToolExecutor(...)` is called
- [ ] 4.4 [backend] Ensure audit-write failures are logged at WARN but never bubble up as agent errors

## Phase 5 — Admin endpoint [backend]

- [ ] 5.1 [backend] Add `GET /admin/tool-audit?limit=N` to `admin/routes.ts`, admin-gated
- [ ] 5.2 [backend] Validate `limit` (default 100, max 500)
- [ ] 5.3 [backend] Wire `ToolCallAuditRepo` into `createAdminRouter` signature and `index.ts`

## Phase 6 — Verification [infra]

- [ ] 6.1 [infra] Manual: run a chat session that calls read + write + destructive tools; query `/admin/tool-audit`; confirm one row per call with correct safety
- [ ] 6.2 [infra] Manual: send a prompt that triggers `run_command` with a malformed argument shape; confirm `status='invalid-args'` and Zod issues in excerpt
- [ ] 6.3 [infra] Manual: set `tools.autonomy_level=block-destructive`; trigger `run_command`; confirm `status='blocked'` and clear error to the agent
- [ ] 6.4 [infra] Confirm `pnpm -r build` passes
- [ ] 6.5 [infra] Confirm `pnpm typecheck` passes
- [ ] 6.6 [infra] Confirm `pnpm lint` passes
- [ ] 6.7 [infra] Update `README.md` to mark phase 8 as ✅ (audit + classification + Zod + gate)
