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
- [ ] **Migraciones rollback strategy** — el runner solo aplica adelante. Decidir: ¿se aceptan migraciones irreversibles? ¿Cómo se recupera de una migración a medias?

### Secrets & config
- [x] **Validación estricta de `config.ts` en startup**. En producción rechaza secretos placeholder, CORS wildcard y paths no absolutos.
- [x] **Infisical wireado en prod** (variables como `STORAGE_BASE_PATH`, `WORKSPACE_ROOT`, `SQLITE_PATH` deben venir de Infisical, no `.env`). `docker-compose.prod.yml` y `.env.example` documentan las variables runtime; `loadSecrets()` sigue cargando Infisical si hay bootstrap credentials.
- [ ] **Rotación de `JWT_SECRET`** documentada (qué pasa con tokens existentes — refresh + invalidación). Nota: con spec 008-keycloak-oidc en vigor (Phase 9 cleanup), `JWT_SECRET` deja de existir; la rotación pasa a manos de Keycloak.

### Seguridad
- [ ] **HTTPS/TLS**. Decisión aplicada: TLS termina en reverse proxy delante; pendiente añadir config Caddy/nginx concreta del host.
- [x] **Headers de seguridad**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options. Añadido middleware propio en `packages/backend/src/http/security.ts`.
- [x] **CORS estricto** — hoy probablemente acepta cualquier origen. Limitado mediante `CORS_ALLOWED_ORIGINS`; wildcard bloqueado en producción.
- [x] **Rate limiting** en `/auth/login`, `/auth/register`, `/api/chat/send`. Auth ya lo tenía; añadido también a `POST /api/chat`.
- [x] **Password complexity policy** en registro (longitud mínima, etc.) — mínimo 12 chars + minúscula + mayúscula + número + símbolo.
- [x] **CSRF** si hay cookies de sesión — refresh cookie `HttpOnly`, `SameSite=Strict`, `secure` en producción; API principal usa JWT por `Authorization`.

### Auth & cuentas
- [x] **Refresh token rotation real** (no reutilización). Añadida tabla `refresh_tokens`, hashing SHA-256 y revocación al rotar.
- [x] **Logout invalida tokens** en el servidor (blocklist o jti). Logout revoca el refresh token actual server-side.
- [ ] **Recuperación de password** — flujo de reset, email, etc. **Resuelto por spec 008-keycloak-oidc**: Keycloak gestiona password reset, email verification y lockout tras N intentos vía políticas de realm. Pendiente cerrar Phase 8 (verify manual).
- [ ] **Email verification** — si va a admitir registros desde fuera de tu red, requerido. **Resuelto por 008-keycloak-oidc**.
- [ ] **Bloqueo tras N intentos fallidos** + cooldown. **Resuelto por 008-keycloak-oidc** (brute force detection en realm).

---

## 🟠 Importantes — sin esto produces incidentes en semanas

### Observabilidad
- [x] **Logs estructurados a stdout** + recolección (Loki/Promtail, journald, lo que sea). Verificado: `packages/backend/src/logger.ts` instancia `pino` y emite una línea JSON por log con `level`, `time`, `pid`, `hostname`, `msg` y campos arbitrarios; trazas de error se serializan completas. La recolección (Loki/Promtail) sigue siendo trabajo de infra fuera del repo.
- [x] **Métricas Prometheus**: request count/latency por endpoint, jobs en cola, tool calls por safety, duración de agent loops, hit rate del HNSW, ref_count de blobs. Base añadida en `/api/metrics` para uptime + HTTP count/duration; métricas profundas quedan como follow-up.
- [ ] **Trazas distribuidas** opcional (OpenTelemetry) para correlacionar chat → agent loop → tools → DB.
- [ ] **Alertas mínimas**: backend caído, workers parados, cola > N, Ollama down, latencia chat p99 > X, DB > Y GB.
- [ ] **Dashboard básico** (Grafana) con esas métricas.

