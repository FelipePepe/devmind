import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ToolCallAuditRepo, excerpt } from './tool-call-audit.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tool_call_audit (
      id              TEXT PRIMARY KEY,
      agent_run_id    TEXT,
      session_id      TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      project_id      TEXT,
      tool_name       TEXT NOT NULL,
      safety          TEXT NOT NULL CHECK(safety IN ('read','write','destructive')),
      args_json       TEXT NOT NULL,
      status          TEXT NOT NULL CHECK(status IN ('ok','error','blocked','invalid-args')),
      output_excerpt  TEXT NOT NULL DEFAULT '',
      error           TEXT,
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const baseStart = {
  agentRunId: 'run-1',
  sessionId: 'sess-1',
  userId: 'user-1',
  projectId: 'proj-1',
  toolName: 'file_read',
  safety: 'read' as const,
  argsJson: '{"path":"a.ts"}',
};

test('excerpt returns the original text below the cap', () => {
  assert.equal(excerpt('short'), 'short');
  assert.equal(excerpt(''), '');
});

test('excerpt truncates and annotates large output', () => {
  const big = 'x'.repeat(3000);
  const out = excerpt(big);
  assert.ok(out.length < big.length);
  assert.match(out, /\(truncated 952 chars\)/);
});

test('insertStart writes a provisional row with status=ok and empty excerpt', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  const id = repo.insertStart(baseStart);

  const row = db.prepare('SELECT * FROM tool_call_audit WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(row.status, 'ok');
  assert.equal(row.output_excerpt, '');
  assert.equal(row.tool_name, 'file_read');
  assert.equal(row.safety, 'read');
  assert.equal(row.duration_ms, 0);
});

test('updateFinish transitions the provisional row to its final state', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  const id = repo.insertStart(baseStart);
  repo.updateFinish(id, { status: 'error', outputExcerpt: 'boom', error: 'ENOENT', durationMs: 42 });

  const row = db.prepare('SELECT * FROM tool_call_audit WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(row.status, 'error');
  assert.equal(row.output_excerpt, 'boom');
  assert.equal(row.error, 'ENOENT');
  assert.equal(row.duration_ms, 42);
});

test('insertFinal writes a fully-formed row in one shot (blocked path)', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  const id = repo.insertFinal({
    ...baseStart,
    toolName: 'delete_project',
    safety: 'destructive',
    status: 'blocked',
    outputExcerpt: '',
    error: 'autonomy policy: destructive blocked',
    durationMs: 0,
  });

  const row = db.prepare('SELECT * FROM tool_call_audit WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(row.status, 'blocked');
  assert.equal(row.error, 'autonomy policy: destructive blocked');
});

test('insertFinal truncates output excerpts that exceed the cap', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  const id = repo.insertFinal({
    ...baseStart,
    status: 'ok',
    outputExcerpt: 'a'.repeat(5000),
    error: null,
    durationMs: 5,
  });

  const row = db.prepare('SELECT output_excerpt FROM tool_call_audit WHERE id = ?').get(id) as { output_excerpt: string };
  assert.ok(row.output_excerpt.length < 5000);
  assert.match(row.output_excerpt, /\(truncated/);
});

test('status enum check rejects unknown values', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  assert.throws(
    () =>
      repo.insertFinal({
        ...baseStart,
        status: 'unknown' as never,
        outputExcerpt: '',
        error: null,
        durationMs: 0,
      }),
    /CHECK constraint failed/
  );
});

test('safety enum check rejects unknown values', () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  assert.throws(
    () =>
      repo.insertFinal({
        ...baseStart,
        safety: 'spicy' as never,
        status: 'ok',
        outputExcerpt: '',
        error: null,
        durationMs: 0,
      }),
    /CHECK constraint failed/
  );
});

test('findRecent returns rows newest-first with cap clamped to [1, 500]', async () => {
  const db = freshDb();
  const repo = new ToolCallAuditRepo(db);
  repo.insertFinal({ ...baseStart, toolName: 'a', status: 'ok', outputExcerpt: '', error: null, durationMs: 1 });
  await new Promise((r) => setTimeout(r, 1100));
  repo.insertFinal({ ...baseStart, toolName: 'b', status: 'ok', outputExcerpt: '', error: null, durationMs: 1 });

  const rows = repo.findRecent(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.tool_name, 'b');
  assert.equal(rows[1]!.tool_name, 'a');

  assert.equal(repo.findRecent(0).length, 1, 'limit<1 clamps to 1');
  assert.equal(repo.findRecent(-5).length, 1, 'negative limit clamps to 1');
  assert.equal(repo.findRecent(10000).length, 2, 'limit>500 clamps to 500 (we only have 2 rows here)');
});
