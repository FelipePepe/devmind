import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ProjectSnapshotBlobsRepo } from './project-snapshot-blobs.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE project_snapshot_blobs (
      hash        TEXT PRIMARY KEY,
      content     BLOB NOT NULL,
      size_bytes  INTEGER NOT NULL,
      ref_count   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('writeIfMissing inserts the blob once and reports the first write only', () => {
  const repo = new ProjectSnapshotBlobsRepo(freshDb());
  const buf = Buffer.from('hello', 'utf8');
  assert.equal(repo.writeIfMissing('h1', buf), true);
  assert.equal(repo.writeIfMissing('h1', buf), false);
  const row = repo.getByHash('h1')!;
  assert.equal(row.size_bytes, 5);
  assert.equal(row.ref_count, 0);
});

test('incrementRef accumulates duplicates within a single call (regression: SQL IN-clause dedup)', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotBlobsRepo(db);
  repo.writeIfMissing('h1', Buffer.from('a'));
  repo.writeIfMissing('h2', Buffer.from('b'));

  repo.incrementRef(['h1', 'h1', 'h2']);
  assert.equal(repo.getByHash('h1')!.ref_count, 2);
  assert.equal(repo.getByHash('h2')!.ref_count, 1);
});

test('decrementRef accumulates duplicates within a single call', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotBlobsRepo(db);
  repo.writeIfMissing('h1', Buffer.from('a'));
  repo.incrementRef(['h1', 'h1', 'h1']);
  repo.decrementRef(['h1', 'h1']);
  assert.equal(repo.getByHash('h1')!.ref_count, 1);
});

test('deleteOrphans removes rows with ref_count <= 0 and returns the count', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotBlobsRepo(db);
  repo.writeIfMissing('keep', Buffer.from('a'));
  repo.writeIfMissing('drop1', Buffer.from('b'));
  repo.writeIfMissing('drop2', Buffer.from('c'));
  repo.incrementRef(['keep']);
  repo.decrementRef(['drop1']); // 0 → -1

  const removed = repo.deleteOrphans();
  assert.equal(removed, 2); // both drop1 (-1) and drop2 (0) qualify
  assert.ok(repo.getByHash('keep'));
  assert.equal(repo.getByHash('drop1'), undefined);
  assert.equal(repo.getByHash('drop2'), undefined);
});

test('empty input arrays are a no-op', () => {
  const db = freshDb();
  const repo = new ProjectSnapshotBlobsRepo(db);
  repo.writeIfMissing('h1', Buffer.from('a'));
  repo.incrementRef([]);
  repo.decrementRef([]);
  assert.equal(repo.getByHash('h1')!.ref_count, 0);
});
