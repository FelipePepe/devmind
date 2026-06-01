import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ProjectSnapshotsRepo, snapshotStateHash } from './project-snapshots.js';
import { ProjectSnapshotBlobsRepo } from './project-snapshot-blobs.js';
import { FlagsRepo } from './flags.js';
import { sha256 } from './hashing.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE feature_flags (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      description TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE projects (
      id                       TEXT PRIMARY KEY,
      name                     TEXT NOT NULL,
      snapshot_retention_keep  INTEGER NOT NULL DEFAULT 20
    );

    CREATE TABLE project_snapshots (
      id                   TEXT PRIMARY KEY,
      project_id           TEXT NOT NULL,
      run_id               TEXT,
      label                TEXT,
      manifest_json        TEXT NOT NULL DEFAULT '{}',
      file_tree_json       TEXT NOT NULL DEFAULT '[]',
      resource_graph_json  TEXT NOT NULL DEFAULT '{}',
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      parent_snapshot_id   TEXT,
      trigger              TEXT NOT NULL DEFAULT 'manual',
      agent_run_id         TEXT,
      message_id           TEXT,
      retention            TEXT NOT NULL DEFAULT 'ephemeral',
      file_manifest_json   TEXT,
      screenshot_blob_hash TEXT
    );

    CREATE TABLE project_snapshot_blobs (
      hash        TEXT PRIMARY KEY,
      content     BLOB NOT NULL,
      size_bytes  INTEGER NOT NULL,
      ref_count   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('proj-1', 'demo');
  return db;
}

function createInputFor(files: Array<{ path: string; content: string; language?: string }>) {
  return {
    manifest: { version: 1 },
    fileTree: files,
    resourceGraph: { services: [], apiRoutes: [] },
    fileManifest: files.map((f) => ({
      path: f.path,
      hash: sha256(Buffer.from(f.content, 'utf8')),
      ...(f.language ? { language: f.language } : {}),
    })),
  };
}

test('create persists a snapshot and round-trips its JSON fields', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  const snap = repo.create('proj-1', {
    label: 'first',
    manifest: { version: 2, appType: 'static-web' },
    fileTree: [{ path: 'index.html', content: '<h1/>' }],
    resourceGraph: { services: [{ name: 'web' }] },
  });

  assert.equal(snap.label, 'first');
  assert.equal(snap.trigger, 'manual');
  assert.equal(snap.retention, 'ephemeral');
  assert.equal(snap.parent_snapshot_id, null);
  assert.deepEqual(snap.manifest, { version: 2, appType: 'static-web' });
  assert.equal((snap.file_tree[0] as { path: string }).path, 'index.html');
});

test('findByProject orders newest-first and respects the limit', async () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  repo.create('proj-1', { label: 'a', manifest: {}, fileTree: [], resourceGraph: {} });
  await new Promise((r) => setTimeout(r, 1100));
  repo.create('proj-1', { label: 'b', manifest: {}, fileTree: [], resourceGraph: {} });

  const rows = repo.findByProject('proj-1', 10);
  assert.equal(rows[0]!.label, 'b');
  assert.equal(rows[1]!.label, 'a');
  assert.equal(repo.findByProject('proj-1', 1).length, 1);
});

test('getTimeline returns nodes oldest-first with a tip id', async () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  const a = repo.create('proj-1', { label: 'a', manifest: {}, fileTree: [], resourceGraph: {} });
  await new Promise((r) => setTimeout(r, 1100));
  const b = repo.create('proj-1', {
    label: 'b', manifest: {}, fileTree: [], resourceGraph: {},
    parentSnapshotId: a.id, trigger: 'manual',
  });

  const timeline = repo.getTimeline('proj-1');
  assert.equal(timeline.tip_id, b.id);
  assert.equal(timeline.nodes.length, 2);
  assert.equal(timeline.nodes[0]!.id, a.id);
  assert.equal(timeline.nodes[1]!.parent_id, a.id);
});

