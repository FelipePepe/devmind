# Design: 004 — Project Versioning

## Technical Approach

DevMind already has a snapshot primitive that captures full project state and restores it atomically. The design challenge is not capture-or-restore; it is making the workflow trustworthy and bounded:

1. **Make capture invisible** — automatic before and after every agent run, never something the user has to remember.
2. **Make storage bounded** — content-addressable file blobs with reference counting, deterministic pruning of ephemeral snapshots.
3. **Make navigation legible** — parent linkage turns the flat list into a timeline; restore creates branches, never overwrites history silently.
4. **Make undo cheap** — diffing surfaces what changed before the user commits to a restore; the chat UI offers per-message revert when a snapshot is attached.

The migration is **additive-first** and gated by two feature flags. The existing JSON-blob snapshot format continues to work; new snapshots write into the blob store; existing snapshots get a one-time backfill.

---

## 1. Target Architecture

```text
agent.runAgentLoop(projectId, runId)
  ├─ pre:  snapshotsRepo.capture(projectId, runId, 'auto-pre-agent')
  │         └─ writes file_manifest with blob_hash refs, increments blob ref_counts
  ├─ ... existing tool execution ...
  └─ post: if mutated then snapshotsRepo.capture(projectId, runId, 'auto-post-agent', messageId)
            └─ links to closing assistant message
            └─ schedules retention pass for this project

snapshot timeline (frontend)
  /project/:id/snapshots/timeline
    GET → tree of snapshots ordered by parent_snapshot_id
    rendered as indented list with trigger icons + labels

snapshot diff
  GET /api/projects/:id/snapshots/:a/diff/:b
    returns {
      files: { added[], removed[], modified[ { path, a_hash, b_hash } ] },
      resources: { services, apiRoutes, dbSchemas, dbMigrations, appResources, envVars }
                  each a diff summary
    }
  GET /api/projects/:id/snapshot-blobs/:hash → raw content (for client-side line diff)

restore
  POST /api/projects/:id/snapshots/:id/restore
    body: { confirm: true }
    response: { new_snapshot_id }   ← restored state immediately re-snapshotted as branch root
```

---

## 2. Data Model

### Migration 018 — versioning schema

```sql
-- Extend project_snapshots
ALTER TABLE project_snapshots ADD COLUMN parent_snapshot_id TEXT
  REFERENCES project_snapshots(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'
  CHECK (trigger IN ('manual','auto-pre-agent','auto-post-agent','milestone','branch-root'));
ALTER TABLE project_snapshots ADD COLUMN agent_run_id TEXT
  REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots ADD COLUMN message_id TEXT
  REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots ADD COLUMN retention TEXT NOT NULL DEFAULT 'ephemeral'
  CHECK (retention IN ('ephemeral','pinned'));
ALTER TABLE project_snapshots ADD COLUMN file_manifest_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_snapshots ADD COLUMN screenshot_blob_hash TEXT;
-- file_tree_json remains for back-compat; new captures leave it as '[]' and use file_manifest_json
-- A later cleanup change MAY drop file_tree_json once all snapshots are migrated.

CREATE TABLE project_snapshot_blobs (
  hash       TEXT PRIMARY KEY,
  content    BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  ref_count  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Per-project retention policy
ALTER TABLE projects ADD COLUMN snapshot_retention_keep INTEGER NOT NULL DEFAULT 20;

CREATE INDEX idx_project_snapshots_parent ON project_snapshots(parent_snapshot_id);
CREATE INDEX idx_project_snapshots_project_created ON project_snapshots(project_id, created_at DESC);
CREATE INDEX idx_project_snapshots_message ON project_snapshots(message_id);
```

### `file_manifest_json` shape

```json
[
  { "path": "src/index.ts", "blob_hash": "ab12…", "language": "typescript" },
  { "path": "package.json",  "blob_hash": "cd34…", "language": "json" }
]
```

Storage cost per snapshot is reduced from `O(total file content)` to `O(file count × ~80 bytes)` plus shared blob storage.

---

## 3. Capture Strategy

### Automatic capture in the agent loop

`packages/backend/src/agent/loop.ts` is extended with two hooks:

```ts
async function runAgentLoop(input) {
  const flags = getFlags();
  const autoCapture = flags['versioning.auto_capture'];

  let preSnapshotId: string | null = null;
  if (autoCapture && input.projectId) {
    const pre = snapshotsRepo.capture(input.projectId, {
      runId: input.runId,
      trigger: 'auto-pre-agent',
      parentSnapshotId: snapshotsRepo.findCurrentTip(input.projectId)?.id ?? null,
    });
    preSnapshotId = pre.id;
  }

  const result = await runExistingLoop(input);

  if (autoCapture && input.projectId && result.mutated) {
    snapshotsRepo.capture(input.projectId, {
      runId: input.runId,
      messageId: result.closingMessageId,
      trigger: 'auto-post-agent',
      parentSnapshotId: preSnapshotId,
    });
    schedulePruning(input.projectId);
  }

  return result;
}
```