### Backups & DR
- [x] **Backup automático del SQLite** (snapshot WAL-safe, p.ej. `VACUUM INTO`). Diario + retención. Añadido `scripts/backup-sqlite.sh` y perfil `sqlite-backup`.
- [ ] **Backup de `workspace/`** (archivos de proyectos generados) — rsync incremental.
- [x] **Backup del `vector-db/`** o documentar que es recomputable (regenerar índice). Documentado en `OPERATIONS.md`: recomputable, pero volumen incluido en estrategia.
- [x] **Restore drill documentado** — instrucciones exactas para recuperar. Añadido en `OPERATIONS.md`.

### CI/CD
- [x] **Tests automatizados**. Mínimo viable: unit en repos críticos (snapshots, tool-audit, project-files), integración del agent loop con tool mocks, smoke E2E del flujo principal (login → crear proyecto → prompt → ver archivo generado). Añadido primer baseline `pnpm test` + tests de password policy y refresh token hashing; falta ampliar cobertura a los repos críticos y E2E.
- [ ] **Deploy automation** — workflow GitHub Actions que tras merge a `main` haga `docker build && push && ssh deploy`. Hoy no hay `main` activo siquiera; falta protocolo `develop → main → tag → deploy`.
- [ ] **Branch protection** en `main`: requiere PR, CI verde, ≥1 review. En `develop`: requiere CI verde.
- [ ] **SonarQube CI gate** — el job `sonarqube` de `.github/workflows/build.yml` necesita (1) self-hosted runner con acceso a la intranet `.casa` para alcanzar `http://192.168.1.56:9000`, y (2) secretos `SONAR_TOKEN` + `SONAR_HOST_URL` configurados en GitHub Actions. Sin esto el job queda en cola. Proyecto ya existe en SonarQube (creado en el primer scan local del 2026-05-26).

### Workers
- [x] **Dead-letter queue / retry policy** explícita. Añadida tabla `dead_letter_jobs`; `markFailed` copia el job fallido.
- [x] **Concurrency limit** por tipo de job — un `generate-project` puede saturar Ollama. Worker actual procesa un job global a la vez; suficiente como límite conservador inicial.
- [x] **Crash recovery**: si el worker muere a mitad de un job, ¿se recoge? `resetStuckJobs()` ya reencola `processing → pending`; documentado y mantenido en arranque/tick.

### Verificación manual pendiente
- [ ] **Spec 004 — Phase 12 verify**: snapshots + dedup + pin/prune + branch-root restore + per-message revert contra DB real.
- [ ] **Spec 006 — Phase 6 verify**: audit + Zod rechazo + autonomy gate vía chat real (el smoke automatizado del 2026-05-25 cubre schema y CHECK constraints; falta el end-to-end vivo).

---

## 🟡 Deseables — calidad de producto

### UX / DEX
- [ ] **Onboarding flow** — primer login, primer proyecto, tour de la UI.
- [ ] **Error boundaries** en React. Hoy un componente que petó tumba el chat entero.
- [ ] **Empty states** en builder (sin proyectos, sin archivos, sin tools).
- [ ] **Mensajes de error útiles** — hoy varios fallos terminan en "Internal server error" sin contexto.
- [ ] **Loading states** — varios fetches sin skeleton/spinner.
- [ ] **Code splitting frontend** — vite warned chunk > 500 KB. Lazy-load `marked`, `highlight.js` (Monaco ya está lazy).
- [ ] **PWA / offline** — opcional, pero útil para reentrar a un proyecto sin conexión.

### Spec 005 (playwright-validation)
- [ ] Convierte al agente en "el que prueba lo que genera". Hook `screenshot_blob_hash` ya emitido por 004. Es alcance de spec entera; alta prioridad funcional pero no bloqueador de prod.

### Tool governance v2 (follow-up de spec 006)
- [ ] **UI de confirmación per-call** para `destructive` cuando `autonomy_level=confirm-destructive` (que aún no existe como valor del flag).
- [ ] **Per-project / per-user autonomy overrides**.
- [ ] **Retention/purga del audit log** — hoy crece sin límite.

### Datos
- [ ] **Exportación de proyectos** (zip del workspace + metadata).
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
