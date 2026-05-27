# Design: 010-observability

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  DevMind backend (Hono, :3001)                                  │
│                                                                 │
│   request ─► request-id middleware ─► child logger (req_id)     │
│              │                                                  │
│              ▼                                                  │
│         http metrics middleware ─► MetricsRegistry              │
│              │  (recordHttp: count + histogram bucket)          │
│              ▼                                                  │
│           route handler                                         │
│              │                                                  │
│              ▼                                                  │
│         tool executor ─► tool_call_audit (DB)                   │
│              │                                                  │
│              ▼                                                  │
│         counter recordToolCall(tool, safety, status, dur)       │
└──────┬──────────────────────────────────────────────────────────┘
       │
       ├─ GET /api/metrics ─► MetricsRegistry.render()
       │    ┌──────────────────────────────────────┐
       │    │ counters    (in-memory)              │
       │    │ histograms  (in-memory buckets)      │
       │    │ gauges      (cheap COUNT(*) per call)│
       │    └──────────────────────────────────────┘
       │
       └─ GET /api/health ─► HealthService.snapshot()
            ┌────────────────────────────────────────────────┐
            │ db:      ping prepared SELECT 1                │
            │ ollama:  cached GET /api/tags (TTL 10s)        │
            │ workers: lastOkAt from in-process worker tick  │
            │ vector:  hnsw index size (cached, TTL 30s)     │
            └────────────────────────────────────────────────┘
