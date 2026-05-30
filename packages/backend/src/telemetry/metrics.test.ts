import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MetricsRegistry } from './metrics.js';

function makeRegistry(db: Database.Database) {
  return new MetricsRegistry(db, '/tmp/nonexistent-test.db', 'http://127.0.0.1:11434');
}

describe('MetricsRegistry', () => {
  let db: Database.Database;

  before(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE project_snapshot_blobs (hash TEXT PRIMARY KEY);
      INSERT INTO jobs VALUES ('j1', 'pending'), ('j2', 'pending'), ('j3', 'processing'), ('j4', 'failed');
      INSERT INTO project_snapshot_blobs VALUES ('abc'), ('def'), ('ghi');
    `);
  });

  it('recordAgentLoop increments counters and histogram', async () => {
    const m = makeRegistry(db);
    m.recordAgentLoop('success', 3500);
    m.recordAgentLoop('success', 7000);
    m.recordAgentLoop('error', 1200);

    const text = await m.render();
    assert.match(text, /devmind_agent_loop_total\{outcome="success"\} 2/);
    assert.match(text, /devmind_agent_loop_total\{outcome="error"\} 1/);
    assert.match(text, /devmind_agent_loop_duration_seconds_count 3/);
    // 3.5s falls in the 5s bucket; all three fall in the +Inf bucket
    assert.match(text, /devmind_agent_loop_duration_seconds_bucket\{le="\+Inf"\} 3/);
  });

  it('recordToolCall increments with correct safety+status labels', async () => {
    const m = makeRegistry(db);
    m.recordToolCall('read', 'ok');
    m.recordToolCall('read', 'ok');
    m.recordToolCall('write', 'error');
    m.recordToolCall('destructive', 'blocked');

    const text = await m.render();
    assert.match(text, /devmind_tool_calls_total\{safety="read",status="ok"\} 2/);
    assert.match(text, /devmind_tool_calls_total\{safety="write",status="error"\} 1/);
    assert.match(text, /devmind_tool_calls_total\{safety="destructive",status="blocked"\} 1/);
  });

  it('render includes all 7 new metric families', async () => {
    const m = makeRegistry(db);
    const text = await m.render();

    assert.match(text, /devmind_uptime_seconds/);
    assert.match(text, /devmind_http_requests_total/);
    assert.match(text, /devmind_agent_loop_total/);
    assert.match(text, /devmind_agent_loop_duration_seconds_bucket/);
    assert.match(text, /devmind_tool_calls_total/);
    assert.match(text, /devmind_job_queue_depth/);
    assert.match(text, /devmind_blob_store_blobs_total/);
    assert.match(text, /devmind_db_size_bytes/);
    assert.match(text, /devmind_ollama_health_latency_ms/);
  });

  it('render queries DB gauges correctly', async () => {
    const m = makeRegistry(db);
    const text = await m.render();

    assert.match(text, /devmind_job_queue_depth\{status="pending"\} 2/);
    assert.match(text, /devmind_job_queue_depth\{status="processing"\} 1/);
    assert.match(text, /devmind_job_queue_depth\{status="failed"\} 1/);
    assert.match(text, /devmind_blob_store_blobs_total 3/);
    // db file doesn't exist at /tmp/nonexistent — size should be 0
    assert.match(text, /devmind_db_size_bytes 0/);
    // Ollama may or may not be running in test env — any integer is valid
    assert.match(text, /devmind_ollama_health_latency_ms -?\d+/);
  });
});
