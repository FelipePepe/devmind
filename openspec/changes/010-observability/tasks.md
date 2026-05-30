# Tasks: 010 — Observability

> **Status**: Phase 0 en progreso (2026-05-30). Pendiente owner sign-off e implementación.

---

## Phase 0 — SDD Baseline [infra]

- [ ] 0.1 ⛔ **OWNER** Aprobar proposal, design, spec
- [x] 0.2 [infra] Confirmar stack: Prometheus + Loki + Promtail + Grafana (no Alertmanager)
- [x] 0.3 [infra] Confirmar puerto Grafana: 3000 (no conflicto con stack actual)
- [x] 0.4 [infra] Confirmar retention logs Loki: 30 días
- [x] 0.5 [infra] Confirmar alert channel inicial: webhook env var (silencioso si no configurado)

---

## Phase 1 — Extend MetricsRegistry [backend]

- [ ] 1.1 [backend] Añadir `recordAgentLoop(outcome: 'success'|'error'|'max_iter', durationMs: number)` a `MetricsRegistry`:
      - Incrementa `devmind_agent_loop_total{outcome}`
      - Actualiza histograma `devmind_agent_loop_duration_seconds` con buckets `[1,5,15,30,60,120,300,+Inf]`
- [ ] 1.2 [backend] Añadir `recordToolCall(safety: string, status: string)` a `MetricsRegistry`:
      - Incrementa `devmind_tool_calls_total{safety,status}`
- [ ] 1.3 [backend] Hacer `MetricsRegistry` recibir `{ db: Database, config: Config }` en constructor; queries sincronas (better-sqlite3) en `render()`:
      - `devmind_job_queue_depth{status="pending|processing|failed"}` — `SELECT status, COUNT(*) FROM jobs GROUP BY status`
      - `devmind_blob_store_blobs_total` — `SELECT COUNT(*) FROM project_snapshot_blobs`
      - `devmind_db_size_bytes` — `fs.statSync(config.SQLITE_PATH).size`
      - `devmind_ollama_health_latency_ms` — llamada `GET /api/ollama/health` con timeout 3s; −1 si falla
- [ ] 1.4 [backend] Actualizar `index.ts` para pasar `db` y `config` al construir `metricsRegistry`
- [ ] 1.5 [backend] Instrumentar `agent/loop.ts`:
      - Registrar `startTime = Date.now()` antes del loop
      - Llamar `metrics.recordAgentLoop(outcome, Date.now() - startTime)` en cada salida (success, error, max_iter)
- [ ] 1.6 [backend] Instrumentar `tools/executor.ts`:
      - Tras escribir el audit record, llamar `metrics.recordToolCall(def.safety, auditStatus)`
- [ ] 1.7 [backend] Test unit `telemetry/metrics.test.ts`:
      - `recordAgentLoop` incrementa contadores y acumula histograma correctamente
      - `recordToolCall` incrementa `devmind_tool_calls_total` con labels correctos
      - `render()` con DB mock devuelve todas las familias de métricas en formato Prometheus text

---

## Phase 2 — Infra: docker-compose.observability.yml [infra]

- [ ] 2.1 [infra] Crear `docker-compose.observability.yml` con 4 servicios: `prometheus`, `loki`, `promtail`, `grafana` (versiones: prometheus v3, loki 3, promtail 3, grafana 11)
- [ ] 2.2 [infra] Crear `observability/prometheus.yml`: scrape `backend:3001/api/metrics` cada 15s
- [ ] 2.3 [infra] Crear `observability/loki-config.yml`: filesystem storage en `/loki`, retention 30d, HTTP listener :3100
- [ ] 2.4 [infra] Crear `observability/promtail-config.yml`: Docker autodiscovery vía socket, label `container` del nombre del contenedor, push a `http://loki:3100/loki/api/v1/push`
- [ ] 2.5 [infra] Añadir `GRAFANA_ADMIN_PASSWORD` y `GRAFANA_ALERT_WEBHOOK` a `.env.example`
- [ ] 2.6 [infra] Añadir `.gitignore` entry para `observability/grafana/data/` si se genera

---

## Phase 3 — Grafana provisioning [infra]

- [ ] 3.1 [infra] Crear `observability/grafana/provisioning/datasources/datasources.yaml`:
      - Prometheus: `http://prometheus:9090`, UID `prometheus`, default
      - Loki: `http://loki:3100`, UID `loki`
- [ ] 3.2 [infra] Crear `observability/grafana/provisioning/dashboards/dashboards.yaml`: apunta a `/etc/grafana/provisioning/dashboards/*.json`
- [ ] 3.3 [infra] Crear `observability/grafana/provisioning/dashboards/devmind-overview.json`:
      - Row 1 — System: uptime, DB size, process memory
      - Row 2 — HTTP: req/s, error rate (5xx%), p95 latency
      - Row 3 — Agent loops: total/s, duration p50/p95, outcome breakdown
      - Row 4 — Tool calls: calls/s by safety, block rate
      - Row 5 — Job queue: depth by status, throughput
      - Row 6 — Ollama: health latency gauge, status indicator
      - Row 7 — Logs: Loki panel `{container="devmind-backend"}` con filter `level="error"`
- [ ] 3.4 [infra] Crear `observability/grafana/provisioning/alerting/alert-rules.yaml` con las 5 reglas (BackendDown, WorkersStalled, QueueDepthHigh, OllamaUnreachable, DbSizeCritical) y contact point webhook

---

## Phase 4 — OPERATIONS.md + PRODUCTION_READINESS.md [docs]

- [ ] 4.1 [docs] Añadir sección `## Observability` en `OPERATIONS.md`:
      - Cómo arrancar: `docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d`
      - URL Grafana: `http://<host>:3000` (admin / `GRAFANA_ADMIN_PASSWORD`)
      - Cómo ver alertas activas, silenciarlas, y configurar el webhook
- [ ] 4.2 [docs] Marcar en `PRODUCTION_READINESS.md`:
      - `[x] Alertas mínimas`
      - `[x] Dashboard básico (Grafana)`
      - `[~] Trazas distribuidas` → diferido (no multi-service spans aún)

---

## Phase 5 — Verificación [verify]

- [ ] 5.1 [verify] `GET /api/metrics` devuelve los 7 nuevos families (AC1)
- [ ] 5.2 [verify] `docker compose ... up` levanta los 4 servicios sin errores (AC2)
- [ ] 5.3 [verify] Prometheus Targets page muestra `devmind-backend` en `UP` (AC3)
- [ ] 5.4 [verify] Dashboard "DevMind Overview" carga en Grafana y todos los panels muestran datos (AC4)
- [ ] 5.5 [verify] Al menos una alert rule aparece en Grafana Alert Rules page (AC5)
- [ ] 5.6 [verify] Logs del backend aparecen en el panel Loki de Grafana en < 30s (AC6)
- [ ] 5.7 [verify] Parar backend → alerta `BackendDown` se dispara en < 3 min (AC7)
- [ ] 5.8 [verify] `pnpm -r build` + `pnpm typecheck` + `pnpm test` pasan limpios

---

## Phase 6 — Archive [infra]

- [ ] 6.1 [infra] Mover `openspec/changes/010-observability/` a `openspec/changes/archive/`
- [ ] 6.2 [infra] Actualizar `Proyectos/DevMind.md` en Atlas: marcar 010 ✅ Cerrado
- [ ] 6.3 [infra] Crear entrada de cierre en Engram (`session-end`)
