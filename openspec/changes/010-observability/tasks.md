# Tasks: 010 — Observability

> **Status (2026-05-27)**: Spec abierta. Baseline mínimo (uptime + HTTP
> count/duration + `/api/health` plano + `pino` JSON) ya cerrado por
> spec 007. Esta spec lleva la observabilidad a "puedo detectar caída
> y degradación en <1 min sin leer logs".

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 [infra] Redactar `proposal.md`
- [x] 0.2 [infra] Redactar `design.md`
- [x] 0.3 [infra] Redactar `spec.md`
- [ ] 0.4 [infra] Aprobar baseline (este PR)

## Phase 1 — MetricsRegistry: HTTP histogram + counters base [backend]

- [ ] 1.1 [backend] Añadir buckets `50/100/250/500/1000/2500/+Inf` a
      `MetricsRegistry.recordHttp` y exponer `_bucket`, `_sum`, `_count`
- [ ] 1.2 [backend] Cambiar la etiqueta `route` a `c.req.routePath` (con fallback
      `<not-found>`) en el middleware HTTP
- [ ] 1.3 [backend] Añadir flag `METRICS_ENABLED` (default `true`) a `config.ts`;
      si `false`, `/api/metrics` devuelve `404`
- [ ] 1.4 [backend] Test unit: `MetricsRegistry.render()` produce buckets en
      formato Prometheus válido (verifica orden de `le`, monotonicidad)

## Phase 2 — Métricas de workers, jobs y dead-letter [backend, workers]

- [ ] 2.1 [backend] Migración `023_workers_heartbeat.sql` (singleton con
      `CHECK (id = 1)`, defaults a `datetime('now')`)
- [ ] 2.2 [workers] Loop principal actualiza `workers_heartbeat.last_ok` +
      `queue_depth` cada `WORKERS_HEARTBEAT_MS` (default 5s)
- [ ] 2.3 [backend] `MetricsRegistry` añade:
      - `devmind_workers_last_ok_seconds` (gauge, leído al render)
      - `devmind_jobs_in_queue{type}` (gauge, `SELECT type, COUNT(*) … WHERE status IN ('pending','processing') GROUP BY type`)
      - `devmind_jobs_total{type, status}` (counter, incrementado por el worker tras procesar)
      - `devmind_dead_letter_jobs_total{type}` (counter, incrementado al mover a DLQ)
- [ ] 2.4 [backend] Test unit: gauges leen valores correctos del singleton +
      tabla `jobs`

## Phase 3 — Métricas de tool calls [backend]

- [ ] 3.1 [backend] `ToolExecutor` llama
      `metrics.recordToolCall(tool, safety, status, durationMs)` justo
      después de `auditRepo.updateFinish/insertFinal`
- [ ] 3.2 [backend] `MetricsRegistry` añade:
      - `devmind_tool_calls_total{tool, safety, status}` (counter)
      - `devmind_tool_call_duration_ms_sum{tool, safety}` (counter)
      - `devmind_tool_call_duration_ms_count{tool, safety}` (counter)
- [ ] 3.3 [backend] Test unit: counter incrementa por tool/safety, no por
      argumentos

## Phase 4 — Métricas de agent loop, vector search, blobs [backend]

- [ ] 4.1 [backend] `agent/loop.ts` llama
      `metrics.recordAgentLoop(outcome, iterations, durationMs)` al final
- [ ] 4.2 [backend] `MetricsRegistry` añade:
      - `devmind_agent_loop_iterations_bucket{outcome, le}` (buckets `1,2,4,6,8`)
      - `devmind_agent_loop_duration_ms_sum/count{outcome}`
- [ ] 4.3 [backend] `tools/impl/vector-search.ts` y
      `tools/impl/search-code.ts` llaman `metrics.recordVectorSearch(tool, hit)`
- [ ] 4.4 [backend] `MetricsRegistry` añade `devmind_vector_search_total{tool, hit}`
- [ ] 4.5 [backend] `MetricsRegistry.render()` evalúa
      `devmind_snapshot_blobs_count` (gauge,
      `SELECT COUNT(*) FROM project_snapshot_blobs`) y
      `devmind_snapshot_blobs_ref_count_sum` (gauge,
      `SELECT COALESCE(SUM(ref_count), 0) FROM project_snapshot_blobs`)
- [ ] 4.6 [backend] Test unit: el render incluye todas las métricas
      esperadas y respeta etiquetas estables

## Phase 5 — `/api/health` tipado [backend]

- [ ] 5.1 [backend] `health/service.ts` con `HealthService.snapshot()`
      devolviendo el payload tipado de la spec (D6)
- [ ] 5.2 [backend] Caches internos: `HEALTH_OLLAMA_TTL_MS` (10s),
      `HEALTH_VECTOR_TTL_MS` (30s)
- [ ] 5.3 [backend] `/api/health` devuelve `503` cuando `status == 'down'`
- [ ] 5.4 [backend] Actualizar `HEALTHCHECK` del `Dockerfile.backend` al
      formato nuevo (greppear `status":"ok"` o `"status":"degraded"`)
- [ ] 5.5 [backend] Test unit: agregación correcta de
      `ok|degraded|down` según componentes
- [ ] 5.6 [infra] Verificar que `docker-compose.prod.yml` sigue saludable
      con el nuevo formato

## Phase 6 — `req_id` middleware + child logger [backend]

- [ ] 6.1 [backend] `http/request-id.ts` lee/genera `X-Request-Id`,
      setea `c.set('req_id', reqId)` y `c.set('logger', baseLogger.child({req_id}))`,
      añade response header `X-Request-Id`
- [ ] 6.2 [backend] Helper `getLogger(c)` y refactor de los handlers que
      hacen `import { logger }` directo (≤15 sites)
- [ ] 6.3 [backend] `agent/loop.ts` propaga `req_id` al `tool_call_audit.args_json`
      cuando hay request context
- [ ] 6.4 [backend] Flag `LOG_REQUEST_ID` (default `true`) permite desactivar
      el middleware en perfiles dev
- [ ] 6.5 [backend] Test unit: el middleware genera UUID v4 si no llega header;
      respeta el header entrante si está presente

## Phase 7 — Alert rules + observability docs [infra]

- [ ] 7.1 [infra] `ops/alerts/devmind.rules.yml` con los 6 alerts de la spec
- [ ] 7.2 [infra] `docs/observability.md` con tabla canonical, ejemplo de
      query Grafana, instrucciones de Prometheus scrape
- [ ] 7.3 [infra] Smoke local: `curl /api/metrics | promtool check rules`
      (si está disponible) o validación manual del formato Prometheus

## Phase 8 — Tests + lint + build [backend]

- [ ] 8.1 [backend] Suite completa de tests del registry, health, request-id,
      formato Prometheus
- [ ] 8.2 [backend] `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
      verde antes de mergear

## Phase 9 — Documentación final [infra]

- [ ] 9.1 [infra] `PRODUCTION_READINESS.md`:
      - `[x]` Métricas Prometheus profundas
      - `[x]` Alertas mínimas (definidas en `ops/alerts/devmind.rules.yml`)
      - mantener `[ ]` Dashboard Grafana (fuera del repo)
      - mantener `[ ]` Trazas distribuidas (out of scope)
- [ ] 9.2 [infra] `README.md` añade fila/párrafo sobre observabilidad
- [ ] 9.3 [infra] Atlas (`/mnt/nas/Obsidian/Proyectos/DevMind.md`) actualizado
      con la nueva spec cerrada (delegado a `/session-end`)
