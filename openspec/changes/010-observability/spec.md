# Spec: 010-observability

## Overview

Extender métricas, logs y health del backend para que un operador pueda
detectar caída/degradación en <1 minuto sin leer logs. Sin provisionar
stack externo — solo definir lo que el repo debe exponer.

## Configuración (variables de entorno)

| Variable | Default | Notas |
|---|---|---|
| `METRICS_ENABLED` | `true` | Si `false`, `/api/metrics` devuelve `404`. Útil para perfiles dev. |
| `HEALTH_OLLAMA_TTL_MS` | `10000` | Caché del ping a Ollama dentro de `/api/health`. |
| `HEALTH_VECTOR_TTL_MS` | `30000` | Caché del read de tamaño de índice HNSW. |
| `WORKERS_HEARTBEAT_MS` | `5000` | Cada cuánto el worker actualiza `workers_heartbeat`. |
| `LOG_REQUEST_ID` | `true` | Cuando `true`, cada request emite logs con `req_id` UUID v4. |

## Endpoint `GET /api/metrics`

Sin cambios de auth (sigue público en LAN). Devuelve `text/plain` con
formato Prometheus exposition.

### Métricas (canonical)

| Nombre | Tipo | Labels | Descripción |
|---|---|---|---|
| `devmind_uptime_seconds` | gauge | — | Tiempo en segundos desde que arrancó el backend. |
| `devmind_http_requests_total` | counter | method, route, status | Requests HTTP por método/ruta/status. |
| `devmind_http_request_duration_ms_sum` | counter | method, route, status | Duración total acumulada en ms. |
| `devmind_http_request_duration_ms_count` | counter | method, route, status | Número de requests (denominador para media). |
| `devmind_http_request_duration_ms_bucket` | histogram bucket | method, route, status, le | Buckets `50, 100, 250, 500, 1000, 2500, +Inf`. |
| `devmind_jobs_total` | counter | type, status | Jobs procesados por worker, por tipo y outcome (`ok|error|retried|dead-lettered`). |
| `devmind_jobs_in_queue` | gauge | type | Jobs en estado `pending|processing` por tipo. |
| `devmind_dead_letter_jobs_total` | counter | type | Jobs movidos a `dead_letter_jobs`. |
| `devmind_workers_last_ok_seconds` | gauge | — | Unix timestamp del último heartbeat exitoso de workers. |
| `devmind_tool_calls_total` | counter | tool, safety, status | Tool calls por nombre/safety/status. |
| `devmind_tool_call_duration_ms_sum` | counter | tool, safety | Duración total por tool/safety. |
| `devmind_tool_call_duration_ms_count` | counter | tool, safety | Número de calls por tool/safety. |
| `devmind_agent_loop_iterations_bucket` | histogram bucket | outcome, le | Iteraciones por agent run, buckets `1, 2, 4, 6, 8`. |
| `devmind_agent_loop_duration_ms_sum` | counter | outcome | Duración total de agent loops. |
| `devmind_agent_loop_duration_ms_count` | counter | outcome | Número de agent loops. |
| `devmind_vector_search_total` | counter | tool, hit | `hit=true` si la búsqueda devolvió ≥1 resultado, `false` si vacía. |
| `devmind_snapshot_blobs_count` | gauge | — | Filas en `project_snapshot_blobs`. |
| `devmind_snapshot_blobs_ref_count_sum` | gauge | — | Suma de `ref_count` (drift indicator). |

### Etiquetas

- `route` se toma de `c.req.routePath` (plantilla Hono). Para 404 se usa
  el valor literal `<not-found>`.
- `status` es entero HTTP (200, 401, 500, …) serializado como string.
- `safety` ∈ `read|write|destructive`.
- `tool status` ∈ `ok|error|blocked|invalid-args`.
- `outcome` agent loop ∈ `ok|error|limit-reached`.

### Formato

Cada métrica precedida de `# HELP` y `# TYPE` por convención
Prometheus. Counters acaban en `_total`, histogramas exponen `_bucket`
+ `_sum` + `_count`.

## Endpoint `GET /api/health`

### Respuesta nueva (rompe con la 007)

```json
{
  "status": "ok" | "degraded" | "down",
  "uptime_seconds": 12345,
  "components": {
    "db":      { "ok": true,  "latency_ms": 0.4 },
    "ollama":  { "ok": true,  "latency_ms": 12,  "model": "qwen2.5-coder:7b" },
    "workers": { "ok": true,  "last_ok_seconds": 3, "queue_depth": 2 },
    "vector":  { "ok": true,  "index_size": 142 }
  }
}
```