```

## Decisiones técnicas

### D1: Métricas en memoria, no Redis/external store

- DevMind corre un único proceso backend (no clusterizado). Mantener
  contadores y buckets en memoria es suficiente, sin red, sin failure
  modes.
- Si en el futuro se escala a múltiples réplicas: Prometheus puede
  scrapear cada réplica por separado y agregar a nivel de query (es la
  forma idiomática). No introducimos un store compartido.

### D2: Histogram con buckets estáticos

Buckets para `devmind_http_request_duration_ms_bucket`:
`50, 100, 250, 500, 1000, 2500, +Inf`.

Razón: cubre desde requests baratos (auth, refresh) hasta lentos
(chat SSE inicial, vector search). Permite p50/p95/p99 con
`histogram_quantile` de Prometheus.

Para `devmind_agent_loop_iterations_bucket`: `1, 2, 4, 6, 8`.
8 es `MAX_ITERATIONS` actual, los otros son cortes naturales.

No usamos summaries (no se pueden agregar a través de réplicas en
Prometheus). Histograms sí.

### D3: Etiqueta `route` viene de `c.req.routePath`, no de `c.req.url`

`c.req.url` contiene IDs específicos (`/projects/abc-123`) → explosión
de cardinalidad. `c.req.routePath` devuelve la plantilla
(`/projects/:id`) que es el matcher Hono → cardinalidad acotada por el
número de rutas.

Si una ruta no está en el router (404), se usa `<not-found>` como
valor de `route` para no inflar.

### D4: Gauges leídos en `render()`, no eventados

- `devmind_jobs_in_queue`, `devmind_snapshot_blobs_count`,
  `devmind_snapshot_blobs_ref_count_sum`: se leen con un `COUNT(*)`
  / `SUM(ref_count)` desde la DB al renderizar.
- Coste: ~1ms total con índices presentes. Scrape interval ≥10s →
  insignificante.
- Alternativa rechazada: contador eventado con `incrementWhenJobInserted`
  / `decrementWhenJobCompleted`. Más rápido pero requiere instrumentar
  cada path de inserción/borrado y se desincroniza fácilmente si alguno
  se olvida. La fuente de verdad es la DB.

### D5: Tool calls — counter incrementado por el executor, no leído de la audit table

El `ToolExecutor` ya inserta en `tool_call_audit` al final de cada
llamada. Se aprovecha ese mismo punto para llamar
`metrics.recordToolCall(name, safety, status, durationMs)`.

Razón: leer la audit table en cada scrape sería costoso (la tabla crece
sin límite, ya documentado como deuda). En memoria sí escala.

Pérdida aceptada: si el proceso se reinicia, los counters de tool
calls se reinician también. Es lo mismo que pasa con `http_requests_total`.
Si en el futuro hace falta totales históricos, se hace una query
explícita contra la audit table desde Grafana.

### D6: `/api/health` con `status` agregado

```ts
type HealthSnapshot = {
  status: 'ok' | 'degraded' | 'down';
  uptime_seconds: number;
  components: {
    db: { ok: boolean; latency_ms?: number };
    ollama: { ok: boolean; latency_ms?: number; model?: string };
    workers: { ok: boolean; last_ok_seconds?: number; queue_depth?: number };
    vector: { ok: boolean; index_size?: number };
  };
};
```

Reglas de agregación:
- `db.ok == false` → status `down`. La DB es load-bearing; sin ella
  nada funciona.
- Cualquier otro componente `ok == false` → `degraded`.
- Todos `ok == true` → `ok`.

Códigos HTTP:
- `ok` y `degraded` → `200`. Permite que el load balancer lo siga
  considerando vivo (con `degraded` el operador decide).
- `down` → `503`. Sí saca al backend del rotation.

Compatibilidad: el endpoint emitido por la spec 007 devolvía un objeto
con campos planos (`db`, `ollama`, `workers_lag`). El consumidor real
es el `HEALTHCHECK` del Dockerfile y un eventual script de smoke. Se
actualizan en el mismo PR. No hay API pública versionada.

### D7: `req_id` propagado via Hono context

```ts
app.use('*', requestIdMiddleware());
// dentro del middleware:
const reqId = crypto.randomUUID();
c.set('req_id', reqId);
c.set('logger', baseLogger.child({ req_id: reqId }));
```

Cada handler que ya hace `import { logger }` se cambia a
`const logger = c.get('logger') ?? baseLogger`. Pequeño refactor,
~10-15 sites en backend.

El `req_id` se incluye en `tool_call_audit.args_json` solo en handlers
que tienen el context (la mayoría de las llamadas a tools vienen del
agent loop que sí tiene el request original).

Esto NO cambia el schema de `tool_call_audit` — el `req_id` va dentro
del JSON de args como un campo más (no canonical). Si más adelante hace
falta una columna dedicada se añade en otra migración.

### D8: Workers en proceso → métrica desde el mismo backend

El compose actual (`docker-compose.prod.yml`) define un servicio
`workers` separado, pero `packages/workers` importa los handlers de
`packages/backend` y comparte la misma DB. El `lastOkAt` lo expone el
loop principal del worker.

Para la spec 010:
- Si los workers viven en el mismo proceso del backend
  (`WORKERS_INPROCESS=true`, viable para hosts pequeños), el backend
  publica `devmind_workers_last_ok_seconds` desde una variable
  compartida.
- Si los workers viven en un proceso separado, el backend obtiene el
  valor de la última vez que se vio el worker activo desde una columna
  `workers_heartbeat` (tabla nueva, una sola fila tipo singleton) que
  el worker actualiza cada tick.

Decisión: implementar la segunda variante (singleton row
`workers_heartbeat`) porque no rompe el compose actual y es trivial.
Migración 023.

### D9: Reglas de alerta versionadas en repo, no aplicadas desde repo

`ops/alerts/devmind.rules.yml` es un fichero YAML estándar Prometheus
con `groups[].rules[]`. El repo lo guarda como documentación versionada
(qué alertas debería emitir Alertmanager para esta instancia). El
operador lo copia a su instalación Alertmanager fuera del repo.

No CI lint contra Prometheus — sería overkill. Si en el futuro hay un
linter Prometheus standalone, se añade.

### D10: Cardinalidad acotada de etiquetas

| Métrica | Labels | Cardinalidad esperada |
|---|---|---|
| `devmind_http_requests_total` | method, route, status | ~50-100 series |
| `devmind_http_request_duration_ms_bucket` | method, route, status, le | ~700 series (7 buckets × 100) |
| `devmind_jobs_total` | type, status | ~10 series |
| `devmind_tool_calls_total` | tool, safety, status | ~100 series (20 tools × 3 safety × 4 status, peor caso) |
| `devmind_agent_loop_iterations_bucket` | outcome, le | ~15 series |
| `devmind_vector_search_total` | tool, hit | ~10 series |

Total esperado: <1k series. Prometheus aguanta sin esfuerzo.

## Plan de migración

1. Implementar primero las métricas in-memory (counters + histograms)
   sin tocar `/api/health` ni añadir `req_id`. Cambio aditivo, el
   endpoint actual sigue funcionando.
2. Cambiar `/api/health` al formato tipado actualizando el
   `HEALTHCHECK` del Dockerfile en el mismo PR.
3. Añadir `req_id` middleware en otro PR — refactor toca muchos
   archivos pero no es funcional.
4. Reglas Prometheus + doc al final.

Cada paso vive en un commit testeable independiente.
