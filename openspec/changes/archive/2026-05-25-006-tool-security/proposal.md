# Proposal: 006-tool-security

## Intent

Close the security gap in DevMind's agent tool stack. Today every tool the
agent invokes is executed silently with whatever arguments the LLM produced,
no record of who ran what survives the conversation, and there is no way for
the user to insert a confirmation gate before a destructive operation. This
change introduces **(1)** a persistent audit log of every tool call, **(2)** a
safety classification per tool so the system knows which calls mutate state,
**(3)** strict server-side input validation via Zod so a hallucinated argument
shape cannot reach the tool body, and **(4)** an autonomy gate that can block
destructive tools when the operator wants stricter supervision.

This is the backend half of "Phase 8 — security and tool governance" in
`RECOVERY_PLAN.md`. A follow-up change will add the per-tool confirmation UI
that consumes the gate.

## Scope

### In Scope

- `packages/backend/src/db/migrations/` — schema for `tool_call_audit` table
- `packages/backend/src/db/repos/` — `ToolCallAuditRepo`
- `packages/backend/src/tools/types.ts` — extend `ToolDef` with `safety` and
  optional `inputSchema`
- `packages/backend/src/tools/executor.ts` — Zod validation, audit log writes,
  autonomy gate check
- `packages/backend/src/tools/impl/*.ts` — classify every existing tool and
  add a Zod `inputSchema` to the destructive ones (`run_command`,
  `write_project_file`, `delete_project_file`, `restore` calls)
- `packages/backend/src/admin/routes.ts` — `GET /admin/tool-audit` endpoint
- Feature flag `tools.autonomy_level` registered with default `auto`

### Out of Scope

- Frontend confirmation UI (per-tool prompt modal). The backend exposes the
  building blocks; the UI lands in a follow-up change so this PR stays
  reviewable.
- Per-project or per-user autonomy overrides. v1 ships a single global flag.
- Rate limiting / quota per tool. Different concern; revisit if abuse appears.
- Cryptographic signing of audit entries. The table is append-only by
  convention, not enforced.

## Problem Statement

Three blind spots in the current tool stack:

1. **No record.** The chat history stores the assistant message that asked
   for a tool and the tool result message that came back, but the structured
   args, the safety class of the call, the duration and the success/failure
   are not persisted as first-class data. Forensics after a bad run mean
   reading a chat transcript and guessing.

2. **No classification.** The executor treats `read_project_file` and
   `write_project_file` the same way — both fire on whatever the model
   returned. There is no way for the runtime to say "this one mutates state,
   apply stricter rules" because the rule does not exist as data.

3. **No input contract on the server.** Tools receive `Record<string,
   unknown>` and parse their own arguments. When the model hallucinates a
   shape ("path is an array now"), the tool sees the bad input and either
   crashes deep in its body or silently produces nonsense. The JSON Schema
   we hand Ollama is advisory, not enforced.

4. **No supervision gate.** Even when the operator wants the agent to ask
   before destructive operations, the system has nowhere to insert that ask.
   Today the agent loop is binary: run or don't run.

The combined effect is that a user cannot trust the agent with anything they
care about, and after the fact cannot reconstruct what it did. The product
needs a record and a brake.

## Proposed Direction

### Domain model

```text
tool_call_audit
  id                TEXT PRIMARY KEY
  agent_run_id      TEXT  REFERENCES agent_runs(id) ON DELETE CASCADE  (nullable for non-agent calls)
  session_id        TEXT  REFERENCES sessions(id)   ON DELETE CASCADE
  user_id           TEXT  REFERENCES users(id)      ON DELETE CASCADE
  project_id        TEXT  (nullable)
  tool_name         TEXT  NOT NULL
  safety            TEXT  NOT NULL  CHECK(safety IN ('read','write','destructive'))
  args_json         TEXT  NOT NULL
  status            TEXT  NOT NULL  CHECK(status IN ('ok','error','blocked','invalid-args'))
  output_excerpt    TEXT  NOT NULL  (first ~2 KB of the result or error)
  error             TEXT  (nullable; populated when status != 'ok')
  duration_ms       INTEGER NOT NULL DEFAULT 0
  started_at        TEXT  NOT NULL DEFAULT (datetime('now'))
  finished_at       TEXT  NOT NULL DEFAULT (datetime('now'))
```

Indexes on `(agent_run_id, started_at)`, `(session_id, started_at)`,
`(tool_name, status, started_at)` to support audit views and forensics.

### ToolDef changes

```ts
export interface ToolDef {
  name: string;
  description: string;
  parameters: OllamaTool['function']['parameters']; // JSON Schema for Ollama
  safety: 'read' | 'write' | 'destructive';        // NEW — runtime classification
  inputSchema?: z.ZodTypeAny;                       // NEW — server-side validation
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
```