`result.mutated` is determined by comparing the tip blob manifest hash before and after, which costs one SQL aggregate per project.

### Branch-root capture on restore

Restoring a snapshot creates a **new snapshot** with `trigger = 'branch-root'` and `parent_snapshot_id = <restored.id>`. The live state then follows from that branch root. The restored snapshot itself is never mutated.

This guarantees:

- Restore is non-destructive at the history level.
- Two branches sharing ancestors share blobs through ref counting.
- A user who restores by mistake can restore again from the previously-current tip.

---

## 4. Content-Addressable Blob Storage

### Hashing

- Algorithm: SHA-256, hex-encoded.
- Hash input: raw file content bytes (UTF-8 for text files, binary for assets when 005 lands).
- Empty files have a deterministic empty-content hash; they still get a row.

### Write path (capture)

```ts
function capture(projectId, opts) {
  const files = db.prepare('SELECT path, content, language FROM project_files WHERE project_id = ?').all(projectId);

  const manifest = [];
  const newBlobHashes = new Set();

  for (const f of files) {
    const hash = sha256(f.content);
    manifest.push({ path: f.path, blob_hash: hash, language: f.language });
    if (!newBlobHashes.has(hash)) {
      newBlobHashes.add(hash);
      const existing = db.prepare('SELECT hash FROM project_snapshot_blobs WHERE hash = ?').get(hash);
      if (!existing) {
        db.prepare('INSERT INTO project_snapshot_blobs (hash, content, size_bytes, ref_count, created_at) VALUES (?, ?, ?, 0, ?)')
          .run(hash, f.content, Buffer.byteLength(f.content, 'utf8'), nowIso());
      }
    }
  }

  // capture row + resource_graph + manifest_json + file_manifest_json
  // then bump ref_count for each unique blob
  for (const hash of newBlobHashes) {
    db.prepare('UPDATE project_snapshot_blobs SET ref_count = ref_count + 1 WHERE hash = ?').run(hash);
  }
}
```

### Read path (restore)

`restore()` reads `file_manifest_json`, fetches each blob by hash, rehydrates `project_files`. The existing transactional rehydrate logic in `project-snapshots.ts:restore()` is updated to consume the manifest format when present, falling back to `file_tree_json` for legacy snapshots.

### Prune path

```ts
function prune(projectId) {
  const keep = db.prepare('SELECT snapshot_retention_keep FROM projects WHERE id = ?').get(projectId).snapshot_retention_keep;
  const toDelete = db.prepare(`
    SELECT id FROM project_snapshots
    WHERE project_id = ? AND retention = 'ephemeral'
    ORDER BY created_at DESC
    LIMIT -1 OFFSET ?
  `).all(projectId, keep);

  for (const { id } of toDelete) {
    const manifest = JSON.parse(db.prepare('SELECT file_manifest_json FROM project_snapshots WHERE id = ?').get(id).file_manifest_json);
    const uniqueHashes = new Set(manifest.map(m => m.blob_hash));
    db.prepare('DELETE FROM project_snapshots WHERE id = ?').run(id);
    for (const hash of uniqueHashes) {
      db.prepare('UPDATE project_snapshot_blobs SET ref_count = ref_count - 1 WHERE hash = ?').run(hash);
    }
  }
  db.prepare('DELETE FROM project_snapshot_blobs WHERE ref_count <= 0').run();
}
```

Pinned snapshots and their ancestors are excluded from the deletion candidate set even if they fall outside the keep window. Children-of-pinned are NOT preserved unless they are also pinned — this keeps the rule simple.

---

## 5. Diff Engine

### File diff

Per-pair file diff is computed as set arithmetic on the two manifests:

```ts
function diffManifests(a, b) {
  const aByPath = new Map(a.map(f => [f.path, f.blob_hash]));
  const bByPath = new Map(b.map(f => [f.path, f.blob_hash]));

  const added = [...bByPath].filter(([p]) => !aByPath.has(p)).map(([path, blob_hash]) => ({ path, blob_hash }));
  const removed = [...aByPath].filter(([p]) => !bByPath.has(p)).map(([path, blob_hash]) => ({ path, blob_hash }));
  const modified = [...bByPath]
    .filter(([p, h]) => aByPath.has(p) && aByPath.get(p) !== h)
    .map(([path, b_hash]) => ({ path, a_hash: aByPath.get(path), b_hash }));

  return { added, removed, modified };
}
```

Cost: O(n+m) on path counts. No content reads required for the summary.

### Resource diff

Resource graphs are diffed by `(type, name)` keys. The diff returns a structured summary, not a line diff:

```json
{
  "services":   { "added": [], "removed": [], "modified": [{ "name": "api", "field": "port", "a": 3000, "b": 3001 }] },
  "apiRoutes":  { "added": [{ "method": "GET", "path": "/users" }], "removed": [], "modified": [] },
  "dbSchemas":  { "added": [], "removed": [], "modified": [] },
  "dbMigrations": { ... },
  "appResources": { ... },
  "envVars":    { ... }
}
```

