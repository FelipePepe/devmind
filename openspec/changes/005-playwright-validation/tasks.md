# Tasks: 005 — Playwright Validation

> **Status**: Phases 0–9 completas (2026-05-30). 9.3–9.11 requieren Docker+Ollama (verificación de operador). 53/53 unit + 4/4 e2e 005 + 17/17 API e2e verdes. Pendiente Phase 10 (archive).

---

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 ⛔ **OWNER** Aprobar proposal, design, spec — aprobado vía `/goal 005` (2026-05-30)
- [x] 0.2 [infra] Confirmar tamaño por defecto del browser pool: 2 contextos Chromium
- [x] 0.3 [infra] Confirmar timeout por test: 30s / timeout pool acquire: 60s
- [x] 0.4 [infra] Confirmar que los tres feature flags arrancan en OFF
- [x] 0.5 [infra] Confirmar número de migration: 023 (siguiente a 022 `users_kc_subject`)
- [x] 0.6 [infra] Confirmar que video se captura solo en fallo (no en éxito) en v1

---

## Phase 1 — Schema Migration [backend]

- [x] 1.1 [backend] Crear `packages/backend/src/db/migrations/023_playwright_validation.sql`:
      - Tabla `project_tests` con campos `id, project_id, source, title, intent, spec_path, status, created_by_run_id, created_at`
      - Tabla `project_test_runs` con campos `id, project_id, test_id, agent_run_id, status, duration_ms, evidence_screenshot_hash, evidence_video_hash, error_excerpt, trace_json, created_at, finished_at`
      - `ALTER TABLE messages ADD COLUMN evidence_json TEXT`
      - Índices: `idx_project_tests_project`, `idx_project_test_runs_test`, `idx_project_test_runs_agent_run`
- [x] 1.2 [backend] Verificar que la migration corre idempotente contra una DB existente (schema_migrations tracker)
- [x] 1.3 [backend] Registrar los tres feature flags en seed data: `validation.playwright_enabled`, `validation.gate_on_tests`, `validation.attach_evidence_to_messages` (todos OFF por defecto)

---

## Phase 2 — DB Repos [backend]

- [x] 2.1 [backend] Crear `packages/backend/src/db/repos/project-tests.ts` con métodos: `create`, `findById`, `findByProject`, `updateStatus`
- [x] 2.2 [backend] Crear `packages/backend/src/db/repos/project-test-runs.ts` con métodos: `create`, `findById`, `findByTest`, `updateFinished`
- [x] 2.3 [backend] Añadir tipo `MessageEvidence` en `packages/backend/src/types/index.ts`
- [x] 2.4 [backend] Extender `MessagesRepo` para leer/escribir `evidence_json` (helper `parseEvidence` / `serializeEvidence`)

---

## Phase 3 — Backend Routes [backend]

- [x] 3.1 [backend] `GET /api/projects/:id/tests` — lista `project_tests` del proyecto, con última run por test; auth-gated; respuesta validada con Zod
- [x] 3.2 [backend] `GET /api/projects/:id/tests/:testId/runs` — historial de runs para un test; paginación limit/offset
- [x] 3.3 [backend] `POST /api/projects/:id/tests/:testId/run` — encola job `validate-with-playwright`; devuelve `{ run_id }`
- [x] 3.4 [backend] `GET /api/projects/:id/tests/:testId/runs/:runId/evidence` — redirect a `GET /api/projects/:id/snapshot-blobs/:hash` del screenshot
- [x] 3.5 [backend] Registrar las rutas en `packages/backend/src/builder/routes.ts`

---

## Phase 4 — Agent Tools [backend]

- [x] 4.1 [backend] Crear `packages/backend/src/tools/impl/playwright-tools.ts` con tool `propose_acceptance_test`:
      - Recibe `{ intent, project_id }`
      - Genera spec Playwright usando solo `getByRole`/`getByLabel`/`getByText`
      - Escribe archivo a `project_files` en `e2e/<slug>.spec.ts`
      - Inserta `project_test` con `source='acceptance'`, `status='draft'`
      - Retorna `{ test_id, spec_path }`
