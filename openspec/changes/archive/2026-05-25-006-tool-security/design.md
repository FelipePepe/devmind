# Design: 006-tool-security

## Where the choke point lives

Today the only thing standing between the LLM's tool call and a shell command
or a file write is `ToolExecutor.execute()` in
`packages/backend/src/tools/executor.ts`. It already does three things every
call goes through:

1. Looks the tool up in the registry.
2. Parses the JSON arguments.
3. Wires a timeout + abort signal.

That makes it the natural place to insert validation, audit writes and the
autonomy gate. Every change in this proposal lives in this file or in the
data it consumes (`ToolDef.safety`, `ToolDef.inputSchema`, the audit repo,
the flag). The agent loop itself does not need to know that any of this
happened — the executor's contract is unchanged from the loop's perspective
(call in → `ToolResult` out).

## Why audit is its own table, not a column on messages

The `messages` table already stores rows with `role='tool'` carrying the
tool result text. That looks like it could host the audit data, but it has
the wrong shape:

- A message is human-readable text. The audit row needs structured columns
  (`tool_name`, `safety`, `status`, `duration_ms`, `args_json`) to support
  forensics queries like "how many destructive `write_project_file` calls
  failed last week".
- A message only exists when the loop produced one. Tool calls that fail at
  validation time (invalid args, blocked by policy) never reach the result
  message stage, but they still need to appear in the audit.
- Coupling audit lifecycle to message lifecycle means a deleted session
  loses its audit trail. The audit FK to `sessions` uses `ON DELETE CASCADE`
  by default but a future change might want longer retention; keeping it
  separate leaves that door open.

So `tool_call_audit` is its own table, FK-linked to `agent_runs`, `sessions`,
`users` and (when relevant) the project context, but not derived from
`messages`.

## Why `safety` is required, not defaulted

A required field forces a deliberate choice at tool definition time. If we
default to `read`, a new destructive tool ships unclassified and the
autonomy gate fails open. The migration to require the field on every
existing tool is a few lines per file; the safety guarantee is worth it.

The three values were chosen to map onto operator intuition:

- `read` — observes state, does not change anything in DevMind or the
  filesystem. (`file_read`, `file_list`, `search_code`, `vector_search`,
  `read_project_file`, `list_project_files`, `get_session_history`)
- `write` — creates or modifies project state that is recoverable via the
  snapshot system from spec 004. (`write_project_file`,
  `update_project_*`, `save_session`, `task_update`,
  the project-structure-tools that upsert manifests/services/api routes)
- `destructive` — does something that cannot be undone by restoring a
  snapshot: spawns processes (`run_command`), or eventually deletes
  files/projects/sessions outright.

`run_command` is destructive because the allowlist contains commands like
`git` and `npm` that mutate state on disk in ways the snapshot system
cannot capture. Even safe-looking commands like `pnpm install` write to
`node_modules`. Classifying it as `destructive` is the conservative call;
the autonomy gate can decide whether to actually block it.

## Why Zod, not just rely on the JSON Schema we already give Ollama

The JSON Schema in `ToolDef.parameters` is the contract we publish to the
model. Ollama (and most LLM tool-use stacks) treat it as advisory — the
model is encouraged to produce arguments matching the schema, but nothing
in the request/response path enforces it. The server has to assume any
shape can arrive.

Zod gives us:

- A runtime-validated TypeScript type for the args. The tool body can type
  its first parameter as `z.infer<typeof schema>` instead of
  `Record<string, unknown>` and stop doing the `String(args['path'] ?? '')`
  dance.
- An issue list with field-level errors that we can return to the agent so
  it can retry with a correct shape.
- Composable schemas — `pathInsideWorkspace`, `allowedCommandName` —
  reusable across tools.

The cost is one extra dependency on `zod`, which the backend already pulls
in. No new runtime weight.

## Why a single global flag, not per-user / per-project

The proposal calls for one flag in v1: `tools.autonomy_level`. Anything
finer-grained (per-user, per-project, per-tool, time-of-day) is plausible
but adds surface to a feature that has not been used in production yet.

The single flag covers the two concrete cases we care about right now:

- An operator wants to disable destructive operations while reviewing a
  long agent run. Flip to `block-destructive`. Agent gets a clear error
  for `run_command` and `write_project_file`, sees it in the next turn,
  asks for help or backs off.
- The default user wants the existing behaviour. Default `auto` matches
  what shipped before this change, so the rollout is invisible.

When the confirmation UI lands, the natural extension is a richer set of
levels (`confirm-destructive`, `confirm-all`, `auto-with-replay`) keyed
off the same flag. Per-project overrides can be added on top of the global
default in a later PR without breaking the schema we ship here.

## Audit shape and storage

The audit row is inserted *before* the tool body runs, with provisional
status. The reason is that if the process crashes mid-call, we still have a
record that the call started and what its args were. After the body
returns (or throws), the row is updated with the final status, duration
and output excerpt.

`output_excerpt` is capped at ~2 KB. Full tool output already lives in the
`messages` row (`role='tool'`) for ok calls, so the excerpt is enough for
audit views. For blocked/invalid-args calls, the excerpt is the error
message itself.

The table is INSERT/UPDATE only — no DELETE in the repo. A retention job
can be added later if growth becomes an issue, but for "weeks to months of
single-user usage" the table will stay in the low MB range.

## Sequencing inside the executor

```
1. Lookup tool. Unknown → audit insert with status 'invalid-args'. Return.
2. JSON.parse args. Bad JSON → audit insert with status 'invalid-args'. Return.
3. If inputSchema → zod.safeParse. Fails → audit insert 'invalid-args'
   with flattened issues. Return.
4. Read flag once at the start of execute() to avoid per-call DB hit on
   the hot path. (Flag changes will take effect on the next agent run.)
5. If autonomy='block-destructive' and safety='destructive' → audit insert
   'blocked'. Return blocked error.
6. Audit insert with provisional status='ok'.
7. tool.execute(args, ctx) inside try/catch.
8. Audit update with final status, duration, output excerpt.
9. Return ToolResult.
```

Steps 1-3 use the `created_at = finished_at` shorthand (single insert) because
nothing executed. Step 6 captures `started_at`, step 8 sets `finished_at`
and `duration_ms`.

## Out-of-scope: the UI confirmation flow

The proposal explicitly leaves the per-call confirmation UI out. The backend
gate as designed is enough to land safely and gives us:

- A real audit trail starting today.
- Strict validation that protects every tool the model can invoke.
- A coarse but useful operator-facing kill switch.

The UI flow (modal asks "tool X wants to do Y, allow?", server pauses
execution, resumes on click) needs SSE plumbing, a frontend pending-calls
state, and probably a per-project policy table. That is a follow-up change
that consumes the building blocks landed here.
