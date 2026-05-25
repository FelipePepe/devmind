# Tasks: 004 — Project Versioning

> **Backend status (2026-05-25)**: Phases 0–3, 5, 6 (except 6.5), 7 and 8 are
> implemented and the full monorepo builds clean (`pnpm -r build`). Phase 4
> (agent-loop auto-capture) and Phases 9–11 (frontend timeline / diff modal /
> per-message revert UI) are still open. Verification (Phase 12) is pending and
> must run against a real DevMind DB before this change is archived.

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 [infra] Approve `004-project-versioning` proposal, design, and spec
- [x] 0.2 [infra] Confirm SHA-256 as the blob hash function (vs. blake3)
- [x] 0.3 [infra] Confirm default retention window: 20 ephemeral snapshots per project
- [x] 0.4 [infra] Confirm v1 deduplication scope: text files only; binary blob support deferred to 005
- [x] 0.5 [infra] Confirm both feature flags (`versioning.auto_capture`, `versioning.dedup_blobs`) ship OFF by default

## Phase 1 — Schema Migration [backend]

- [x] 1.1 [backend] Add migration `018_project_versioning.sql` extending
      `project_snapshots` with `parent_snapshot_id`, `trigger`, `agent_run_id`,
      `message_id`, `retention`, `file_manifest_json`, `screenshot_blob_hash`;
      add `project_snapshot_blobs(hash, content, size_bytes, ref_count, created_at)`;
      add `projects.snapshot_retention_keep` (default 20);
      add indexes `idx_project_snapshots_parent|message|agent_run` and
      `idx_project_snapshot_blobs_refcount`.
      FK columns reference real types (all `TEXT`, matching spec-003 schema);
      no `ALTER TABLE ADD CONSTRAINT` (SQLite cannot do that).
- [ ] 1.2 [backend] Verify migration runs idempotently against an existing DevMind database with `003`-era snapshots (manual; pending real-DB check)
- [x] 1.3 [backend] Register the two new feature flags in flag seed data (default OFF)

## Phase 2 — Blob Storage Layer [backend]

- [x] 2.1 [backend] Add `ProjectSnapshotBlobsRepo` with `getByHash`, `writeIfMissing`, `incrementRef`, `decrementRef`, `deleteOrphans`
- [x] 2.2 [backend] Add SHA-256 helper in `packages/backend/src/db/repos/hashing.ts`
- [x] 2.3 [backend] Extend `ProjectSnapshotsRepo.capture()`: when `versioning.dedup_blobs` is ON, compute hashes, write missing blobs, persist `file_manifest_json` and increment ref counts; when OFF, keep legacy JSON-blob path. `file_tree_json` is preserved in both paths to keep legacy `restore` working.
- [x] 2.4 [backend] `restore()` handles both manifest-based and legacy snapshots via `manifestFromSnapshot` fallback that hashes `file_tree` on the fly
- [x] 2.5 [backend] Add `ProjectSnapshotsRepo.findCurrentTip(projectId)`

## Phase 3 — Blob Endpoint [backend]

- [x] 3.1 [backend] `GET /api/projects/:id/snapshot-blobs/:hash`, auth-gated
- [x] 3.2 [backend] Returns `text/plain; charset=utf-8` (language-aware Content-Type deferred to 005)
- [x] 3.3 [backend] Cap response size at 10 MB; 413 otherwise

## Phase 4 — Auto-Capture in Agent Loop [backend]  *(deferred)*

- [ ] 4.1 [backend] Add `result.mutated` signal to `runAgentLoop` by hashing manifest before/after
- [ ] 4.2 [backend] Wrap `runAgentLoop` with pre-capture when `versioning.auto_capture` is ON
- [ ] 4.3 [backend] Add post-capture on `result.mutated === true`, linked to closing assistant message and agent run
- [ ] 4.4 [backend] Ensure pre-capture failure does NOT abort the agent run
- [ ] 4.5 [backend] Ensure post-capture failure does NOT lose the agent run result

## Phase 5 — Diff Endpoint [backend]

- [x] 5.1 [backend] `GET /api/projects/:id/snapshots/:a/diff/:b`
- [x] 5.2 [backend] `diffManifests` returns `{ added, removed, modified }`
- [x] 5.3 [backend] `diffResourceGraph` returns per-resource-type added/removed for services, apiRoutes, dbSchemas, dbMigrations, appResources, envVars
- [ ] 5.4 [backend] Add Zod schema for diff response and shared TS type (the inline type is exported as `SnapshotDiff`; a runtime Zod schema is not strictly needed because the route does not parse a body; if a stricter contract is wanted later, add one)
- [x] 5.5 [backend] Validate `a` and `b` belong to the same project (404 otherwise; spec called for 403 but 404 fits the "do not leak existence" pattern used elsewhere in the router)
- [x] 5.6 [backend] Legacy snapshots: `manifestFromSnapshot` hashes `file_tree` on the fly

## Phase 6 — Retention and Pinning [backend]