`safety` is required (no silent default) so a new tool can't slip through
without a deliberate choice. `inputSchema` is optional but strongly
recommended for `write` and `destructive` tools; the executor uses it before
calling `execute`.

### Executor flow

```text
1. Find tool in registry. If unknown → audit 'invalid-args', return error.
2. Parse JSON args. If invalid JSON → audit 'invalid-args', return error.
3. If tool.inputSchema is set → Zod parse. If fails → audit 'invalid-args',
   return error with the Zod issue list flattened.
4. Read tools.autonomy_level flag. If 'block-destructive' and
   tool.safety === 'destructive' → audit 'blocked', return blocked error.
5. Insert audit row with status 'ok' as a sentinel (will be updated).
6. tool.execute(args, ctx).
7. On success → update audit row with output excerpt, duration, status 'ok'.
   On throw → update with status 'error', error message, output excerpt of
   any partial output.
8. Return ToolResult as before.
```

The agent loop does not change. The executor is the choke point.

### Autonomy gate

A single global flag in v1: `tools.autonomy_level` with values:
- `auto` (default, backwards-compatible) — every tool runs.
- `block-destructive` — destructive tools return a "blocked" error to the
  agent, which the agent will read in its next turn and can choose to ask
  the user or try a different approach.

This is intentionally coarse. The user-facing confirmation UI ("Tool X
wants to do Y, allow?") needs frontend work that belongs in a follow-up
change. By shipping the gate behind a flag now, we (a) get a real audit
trail, (b) make destructive operations observable, (c) leave the UI work
to a smaller PR.

### Admin endpoint

`GET /admin/tool-audit?limit=100` returns the most recent audit rows, JSON
encoded, joined with agent_run + session metadata. Admin only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend/src/db/migrations/` | Medium | New migration `019_tool_audit.sql` |
| `packages/backend/src/db/repos/` | Medium | New `tool-call-audit.ts` repo |
| `packages/backend/src/tools/types.ts` | Low | Extend ToolDef shape |
| `packages/backend/src/tools/executor.ts` | High | Validation, audit writes, gate check |
| `packages/backend/src/tools/impl/*.ts` | Medium | Classify safety on every tool; add Zod schemas to write/destructive ones |
| `packages/backend/src/tools/index.ts` | Low | Wire `ToolCallAuditRepo` and `FlagsRepo` into the registry/executor build |
| `packages/backend/src/admin/routes.ts` | Low | New audit endpoint |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Audit writes slow down every agent iteration | Medium | INSERT is ~1ms; index on hot columns; benchmark if iteration time grows visibly |
| Zod schema mismatches break an existing tool the agent relied on | Medium | Roll out gradually: classify all tools but only require `inputSchema` on destructive ones in this PR. Read tools stay unchanged. |
| `tools.autonomy_level = block-destructive` confuses the agent | Low | Blocked tool returns a clear error message the model can react to ("blocked by operator policy"); the loop continues |
| Audit table grows unbounded | Medium | Document a retention follow-up; for now, INSERT-only is fine for months of usage |
| Admin endpoint leaks internals | Low | Admin middleware already in place; return excerpts not full output |
| Existing tools have implicit args (e.g. `cwd` optional) — Zod schemas could reject valid calls | Medium | Use `z.object(...).passthrough()` on initial schemas; tighten over time |

## Rollback Plan

This change is additive-first:

- `safety` is required on every tool but the value can be set conservatively
  (anything that mutates is `destructive`, anything else is `read`). Cannot
  break existing flow.
- `inputSchema` is optional. Tools without it behave exactly as today.
- `tools.autonomy_level` defaults to `auto`. Flipping the flag is the only
  behaviour change; flipping back restores prior behaviour.
- Audit table is read-only from the agent's perspective; deleting rows or
  truncating the table is safe and only loses forensics, not state.

## Success Criteria

- [ ] Every tool call (read, write, destructive, errored, blocked) produces a row in `tool_call_audit` with start/end times and args.
- [ ] An invalid argument shape from the LLM is rejected by Zod before reaching the tool body; the audit row records `status='invalid-args'` and the Zod issue.
- [ ] When `tools.autonomy_level=block-destructive`, the agent receives a clear blocked error for destructive tools and the audit row records `status='blocked'`.
- [ ] `GET /admin/tool-audit` returns the last N tool calls joined with session and agent_run metadata.
- [ ] All existing tools continue to work in the default `auto` mode without any code change at their call sites.
- [ ] `pnpm -r build`, `pnpm typecheck` and `pnpm lint` all pass.
