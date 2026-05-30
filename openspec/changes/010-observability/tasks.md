# Tasks: 010 — Observability

> **Status**: Phases 0–4 completas (2026-05-30). Pendiente Phase 5 (verificación con stack Docker).

---

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 ✅ **OWNER** Aprobar proposal, design, spec — sign-off 2026-05-30
- [x] 0.2 [infra] Confirmar stack: Prometheus + Loki + Promtail + Grafana (no Alertmanager)
- [x] 0.3 [infra] Confirmar puerto Grafana: 3000 (no conflicto con stack actual)
- [x] 0.4 [infra] Confirmar retention logs Loki: 30 días
- [x] 0.5 [infra] Confirmar alert channel inicial: webhook env var (silencioso si no configurado)

---

## Phase 1 — Extend MetricsRegistry [backend]

- [x] 1.1 [backend] Añadir `recordAgentLoop(outcome: 'success'|'error'|'max_iter', durationMs: number)` a `MetricsRegistry`
- [x] 1.2 [backend] Añadir `recordToolCall(safety: string, status: string)` a `MetricsRegistry`
- [x] 1.3 [backend] Hacer `MetricsRegistry` recibir `{ db, dbPath, ollamaBaseUrl }` en constructor; gauges en `render()` async
- [x] 1.4 [backend] Actualizar `index.ts` para pasar `db`, `config.DB_PATH`, `config.OLLAMA_BASE_URL` al construir; `/api/metrics` async
- [x] 1.5 [backend] Instrumentar `agent/loop.ts` con `metrics.recordAgentLoop()` en exits (success/error/max_iter)
- [x] 1.6 [backend] Instrumentar `tools/executor.ts` con `metrics.recordToolCall()` en todos los exit paths
- [x] 1.7 [backend] Test unit `telemetry/metrics.test.ts` — 4/4 verde

---

## Phase 2 — Infra: docker-compose.observability.yml [infra]

- [x] 2.1 [infra] Crear `docker-compose.observability.yml` con 4 servicios
- [x] 2.2 [infra] Crear `observability/prometheus.yml`
- [x] 2.3 [infra] Crear `observability/loki-config.yml`
- [x] 2.4 [infra] Crear `observability/promtail-config.yml`
- [x] 2.5 [infra] Añadir `GRAFANA_ADMIN_PASSWORD` y `GRAFANA_ALERT_WEBHOOK` a `.env.example`
- [x] 2.6 [infra] Añadir `.gitignore` entry para `observability/grafana/data/`

---

## Phase 3 — Grafana provisioning [infra]

- [x] 3.1 [infra] Crear `observability/grafana/provisioning/datasources/datasources.yaml`
- [x] 3.2 [infra] Crear `observability/grafana/provisioning/dashboards/dashboards.yaml`
- [x] 3.3 [infra] Crear `observability/grafana/provisioning/dashboards/devmind-overview.json` (7 rows)
- [x] 3.4 [infra] Crear `observability/grafana/provisioning/alerting/alert-rules.yaml` con 5 reglas + webhook contact point

---

## Phase 4 — OPERATIONS.md + PRODUCTION_READINESS.md [docs]

- [x] 4.1 [docs] Añadir sección `## Observability` en `OPERATIONS.md`
- [x] 4.2 [docs] Marcar en `PRODUCTION_READINESS.md`: alertas [x], dashboard [x], trazas [~]

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
