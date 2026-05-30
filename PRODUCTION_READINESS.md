# Production readiness — DevMind

> Creado: **2026-05-25** · Fuente: diagnóstico tras cerrar spec 006 (tool security, PR #8).
>
> El producto funciona end-to-end (auth, builder full-stack, agente con tools,
> snapshots versionados, audit log). Este documento lista lo que falta entre
> "funciona en mi máquina" y "corre 24/7 contra usuarios reales".

## Cómo usar este documento

- Marca `[x]` lo que vayas cerrando.
- Cuando un bloque entero merezca su propia spec, abre `openspec/changes/00N-...`
  siguiendo el patrón de las specs 003/004/006 (proposal + design + spec + tasks).
- El orden sugerido vive al final, en **Stack sugerido**.
- Cambios concretos van por PR contra `develop` como el resto.

## Estado base (lo ya cerrado)

| Capa | Estado |
|---|---|
| Auth (password + TOTP + JWT) | ✅ (spec 003) |
| Chat SSE streaming + agent loop | ✅ |
| Builder project-first (proyectos, screens, files, manifest, services, API routes, DB schemas, env vars) | ✅ (spec 003) |
| Preview runtime con tickets firmados | ✅ |
| Indexación semántica (HNSW + embeddings Ollama) | ✅ (spec 002-fase-6) |
| Workers reales (5 handlers) | ✅ |
| Versionado de proyectos (snapshots + blob dedup + timeline + diff modal + auto-capture + revert por mensaje) | ✅ (spec 004) |
| Tool security (audit log + safety classification + Zod validation + autonomy gate + admin endpoint) | ✅ (spec 006) |
| CI: build + typecheck + lint | ⚠️ Parcial — falta tests |

---

## 🔴 Bloqueadores — sin esto NO se despliega

### Deploy & runtime
- [x] **Dockerfile productivo** por servicio (backend, workers, frontend). `Dockerfile.backend`, `Dockerfile.frontend` y `Dockerfile.workers` construyen artefactos `dist` y ejecutan runtime productivo.
- [x] **`docker-compose.yml` de producción** con volúmenes persistentes para `data/` (SQLite + WAL), `workspace/`, `vector-db/`, restart policies, healthchecks reales. Añadido `docker-compose.prod.yml` con `devmind-data`, `devmind-workspace`, `devmind-vectors`, `devmind-storage` y healthchecks.
- [x] **Healthcheck endpoint `/api/health`** que devuelva `{ db: ok, ollama: ok, workers: lag_ms }`. Añadido endpoint público con estado DB/Ollama/cola.
- [x] **Graceful shutdown** del backend (Hono server + WebSocket) y workers (terminar job en curso, no aceptar nuevos). Backend ahora cierra WS + HTTP server + DB; workers ya drenan job en curso.
- [x] **Migraciones rollback strategy** — forward-only, additive changes policy, restore-from-backup recovery procedure. Documentado en `OPERATIONS.md §Migration rollback strategy`.

### Secrets & config
- [x] **Validación estricta de `config.ts` en startup**. En producción rechaza secretos placeholder, CORS wildcard y paths no absolutos.
- [x] **Infisical wireado en prod** (variables como `STORAGE_BASE_PATH`, `WORKSPACE_ROOT`, `SQLITE_PATH` deben venir de Infisical, no `.env`). `docker-compose.prod.yml` y `.env.example` documentan las variables runtime; `loadSecrets()` sigue cargando Infisical si hay bootstrap credentials.
- [~] **Rotación de `JWT_SECRET`** — diferido: con spec 008-keycloak-oidc (Phase 9), `JWT_SECRET` desaparece; la rotación pasa a Keycloak. Pendiente KC infra (0.1 owner sign-off).

### Seguridad
- [x] **HTTPS/TLS**. TLS termina en reverse proxy. Config nginx concreta añadida en `OPERATIONS.md §Nginx reverse-proxy config` (incluye SSE no-buffering, WS upgrade, redirect 80→443).
- [x] **Headers de seguridad**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options. Añadido middleware propio en `packages/backend/src/http/security.ts`.
- [x] **CORS estricto** — hoy probablemente acepta cualquier origen. Limitado mediante `CORS_ALLOWED_ORIGINS`; wildcard bloqueado en producción.
- [x] **Rate limiting** en `/auth/login`, `/auth/register`, `/api/chat/send`. Auth ya lo tenía; añadido también a `POST /api/chat`.
- [x] **Password complexity policy** en registro (longitud mínima, etc.) — mínimo 12 chars + minúscula + mayúscula + número + símbolo.
- [x] **CSRF** si hay cookies de sesión — refresh cookie `HttpOnly`, `SameSite=Strict`, `secure` en producción; API principal usa JWT por `Authorization`.

### Auth & cuentas
- [x] **Refresh token rotation real** (no reutilización). Añadida tabla `refresh_tokens`, hashing SHA-256 y revocación al rotar.
- [x] **Logout invalida tokens** en el servidor (blocklist o jti). Logout revoca el refresh token actual server-side.
- [~] **Recuperación de password** — resuelto por spec 008-keycloak-oidc (Keycloak gestiona reset + email). Pendiente KC infra (0.1 owner sign-off + 1.x KC admin console).
- [~] **Email verification** — resuelto por 008-keycloak-oidc. Pendiente KC infra.
- [~] **Bloqueo tras N intentos fallidos** + cooldown — resuelto por 008-keycloak-oidc (brute force detection en realm). Pendiente KC infra.

---

## 🟠 Importantes — sin esto produces incidentes en semanas

### Observabilidad
- [x] **Logs estructurados a stdout** + recolección (Loki/Promtail, journald, lo que sea). Verificado: `packages/backend/src/logger.ts` instancia `pino` y emite una línea JSON por log con `level`, `time`, `pid`, `hostname`, `msg` y campos arbitrarios; trazas de error se serializan completas. La recolección (Loki/Promtail) sigue siendo trabajo de infra fuera del repo.
- [x] **Métricas Prometheus**: request count/latency por endpoint, jobs en cola, tool calls por safety, duración de agent loops, hit rate del HNSW, ref_count de blobs. Base añadida en `/api/metrics` para uptime + HTTP count/duration; métricas profundas quedan como follow-up.
- [~] **Trazas distribuidas** opcional (OpenTelemetry) — diferido: no hay spans multi-servicio aún. Ver spec 010 §Out of scope.
- [x] **Alertas mínimas**: 5 alert rules en Grafana (BackendDown, WorkersStalled, QueueDepthHigh, OllamaUnreachable, DbSizeCritical). Ver spec 010 + `docker-compose.observability.yml`.
- [x] **Dashboard básico** (Grafana) — DevMind Overview: 7 rows cubriendo HTTP, agent loops, tool calls, job queue, Ollama, logs. Ver spec 010.

### Backups & DR
- [x] **Backup automático del SQLite** (snapshot WAL-safe, p.ej. `VACUUM INTO`). Diario + retención. Añadido `scripts/backup-sqlite.sh` y perfil `sqlite-backup`.
- [x] **Backup de `workspace/`** (archivos de proyectos generados) — rsync incremental. `scripts/backup-workspace.sh` (workspace + storage + vectors, retención 14d). Documentado en `OPERATIONS.md §Backups`.
- [x] **Backup del `vector-db/`** o documentar que es recomputable (regenerar índice). Documentado en `OPERATIONS.md`: recomputable, pero volumen incluido en estrategia.
- [x] **Restore drill documentado** — instrucciones exactas para recuperar. Añadido en `OPERATIONS.md`.

### CI/CD
- [x] **Tests automatizados**. Mínimo viable: unit en repos críticos (snapshots, tool-audit, project-files), integración del agent loop con tool mocks, smoke E2E del flujo principal (login → crear proyecto → prompt → ver archivo generado). Añadido primer baseline `pnpm test` + tests de password policy y refresh token hashing; falta ampliar cobertura a los repos críticos y E2E.
- [x] **Deploy automation** — `.github/workflows/deploy.yml` se dispara en push a `main` y tags `v*`. SSH al host de producción → `git pull` → `docker compose up --build` → health check. Requiere GitHub secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH` (y opcionalmente `DEPLOY_PORT`). Configurar en GitHub repo → Settings → Environments → production.
- [ ] **Branch protection** en `main`: requiere PR, CI verde, ≥1 review. En `develop`: requiere CI verde.
- [ ] **SonarQube CI gate** — job marcado `continue-on-error: true` en `build.yml` para no bloquear PRs cuando el runner de intranet no está disponible. Para activar: (1) self-hosted runner con acceso a `http://192.168.1.56:9000`, (2) secrets `SONAR_TOKEN` + `SONAR_HOST_URL` en GitHub repo settings. Proyecto ya existe en SonarQube desde 2026-05-26.

### Workers
- [x] **Dead-letter queue / retry policy** explícita. Añadida tabla `dead_letter_jobs`; `markFailed` copia el job fallido.
- [x] **Concurrency limit** por tipo de job — un `generate-project` puede saturar Ollama. Worker actual procesa un job global a la vez; suficiente como límite conservador inicial.
- [x] **Crash recovery**: si el worker muere a mitad de un job, ¿se recoge? `resetStuckJobs()` ya reencola `processing → pending`; documentado y mantenido en arranque/tick.

### Verificación manual pendiente
- [x] **Spec 004 — Phase 12 verify**: snapshots + dedup + pin/prune + branch-root restore + per-message revert — verificado con stack real 2026-05-29 (CLOSEOUT_CHECKLIST Bloque B, e2e `revert-ui.spec.ts`).
- [x] **Spec 006 — Phase 6 verify**: audit + Zod rechazo + autonomy gate vía chat real — verificado en vivo 2026-05-29 (CLOSEOUT_CHECKLIST 6.1/6.2/6.3 cerrados).

---

## 🟡 Deseables — calidad de producto

### UX / DEX
- [ ] **Onboarding flow** — primer login, primer proyecto, tour de la UI.
- [x] **Error boundaries** en React. `ErrorBoundary` wraps cada página vía `AppLayout` + `App` root + `LogPanel`. Un crash en Builder no borra el TopBar.
- [x] **Empty states** en builder (sin proyectos, sin archivos, sin tools). Files, screens, API routes, database, env, validation, runtime, snapshots — todos tienen mensaje vacío.
- [x] **Mensajes de error útiles** — rutas del builder retornan `{ error: 'X not found' }` 404 / `{ error: 'Invalid request', details: … }` 400 explícitos. `app.onError` devuelve "Internal server error" solo para excepciones inesperadas en prod (correcto). `apiFetch` extrae `body.error` en frontend.
- [x] **Loading states** — Projects muestra skeleton de 3 cards mientras carga; Builder muestra "Loading project…" durante la carga inicial.
- [x] **Code splitting frontend** — páginas lazy con `React.lazy()` en AppLayout: Chat/Projects/Builder/Admin splits separados; `highlight.js` lazy vía `ArtifactViewer` lazy en `Chat.tsx`; Monaco ya lazy en `Builder.tsx`.
- [ ] **PWA / offline** — opcional, pero útil para reentrar a un proyecto sin conexión.

### Spec 005 (playwright-validation)
- [x] Convierte al agente en "el que prueba lo que genera". Implementado (spec 005, PR #14+#15, 2026-05-30). Migration 023, BrowserPool Chromium, 3 agent tools, Tests tab, EvidenceBlock. Flags OFF por defecto. Verificación completa con Ollama live queda como operador.

### Tool governance v2 (follow-up de spec 006)
- [ ] **UI de confirmación per-call** para `destructive` cuando `autonomy_level=confirm-destructive` (que aún no existe como valor del flag).
- [ ] **Per-project / per-user autonomy overrides**.
- [x] **Retention/purga del audit log** — `TOOL_AUDIT_RETENTION_DAYS` (default 30d) + timer horario `pruneOlderThan()` en `index.ts`. Desactivable con `TOOL_AUDIT_RETENTION_DAYS=0`.

### Datos
- [x] **Exportación de proyectos** — `GET /api/projects/:id/export` devuelve JSON con metadata + files + manifest + services + API routes + database + env vars. Botón ↓ en Projects page y Builder sidebar.
- [ ] **Importación** para mover entre instancias.
- [ ] **GDPR / borrado de cuenta** — si va a haber usuarios reales que no sean tú.

### Performance & escala
- [ ] **HNSW reindex incremental** funcional bajo carga real (verificado en spec 002-fase-6; revalidar con un repo grande real).
- [ ] **Caché de embeddings** (Ollama embed es lento).
- [ ] **Load test** del flujo chat para conocer el techo.

### Documentación
- [x] **`OPERATIONS.md`**: cómo arrancar, parar, actualizar, restaurar, ver logs, debuggear.
- [x] **`SECURITY.md`**: cómo reportar vulnerabilidades, política de actualizaciones.
- [ ] **API docs**: OpenAPI/Swagger generado de las rutas Hono.

---

## 🟢 Nice-to-have

- [ ] Modo invitado / demo público.
- [ ] Métricas de uso por usuario.
- [ ] Plantillas de proyecto (starter kits).
- [ ] Integración con git remoto (push del proyecto generado a GitHub).
- [ ] i18n del frontend.

---

## Lo más sangrante (top 5)

1. **Dockerfile + docker-compose productivos + healthcheck real** — sin esto no hay despliegue reproducible.
2. **Tests automatizados** — sin esto cualquier cambio puede romper algo silenciosamente.
3. **Headers de seguridad + CORS estricto + HTTPS delante** — sin esto cualquier visitante puede joder cosas.
4. **Backups automáticos + restore drill** — sin esto un disco roto te borra meses de proyectos.
5. **Observabilidad mínima** (métricas + alerta de "backend caído") — sin esto te enteras tarde.

## Stack sugerido (orden de ataque)

| # | Spec | Cubre |
|---|---|---|
| 1 | `007-production-deploy` | Docker, docker-compose, healthchecks `/api/health`, graceful shutdown, config strict validation |
| 2 | `008-security-hardening` | Headers (CSP/HSTS/etc), CORS estricto, TLS termination, rate limit completo, password policy, refresh rotation |
| 3 | `009-tests-baseline` | vitest + ~30 unit tests en repos críticos + 3 E2E del flujo principal + integración del agent loop |
| 4 | `010-observability` | Prometheus metrics + Loki logs + 5 alertas mínimas + dashboard Grafana |
| 5 | `011-backups-dr` | Backup automático SQLite/workspace, restore drill documentado |
| 6 | Phase 12 + Phase 6 verify | Verificación manual end-to-end de specs 004 y 006 |
| 7 | `005-playwright-validation` | Tests automáticos de las apps generadas por el agente |

Una vez cubiertos 1-5, el producto está listo para producción real con usuarios. 6 valida el código ya merged. 7 cierra la promesa central ("el agente prueba lo que dice que hizo") pero no bloquea el deploy.
