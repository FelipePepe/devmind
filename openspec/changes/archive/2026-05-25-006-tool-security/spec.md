# Spec: 006-tool-security

## Overview

Backend security and governance for the agent's tool stack. Adds a
persistent audit log, server-side argument validation, a per-tool safety
classification and a coarse global autonomy gate. The UI confirmation flow
is out of scope and lands in a follow-up change.

## Data model

### `tool_call_audit` (new)

```sql
CREATE TABLE tool_call_audit (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_run_id    TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT,
  tool_name       TEXT NOT NULL,
  safety          TEXT NOT NULL CHECK(safety IN ('read','write','destructive')),
  args_json       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('ok','error','blocked','invalid-args')),
  output_excerpt  TEXT NOT NULL DEFAULT '',
  error           TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tool_audit_agent_run ON tool_call_audit(agent_run_id, started_at);
CREATE INDEX idx_tool_audit_session   ON tool_call_audit(session_id, started_at);
CREATE INDEX idx_tool_audit_tool      ON tool_call_audit(tool_name, status, started_at);
```

Migration file: `packages/backend/src/db/migrations/019_tool_audit.sql`.

### `ToolDef` (extension)

```ts
export type ToolSafety = 'read' | 'write' | 'destructive';

export interface ToolDef {
  name: string;
  description: string;
  parameters: OllamaTool['function']['parameters'];
  safety: ToolSafety;             // NEW — required
  inputSchema?: z.ZodTypeAny;     // NEW — optional, validated by executor
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
```

### Feature flag

`tools.autonomy_level` with values `auto` (default) or `block-destructive`.
Registered in migration 019 alongside the table, default `auto`.

## Executor contract

`ToolExecutor.execute(call, ctx)` MUST:

1. Look up the tool by name. If not found, insert an audit row with
   `status='invalid-args'`, `output_excerpt='Unknown tool: X'` and return
   an error `ToolResult`. Do not proceed.
2. Parse `call.function.arguments` as JSON. On failure, insert an audit
   row with `status='invalid-args'`, `output_excerpt='Failed to parse tool
   arguments'` and return an error `ToolResult`.
3. If `tool.inputSchema` is defined, run `inputSchema.safeParse(args)`. On
   failure, insert an audit row with `status='invalid-args'` and an excerpt
   containing the flattened Zod issue list. Return an error `ToolResult`
   whose content is the Zod issues serialized as JSON.
4. Read the `tools.autonomy_level` flag once per `execute` call. If the
   value is `block-destructive` AND `tool.safety === 'destructive'`,
   insert an audit row with `status='blocked'`, `output_excerpt='Blocked
   by operator policy: tools.autonomy_level=block-destructive'`. Return an
   error `ToolResult` with the same message.
5. Otherwise, insert an audit row with provisional `status='ok'`,
   capturing `started_at = now()`. Save the row id.
6. Run `await tool.execute(args, ctx)` under the existing timeout + abort
   signal wiring.
7. On success, update the audit row with `status='ok'`,
   `output_excerpt = first 2 KB of the result`, `duration_ms =
   now - started_at`, `finished_at = now()`. Return a successful
   `ToolResult`.
8. On thrown error, update the audit row with `status='error'`,
   `output_excerpt = first 2 KB of err.message`, `error = err.message`,
   `duration_ms`, `finished_at`. Return an error `ToolResult` as today.

The executor MUST NOT skip the audit write in any of the above paths. A
failed audit write is logged at WARN level but does not change the
`ToolResult` returned to the agent (audit failures must not break the
agent loop, just as snapshot failures must not in spec 004).

## Tool classification

The following tools MUST declare `safety` exactly as below in this change:

| Tool | safety | inputSchema required? |
|---|---|---|
| `file_read` | `read` | no |
| `file_list` | `read` | no |
| `search_code` | `read` | no |
| `vector_search` | `read` | no |
| `read_project_file` | `read` | no |
| `list_project_files` | `read` | no |
| `get_session_history` | `read` | no |
| `save_session` | `write` | yes (Zod) |
| `task_update` | `write` | yes (Zod) |
| `write_project_file` | `write` | yes (Zod) |
| `update_project_manifest` | `write` | yes (Zod) |
| `upsert_project_service` | `write` | yes (Zod) |
| `upsert_project_api_route` | `write` | yes (Zod) |
| `upsert_project_db_schema` | `write` | yes (Zod) |
| `upsert_project_db_migration` | `write` | yes (Zod) |
| `upsert_project_env_var` | `write` | yes (Zod) |
| `create_project_snapshot` | `write` | yes (Zod) |
| `run_command` | `destructive` | yes (Zod) |

Read tools may add a Zod schema later; this change does not require it.

## Admin endpoint

`GET /admin/tool-audit?limit=N`:

- Auth: `authMiddleware` + `adminMiddleware`.
- Query: `limit` (integer, default 100, max 500).
- Response: `Array<{ id, agent_run_id, session_id, user_id, project_id,
  tool_name, safety, args_json, status, output_excerpt, error, duration_ms,
  started_at, finished_at }>`, ordered by `started_at DESC`.

Route lives in `packages/backend/src/admin/routes.ts`.

## Acceptance

A reviewer should be able to:

1. Read a chat session, see N tool messages, query `/admin/tool-audit` and
   find N corresponding audit rows with matching `tool_name` and `args_json`.
2. Manually craft a malformed argument for `run_command` (e.g. `command` as
   an array), invoke it, and observe `status='invalid-args'` in the audit
   row with the Zod issue list in `output_excerpt`.
3. Set `tools.autonomy_level=block-destructive`, send a prompt that would
   normally trigger `run_command`, and observe `status='blocked'` in the
   audit row plus a clear error message returned to the agent.
4. Confirm `pnpm typecheck`, `pnpm -r build` and `pnpm lint` all pass on
   the change.
