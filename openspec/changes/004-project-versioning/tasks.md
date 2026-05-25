# Tasks: 004 — Project Versioning

> **Status (2026-05-25)**: All phases except verification are done. Backend
> phases 0–8 shipped in PR #5 (merged to develop). Phase 4 (agent-loop
> auto-capture), Phase 6.5 (admin compact), Phase 11.1 (messages route
> extension) and Phases 9–11 (frontend timeline / diff modal / per-message
> revert) shipped on `feature/004-phase-4-auto-capture`. The full monorepo
> builds clean (`pnpm -r build`). Phase 12 verification is still pending and
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

## Phase 4 — Auto-Capture in Agent Loop [backend]

- [x] 4.1 [backend] Mutation signal via `snapshotStateHash(snapshot)` (SHA-256 of manifest + files + resources). Cheaper than re-reading tables — uses the snapshot we already captured.
- [x] 4.2 [backend] `chat/routes.ts` wraps `runAgentLoop` with pre-capture `(trigger: 'auto-pre-agent', agentRunId)` when `versioning.auto_capture` is ON and the session belongs to a project.
- [x] 4.3 [backend] Post-capture `(trigger: 'auto-post-agent', agentRunId, messageId, parentSnapshotId: preId)`. If post hash equals pre hash, `discard(post.id)` keeps the timeline clean.
- [x] 4.4 [backend] Pre-capture errors are caught and logged; agent run proceeds normally.
- [x] 4.5 [backend] Post-capture errors are caught and logged after `onDone` has already streamed the assistant message; the result is never lost.

## Phase 5 — Diff Endpoint [backend]

- [x] 5.1 [backend] `GET /api/projects/:id/snapshots/:a/diff/:b`
- [x] 5.2 [backend] `diffManifests` returns `{ added, removed, modified }`
- [x] 5.3 [backend] `diffResourceGraph` returns per-resource-type added/removed for services, apiRoutes, dbSchemas, dbMigrations, appResources, envVars
- [ ] 5.4 [backend] Add Zod schema for diff response and shared TS type (`SnapshotDiff` is exported; runtime Zod schema not needed because the route does not parse a body)
- [x] 5.5 [backend] Validate `a` and `b` belong to the same project (404 — same "do not leak existence" pattern used elsewhere)
- [x] 5.6 [backend] Legacy snapshots: `manifestFromSnapshot` hashes `file_tree` on the fly

## Phase 6 — Retention and Pinning [backend]

- [x] 6.1 [backend] `ProjectSnapshotsRepo.prune(projectId)` evicts ephemeral snapshots beyond `snapshot_retention_keep`, skips pinned, decrements blob refs and deletes orphan blobs in one transaction
- [x] 6.2 [backend] `chat/routes.ts` calls `prune` after each mutating `auto-post-agent` capture; errors are logged and ignored.
- [x] 6.3 [backend] `PATCH /api/projects/:id/snapshots/:snapshotId` accepts `{ label?, retention? }`
- [x] 6.4 [backend] `PATCH /api/projects/:id/snapshot-retention` accepts `{ snapshot_retention_keep }`
- [x] 6.5 [backend] `POST /admin/snapshots/compact` runs `compactBlobs()`: resets ref_count to 0 and re-increments from live manifests, then deletes orphans. Recovers storage if refs drift.

## Phase 7 — Branch-Root Restore [backend]

- [x] 7.1 [backend] `POST /api/projects/:id/snapshots/:snapshotId/restore` requires `{ confirm: true }`, returns 400 otherwise
- [x] 7.2 [backend] After successful rehydrate, `restore()` inserts a `branch-root` snapshot with `parent_snapshot_id = restored.id`
- [x] 7.3 [backend] Response includes `branch_root_id`
- [x] 7.4 [backend] Frontend restore call now sends `{ confirm: true }` from the diff modal (Phase 10.5)

## Phase 8 — Timeline Endpoint [backend]

