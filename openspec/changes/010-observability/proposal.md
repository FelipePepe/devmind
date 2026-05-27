# Proposal: 010-observability

## Intent

Extender la observabilidad de DevMind del baseline mínimo cerrado por la
spec 007 (uptime + HTTP count/duration en `/api/metrics`, `pino` con JSON
parseable, `/api/health` con `db|ollama|workers_lag`) a un conjunto de
métricas, etiquetas estandarizadas y reglas de alerta que permitan saber
**en menos de un minuto** si la instancia está rota o degradada — sin
necesitar leer logs.

El objetivo no es un stack completo Loki/Grafana provisionado por nosotros
— eso queda fuera del repo, como gestiona el resto del homelab. El
objetivo es:

1. Que `/api/metrics` exponga las métricas que un dashboard básico
   necesita (jobs, agente, tools, vector, blobs).
2. Que las etiquetas (`labels`) sean estables — sin esto cualquier
   dashboard que se monte se rompe en cuanto refactorizamos.
3. Que `/api/health` deje de ser binario (`ok/degraded/down`) y pase a
   tener subsistemas tipados, con un `status` agregado claro.
4. Que el repo lleve un fichero de reglas de alerta Prometheus (no las
   monta él, pero las define) listo para copiar a Alertmanager.
5. Que la observabilidad de los workers no dependa de pollear DB desde
   fuera — cada worker debe emitir su lag y last-ok timestamp por
   métrica.

## Scope

### In Scope

- Backend (`packages/backend/src/`):
  - `telemetry/metrics.ts` extendido con:
    - `devmind_jobs_total{type, status}` — counter por jobs procesados.
    - `devmind_jobs_in_queue{type}` — gauge actual de `jobs` pendientes y
      en proceso por tipo.
    - `devmind_dead_letter_jobs_total{type}` — counter de jobs movidos a
      `dead_letter_jobs`.
    - `devmind_tool_calls_total{tool, safety, status}` — counter de
      llamadas a tools (consume `tool_call_audit`).
    - `devmind_tool_call_duration_ms_sum{tool, safety}` — counter de
      duración acumulada por tool (junto al count se calcula media).
    - `devmind_agent_loop_iterations{outcome}` — histogram simple
      (buckets 1/2/4/6/8) de iteraciones por agent run.
    - `devmind_agent_loop_duration_ms_sum{outcome}` — counter de duración
      total acumulada de agent loops por outcome (ok/error/limit).
    - `devmind_vector_search_total{tool, hit}` — counter de búsquedas
      HNSW con `hit=true/false`.
    - `devmind_snapshot_blobs_count` — gauge de filas en
      `project_snapshot_blobs`.
    - `devmind_snapshot_blobs_ref_count_sum` — gauge de la suma de
      `ref_count` (drift indicator vs `_count` si `compactBlobs` está
      desincronizado).
    - `devmind_http_request_duration_ms_bucket{le, method, route, status}`
      — histogram simple con buckets 50/100/250/500/1000/2500/+Inf
      (sustituye al actual `_sum` solo, que no permite calcular p99).
  - `MetricsRegistry` mantiene las gauges al render-time leyendo de la DB
    (cheap: 4-5 COUNT). Los counters viven en memoria.
  - `/api/health` devuelve `{ status, components: { db, ollama, workers,
    vector } }` donde `status = ok | degraded | down` se computa:
    - `down` si `db` cae,
    - `degraded` si cualquiera de `ollama|workers|vector` está roto,
    - `ok` en caso contrario.
- Workers (`packages/workers/src/`):
  - Cada vuelta del loop actualiza un timestamp en memoria
    `lastOkAt: Date`. El backend expone este via
    `devmind_workers_last_ok_seconds` cuando lo lee del mismo proceso
    (compose monolítico) o cuando los workers exponen su propio
    `/metrics` (compose split — opcional).
  - Decisión inicial: workers viven dentro del mismo proceso vía
    `WORKERS_INPROCESS=true` (default), las métricas están en
    `/api/metrics` del backend. Si en el futuro se separa el proceso, el
    sidecar abrirá su propio endpoint.
- Logs (`packages/backend/src/logger.ts`):
  - Verificación documentada: cada request emite una línea JSON con
    `req_id` (`crypto.randomUUID()` por request), `method`, `url`,
    `status`, `duration_ms`. Hook común en el middleware HTTP.
  - `req_id` se propaga al `pino` child logger durante el request y va
    en `tool_call_audit.args_json` cuando aplique.
- Reglas de alerta (`ops/alerts/devmind.rules.yml`):
  - `DevmindBackendDown` — `up{job="devmind"} == 0` 1m
  - `DevmindOllamaDegraded` — `/api/health` `components.ollama == false`
    5m
  - `DevmindWorkersStalled` — `time() - devmind_workers_last_ok_seconds
    > 120` 2m
  - `DevmindJobQueueGrowing` — `devmind_jobs_in_queue{type=~".+"} > 25`
    10m
  - `DevmindToolCallErrorRate` — `rate(devmind_tool_calls_total{status=
    "error"}[5m]) / rate(devmind_tool_calls_total[5m]) > 0.1` 5m
  - `DevmindHttpLatencyHigh` — `histogram_quantile(0.99,
    rate(devmind_http_request_duration_ms_bucket[5m])) > 2500` 5m
