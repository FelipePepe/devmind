# Delta Spec: 004-project-versioning

> This change extends DevMind's snapshot primitive into a first-class versioning system: automatic capture, parent-linked history, content-addressable storage, diffing, pinning, retention, and per-message revert.

---

## ### ADDED — snapshot-auto-capture

**Package**: `packages/backend/src/agent/loop.ts`, `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: Automatic Pre- and Post-Agent Snapshots

The system MUST automatically capture a snapshot before and after each project-scoped agent run when the feature flag `versioning.auto_capture` is enabled. The pre-run snapshot SHALL be linked to the agent run as `trigger = 'auto-pre-agent'`. The post-run snapshot SHALL be created only when the run mutated project state, with `trigger = 'auto-post-agent'`, linked to both the agent run and the closing assistant message.

#### Scenario: Auto-capture before agent run

- GIVEN a project with the `versioning.auto_capture` flag ON
- WHEN an agent run starts for that project
- THEN the system creates a snapshot with `trigger = 'auto-pre-agent'` and `agent_run_id` set, linked as child of the current tip

#### Scenario: Auto-capture after mutating run

- GIVEN an agent run that modified at least one project file or resource
- WHEN the run completes successfully
- THEN the system creates a second snapshot with `trigger = 'auto-post-agent'`, `agent_run_id` set, `message_id` set to the closing assistant message, parent set to the pre-run snapshot

#### Scenario: No post-capture on no-op run

- GIVEN an agent run that did not change any project file or resource
- WHEN the run completes
- THEN no `auto-post-agent` snapshot is created and the pre-run snapshot remains as the only artifact

#### Scenario: Flag disabled

- GIVEN the flag `versioning.auto_capture` is OFF
- WHEN any agent run executes
- THEN no automatic snapshot is created and existing manual snapshot creation continues to work unchanged

---

## ### ADDED — snapshot-parent-linkage

**Package**: `packages/backend/src/db/migrations/`, `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: Parent-Linked Snapshot History

The system MUST persist a parent reference on every snapshot via `parent_snapshot_id`, supporting a tree (not flat list) of historical states. When a snapshot is restored, a new `branch-root` snapshot SHALL be created whose parent is the restored snapshot, preserving the prior tip in history.

#### Scenario: Tip snapshot has no parent

- GIVEN a new project with no prior snapshots
- WHEN the first snapshot is created
- THEN its `parent_snapshot_id` is NULL

#### Scenario: Subsequent snapshot links to current tip

- GIVEN a project with one or more existing snapshots
- WHEN a new snapshot is created
- THEN its `parent_snapshot_id` references the most recent snapshot for that project

#### Scenario: Restore creates branch-root

- GIVEN a project tip `T` and a non-tip snapshot `S`
- WHEN the user restores `S`
- THEN the system creates a new snapshot with `trigger = 'branch-root'` and `parent_snapshot_id = S.id`
- AND `T` remains unchanged in the snapshot table

#### Scenario: Timeline retrieval

- GIVEN a project with branching snapshot history
- WHEN the frontend requests `GET /api/projects/:id/snapshots/timeline`
- THEN the response is a tree ordered by parent linkage, with the current tip indicated

---

## ### ADDED — snapshot-content-addressable-storage

**Package**: `packages/backend/src/db/repos/project-snapshots.ts`, `packages/backend/src/db/migrations/`

### Requirement: Deduplicated Blob Storage

The system MUST store file contents in a content-addressable table `project_snapshot_blobs` keyed by SHA-256 hash. Each snapshot SHALL reference its files via `file_manifest_json` (an array of `{ path, blob_hash, language }`). Identical content across snapshots MUST share a single blob row with reference counting. When the feature flag `versioning.dedup_blobs` is OFF, the legacy `file_tree_json` path remains active.

#### Scenario: Identical files across snapshots deduplicate

- GIVEN two snapshots whose file content is identical
- WHEN both are captured with `versioning.dedup_blobs` ON
- THEN `project_snapshot_blobs` contains one row per unique content with `ref_count = 2`

#### Scenario: Modifying a file produces a new blob

- GIVEN a snapshot containing file `f` with content `c1`
- WHEN a subsequent snapshot is captured after `f` is changed to content `c2`
- THEN both blobs `hash(c1)` and `hash(c2)` exist with `ref_count = 1` each

#### Scenario: Blob endpoint serves content

