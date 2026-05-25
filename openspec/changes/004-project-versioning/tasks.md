# Tasks: 004 — Project Versioning

## Phase 0 — SDD Baseline [infra]

- [ ] 0.1 [infra] Approve `004-project-versioning` proposal, design, and spec
- [ ] 0.2 [infra] Confirm SHA-256 as the blob hash function (vs. blake3)
- [ ] 0.3 [infra] Confirm default retention window: 20 ephemeral snapshots per project
- [ ] 0.4 [infra] Confirm v1 deduplication scope: text files only; binary blob support deferred to 005
- [ ] 0.5 [infra] Confirm both feature flags (`versioning.auto_capture`, `versioning.dedup_blobs`) ship OFF by default

## Phase 1 — Schema Migration [backend]

- [ ] 1.1 [backend] Add migration `018_project_versioning.sql` with:
  - new columns on `project_snapshots`: `parent_snapshot_id`, `trigger`, `agent_run_id`, `message_id`, `retention`, `file_manifest_json`, `screenshot_blob_hash`
  - new table `project_snapshot_blobs(hash, content, size_bytes, ref_count, created_at)`
  - new column `projects.snapshot_retention_keep` (default 20)
  - indexes: `idx_project_snapshots_parent`, `idx_project_snapshots_project_created`, `idx_project_snapshots_message`
- [ ] 1.2 [backend] Verify migration runs idempotently against an existing DevMind database with `003`-era snapshots
- [ ] 1.3 [backend] Register the two new feature flags in flag seed data (default OFF)

## Phase 2 — Blob Storage Layer [backend]

- [ ] 2.1 [backend] Add `ProjectSnapshotBlobsRepo` with: `getByHash`, `writeIfMissing`, `incrementRef(hashes)`, `decrementRef(hashes)`, `deleteOrphans`
- [ ] 2.2 [backend] Add SHA-256 helper in `packages/backend/src/db/repos/hashing.ts` (use `node:crypto`)
- [ ] 2.3 [backend] Extend `ProjectSnapshotsRepo.capture()` to:
  - read `versioning.dedup_blobs` flag
  - if ON: compute hashes, write missing blobs, build `file_manifest_json`, increment ref counts; leave `file_tree_json` as `[]`
  - if OFF: keep existing JSON-blob path; leave `file_manifest_json` as `[]`
- [ ] 2.4 [backend] Extend `ProjectSnapshotsRepo.restore()` to detect manifest vs. legacy format and rehydrate from blobs when manifest is present
- [ ] 2.5 [backend] Add `ProjectSnapshotsRepo.findCurrentTip(projectId)` returning the most recent snapshot for a project

## Phase 3 — Blob Endpoint [backend]

- [ ] 3.1 [backend] Add `GET /api/projects/:id/snapshot-blobs/:hash` route, auth-gated, validates the blob belongs to a snapshot of that project
- [ ] 3.2 [backend] Return `Content-Type` based on `language` field when possible (`text/plain` fallback)
- [ ] 3.3 [backend] Cap response size and reject blobs > 10 MB with 413 (defense; in practice text files are small)

## Phase 4 — Auto-Capture in Agent Loop [backend]

- [ ] 4.1 [backend] Add `result.mutated` signal to `runAgentLoop` by hashing manifest before/after
- [ ] 4.2 [backend] Wrap `runAgentLoop` with pre-capture when `versioning.auto_capture` is ON
- [ ] 4.3 [backend] Add post-capture on `result.mutated === true`, linked to closing assistant message and agent run
- [ ] 4.4 [backend] Ensure pre-capture failure does NOT abort the agent run (log and continue)
- [ ] 4.5 [backend] Ensure post-capture failure does NOT lose the agent run result (log and continue)

## Phase 5 — Diff Endpoint [backend]

- [ ] 5.1 [backend] Add `GET /api/projects/:id/snapshots/:a/diff/:b` route
- [ ] 5.2 [backend] Implement `diffManifests(a, b)` returning `{ added, removed, modified }` by path/hash comparison
- [ ] 5.3 [backend] Implement `diffResourceGraph(a, b)` returning per-resource-type summaries (services, apiRoutes, dbSchemas, dbMigrations, appResources, envVars)
- [ ] 5.4 [backend] Add Zod schema for diff response and shared type
- [ ] 5.5 [backend] Validate `a` and `b` belong to the same project; 403 otherwise
- [ ] 5.6 [backend] Handle legacy snapshots (no manifest) by hashing `file_tree_json` entries on the fly for diff purposes

## Phase 6 — Retention and Pinning [backend]

- [ ] 6.1 [backend] Implement `ProjectSnapshotsRepo.prune(projectId)`:
  - select ephemeral snapshots older than `snapshot_retention_keep` window
  - skip pinned
  - delete rows + decrement blob refs + delete zero-ref blobs
  - all in one transaction
