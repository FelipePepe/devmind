# Proposal: Frontend Rearquitectura

## Intent

El frontend de DevMind es un monolito inmantenible. App.tsx tiene 419 líneas con login, registro, MFA, routing y layout mezclados. Los hooks duplican lógica (useChat + useChatStore), los tipos están dispersos, los estilos inline inflan cada componente y no hay stores centralizados. Necesitamos romper el monolito en una estructura profesional.

## Scope

### In Scope
- Centralizar tipos duplicados en `src/types/index.ts`
- Reemplazar hooks de estado (useAuth, useChatStore, useSession) con Zustand stores
- Romper App.tsx en componentes de auth separados (LoginForm, RegisterForm, MfaForm, TotpSetupForm, LoginPage)
- Extraer TopBar de App.tsx a `components/layout/`
- Crear AppLayout wrapper limpio
- Eliminar `useChat.ts` (duplica `useChatStore.ts`)
- Mover estilos inline de ArtifactViewer, Projects, Builder a CSS

### Out of Scope
- Páginas admin (Flags, Users, Jobs, Ollama) — siguen con useState local, no las tocamos ahora
- Backend, workers
- Diseño visual nuevo o cambios de UX
- Firebase, test runner, CI

## Capabilities

### New Capabilities
- `frontend-state-management`: Gestión centralizada de estado con Zustand para auth, chat y sesiones

### Modified Capabilities
- `frontend-auth`: Auth flow pas de hooks inline a store Zustand dedicado
- `frontend-chat`: Chat+SSE consolidation, eliminando duplicación entre useChat y useChatStore
- `frontend-vector`: (existente, sin cambios requeridos)

## Approach

Fase lineal sobre el código existente, sin borrar nada funcional:

1. **Tipos primero** — User, Session, Message, Artifact, ToolEvent centralizados
2. **Zustand stores** — auth, chat, session como single source of truth
3. **Descomponer App.tsx** — auth components + layout
4. **Limpiar hooks** — eliminar duplicados, mantener solo useFlags (polling)
5. **CSS cleanup** — inline styles a clases

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/frontend/src/App.tsx` | Modified | De 419 a ~40 líneas |
| `packages/frontend/src/types/` | New | Tipos centralizados |
| `packages/frontend/src/stores/` | New | Zustand stores |
| `packages/frontend/src/components/auth/` | New | Forms extraídos de App.tsx |
| `packages/frontend/src/components/layout/` | New | AppLayout, TopBar |
| `packages/frontend/src/hooks/useAuth.ts` | Removed | Reemplazado por store |
| `packages/frontend/src/hooks/useChat.ts` | Removed | Duplica useChatStore |
| `packages/frontend/src/hooks/useChatStore.ts` | Removed | Reemplazado por store |
| `packages/frontend/src/hooks/useSession.ts` | Removed | Reemplazado por store |
| `packages/frontend/src/styles/globals.css` | Modified | Nuevas clases CSS |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Romper auth flow | High | Testing manual después de cada fase |
| Perder funcionalidad SSE | Medium | useChatStore como referencia durante migración |
| Regression en TOTP/MFA | Medium | Forms extraídos sin modificación inicial |

## Rollback Plan

Git branch `frontend-rearch` — revert con `git reset --hard HEAD` en main si falla.

## Dependencies

- Zustand (pendiente de instalar, bloqueado por pnpm store issue)
- Código existente funcional

## Success Criteria

- [ ] App.tsx < 50 líneas
- [ ] Tres Zustand stores funcionando (auth, chat, sesión)
- [ ] Zero tipos duplicados
- [ ] Build limpio (`pnpm --filter @devmind/frontend build`)
- [ ] Auth flow intacto (login → MFA → dashboard)
