export interface LiveStats {
  workers: { pending: number; processing: number; failed: number; lagMs: number };
  ollamaUp: boolean;
  dbSizeBytes: number;
  embedCache: { size: number; hits: number; misses: number };
}

const HTTP_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export class MetricsRegistry {
  private readonly startedAt = Date.now();

  // HTTP: count + duration histogram
  private readonly httpCounts = new Map<string, number>();
  private readonly httpBuckets = new Map<string, number[]>();
  private readonly httpDurationSum = new Map<string, number>();

  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
    this.httpCounts.set(labels, (this.httpCounts.get(labels) ?? 0) + 1);
    this.httpDurationSum.set(labels, (this.httpDurationSum.get(labels) ?? 0) + durationMs);

    const buckets = this.httpBuckets.get(labels) ?? new Array<number>(HTTP_BUCKETS.length + 1).fill(0);
    for (let i = 0; i < HTTP_BUCKETS.length; i++) {
      if (durationMs <= HTTP_BUCKETS[i]!) buckets[i]!++;
    }
    buckets[HTTP_BUCKETS.length]!++; // +Inf
    this.httpBuckets.set(labels, buckets);
  }

  render(live: LiveStats): string {
    const lines: string[] = [];
    const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);

    // ── uptime ──────────────────────────────────────────────────────────────
    lines.push(
      '# HELP devmind_uptime_seconds Backend process uptime in seconds.',
      '# TYPE devmind_uptime_seconds gauge',
      `devmind_uptime_seconds ${uptimeSec}`,
    );

    // ── HTTP requests (counter) ──────────────────────────────────────────────
    lines.push(
      '# HELP devmind_http_requests_total Total HTTP requests by method, route and status.',
      '# TYPE devmind_http_requests_total counter',
    );
    for (const [labels, value] of this.httpCounts) {
      lines.push(`devmind_http_requests_total{${labels}} ${value}`);
    }

    // ── HTTP duration (histogram) ────────────────────────────────────────────
    lines.push(
      '# HELP devmind_http_request_duration_ms HTTP request duration in milliseconds.',
      '# TYPE devmind_http_request_duration_ms histogram',
    );
    for (const [labels, buckets] of this.httpBuckets) {
      for (let i = 0; i < HTTP_BUCKETS.length; i++) {
        lines.push(`devmind_http_request_duration_ms_bucket{${labels},le="${HTTP_BUCKETS[i]}"} ${buckets[i]}`);
      }
      lines.push(`devmind_http_request_duration_ms_bucket{${labels},le="+Inf"} ${buckets[HTTP_BUCKETS.length]}`);
      lines.push(`devmind_http_request_duration_ms_sum{${labels}} ${Math.round(this.httpDurationSum.get(labels) ?? 0)}`);
      lines.push(`devmind_http_request_duration_ms_count{${labels}} ${this.httpCounts.get(labels) ?? 0}`);
    }

    // ── workers ─────────────────────────────────────────────────────────────
    lines.push(
      '# HELP devmind_workers_queue_pending Jobs waiting to be processed.',
      '# TYPE devmind_workers_queue_pending gauge',
      `devmind_workers_queue_pending ${live.workers.pending}`,
      '# HELP devmind_workers_queue_processing Jobs currently being processed.',
      '# TYPE devmind_workers_queue_processing gauge',
      `devmind_workers_queue_processing ${live.workers.processing}`,
      '# HELP devmind_workers_queue_failed Jobs in failed state (dead-letter).',
      '# TYPE devmind_workers_queue_failed gauge',
      `devmind_workers_queue_failed ${live.workers.failed}`,
      '# HELP devmind_workers_queue_lag_ms Age of oldest pending job in milliseconds.',
      '# TYPE devmind_workers_queue_lag_ms gauge',
      `devmind_workers_queue_lag_ms ${live.workers.lagMs}`,
    );

    // ── ollama ───────────────────────────────────────────────────────────────
    lines.push(
      '# HELP devmind_ollama_up 1 if Ollama is reachable, 0 otherwise.',
      '# TYPE devmind_ollama_up gauge',
      `devmind_ollama_up ${live.ollamaUp ? 1 : 0}`,
    );

    // ── database ─────────────────────────────────────────────────────────────
    lines.push(
      '# HELP devmind_db_size_bytes SQLite database file size in bytes.',
      '# TYPE devmind_db_size_bytes gauge',
      `devmind_db_size_bytes ${live.dbSizeBytes}`,
    );

    // ── embed cache ──────────────────────────────────────────────────────────
    lines.push(
      '# HELP devmind_embed_cache_size Number of embeddings currently in the LRU cache.',
      '# TYPE devmind_embed_cache_size gauge',
      `devmind_embed_cache_size ${live.embedCache.size}`,
      '# HELP devmind_embed_cache_hits_total Total embedding cache hits.',
      '# TYPE devmind_embed_cache_hits_total counter',
      `devmind_embed_cache_hits_total ${live.embedCache.hits}`,
      '# HELP devmind_embed_cache_misses_total Total embedding cache misses.',
      '# TYPE devmind_embed_cache_misses_total counter',
      `devmind_embed_cache_misses_total ${live.embedCache.misses}`,
    );

    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}