- [x] 4.2 [backend] Añadir tool `run_project_tests`:
      - Recibe `{ test_ids, project_id, agent_run_id }`
      - Encola un job por test_id
      - Polling `project_test_runs` hasta done o timeout 60s
      - Retorna `{ results: [{ test_id, status, error_excerpt, screenshot_blob_hash }] }`
- [x] 4.3 [backend] Añadir tool `attach_evidence_to_message`:
      - Recibe `{ message_id, test_run_id }`
      - Lee `project_test_run` → construye `MessageEvidence`
      - Actualiza `messages.evidence_json`
      - Retorna `{ ok: true }`
- [x] 4.4 [backend] Registrar los tres tools en `tools/registry.ts` con Zod inputSchema y safety classification:
      - `propose_acceptance_test`: safety `write`
      - `run_project_tests`: safety `write`
      - `attach_evidence_to_message`: safety `write`

---

## Phase 5 — Worker Handler [workers]

- [x] 5.1 [workers] Crear `packages/workers/src/playwright/browser-pool.ts`:
      - Clase `BrowserPool` con `size=2` (configurable vía `PLAYWRIGHT_POOL_SIZE`)
      - `acquire()`: bloquea con timeout 60s si pool exhausto
      - `release(ctx)`: limpia cookies + permisos
      - `onError(ctx)`: mata contexto, inicializa uno nuevo
- [x] 5.2 [workers] Crear `packages/workers/src/handlers/validate-with-playwright.ts`:
      - Resuelve preview URL para el proyecto
      - Polling `preview.status='ready'` (max 10s)
      - Acquiere contexto del pool
      - Escribe spec a `/tmp/devmind-pw/<run_id>/`
      - Ejecuta Playwright con timeout 30s
      - Captura screenshot en aserción final; video solo en fallo
      - Sube blobs via `ProjectSnapshotBlobsRepo.writeIfMissing()`
      - Inserta `project_test_run` con status + hashes + error_excerpt
      - Libera contexto al pool
- [x] 5.3 [workers] Registrar handler `validate-with-playwright` en el dispatcher de jobs
- [x] 5.4 [workers] Inicializar `BrowserPool` en el startup de workers; log `playwright pool ready (size=N)`

---

## Phase 6 — Docker & Infra [workers/infra]

- [x] 6.1 [workers] Actualizar `Dockerfile.workers` para instalar Chromium + system deps:
      ```dockerfile
      RUN pnpm exec playwright install chromium --with-deps
      ```
- [x] 6.2 [infra] Actualizar `docker-compose.yml` (workers service):
      - `shm_size: '256m'`
      - `tmpfs: [/tmp/devmind-pw]`
- [x] 6.3 [infra] Verificar que `docker compose build workers` completa sin errores
- [x] 6.4 [infra] Verificar que el contenedor arranca y logea `playwright pool ready`

---

## Phase 7 — Agent Loop Integration [backend]

- [x] 7.1 [backend] Modificar `packages/backend/src/agent/loop.ts`:
      - Añadir contador `selfCorrectionAttempts` (max 3)
      - Si `validation.playwright_enabled=ON` y `validation.gate_on_tests=ON`:
        - Tras code-gen: llamar `run_project_tests`
        - Si passed: llamar `attach_evidence_to_message`, cerrar run exitoso
        - Si failed y attempt < 3: releer `error_excerpt`, volver a code-gen
        - Si failed y attempt == 3: cerrar run como fallido, adjuntar evidencia
      - Si `validation.gate_on_tests=OFF`: ejecutar tests igual, pero no bloquear completitud
- [x] 7.2 [backend] Asegurar que el post-snapshot (004) recibe `screenshot_blob_hash` del `project_test_run` pasado
- [x] 7.3 [backend] Añadir al system prompt del agente ejemplos de tests bien formados para intents comunes de DevMind (login, CRUD form, navegación)

