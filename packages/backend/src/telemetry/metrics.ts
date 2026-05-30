import { statSync } from 'node:fs';
import type { Database } from 'better-sqlite3';

const LOOP_DURATION_BUCKETS = [1, 5, 15, 30, 60, 120, 300, Infinity];

export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly httpCounts = new Map<string, number>();
  private readonly httpDurationMs = new Map<string, number>();
  private readonly agentLoopCounts = new Map<string, number>();
  private readonly toolCallCounts = new Map<string, number>();
  private readonly loopDurationBucketCounts = new Array<number>(LOOP_DURATION_BUCKETS.length).fill(0);
  private loopDurationSum = 0;
  private loopDurationCount = 0;

  constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly ollamaBaseUrl: string,
  ) {}

  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
    this.httpCounts.set(labels, (this.httpCounts.get(labels) ?? 0) + 1);
    this.httpDurationMs.set(labels, (this.httpDurationMs.get(labels) ?? 0) + durationMs);
  }

  recordAgentLoop(outcome: 'success' | 'error' | 'max_iter', durationMs: number): void {
    const labels = `outcome="${outcome}"`;
    this.agentLoopCounts.set(labels, (this.agentLoopCounts.get(labels) ?? 0) + 1);
    const durationSeconds = durationMs / 1000;
    for (let i = 0; i < LOOP_DURATION_BUCKETS.length; i++) {
      if (durationSeconds <= LOOP_DURATION_BUCKETS[i]!) {
        this.loopDurationBucketCounts[i]!++;
      }
    }
    this.loopDurationSum += durationSeconds;
    this.loopDurationCount++;
  }

  recordToolCall(safety: string, status: string): void {
    const labels = `safety="${escapeLabel(safety)}",status="${escapeLabel(status)}"`;
    this.toolCallCounts.set(labels, (this.toolCallCounts.get(labels) ?? 0) + 1);
  }

  async render(): Promise<string> {
    const lines: string[] = [];

    // Uptime
    lines.push(
      '# HELP devmind_uptime_seconds Backend process uptime in seconds.',
      '# TYPE devmind_uptime_seconds gauge',
      `devmind_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
    );

    // HTTP
    lines.push(
      '# HELP devmind_http_requests_total Total HTTP requests by method, route and status.',
      '# TYPE devmind_http_requests_total counter',
    );
    for (const [labels, value] of this.httpCounts) {
      lines.push(`devmind_http_requests_total{${labels}} ${value}`);
    }
    lines.push(
      '# HELP devmind_http_request_duration_ms_sum Total HTTP request duration in milliseconds.',
      '# TYPE devmind_http_request_duration_ms_sum counter',
    );
    for (const [labels, value] of this.httpDurationMs) {
      lines.push(`devmind_http_request_duration_ms_sum{${labels}} ${Math.round(value)}`);
    }

    // Agent loop counters
    lines.push(
      '# HELP devmind_agent_loop_total Agent loop completions by outcome.',
      '# TYPE devmind_agent_loop_total counter',
    );
    for (const [labels, value] of this.agentLoopCounts) {
      lines.push(`devmind_agent_loop_total{${labels}} ${value}`);
    }

    // Agent loop histogram — bucket counts are already cumulative (incremented
    // for every threshold >= observation in recordAgentLoop), so output directly.
    lines.push(
      '# HELP devmind_agent_loop_duration_seconds Agent loop wall-clock duration.',
      '# TYPE devmind_agent_loop_duration_seconds histogram',
    );
    for (let i = 0; i < LOOP_DURATION_BUCKETS.length; i++) {
      const le = LOOP_DURATION_BUCKETS[i] === Infinity ? '+Inf' : String(LOOP_DURATION_BUCKETS[i]);
      lines.push(`devmind_agent_loop_duration_seconds_bucket{le="${le}"} ${this.loopDurationBucketCounts[i]!}`);
    }
    lines.push(
      `devmind_agent_loop_duration_seconds_sum ${this.loopDurationSum.toFixed(3)}`,
      `devmind_agent_loop_duration_seconds_count ${this.loopDurationCount}`,
    );

    // Tool call counters
    lines.push(
      '# HELP devmind_tool_calls_total Tool call outcomes by safety classification and status.',
      '# TYPE devmind_tool_calls_total counter',
    );
    for (const [labels, value] of this.toolCallCounts) {
      lines.push(`devmind_tool_calls_total{${labels}} ${value}`);
    }

    // Gauges — queried on every scrape
    const jobDepth = this.queryJobQueueDepth();
    lines.push(
      '# HELP devmind_job_queue_depth Number of jobs by status.',
      '# TYPE devmind_job_queue_depth gauge',
    );
    for (const [status, count] of Object.entries(jobDepth)) {
      lines.push(`devmind_job_queue_depth{status="${status}"} ${count}`);
    }

    const blobCount = this.queryBlobCount();
    lines.push(
      '# HELP devmind_blob_store_blobs_total Total blobs in the snapshot blob store.',
      '# TYPE devmind_blob_store_blobs_total gauge',
      `devmind_blob_store_blobs_total ${blobCount}`,
    );

    const dbSizeBytes = this.queryDbSize();
    lines.push(
      '# HELP devmind_db_size_bytes SQLite database file size in bytes.',
      '# TYPE devmind_db_size_bytes gauge',
      `devmind_db_size_bytes ${dbSizeBytes}`,
    );

    const ollamaLatencyMs = await this.probeOllamaLatency();
    lines.push(
      '# HELP devmind_ollama_health_latency_ms Last Ollama health check round-trip in ms; -1 when unreachable.',
      '# TYPE devmind_ollama_health_latency_ms gauge',
      `devmind_ollama_health_latency_ms ${ollamaLatencyMs}`,
    );

    return `${lines.join('\n')}\n`;
  }

  private queryJobQueueDepth(): Record<string, number> {
    try {
      const rows = this.db
        .prepare(`SELECT status, COUNT(*) AS cnt FROM jobs GROUP BY status`)
        .all() as Array<{ status: string; cnt: number }>;
      const result: Record<string, number> = { pending: 0, processing: 0, failed: 0 };
      for (const row of rows) result[row.status] = row.cnt;
      return result;
    } catch {
      return { pending: 0, processing: 0, failed: 0 };
    }
  }

  private queryBlobCount(): number {
    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM project_snapshot_blobs`)
        .get() as { cnt: number };
      return row.cnt;
    } catch {
      return 0;
    }
  }

  private queryDbSize(): number {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  private async probeOllamaLatency(): Promise<number> {
    try {
      const start = Date.now();
      const res = await fetch(`${this.ollamaBaseUrl}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? Date.now() - start : -1;
    } catch {
      return -1;
    }
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}