### Inline line diff

The diff endpoint returns metadata only. The frontend, on user expand, calls `GET /snapshot-blobs/:hash` for both `a_hash` and `b_hash` and runs a client-side diff (`diff` npm package, already permissible by license). This keeps server cost predictable.

---

## 6. Restore Semantics

### Confirmation flow

```text
user clicks "restore" on snapshot X
  → frontend calls GET /snapshots/<currentTip>/diff/<X>
  → modal shows: "N files added, M removed, K modified. Restore branches history at this point."
  → user confirms
  → frontend calls POST /snapshots/<X>/restore { confirm: true }
  → backend:
       transaction:
         1. restore project_files / project_services / ... from snapshot X (existing logic, manifest-aware)
         2. INSERT branch-root snapshot: parent = X, trigger = 'branch-root'
       commit
  → frontend reloads project state and snapshot tree
```

### Why branch-root is its own snapshot

Without it, the timeline would show two snapshots with identical content (X and the implicit "where we are now after restore"). With it, the tree clearly shows: *"this branch started by restoring X"*.

Storage cost of branch-root is one row + zero new blobs (all blobs already referenced by X). Tradeoff is favorable.

---

## 7. Retention Policy

Per project, defaults:

| Setting | Default | Editable |
|---|---|---|
| `snapshot_retention_keep` | 20 | Yes, per-project |
| Pinned snapshots | Always kept | Always |
| Pruning trigger | After each `auto-post-agent` capture | No |

A future change MAY add time-based retention ("keep all from last 7 days"). v1 ships with count-based only.

### Pruning concurrency

Pruning runs synchronously inside the post-capture path but in its own transaction. If pruning fails (e.g., FK violation due to a parent reference from a pinned child), it logs and skips — the capture itself still succeeds. The orphaned blobs will be cleaned up by a later prune or by the admin `POST /admin/snapshots/compact` endpoint.

---

## 8. Migration of Existing Snapshots

Existing snapshots have populated `file_tree_json` and empty `file_manifest_json`. A one-time backfill runs lazily on first restore: when a legacy snapshot is restored, the restore path also writes a manifest + blobs for it, leaving `file_tree_json` intact. After lazy migration, both formats co-exist; reading prefers `file_manifest_json` when non-empty.

This avoids a heavy backfill at migration time. A later cleanup change MAY add an eager backfill job and then drop `file_tree_json`.

---

## 9. Frontend — Timeline and Diff Modal

### Sidebar tab "snapshots" becomes timeline

```text
┌─ Snapshots ────────────────────────────┐
│  ● now (tip)                            │
│  │                                       │
│  ▼ Sat 14:21  manual    "before refactor"│  📌
│  │                                       │
│  ▼ Sat 14:18  auto-post  msg #42         │
│  │                                       │
│  ▼ Sat 14:18  auto-pre   run #19         │
│  │                                       │
│  ├─ branch from 14:05 ←── restored here  │
│  │  ▼ Sat 14:05  auto-post                │
│  │
│  ▼ Sat 13:50  manual                      │
└──────────────────────────────────────────┘
```

Renders from `GET /api/projects/:id/snapshots/timeline` which returns the tree pre-ordered. Trigger icons: 📌 pinned, ▶ manual, ⟲ auto-pre, ✓ auto-post, ⤳ branch-root.

### Diff modal

Shown before any restore. Single-screen summary + collapsible per-file inline diff. Two buttons: `Cancel`, `Restore (creates new branch)`. The button text is intentionally explicit.

### Per-message revert

`MessageList.tsx` reads `message.linked_snapshot_id` (already exposable via API). On hover, an icon `⟲ revert to here` appears. Clicking it opens the same diff modal pre-loaded with that snapshot.

---

## 10. Implementation Order

The order is chosen so each phase is independently mergeable, observable, and reversible behind feature flags.

1. **Schema migration** — additive columns + blob table. No behavior change.
2. **Repo layer** — capture-by-hash, manifest-aware restore, prune logic. Old endpoints still work; new code path opt-in.
3. **Blob storage routes** — `GET /snapshot-blobs/:hash` content endpoint, gated by auth.
4. **Auto-capture in agent loop** — behind `versioning.auto_capture` flag. Off by default until verified.
5. **Diff endpoint and types** — `GET /snapshots/:a/diff/:b`.
6. **Retention / pinning** — endpoints for label, pin/unpin, retention config; prune executed on post-capture.
7. **Branch-root on restore** — modify restore route to create branch-root snapshot.
8. **Frontend timeline view** — replace flat list with tree; add trigger icons + labels.
9. **Frontend diff modal** — render diff before restore; require explicit confirmation.
10. **Per-message revert** — chat UI affordance.
11. **Verification + flag rollout** — turn flags on per environment, monitor blob table growth, document admin compact endpoint.
