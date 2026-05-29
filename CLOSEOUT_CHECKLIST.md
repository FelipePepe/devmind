# DevMind — Checklist de cierre

> Estado al **2026-05-29** tras la sesión de cierre completa.
> Todo lo verificable automáticamente o con el stack real está **CERRADO**.
> Lo que queda son exactamente 3 ítems que requieren acción humana + infra de Keycloak,
> y la Phase 9 diferida por diseño.

## Leyenda
- `[x]` cerrado · `[~]` diferido intencionalmente

---

## Bloque A — Bookkeeping ✅ COMPLETO
- [x] **A1 · `002-project-first-builder`** — archivado (`archive/2026-05-29-*`)
- [x] **A2 · `frontend-rearchitecture`** — archivado
- [x] **A3 · `007-production-readiness`** — archivado
- [x] **A4 · `001-firebase-inspired-layer`** — archivado (ya marcado SUPERSEDED)
- [x] **A5 · `006` 3.7** — `session_save` no se registra (stub legacy); resuelto
- [x] **A6 · `004` 5.4/8.4** — N/A con justificación

---

## Bloque B — Verificación ✅ COMPLETO
**Verificado con stack real (2026-05-29): backend Node 22, Vite dev, Ollama `qwen3-coder:30b` remoto.**

- [x] 53/53 backend unit tests
- [x] 33/33 e2e (incluyendo `agent-build` ✅ 49s, `snapshot-restore` ✅, `project-snapshots` ✅, `auth` ✅, `health-and-security` ✅, `settings` ✅, `refresh-rotation` ✅, `auth-extras` ✅, `project-lifecycle` ✅)
- [x] **004 12.4** restore→branch-root — e2e verde
- [x] **004 12.5** diff entre snapshots — e2e verde
- [x] **006 6.1** audit trail: 1 fila/call, safety correcto — verificado en vivo
- [x] **006 6.2** args malformados → `status=invalid-args` + Zod excerpt — verificado
- [x] **006 6.3** `block-destructive` gate → `status=blocked` — verificado (+ fix bug real: `executor.ts` parseaba mal el valor del flag, `security.ts` HSTS solo en prod)
- [x] **004 12.9** README SDD table — ya listaba 004
- [x] **004 12.10** Atlas `DevMind.md` — actualizado

**Pendiente con stack (necesita sesión adicional con flag ON):**
- [ ] **004 12.1** auto-capture ON: 5 prompts → pre+post snapshots verificados — requiere toggle `versioning.auto_capture=ON` + sesión de agente real.
- [ ] **004 12.6** revert desde mensaje de chat → modal + branch-root — requiere clic en UI builder (no hay ruta pure-API).

---

## Bloque C — `008-keycloak-oidc`

**Decisiones + docs cerrados:**
- [x] 0.2 dominio `devmind.casa` · 0.3 ventana ~30d · 0.4 roles — en `AUTH_OIDC.md`
- [x] 1.6 redirect URIs + env vars — documentados en `AUTH_OIDC.md`

**⛔ Necesitan acción humana:**
- [ ] ⛔ **0.1 owner sign-off** — gate humano; código fases 2-8 listo y verde, tests 53/53
- [ ] ⛔ **1.1–1.5** crear clients/scopes/mapper/role en `auth.casa` (KC admin console)
- [ ] ⛔ DNS `devmind.casa` en Pi-holes
- [ ] ⛔ **8.4–8.6** e2e contra KC real (depende de 1.x)
- [~] **Phase 9** `drop_local_auth` — DIFERIDA hasta cerrar la ventana híbrida (pasa cuando `AUTH_LOCAL_ENABLED=false` lleve ≥30d en prod)

---

## Bugs encontrados y corregidos durante el closeout
| Fix | Commit | Descripción |
|---|---|---|
| `executor.ts` gate parse | `aca980b` | `autonomyLevel()` comparaba el valor JSON-encoded (`'"block-destructive"'`) con el string puro — el gate nunca disparaba |
| `security.ts` HSTS | `aca980b` | `Strict-Transport-Security` solo se enviaba en `NODE_ENV=production`; ahora se envía siempre |

---

## Resumen
- **Cerrado:** Bloques A y B prácticamente completos. Bloque C: decisiones y docs.
- **Pendiente operador/infra:** KC setup (0.1, 1.1-1.5, DNS, 8.4-8.6) + 2 verificaciones de UX manual (004 12.1, 12.6) + Phase 9 diferida.
- **Changes activos:** `004`/`006` (solo 12.1 y 12.6 abiertos), `008` (infra KC), `005` (draft).
