# Design: 010-observability

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  docker-compose (same host as devmind)                      │
│                                                             │
│  backend :3001  ──► GET /api/metrics (Prometheus text)      │
│      │                      ▲                               │
│      │ pino JSON stdout      │ scrape every 15s             │
│      ▼                      │                               │
│  Promtail          Prometheus :9090                         │
│      │                      │                               │
│      │ push logs            │ query                         │
│      ▼                      ▼                               │
│  Loki :3100       Grafana :3000                             │
│                      ├── dashboard: DevMind Overview        │
│                      └── 5 alert rules → webhook/email      │
└─────────────────────────────────────────────────────────────┘
```

## Key decisions

### D1 — In-process Prometheus exposition (no sidecar)

The existing `MetricsRegistry` class already renders Prometheus text format.
We extend it rather than adding a sidecar agent. Simpler, no inter-process IPC.

### D2 — Pull model for metrics, push model for logs

Prometheus pulls `/api/metrics`. Promtail pushes container stdout to Loki.
This matches the standard Grafana stack and requires zero changes to the backend
log format (pino already emits JSON to stdout).

### D3 — Grafana alerting (not Alertmanager)

Single-binary approach. Grafana's built-in alerting evaluates rules against
Prometheus + Loki datasources and can notify via webhook, email, or Slack.
Avoids running a fourth separate process (Alertmanager).

### D4 — Separate observability compose file

`docker-compose.observability.yml` contains Prometheus + Loki + Promtail +
Grafana. Extended with `docker compose -f docker-compose.yml -f
docker-compose.observability.yml up`. Keeps the core compose clean; observability
is optional in dev.

### D5 — Histogram buckets for agent loop duration

Agent loops run O(seconds) to O(minutes). Buckets: 1s, 5s, 15s, 30s, 60s,
120s, 300s, +Inf. Exposed as `devmind_agent_loop_duration_seconds`.

## Metrics catalog (new)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `devmind_job_queue_depth` | gauge | `status` (pending\|processing\|failed) | Jobs by status |
| `devmind_agent_loop_duration_seconds` | histogram | — | Wall-clock time per loop run |
| `devmind_agent_loop_total` | counter | `outcome` (success\|error\|max_iter) | Loop completions |
| `devmind_tool_calls_total` | counter | `safety` (read\|write\|destructive), `status` (ok\|error\|blocked) | Tool call outcomes |
| `devmind_blob_store_blobs_total` | gauge | — | Total blobs in store |
| `devmind_ollama_health_latency_ms` | gauge | — | Last health check RTT; -1 if unreachable |
| `devmind_db_size_bytes` | gauge | — | SQLite file size |

Existing metrics (`devmind_uptime_seconds`, `devmind_http_requests_total`,
`devmind_http_request_duration_ms_sum`) are preserved unchanged.

## Grafana dashboard rows

1. **System** — uptime, DB size, backend process memory (RSS via `/api/health`)
2. **HTTP** — req/s by route, error rate (5xx %), p95 latency
3. **Agent loops** — active/completed/errored, duration p50/p95
4. **Tool calls** — calls/s by safety level, block rate
5. **Job queue** — depth by status, throughput
6. **Ollama** — health latency gauge, reachability status
7. **Logs** — Loki panel with `{container="devmind-backend"}` and error filter

## Alert rules

| Alert | Condition | For | Severity |
|-------|-----------|-----|---------|
| BackendDown | `devmind_uptime_seconds` absent | 2m | critical |
| WorkersStalled | `devmind_job_queue_depth{status="processing"} > 0` AND no completions in 5m | 5m | warning |
| QueueDepthHigh | `devmind_job_queue_depth{status="pending"} > 50` | 2m | warning |
| OllamaUnreachable | `devmind_ollama_health_latency_ms == -1` | 3m | warning |
| DbSizeCritical | `devmind_db_size_bytes > 1073741824` | 5m | warning |