test('getDiff classifies added / removed / modified files', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);

  const a = repo.create('proj-1', {
    ...createInputFor([
      { path: 'keep.ts', content: 'same' },
      { path: 'mod.ts', content: 'v1' },
      { path: 'gone.ts', content: 'bye' },
    ]),
  });
  const b = repo.create('proj-1', {
    ...createInputFor([
      { path: 'keep.ts', content: 'same' },
      { path: 'mod.ts', content: 'v2' },
      { path: 'new.ts', content: 'hi' },
    ]),
  });

  const diff = repo.getDiff('proj-1', a.id, b.id);
  assert.ok(diff);
  assert.deepEqual(diff!.files.added.map((f) => f.path), ['new.ts']);
  assert.deepEqual(diff!.files.removed.map((f) => f.path), ['gone.ts']);
  assert.deepEqual(diff!.files.modified.map((f) => f.path), ['mod.ts']);
});

test('getDiff falls back to hashing file_tree when no manifest exists (legacy snapshots)', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  const a = repo.create('proj-1', {
    manifest: {}, resourceGraph: {},
    fileTree: [{ path: 'a.ts', content: 'one' }],
  });
  const b = repo.create('proj-1', {
    manifest: {}, resourceGraph: {},
    fileTree: [{ path: 'a.ts', content: 'two' }],
  });
  const diff = repo.getDiff('proj-1', a.id, b.id);
  assert.equal(diff!.files.modified.length, 1);
});

test('getDiff refuses cross-project comparison', () => {
  const db = freshDb();
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('proj-2', 'other');
  const repo = new ProjectSnapshotsRepo(db);
  const a = repo.create('proj-1', { manifest: {}, fileTree: [], resourceGraph: {} });
  const b = repo.create('proj-2', { manifest: {}, fileTree: [], resourceGraph: {} });
  assert.equal(repo.getDiff('proj-1', a.id, b.id), undefined);
});

test('updateMetadata patches label, retention, and screenshot hash independently', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  const snap = repo.create('proj-1', { manifest: {}, fileTree: [], resourceGraph: {} });

  const after = repo.updateMetadata(snap.id, { label: 'pinned', retention: 'pinned', screenshotBlobHash: 'h1' });
  assert.equal(after!.label, 'pinned');
  assert.equal(after!.retention, 'pinned');
  assert.equal(after!.screenshot_blob_hash, 'h1');

  // clearing the screenshot back to null must round-trip
  const cleared = repo.updateMetadata(snap.id, { screenshotBlobHash: null });
  assert.equal(cleared!.screenshot_blob_hash, null);
});

test('prune deletes oldest ephemerals beyond retention and decrements blob ref counts', () => {
  const db = freshDb();
  const blobs = new ProjectSnapshotBlobsRepo(db);
  const flags = new FlagsRepo(db);
  flags.set('versioning.dedup_blobs', 'true');
  const repo = new ProjectSnapshotsRepo(db, blobs, flags);

  db.prepare('UPDATE projects SET snapshot_retention_keep = 2 WHERE id = ?').run('proj-1');

  // Create 4 ephemeral snapshots sharing a single file blob to exercise dedup ref counting.
  const buf = Buffer.from('shared', 'utf8');
  const hash = sha256(buf);
  for (let i = 0; i < 4; i++) {
    blobs.writeIfMissing(hash, buf);
    blobs.incrementRef([hash]);
    repo.create('proj-1', {
      manifest: {}, fileTree: [], resourceGraph: {},
      fileManifest: [{ path: 'x.txt', hash }],
    });
  }

  assert.equal(blobs.getByHash(hash)!.ref_count, 4);
  const pruned = repo.prune('proj-1');
  assert.equal(pruned, 2);
  // 2 victims released their ref → ref_count drops from 4 to 2, blob survives.
  assert.equal(blobs.getByHash(hash)!.ref_count, 2);
  assert.equal(repo.findByProject('proj-1').length, 2);
});