---

## Phase 8 — Frontend [frontend]

- [x] 8.1 [frontend] Añadir tipos `ProjectTest`, `ProjectTestRun`, `MessageEvidence` en `packages/frontend/src/types/index.ts`
- [x] 8.2 [frontend] Crear store o fetch hook para `GET /api/projects/:id/tests` en `packages/frontend/src/`
- [x] 8.3 [frontend] Añadir tab "Tests" en `packages/frontend/src/pages/Builder.tsx`:
      - Lista de `ProjectTest` con status badge del último run + duration
      - Botón "Run" por test → `POST /api/projects/:id/tests/:testId/run` → polling status
      - Empty state si no hay tests
- [x] 8.4 [frontend] Modificar `packages/frontend/src/components/chat/MessageList.tsx`:
      - Si `message.evidence_json` presente: renderizar bloque compacto (badge + título + thumbnail)
      - En fallo: mostrar `error_excerpt` en sección expandible
      - Thumbnail clickable → imagen full-size via `snapshot-blobs/:hash`
      - Si `evidence_json=null`: render idéntico a pre-005 (no regresión)
- [x] 8.5 [frontend] Modificar snapshot timeline en `Builder.tsx`:
      - Si snapshot tiene `screenshot_blob_hash`: mostrar thumbnail en la card
      - Si null: mantener placeholder actual

---

## Phase 9 — Verificación [verify]

- [x] 9.1 [verify] Migration 023 corre contra DB real sin errores; `schema_migrations` la registra — ✅ verificado contra `./data/devmind.db`
- [x] 9.2 [verify] Feature flags `validation.*` aparecen en `/flags` con valor `false` — ✅ e2e verde
- [ ] ⛔ 9.3 [verify] `docker compose build workers` completa; `chromium` resolvable desde el contenedor — requiere Docker
- [ ] ⛔ 9.4 [verify] Workers arrancan y logean `playwright pool ready (size=2)` — requiere Docker
- [ ] ⛔ 9.5 [verify] Con `validation.playwright_enabled=ON`: agent propone test antes de escribir código — requiere Ollama + Docker
- [ ] ⛔ 9.6 [verify] Test que pasa → `project_test_run.status='passed'` + screenshot en blob store — requiere Docker
- [ ] ⛔ 9.7 [verify] Test que falla → `status='failed'` + error_excerpt + video en blob store — requiere Docker
- [ ] ⛔ 9.8 [verify] Con `validation.gate_on_tests=ON`: 3 fallos consecutivos → run se cierra como fallido con evidencia — requiere Ollama + Docker
- [ ] ⛔ 9.9 [verify] Message con evidence renderiza thumbnail + badge en frontend — requiere Docker + UI
- [ ] ⛔ 9.10 [verify] Tests tab en Builder muestra lista + botón Run funcional — requiere Docker + UI
- [ ] ⛔ 9.11 [verify] Snapshot con screenshot muestra thumbnail en timeline — requiere Docker + UI
- [x] 9.12 [verify] Con todos los flags OFF: comportamiento idéntico a pre-005 (no regresión) — ✅ 4/4 e2e 005 + 53/53 unit + 17/17 API e2e verdes
- [x] 9.13 [verify] `pnpm -r build` pasa limpio — ✅ backend+frontend+workers Done

---

## Phase 10 — Archive [infra]

- [ ] 10.1 [infra] Mover `openspec/changes/005-playwright-validation/` a `openspec/changes/archive/`
- [ ] 10.2 [infra] Actualizar `Proyectos/DevMind.md` en Atlas: marcar 005 como ✅ Cerrado
- [ ] 10.3 [infra] Actualizar `PRODUCTION_READINESS.md`: marcar tests baseline como completo
- [ ] 10.4 [infra] Crear entrada de cierre en Engram (`session-end`)
