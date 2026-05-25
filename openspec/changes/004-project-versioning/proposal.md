# Proposal: 004-project-versioning

## Intent

Turn the existing `project_snapshots` infrastructure (introduced by `003-full-stack-project-generator`) into a **first-class versioning experience** for DevMind project builders. Today snapshots can be created and restored, but the workflow is opaque: snapshots are manual, history is flat, diffs are invisible, retention is unbounded, and there is no notion of branching. Without these capabilities the builder is not safe to iterate aggressively — users avoid bold edits because there is no perceptible "undo".

This change completes the versioning loop so that every meaningful change to a project is automatically captured, navigable, diffable, restorable, and bounded in storage.

## Scope

### In Scope

- `packages/backend/src/db/migrations/` — schema additions for snapshot parent linkage, tags, retention policy, and content-addressable file blobs
- `packages/backend/src/db/repos/project-snapshots.ts` — capture-by-hash, parent linkage, diff queries, retention pruning
- `packages/backend/src/builder/routes.ts` — diff endpoint, label/tag endpoint, retention config endpoint
- `packages/backend/src/agent/loop.ts` — automatic snapshot capture before agent mutations
- `packages/backend/src/tools/impl/project-structure-tools.ts` — keep manual `create_project_snapshot` for explicit milestones
- `packages/frontend/src/pages/Builder.tsx` — snapshot timeline, restore-with-confirmation, diff viewer, label editor
- `packages/frontend/src/components/chat/MessageList.tsx` — per-message "revert to this state" affordance when a message has an associated snapshot

### Out of Scope

- Distributed version control (git-like merge between snapshots of different projects)
- Cross-project snapshot import/export
- Cherry-picking individual file changes between snapshots
- Time-travel debugging of agent runs (replay tool calls)
- Encrypted snapshot storage
- Snapshot diff for binary artifacts beyond text equivalence

## Problem Statement

The current `project_snapshots` table stores the full project state — manifest, file tree, and the entire resource graph — as JSON blobs on every capture. `restore()` wipes the live tables and rehydrates from the snapshot atomically. That works, but five gaps prevent it from feeling like a versioning system:

1. **Capture is manual.** Snapshots only exist when the agent explicitly calls `create_project_snapshot` or a user clicks the button. Most agent runs produce no snapshot, so there is nothing to roll back to after a bad edit.
2. **History is flat.** Snapshots have no parent reference. Once you restore an old snapshot and keep working, the newer states still exist in the list but there is no way to see which timeline they belong to.
3. **No diff.** Users cannot see what changed between two snapshots. Restore is a leap of faith.
4. **No labels.** The `label` field exists in the schema but is not editable from the UI and not shown meaningfully.
5. **No retention.** Snapshots accumulate forever. Each snapshot duplicates the entire file tree as JSON inside a SQLite row. A project with 100 files and 200 snapshots stores 20,000 file contents — most of them identical.
6. **No agent-attached snapshots.** When the agent finishes a run, there is no link between the resulting messages and the snapshot that captured the resulting state, so "go back to before this message" is impossible from the chat UI.
7. **Storage is monolithic.** File contents live inside the `file_tree_json` blob, not as deduplicated blobs. A one-character edit duplicates the entire tree.

Until these gaps are closed, the builder rewards conservative prompting — the opposite of the product intent.

## Proposed Direction

Evolve the snapshot model from "full JSON capture" to a **content-addressable, parent-linked timeline** with automatic capture, lightweight diffing, and bounded retention.

### Core model changes

```text
project_snapshot
  parent_snapshot_id     ← linear history + branching when restore branches
  trigger                ← enum: 'manual' | 'auto-pre-agent' | 'auto-post-agent' | 'milestone'
  agent_run_id           ← link to the agent run that produced this state
  message_id             ← link to the chat message that closed the run
  label                  ← user-editable, optional
  retention              ← enum: 'ephemeral' | 'pinned' (pinned snapshots survive pruning)
  file_manifest_json     ← list of {path, blob_hash} — small
  resource_graph_json    ← unchanged
  manifest_json          ← unchanged

project_snapshot_blobs
  hash                   ← sha256 of content
  content                ← deduplicated file content (one row per unique content)
  ref_count              ← maintained on snapshot create/prune
```

### Hook for the visual layer (deferred)

A future `005-playwright-validation` change will attach a screenshot to each snapshot, enabling visual time-travel and visual diff. To avoid a follow-up migration touching this same table, this change SHALL add a nullable `screenshot_blob_hash` column to `project_snapshots` now and leave it unpopulated. The blob storage table introduced here is content-addressable and accepts any binary, so 005 will reuse it for images without further schema work.

This is the only forward concession in 004. All other surface area stays text-based; image capture, visual diff UI, and Playwright orchestration are entirely owned by 005.

