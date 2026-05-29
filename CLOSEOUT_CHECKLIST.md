# DevMind — Checklist de cierre

> Estado al **2026-05-29** tras la sesión de cierre. Todo lo cerrable de forma
> honesta (verificable por código/tests o por documentación existente) está
> CERRADO. Lo que queda son ítems que **sólo un operador** puede ejecutar:
> requieren stack vivo + Ollama, acceso admin a Keycloak, DNS de intranet, o el
> sign-off del owner. Esos NO se marcan hechos para no falsear el estado.

## Leyenda
- `[x]` cerrado · `[~]` diferido a propósito · `⛔ OPERATOR` requiere acción humana/infra.

---

## Bloque A — Bookkeeping ✅ COMPLETO
- [x] **A1 · `002-project-first-builder`** — 6.1 marcado N/A; change **archivado** (`archive/2026-05-29-002-project-first-builder`).
- [x] **A2 · `frontend-rearchitecture`** — 23/23; **archivado**.
- [x] **A3 · `007-production-readiness`** — 9/9; **archivado**.
- [x] **A4 · `001-firebase-inspired-layer`** — ya marcado SUPERSEDED; **archivado**.
- [x] **A5 · `006` 3.7** — resuelto: `session_save` no se registra (las sesiones persisten vía el chat pipeline; `tools/session-save.ts` es stub legacy).
- [x] **A6 · `004` 5.4 / 8.4** — marcados N/A con justificación.

## Bloque B — Verificación
**Cerrado por la suite de unit tests (53/53 verde esta sesión):**
- [x] B · `004` 1.2 migración idempotente (por diseño: `schema_migrations` trackea versiones aplicadas)
- [x] B · `004` 12.2 dedup_blobs · 12.3 pin-survives-prune · 12.5 diff · 12.7 legacy fallback
- [x] B · `006` 6.5 typecheck · 6.6 lint · 6.7 README · primitivas de audit + enums + authz
- [x] B3 docs · `004` 12.9 README (ya listaba 004) · 12.10 Atlas `DevMind.md` (actualizado)

**⛔ OPERATOR — requieren stack vivo (+ Ollama para flujos de agente):**
> Intenté arrancar el stack para correr los e2e (pure-API, sin Ollama) pero
> el entorno lo bloquea: caché `.vite` propiedad de root + CLI `tsx watch` roto
> bajo Node 22. Los specs existen y están listos para correr contra `:5173`.
- [ ] ⛔ `004` 12.1 auto-capture pre+post sobre 5 prompts (live LLM)
- [ ] ⛔ `004` 12.4 restore→branch-root (`e2e/snapshot-restore.spec.ts`, pure-API)
- [ ] ⛔ `004` 12.6 revert desde mensaje de chat (live UI + LLM)
- [ ] ⛔ `006` 6.1 / 6.2 / 6.3 loop de agente end-to-end (gate + invalid-args + safety por call)

## Bloque C — `008-keycloak-oidc`
**Decisiones + docs cerradas:**
- [x] C1 · 0.2 dominio `devmind.casa` · 0.3 ventana híbrida ~30d · 0.4 mapeo de roles (todo fijado en `AUTH_OIDC.md`)
- [x] C2 · 1.6 redirect URIs + env vars documentados en `AUTH_OIDC.md`

**⛔ OPERATOR / infra — no ejecutables desde este entorno:**
- [ ] ⛔ C1 · 0.1 **owner sign-off** del proposal/design/spec (gate humano; código fases 2-8 listo y verde)
- [ ] ⛔ C1 · crear registro **DNS** `devmind.casa` (op de intranet)
- [ ] ⛔ C2 · 1.1–1.5 crear clients/scopes/mapper/role en el **Keycloak real** (`auth.casa`, sin acceso admin aquí)
- [ ] ⛔ C3 · 8.4–8.6 e2e contra KC real (depende de 1.x)
- [~] C4 · Phase 9 `drop_local_auth` — DIFERIDA hasta cerrar la ventana híbrida (fecha de 0.3)

---

## Resumen
- **Cerrado autónomamente:** Bloque A entero (4 changes archivados), Bloque B verificable por tests + docs, Bloque C decisiones + documentación.
- **Pendiente (sólo operador):** una pasada de QA con el stack vivo (Bloque B ⛔) y la provisión de Keycloak/DNS + sign-off (Bloque C ⛔), más la Phase 9 diferida.
- **Changes activos restantes:** `004` y `006` (sólo verificación de operador), `008` (infra KC), `005` (draft, fuera de este cierre).