- GIVEN a stored blob with hash `h`
- WHEN the frontend requests `GET /api/projects/:id/snapshot-blobs/:h` while authenticated
- THEN the response returns the raw content with appropriate `Content-Type`

#### Scenario: Legacy snapshots remain readable

- GIVEN a snapshot created before this change with populated `file_tree_json` and empty `file_manifest_json`
- WHEN the snapshot is read or restored
- THEN the system falls back to `file_tree_json` without error

---

## ### ADDED — snapshot-diff

**Package**: `packages/backend/src/builder/routes.ts`, `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: Pairwise Snapshot Diff

The system MUST expose a diff endpoint `GET /api/projects/:id/snapshots/:a/diff/:b` that returns a structured summary of differences between two snapshots, covering file changes (added, removed, modified by `blob_hash` inequality) and resource graph changes (services, API routes, DB schemas, migrations, app resources, env vars).

#### Scenario: File-level diff summary

- GIVEN two snapshots `A` and `B` of the same project
- WHEN the diff endpoint is called
- THEN the response contains `files.added`, `files.removed`, and `files.modified` arrays
- AND each `modified` entry includes `path`, `a_hash`, and `b_hash`

#### Scenario: Resource graph diff

- GIVEN snapshot `A` has 3 API routes and `B` has 4 (one added, one renamed)
- WHEN the diff endpoint is called
- THEN `resources.apiRoutes` reports the added and the modified entries

#### Scenario: Inline line diff is client-side

- GIVEN a `modified` file entry with `a_hash` and `b_hash`
- WHEN the frontend wants the line-level diff
- THEN it fetches both blobs via `GET /snapshot-blobs/:hash` and computes the diff locally
- AND the server does NOT compute line-level diffs

---

## ### ADDED — snapshot-retention

**Package**: `packages/backend/src/db/repos/project-snapshots.ts`, `packages/backend/src/db/migrations/`

### Requirement: Bounded Retention with Pinning

The system MUST prune ephemeral snapshots beyond a per-project keep window (`snapshot_retention_keep`, default 20). Pinned snapshots (`retention = 'pinned'`) MUST never be pruned. Pruning SHALL run after each `auto-post-agent` capture and decrement reference counts on blobs of deleted snapshots; blobs reaching zero references MUST be deleted.

#### Scenario: Prune keeps the last N ephemeral

- GIVEN a project with retention `keep = 20` and 25 ephemeral snapshots
- WHEN a new snapshot triggers pruning
- THEN the 5 oldest ephemeral snapshots are deleted

#### Scenario: Pinned snapshots survive pruning

- GIVEN a project with 25 ephemeral and 3 pinned snapshots, retention `keep = 20`
- WHEN pruning runs
- THEN all 3 pinned snapshots remain regardless of age

#### Scenario: Orphaned blobs are removed

- GIVEN a snapshot is pruned and its blobs reach `ref_count = 0`
- WHEN pruning completes
- THEN those rows are deleted from `project_snapshot_blobs`

#### Scenario: Per-project retention is configurable

- GIVEN a user updates `snapshot_retention_keep` to 50 for a project via `PATCH /api/projects/:id`
- WHEN subsequent pruning runs
- THEN it preserves up to 50 ephemeral snapshots for that project

---

## ### ADDED — snapshot-pinning-and-labels

**Package**: `packages/backend/src/builder/routes.ts`, `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: User-Editable Labels and Pin State

The system MUST allow authenticated users to assign or update a human-readable `label` on any snapshot and to toggle the `retention` field between `ephemeral` and `pinned`. These changes SHALL be exposed via `PATCH /api/projects/:id/snapshots/:snapshotId` and reflected in the timeline view.

#### Scenario: User pins a snapshot

- GIVEN a snapshot with `retention = 'ephemeral'`
- WHEN the user sends `PATCH` with `{ retention: 'pinned' }`
- THEN the snapshot's `retention` becomes `pinned`

#### Scenario: User labels a snapshot

- GIVEN any snapshot
- WHEN the user sends `PATCH` with `{ label: 'before auth refactor' }`
- THEN the snapshot's `label` is updated and visible in the timeline

#### Scenario: Pinning prevents pruning

- GIVEN a pinned snapshot that would otherwise be pruned by retention policy
- WHEN pruning runs
- THEN the snapshot remains

---

## ### ADDED — snapshot-message-revert

**Package**: `packages/frontend/src/components/chat/MessageList.tsx`, `packages/backend/src/chat/routes.ts`