test('prune keeps pinned snapshots even beyond the retention cap', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  db.prepare('UPDATE projects SET snapshot_retention_keep = 1 WHERE id = ?').run('proj-1');

  const oldest = repo.create('proj-1', { manifest: {}, fileTree: [], resourceGraph: {}, retention: 'pinned' });
  repo.create('proj-1', { manifest: {}, fileTree: [], resourceGraph: {} });
  repo.create('proj-1', { manifest: {}, fileTree: [], resourceGraph: {} });

  repo.prune('proj-1');
  // Pinned snapshot stays even though it's older than the cap.
  assert.ok(repo.findById(oldest.id));
});

test('discard removes the snapshot and releases its blobs', () => {
  const db = freshDb();
  const blobs = new ProjectSnapshotBlobsRepo(db);
  const flags = new FlagsRepo(db);
  flags.set('versioning.dedup_blobs', 'true');
  const repo = new ProjectSnapshotsRepo(db, blobs, flags);

  const buf = Buffer.from('only-here', 'utf8');
  const hash = sha256(buf);
  blobs.writeIfMissing(hash, buf);
  blobs.incrementRef([hash]);
  const snap = repo.create('proj-1', {
    manifest: {}, fileTree: [], resourceGraph: {},
    fileManifest: [{ path: 'x.txt', hash }],
  });

  repo.discard(snap.id);
  assert.equal(repo.findById(snap.id), undefined);
  assert.equal(blobs.getByHash(hash), undefined, 'orphan blob should be reclaimed');
});

test('compactBlobs resets ref counts from live manifests and deletes orphans', () => {
  const db = freshDb();
  const blobs = new ProjectSnapshotBlobsRepo(db);
  const flags = new FlagsRepo(db);
  const repo = new ProjectSnapshotsRepo(db, blobs, flags);

  const live = sha256(Buffer.from('live', 'utf8'));
  const ghost = sha256(Buffer.from('ghost', 'utf8'));
  blobs.writeIfMissing(live, Buffer.from('live', 'utf8'));
  blobs.writeIfMissing(ghost, Buffer.from('ghost', 'utf8'));

  // Drift: ref_count set out of sync with the live manifests.
  db.prepare('UPDATE project_snapshot_blobs SET ref_count = 99 WHERE hash = ?').run(live);
  db.prepare('UPDATE project_snapshot_blobs SET ref_count = 5 WHERE hash = ?').run(ghost);

  repo.create('proj-1', {
    manifest: {}, fileTree: [], resourceGraph: {},
    fileManifest: [{ path: 'live.txt', hash: live }],
  });

  const result = repo.compactBlobs();
  assert.equal(result.recounted, 1);
  assert.equal(result.orphans_deleted, 1);
  assert.equal(blobs.getByHash(live)!.ref_count, 1);
  assert.equal(blobs.getByHash(ghost), undefined);
});

test('snapshotStateHash is stable across equivalent states', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotsRepo(db);
  const a = repo.create('proj-1', {
    manifest: { v: 1 }, resourceGraph: { services: ['a'] },
    fileTree: [{ path: 'x.ts', content: 'same' }],
    fileManifest: [{ path: 'x.ts', hash: sha256('same') }],
  });
  const b = repo.create('proj-1', {
    manifest: { v: 1 }, resourceGraph: { services: ['a'] },
    fileTree: [{ path: 'x.ts', content: 'same' }],
    fileManifest: [{ path: 'x.ts', hash: sha256('same') }],
  });
  assert.equal(snapshotStateHash(a), snapshotStateHash(b));
});

test('isAutoCaptureEnabled flips with the feature flag', () => {
  const db = freshDb();
  const flags = new FlagsRepo(db);
  const repo = new ProjectSnapshotsRepo(db, undefined, flags);
  assert.equal(repo.isAutoCaptureEnabled(), false);
  flags.set('versioning.auto_capture', 'true');
  assert.equal(repo.isAutoCaptureEnabled(), true);
});