- Documentación:
  - Nuevo `docs/observability.md` con:
    - Listado canonical de métricas (nombre, tipo, labels, qué mide).
    - Cómo pegar `devmind.rules.yml` en un Alertmanager existente.
    - Mini ejemplo de query Grafana por dashboard panel.
  - `PRODUCTION_READINESS.md` actualizado marcando los items de
    observabilidad como cerrados.

### Out of Scope

- Trazas distribuidas OpenTelemetry — opcional en el checklist, no
  bloqueador. Se añadirá en una spec posterior si hace falta.
- Provisionar Grafana, Prometheus o Alertmanager. Vive fuera del repo
  (homelab/maya).
- Loki/Promtail wiring para logs — `pino` ya emite JSON, basta con
  apuntarles a stdout del container.
- Dashboard `devmind.json` en `ops/grafana/` — el checklist solo pide
  que las métricas existan, no que el dashboard esté commiteado.
- Tracing de la cadena chat → agent → tools por request (sería
  OpenTelemetry).
- Pull-based metrics scraper bidireccional (los workers no exponen su
  propio endpoint; comparten proceso con el backend).

## Problem Statement

1. **Sin alertas, los incidentes se detectan tarde.** El backend puede
   estar caído o degradado durante horas sin que nadie lo note. El
   checklist 007 dejó el baseline mínimo pero "métricas profundas quedan
   como follow-up".
2. **Sin histograma de latencia HTTP, no hay p99 ni dashboard de
   request latency.** Hoy `/api/metrics` solo expone `_sum` y `_count`,
   con eso solo se puede calcular la media — irrelevante para detectar
   colas largas.
3. **Sin métrica de cola de jobs, los workers pueden estar parados o
   acumulando trabajo sin que se note.** El checklist marca workers
   como bloqueador.
4. **Sin métrica de tool calls por safety, no se puede ver si el
   agente está siendo bloqueado por el autonomy gate o está rompiendo
   con frecuencia.** Y sin la audit table no hay forma de saberlo en
   tiempo casi-real (la audit table crece sin límite, otro item del
   checklist).
5. **El endpoint `/api/health` actual mezcla todos los subsistemas en
   un único OK/KO.** Un cron de alerta no puede distinguir "ollama
   down" de "backend down".
6. **El `pino` actual no emite `req_id`.** Trazar un fallo HTTP a través
   del agent loop a la tool call concreta requiere matchear timestamps
   a mano.

## Proposed Direction

1. Convertir `MetricsRegistry` en una clase con dos sets de fuentes:
   counters en memoria (HTTP, jobs procesados, tool calls, vector hits,
   agent loops) y gauges que se evalúan en `render()` con queries cortas
   (jobs en cola, blobs count, blobs ref_count_sum).
2. Refactorizar `/api/health` a un payload tipado:
   ```ts
   {
     status: 'ok' | 'degraded' | 'down',
     components: {
       db:       { ok: boolean, latency_ms?: number },
       ollama:   { ok: boolean, latency_ms?: number, model?: string },
       workers:  { ok: boolean, last_ok_seconds?: number, queue_depth?: number },
       vector:   { ok: boolean, index_size?: number }
     },
     uptime_seconds: number
   }
   ```
3. Generar `req_id` en `http/request-id.ts` (Hono middleware), guardarlo
   en `c.get('req_id')` y propagarlo a un child logger via
   `c.set('logger', logger.child({ req_id }))`. Las rutas que ya usen
   `logger` directamente leen del context.
4. Convertir el bucket HTTP a histograma estilo Prometheus exponiendo
   `_bucket{le="X"}`, `_count`, `_sum`. El cambio es retro-compatible
   para consumidores que solo leen `_sum`/`_count`.
5. Definir las reglas de alerta como YAML estándar de Prometheus en
   `ops/alerts/devmind.rules.yml`. El repo NO las aplica — son
   evidencia documental para Alertmanager.
6. Una tabla de métricas canónica en `docs/observability.md` con
   `nombre | tipo | labels | descripción` para que cualquier panel de
   Grafana se construya sin adivinar.

## Riesgos

- **Cardinalidad de labels.** Si `route` no se normaliza, cada path con
  un UUID genera una serie nueva. Mitigación: usar la route plantilla
  de Hono (`c.req.routePath`), no la URL bruta.
- **Coste de gauges leídos en `render()`.** Cada scrape de Prometheus
  ejecuta 4-5 COUNT(*). Aceptable con scrape interval ≥10s. Si más
  adelante hace daño, cachear por 10s.
- **Cambio de estructura de `/api/health` rompe consumidores actuales.**
  Mitigación: mantener `{ status, db, ollama, workers_lag }` planos
  además del objeto nuevo, o versionar via header `Accept`. Decisión:
  el endpoint es nuevo en 007 y el único consumidor real es el script
  de healthcheck del compose — se actualiza junto.
- **`req_id` en logs aumenta tamaño de cada línea ~40 bytes.** Aceptable
  frente al valor de poder correlacionar.