### Capture strategy

- **Before** each `runAgentLoop` invocation, the backend captures a `auto-pre-agent` snapshot, linked to the agent run. This is the rollback target if the run goes wrong.
- **After** a successful run that mutated project state, the backend captures a `auto-post-agent` snapshot, linked to the run **and** the closing assistant message. This is what "go back to here" surfaces from the chat UI.
- **Manual** snapshots via the existing endpoint and agent tool remain `manual`, optionally `milestone` if the user pins them.

### Retention

- A per-project retention policy (default: keep last 20 `ephemeral` snapshots + all `pinned`) prunes on snapshot create.
- Pruning deletes the snapshot row and decrements `ref_count` on its blobs; blobs with `ref_count = 0` are deleted.

### Diff

- A new endpoint `GET /api/projects/:id/snapshots/:a/diff/:b` returns:
  - file-level: added, removed, modified paths (modified = different `blob_hash` for same path)
  - resource-level: high-level summary of changes in services, API routes, DB schemas, env vars
  - per-file inline diff is computed lazily by the frontend (fetch both blobs and diff client-side with `diff` library)

### Frontend

- The existing `snapshots` sidebar tab becomes a **timeline view**: indented tree showing parent-child relationships, with trigger badges (auto vs. manual), labels, and a "current state" pointer.
- Each chat message that has an associated `auto-post-agent` snapshot gets a "revert to here" button on hover.
- Restore actions show a confirmation modal with a summary diff against current state.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend/src/db/migrations/` | High | Migration 018: extend `project_snapshots`, add `project_snapshot_blobs`, add retention column on `projects` |
| `packages/backend/src/db/repos/project-snapshots.ts` | High | Capture by hash + dedup, restore from manifest+blobs, prune, diff queries |
| `packages/backend/src/builder/routes.ts` | High | New endpoints: diff, label, pin/unpin, retention config |
| `packages/backend/src/agent/loop.ts` | Medium | Wrap run with pre/post auto-snapshot |
| `packages/backend/src/tools/impl/project-structure-tools.ts` | Low | Keep manual tool; add `pin_snapshot` tool for milestones |
| `packages/frontend/src/pages/Builder.tsx` | High | Replace flat snapshot list with timeline view + diff modal |
| `packages/frontend/src/components/chat/MessageList.tsx` | Medium | Per-message revert affordance |
| `packages/frontend/src/types/index.ts` | Low | New shared types for trigger, retention, diff payloads |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Auto-snapshot per agent run inflates DB size before dedup lands | High | Ship blob dedup migration in the same phase as auto-capture; never enable auto-capture without dedup live |
| Pruning deletes a snapshot a user wanted to keep | Medium | Default retention is generous (20 + pinned); pinning is one click; pruning is `ephemeral`-only |
| Restore-branching confuses users ("where did my work go?") | Medium | Confirmation modal shows the diff; restored timeline is marked as a branch in the UI, never silently overwrites |
| Blob table grows because ref counting has a bug | Medium | Add an integrity check job that recounts on demand; admin endpoint to trigger compact |
| Diff payload becomes huge for large projects | Low | Diff endpoint returns metadata only; per-file inline diff is opt-in fetch |
| Migration of existing snapshots from JSON blob to blob table | Medium | Migration script converts in place; old `file_tree_json` column kept until migration verified, then dropped in a later cleanup |

## Rollback Plan

This change is **additive-first**:

- New columns on `project_snapshots` default to safe values (`trigger = 'manual'`, `parent_snapshot_id = NULL`, `retention = 'ephemeral'`).
- `project_snapshot_blobs` is a new table; old snapshots remain readable from their `file_tree_json` blob until migrated.
- A feature flag `versioning.auto_capture` gates the agent-loop integration. Off by default until verified.
- A feature flag `versioning.dedup_blobs` gates the blob-storage path. Off until the migration backfills.
- Restore continues to work against old-format snapshots throughout.

If a phase fails after merge:

- Flip the feature flags off — capture reverts to manual; storage reverts to JSON blob.
- Tables remain; no destructive migration is part of this change.

## Success Criteria

- [ ] Every successful agent run produces an auto-snapshot linked to its closing message
- [ ] A user can click "revert to here" on a past assistant message and see the diff before confirming
- [ ] The snapshot timeline shows parent-child relationships, not a flat list
- [ ] A user can pin a snapshot, label it, and trust it will survive retention pruning
- [ ] Two snapshots can be diffed at file-list and resource-graph level via a single API call
- [ ] A project with 100 snapshots and 90% file overlap stores < 2× the size of one snapshot's file content
- [ ] Pruning a snapshot decrements blob ref counts and reclaims storage of unreferenced blobs
- [ ] Existing manual snapshot creation, listing, and restore continue to work unchanged