### Requirement: Revert from Assistant Message

The system MUST surface a "revert to here" affordance on assistant messages that have an associated `auto-post-agent` snapshot. Clicking the affordance SHALL open the diff modal pre-loaded with the comparison between current tip and the message's snapshot. Confirming SHALL invoke the standard restore flow.

#### Scenario: Message with snapshot shows revert affordance

- GIVEN an assistant message linked to an `auto-post-agent` snapshot
- WHEN the user hovers the message in the chat UI
- THEN a "revert to here" control becomes visible

#### Scenario: Message without snapshot has no affordance

- GIVEN an assistant message with no linked snapshot (e.g., a non-mutating reply)
- WHEN the user hovers the message
- THEN no revert control is shown

#### Scenario: Revert from message uses standard diff modal

- GIVEN the user clicks "revert to here" on a message
- WHEN the modal opens
- THEN it shows the diff between current tip and the message's snapshot
- AND confirming restores via the standard restore endpoint

---

## ### ADDED — versioning-feature-flags

**Package**: `packages/backend/src/flags/`

### Requirement: Feature Flag Gating

The system MUST gate new versioning behaviors behind two feature flags:

- `versioning.auto_capture` — controls automatic snapshot creation in the agent loop.
- `versioning.dedup_blobs` — controls whether snapshot capture writes via the content-addressable blob path; when OFF, snapshots are written via the legacy `file_tree_json` path.

Both flags MUST default to OFF until verified in the rollout phase. Flipping either flag OFF SHALL NOT break existing snapshots or active restore operations.

#### Scenario: Auto-capture off retains manual behavior

- GIVEN `versioning.auto_capture = OFF`
- WHEN agent runs execute
- THEN only explicit user or agent-tool snapshot creations produce snapshots

#### Scenario: Dedup off uses legacy storage

- GIVEN `versioning.dedup_blobs = OFF`
- WHEN a snapshot is captured
- THEN `file_tree_json` is populated and `file_manifest_json` remains empty
- AND restore reads from `file_tree_json` as before

#### Scenario: Mixed-format snapshots coexist

- GIVEN a project with snapshots in both legacy and new format
- WHEN any snapshot is restored
- THEN the system correctly reads whichever format that snapshot uses

---

## ### MODIFIED — project-snapshots

**Package**: `packages/backend/src/builder/routes.ts`, `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: Restore with Branch Semantics

The existing snapshot restore behavior (from `003-full-stack-project-generator`) MUST be modified so that every restore creates a new `branch-root` snapshot whose parent is the restored snapshot. The previous tip MUST NOT be deleted or overwritten. The restore endpoint SHALL return the ID of the newly created branch-root snapshot.

#### Scenario: Restore preserves prior tip in history

- GIVEN a project with tip `T` and the user restores snapshot `S` (S ≠ T)
- WHEN the restore completes
- THEN `T` still exists in `project_snapshots` with its original data
- AND a new `branch-root` snapshot exists with `parent_snapshot_id = S.id`
- AND the response contains `{ new_snapshot_id: <branch-root.id> }`

#### Scenario: Restore is transactional

- GIVEN any snapshot restore
- WHEN the restore executes
- THEN all writes (file rehydrate, resource rehydrate, branch-root creation) occur within a single transaction
- AND a failure mid-way rolls back leaving the project in its prior state

#### Scenario: Restore requires confirmation

- GIVEN the restore endpoint is called without `{ confirm: true }` in the body
- WHEN the request is processed
- THEN the endpoint returns 400 with an error explaining that explicit confirmation is required

---

## ### MODIFIED — snapshot-schema

**Package**: `packages/backend/src/db/migrations/`

### Requirement: Schema Backwards Compatibility

The migration adding versioning columns MUST be additive and reversible-by-flag. Existing snapshots SHALL remain readable through the legacy `file_tree_json` path. The `screenshot_blob_hash` column is added now (nullable) as a forward hook for `005-playwright-validation`; it MUST remain unpopulated by this change.

#### Scenario: Migration is additive

- GIVEN an existing DevMind database with snapshots from `003`
- WHEN migration 018 is applied
- THEN all existing snapshots remain queryable
- AND `file_tree_json` is preserved verbatim

#### Scenario: Forward hook column exists but unused

- GIVEN migration 018 has been applied
- WHEN any snapshot is captured by this change's code
- THEN `screenshot_blob_hash` is NULL on the new row