### Reglas de status agregado

- `status = "down"` si `components.db.ok == false`.
- `status = "degraded"` si alguno de `ollama|workers|vector` `.ok == false` y `db.ok == true`.
- `status = "ok"` si todos `.ok == true`.

### Códigos HTTP

- `200` si `status ∈ {"ok", "degraded"}`.
- `503` si `status == "down"`.

### Reglas por componente

| Componente | `ok = true` cuando | `ok = false` cuando |
|---|---|---|
| `db` | `SELECT 1` < 50ms | excepción o > 50ms |
| `ollama` | `GET /api/tags` 200 en <500ms (cacheado 10s) | error o > 500ms |
| `workers` | `time() - workers_heartbeat.last_ok < 30s` | drift > 30s o ausencia de fila |
| `vector` | el índice HNSW está cargado (acceso al wrapper sin error) | el wrapper devuelve `ready == false` |

## Schema — migración 023

```sql
-- DevMind migration 023 — workers heartbeat (spec 010)
CREATE TABLE IF NOT EXISTS workers_heartbeat (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_ok      TEXT NOT NULL DEFAULT (datetime('now')),
  queue_depth  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO workers_heartbeat (id, last_ok, queue_depth) VALUES (1, datetime('now'), 0);
```

Singleton: `CHECK (id = 1)` impide tener más de una fila. El worker
actualiza cada `WORKERS_HEARTBEAT_MS`.

## Reglas de alerta (`ops/alerts/devmind.rules.yml`)

```yaml
groups:
  - name: devmind
    rules:
      - alert: DevmindBackendDown
        expr: up{job="devmind"} == 0
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: "DevMind backend is down"

      - alert: DevmindHealthDegraded
        expr: devmind_uptime_seconds > 0 and on() (probe_success{instance="devmind/health"} == 0)
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "DevMind /api/health reports degraded for 5m"

      - alert: DevmindWorkersStalled
        expr: time() - devmind_workers_last_ok_seconds > 120
        for: 2m
        labels: { severity: warning }
        annotations:
          summary: "DevMind workers heartbeat older than 2m"

      - alert: DevmindJobQueueGrowing
        expr: sum by (type) (devmind_jobs_in_queue) > 25
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "DevMind job queue {{ $labels.type }} > 25 for 10m"

      - alert: DevmindToolCallErrorRate
        expr: |
          sum(rate(devmind_tool_calls_total{status="error"}[5m]))
            /
          clamp_min(sum(rate(devmind_tool_calls_total[5m])), 0.001) > 0.1
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "DevMind tool error rate > 10% for 5m"

      - alert: DevmindHttpLatencyHigh
        expr: |
          histogram_quantile(0.99,
            sum by (le, route) (rate(devmind_http_request_duration_ms_bucket[5m]))
          ) > 2500
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "DevMind HTTP p99 > 2.5s on {{ $labels.route }}"
```

## Logs

### Formato existente (mantiene)

`pino` ya emite una línea JSON por log con `level`, `time`, `pid`,
`hostname`, `msg` y campos arbitrarios. Verificado en spec 007.

### Adición — `req_id`

Cada request HTTP recibe `req_id` UUID v4 generado en
`http/request-id.ts`. El middleware:

1. Lee `X-Request-Id` del header si viene, sino genera UUID v4.
2. Setea `c.set('req_id', reqId)`.
3. Setea `c.set('logger', baseLogger.child({ req_id }))`.
4. Devuelve el `req_id` en el response header `X-Request-Id`.

Handlers leen `const logger = c.get('logger') ?? baseLogger` y siguen
usando `logger.info({ ... }, '...')` como antes.

El agent loop incluye `req_id` en `tool_call_audit.args_json` cuando
está en contexto de un request HTTP.

## Documentación

Nuevo `docs/observability.md`:
- Tabla canonical de métricas (copia de la sección de arriba).
- Cómo apuntar Prometheus al endpoint.
- Cómo copiar las reglas de alerta a un Alertmanager existente.
- Mini ejemplo de query Grafana (p99 latencia, error rate tool calls).

`PRODUCTION_READINESS.md`:
- Marcar `[x]` métricas Prometheus profundas.
- Marcar `[x]` alertas mínimas (definidas, no provisionadas).
- Mantener `[ ]` dashboard Grafana (vive fuera del repo).
- Mantener `[ ]` trazas distribuidas (out of scope).