- [x] 8.1 [backend] `GET /api/projects/:id/snapshots/timeline`
- [x] 8.2 [backend] Response shape `{ tip_id, nodes: [{ id, parent_id, trigger, retention, label, created_at, message_id, agent_run_id }] }`
- [x] 8.3 [backend] `tip_id` returned explicitly
- [ ] 8.4 [backend] Cache-invalidation guidance in route comments *(left for when caching is actually introduced)*

## Phase 9 — Frontend Timeline UI [frontend]

- [x] 9.1 [frontend] `ProjectSnapshotsTimeline`, `TimelineNode`, `SnapshotTrigger`, `SnapshotRetention` types in `types/index.ts`
- [x] 9.2 [frontend] `SnapshotsTimeline` component replaces the flat sidebar list with an indented tree view, trigger icons (◆ ◐ ● ★ ↳), labels and timestamps
- [x] 9.3 [frontend] Inline label edit: click label → input → Enter/blur saves via PATCH; Escape cancels
- [x] 9.4 [frontend] Pin/unpin toggle: 📌 when pinned, 📍 when ephemeral; click toggles retention via PATCH
- [x] 9.5 [frontend] Current tip is highlighted with the accent border and a `● now` chip
- [x] 9.6 [frontend] Restore action opens the diff modal instead of immediately restoring (and is hidden on the tip itself)

## Phase 10 — Frontend Diff Modal [frontend]

- [x] 10.1 [frontend] `SnapshotDiffModal` fetches `GET /snapshots/:a/diff/:b`
- [x] 10.2 [frontend] Summary counters (added/removed/modified) + per-file lists + per-resource-type added/removed summary
- [x] 10.3 [frontend] Expandable per-file inline diff using an in-component LCS line-diff implementation (no npm dep). Blob content is lazy-fetched via `GET /snapshot-blobs/:hash` only when the user expands a file.
- [x] 10.4 [frontend] Confirmation button text: `Restore (creates new branch)`; Cancel leaves state unchanged
- [x] 10.5 [frontend] On confirm, POST restore with `{ confirm: true }`, then reload files and timeline

## Phase 11 — Per-Message Revert [frontend] [backend]

- [x] 11.1 [backend] `findBySession` now LEFT JOINs `project_snapshots` and returns `linked_snapshot_id` per message
- [x] 11.2 [frontend] Assistant messages with `linked_snapshot_id` render a `⟲ revert to here` button that becomes visible on hover (`.message-revertable:hover .revert-button`)
- [x] 11.3 [frontend] Clicking opens `SnapshotDiffModal` pre-loaded with `from = current tip`, `to = linked snapshot`
- [x] 11.4 [frontend] No revert affordance shows on messages without `linked_snapshot_id` or in chats without a project

## Phase 12 — Verification [infra]

- [ ] 12.1 [infra] Manual: create a project, run 5 prompts with `versioning.auto_capture = ON`, verify pre+post snapshots in timeline (mutating runs produce both; no-op runs produce only the pre, then discard the post)
- [ ] 12.2 [infra] Manual: with `versioning.dedup_blobs = ON`, verify `project_snapshot_blobs` shows shared blobs across snapshots when files are unchanged
- [ ] 12.3 [infra] Manual: pin a snapshot, force retention prune, confirm pinned snapshot survives
- [ ] 12.4 [infra] Manual: restore an older snapshot, verify a `branch-root` snapshot is created and prior tip remains
- [ ] 12.5 [infra] Manual: open diff modal between two snapshots, expand a file, confirm inline diff renders
- [ ] 12.6 [infra] Manual: revert from a chat message; confirm modal pre-loads correct diff and restore branches history
- [ ] 12.7 [infra] Verify legacy snapshots (created before this change) remain restorable
- [x] 12.8 [infra] Confirm `pnpm -r build` passes
- [ ] 12.9 [infra] Update `README.md` SDD changes table with `004` once archived
- [ ] 12.10 [infra] Update `DevMind.md` Atlas entity page with new snapshot capabilities