- [x] 6.1 [backend] `ProjectSnapshotsRepo.prune(projectId)` evicts ephemeral snapshots beyond `snapshot_retention_keep`, skips pinned, decrements blob refs and deletes orphan blobs in one transaction
- [ ] 6.2 [backend] Call `prune` after each `auto-post-agent` capture *(blocked on Phase 4)*
- [x] 6.3 [backend] `PATCH /api/projects/:id/snapshots/:snapshotId` accepts `{ label?, retention? }`
- [x] 6.4 [backend] `PATCH /api/projects/:id/snapshot-retention` accepts `{ snapshot_retention_keep }` (separate path from `PATCH /projects/:id` to avoid colliding with the existing name/description update endpoint)
- [ ] 6.5 [backend] Admin endpoint `POST /api/admin/snapshots/compact` *(not implemented; `ProjectSnapshotBlobsRepo.deleteOrphans` is reachable from `prune` but no admin-facing route yet)*

## Phase 7 — Branch-Root Restore [backend]

- [x] 7.1 [backend] `POST /api/projects/:id/snapshots/:snapshotId/restore` requires `{ confirm: true }`, returns 400 otherwise
- [x] 7.2 [backend] After successful rehydrate, `restore()` inserts a `branch-root` snapshot with `parent_snapshot_id = restored.id`
- [x] 7.3 [backend] Response shape includes `branch_root_id`
- [ ] 7.4 [backend] Update existing UI restore call to send `confirm: true` *(frontend work; see Phase 9)*

## Phase 8 — Timeline Endpoint [backend]

- [x] 8.1 [backend] `GET /api/projects/:id/snapshots/timeline`
- [x] 8.2 [backend] Response shape `{ tip_id, nodes: [{ id, parent_id, trigger, retention, label, created_at, message_id, agent_run_id }] }`
- [x] 8.3 [backend] `tip_id` returned explicitly
- [ ] 8.4 [backend] Cache-invalidation guidance in route comments *(left for when caching is actually introduced)*

## Phase 9 — Frontend Timeline UI [frontend]  *(deferred to a follow-up session)*

- [ ] 9.1 [frontend] Add `ProjectSnapshotsTimeline` type in `types/index.ts`
- [ ] 9.2 [frontend] Replace snapshots sidebar tab content with a tree view (trigger icons, labels, timestamps)
- [ ] 9.3 [frontend] Inline label edit on click
- [ ] 9.4 [frontend] Pin/unpin toggle per snapshot
- [ ] 9.5 [frontend] Mark current tip visually (`● now`)
- [ ] 9.6 [frontend] Restore opens the diff modal (Phase 10) instead of immediately restoring

## Phase 10 — Frontend Diff Modal [frontend]  *(deferred)*

- [ ] 10.1 [frontend] `SnapshotDiffModal` fetching `GET /snapshots/:a/diff/:b`
- [ ] 10.2 [frontend] Summary counts and resource changes
- [ ] 10.3 [frontend] Expandable per-file inline diff (npm `diff`); blob content lazy-fetched via `GET /snapshot-blobs/:hash`
- [ ] 10.4 [frontend] Button text `Restore (creates new branch)`
- [ ] 10.5 [frontend] On confirmation, POST restore with `{ confirm: true }`; reload project state and timeline

## Phase 11 — Per-Message Revert [frontend] [backend]

- [ ] 11.1 [backend] Extend `GET /api/sessions/:id/messages` with `linked_snapshot_id` *(backend has `findByMessageId`; the messages route still needs to include the field)*
- [ ] 11.2 [frontend] Hover-revealed `⟲ revert to here` button on assistant messages with `linked_snapshot_id`
- [ ] 11.3 [frontend] Open `SnapshotDiffModal` preloaded with current tip vs. linked snapshot
- [ ] 11.4 [frontend] No revert affordance on messages without a linked snapshot

## Phase 12 — Verification [infra]

- [ ] 12.1 [infra] Manual: create a project, run 5 prompts with `versioning.auto_capture = ON`, verify 10 snapshots in timeline
- [ ] 12.2 [infra] Manual: with `versioning.dedup_blobs = ON`, verify `project_snapshot_blobs` shows shared blobs across snapshots when files are unchanged
- [ ] 12.3 [infra] Manual: pin a snapshot, force retention prune, confirm pinned snapshot survives
- [ ] 12.4 [infra] Manual: restore an older snapshot, verify a `branch-root` snapshot is created and prior tip remains
- [ ] 12.5 [infra] Manual: open diff modal between two snapshots, expand a file, confirm inline diff renders
- [ ] 12.6 [infra] Manual: revert from a chat message; confirm modal pre-loads correct diff and restore branches history
- [ ] 12.7 [infra] Verify legacy snapshots (created before this change) remain restorable
- [x] 12.8 [infra] Confirm `pnpm -r build` passes
- [ ] 12.9 [infra] Update `README.md` SDD changes table with `004` once archived
- [ ] 12.10 [infra] Update `DevMind.md` Atlas entity page with new snapshot capabilities
