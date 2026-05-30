# Spec: 010-observability

## 1. Metrics extension (backend)

### 1.1 New metric families in `MetricsRegistry`

`packages/backend/src/telemetry/metrics.ts` gains:

**Gauges** (snapshotted on render):
- `devmind_job_queue_depth{status}` — query `jobs` table counts by status
  (`pending`, `processing`, `failed`).
- `devmind_blob_store_blobs_total` — `SELECT COUNT(*) FROM project_snapshot_blobs`.
- `devmind_ollama_health_latency_ms` — result of last `/api/ollama/health` call
  (ms RTT); −1 when unreachable. Refreshed on every `/api/metrics` scrape.
- `devmind_db_size_bytes` — `fs.statSync(SQLITE_PATH).size`.

**Counters** (incremented in hot paths):
- `devmind_agent_loop_total{outcome}` — outcomes: `success`, `error`,
  `max_iter`.
- `devmind_tool_calls_total{safety,status}` — `safety` from `ToolDef.safety`,
  `status` from audit record.

**Histogram** (online, no full-corpus scan):
- `devmind_agent_loop_duration_seconds` — buckets `[1,5,15,30,60,120,300,+Inf]`.

### 1.2 Instrumentation call sites

| Where | What to add |
|-------|-------------|
| `agent/loop.ts` — run completion | `metrics.recordAgentLoop(outcome, durationMs)` |
| `tools/executor.ts` — after audit write | `metrics.recordToolCall(safety, status)` |
| `telemetry/metrics.ts` — `render()` | query gauges from DB + Ollama before rendering |

### 1.3 `MetricsRegistry` needs DB + config access

`MetricsRegistry` constructor receives `{ db: Database, config: Config }`.
Wired at `index.ts` where `metricsRegistry` is constructed.

---

## 2. docker-compose.observability.yml

New file at repo root. Services:

### 2.1 Prometheus

```yaml
prometheus:
  image: prom/prometheus:v3
  volumes:
    - ./observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - prometheus-data:/prometheus
  ports: ["9090:9090"]
  restart: unless-stopped
```

Scrape config `observability/prometheus.yml`:
```yaml
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: devmind-backend
    static_configs:
      - targets: ['backend:3001']
    metrics_path: /api/metrics
```

### 2.2 Loki

```yaml
loki:
  image: grafana/loki:3
  volumes:
    - ./observability/loki-config.yml:/etc/loki/local-config.yaml:ro
    - loki-data:/loki
  ports: ["3100:3100"]
  restart: unless-stopped
```

Minimal `observability/loki-config.yml`: filesystem storage, retention 30d.

### 2.3 Promtail

```yaml
promtail:
  image: grafana/promtail:3
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - ./observability/promtail-config.yml:/etc/promtail/config.yml:ro
  restart: unless-stopped
```

`observability/promtail-config.yml`: Docker autodiscovery via socket, label
`container` from container name, push to `http://loki:3100`.

### 2.4 Grafana

```yaml
grafana:
  image: grafana/grafana:11
  volumes:
    - grafana-data:/var/lib/grafana
    - ./observability/grafana/provisioning:/etc/grafana/provisioning:ro
  ports: ["3000:3000"]
  environment:
    GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_ADMIN_PASSWORD}"
    GF_AUTH_ANONYMOUS_ENABLED: "false"
  restart: unless-stopped
```

---

## 3. Grafana provisioning (as-code)

`observability/grafana/provisioning/` contains:

### 3.1 Datasources

`datasources/datasources.yaml`:
- Prometheus: `http://prometheus:9090`, default datasource.
- Loki: `http://loki:3100`.

### 3.2 Dashboard

`dashboards/devmind-overview.json` (7 rows, see design §Grafana dashboard rows).
Generated JSON provisioned via `dashboards/dashboards.yaml`.

### 3.3 Alert rules

`alerting/alert-rules.yaml` with the 5 rules from design §Alert rules.
Contact point: webhook URL from env var `GRAFANA_ALERT_WEBHOOK` (optional;
alerts fire silently if unset). No Alertmanager.

---

## 4. OPERATIONS.md update

Add section `§Observability` after `§Backups`:
- How to start the observability stack (`docker compose ... up`).
- Default Grafana URL and credentials.
- How to silence / acknowledge an alert.

---

## 5. PRODUCTION_READINESS.md update

Mark the three observability items:
```
- [x] Trazas distribuidas — deferred (see spec 010 §Out of scope)
- [x] Alertas mínimas — 5 alerts via Grafana (spec 010)
- [x] Dashboard básico — DevMind Overview in Grafana (spec 010)
```

---

## Acceptance criteria

| # | Criterion |
|---|-----------|
| AC1 | `GET /api/metrics` returns all 7 new metric families in Prometheus text format |
| AC2 | `docker compose -f docker-compose.yml -f docker-compose.observability.yml up` starts all 4 observability services without errors |
| AC3 | Prometheus target `devmind-backend` shows `UP` in the Targets page |
| AC4 | Grafana dashboard "DevMind Overview" loads and all panels show data |
| AC5 | At least one alert rule evaluates (can verify in Grafana Alert Rules page) |
| AC6 | Backend logs appear in Grafana's Loki panel within 30s of generation |
| AC7 | Stopping the backend causes `BackendDown` alert to fire in < 3 min |