- [ ] 6.2 [backend] Call `prune` after each `auto-post-agent` capture
- [ ] 6.3 [backend] Add `PATCH /api/projects/:id/snapshots/:snapshotId` accepting `{ label?, retention? }`
- [ ] 6.4 [backend] Add `PATCH /api/projects/:id` accepting `{ snapshot_retention_keep }`
- [ ] 6.5 [backend] Add admin endpoint `POST /api/admin/snapshots/compact` that recounts blob refs and deletes orphans across all projects

## Phase 7 — Branch-Root Restore [backend]

- [ ] 7.1 [backend] Modify `POST /api/projects/:id/snapshots/:snapshotId/restore` to require `{ confirm: true }` in body; 400 otherwise
- [ ] 7.2 [backend] After successful rehydrate inside the existing transaction, insert a `branch-root` snapshot with `parent_snapshot_id = restored.id`
- [ ] 7.3 [backend] Return `{ new_snapshot_id: <branch-root.id> }` in the restore response
- [ ] 7.4 [backend] Update existing UI restore call to send `confirm: true` (temporary shim until Phase 9)

## Phase 8 — Timeline Endpoint [backend]

- [ ] 8.1 [backend] Add `GET /api/projects/:id/snapshots/timeline` returning the snapshot tree
- [ ] 8.2 [backend] Response shape: `{ tip_id, nodes: [{ id, parent_id, trigger, retention, label, created_at, message_id, agent_run_id }] }`
- [ ] 8.3 [backend] Include `tip_id` (most recent snapshot) explicitly so UI does not have to infer
- [ ] 8.4 [backend] Add caching guidance in route comments (response is invalidated on any snapshot mutation for that project)

## Phase 9 — Frontend Timeline UI [frontend]

- [ ] 9.1 [frontend] Add `ProjectSnapshotsTimeline` type in `types/index.ts`
- [ ] 9.2 [frontend] Replace the snapshots sidebar tab content with a tree view rendering trigger icons, labels, timestamps
- [ ] 9.3 [frontend] Add label edit inline (click label → input → blur saves via `PATCH`)
- [ ] 9.4 [frontend] Add pin/unpin toggle button per snapshot
- [ ] 9.5 [frontend] Mark current tip with a visual indicator (`● now`)
- [ ] 9.6 [frontend] Add restore action that opens the diff modal (Phase 10) instead of immediately restoring

## Phase 10 — Frontend Diff Modal [frontend]

- [ ] 10.1 [frontend] Add `SnapshotDiffModal` component fetching `GET /snapshots/:a/diff/:b`
- [ ] 10.2 [frontend] Render summary: counts of added/removed/modified files, summary of resource changes
- [ ] 10.3 [frontend] Render expandable per-file inline diff using the `diff` npm package; fetch blob content lazily via `GET /snapshot-blobs/:hash`
- [ ] 10.4 [frontend] Confirmation button text: `Restore (creates new branch)`; cancel button leaves state unchanged
- [ ] 10.5 [frontend] After confirmation, call restore endpoint with `{ confirm: true }`; reload project state and timeline on success

## Phase 11 — Per-Message Revert [frontend] [backend]

- [ ] 11.1 [backend] Extend `GET /api/sessions/:id/messages` to include `linked_snapshot_id` derived from `project_snapshots.message_id`
- [ ] 11.2 [frontend] In `MessageList.tsx`, add a hover-revealed `⟲ revert to here` button on assistant messages with `linked_snapshot_id`
- [ ] 11.3 [frontend] On click, open `SnapshotDiffModal` pre-loaded with current tip vs. linked snapshot
- [ ] 11.4 [frontend] Verify no revert affordance shows on messages without a linked snapshot

## Phase 12 — Verification [infra]

- [ ] 12.1 [infra] Manual: create a project, run 5 prompts with `versioning.auto_capture = ON`, verify 10 snapshots in timeline (5 pre + 5 post)
- [ ] 12.2 [infra] Manual: with `versioning.dedup_blobs = ON`, verify `project_snapshot_blobs` shows shared blobs across snapshots when files are unchanged
- [ ] 12.3 [infra] Manual: pin a snapshot, force retention prune, confirm pinned snapshot survives
- [ ] 12.4 [infra] Manual: restore an older snapshot, verify a `branch-root` snapshot is created and prior tip remains
- [ ] 12.5 [infra] Manual: open diff modal between two snapshots, expand a file, confirm inline diff renders
- [ ] 12.6 [infra] Manual: revert from a chat message; confirm modal pre-loads correct diff and restore branches history
- [ ] 12.7 [infra] Verify legacy snapshots (created before this change) remain restorable
- [ ] 12.8 [infra] Confirm `pnpm -r build` passes
- [ ] 12.9 [infra] Update `README.md` SDD changes table with `004` once archived
- [ ] 12.10 [infra] Update `DevMind.md` Atlas entity page with new snapshot capabilities
