# Tasks: 008 — Keycloak OIDC Integration

> **Status (2026-05-26)**: Spec abierta. Infraestructura Keycloak ya
> operativa (`https://auth.casa`, realm `casa`, client `claude-admin`).
> Pendiente toda la implementación. La transición es híbrida durante la
> ventana de migración (~30 días) seguida de cleanup que elimina la auth
> local.

## Phase 0 — SDD Baseline [infra]

- [ ] 0.1 [infra] Aprobar proposal, design, spec
- [ ] 0.2 [infra] Confirmar dominio definitivo de devmind en intranet (`devmind.casa`? Hoy aún sin DNS)
- [ ] 0.3 [infra] Confirmar duración de ventana híbrida (sugerencia: 30 días)
- [ ] 0.4 [infra] Confirmar mapeo de roles (admin vs user) y nombres KC

## Phase 1 — Keycloak — clients y configuración [infra]

- [ ] 1.1 [infra] Crear client `devmind-frontend` en realm `casa` (public + PKCE S256, redirect URIs documentadas)
- [ ] 1.2 [infra] Crear client `devmind-backend` confidential (opcional, para introspection)
- [ ] 1.3 [infra] Configurar scopes default: `openid`, `profile`, `email`
- [ ] 1.4 [infra] Añadir mapper de roles en client scope (realm_access.roles en id_token)
- [ ] 1.5 [infra] Crear role `admin` en realm `casa`
- [ ] 1.6 [infra] Documentar redirect URIs y env vars en `AUTH_OIDC.md`

## Phase 2 — Backend — JWKS + middleware [backend]

- [x] 2.1 [backend] `packages/backend/src/auth/oidc/jwks.ts` — descarga + cache JWKS de `OIDC_ISSUER`, refresh on signature failure (wrapper sobre `createRemoteJWKSet`; `resetJwksCache()` para tests y key rotation)
- [x] 2.2 [backend] `packages/backend/src/auth/oidc/verify.ts` — valida JWT (iss, aud, exp, signature) con `jose`; recovery on signature failure
- [x] 2.3 [backend] `packages/backend/src/auth/middleware.ts` reconoce tokens KC (cuando `iss == OIDC_ISSUER`) o locales (HS256) mientras `AUTH_LOCAL_ENABLED=true`. Inyección de `UsersRepo` vía `configureAuthMiddleware()` desde `index.ts`.
- [x] 2.4 [backend] Test unit `auth/oidc/verify.test.ts`: token válido, expirado, signature de otra key, iss incorrecto, aud incorrecto

## Phase 3 — Backend — endpoints OIDC [backend]

- [x] 3.1 [backend] `POST /auth/oidc/exchange` — intercambia code+verifier por tokens contra KC, valida `id_token`, linkea por email o crea user nuevo, set cookie `oidc_refresh_token` httpOnly
- [x] 3.2 [backend] `POST /auth/oidc/refresh` — lee cookie, intercambia refresh_token con KC, rota cookie, devuelve nuevo access_token
- [x] 3.3 [backend] `POST /auth/oidc/logout` — borra cookie + backchannel logout a KC (revoca refresh)
- [x] 3.4 [backend] Test unit `db/repos/users.test.ts` cubre linking por email vía `linkKcSubject(userId, sub, email)` (con COALESCE de email)
- [x] 3.5 [backend] Test unit `db/repos/users.test.ts` cubre `createFromOidc` con colisión de username (sufijo `_2`)

## Phase 4 — Backend — schema y repo [backend]

- [x] 4.1 [backend] Migration `022_users_kc_subject.sql` añade `kc_subject` + `email`, ambos con unique partial index
- [x] 4.2 [backend] `usersRepo.findByKcSubject`, `findByEmail`, `linkKcSubject`, `createFromOidc` (sentinel `!oidc-only:no-local-password` para password_hash)
- [x] 4.3 [backend] `config.ts` añade `AUTH_LOCAL_ENABLED`, `OIDC_ISSUER`, `OIDC_CLIENT_ID_FRONTEND/BACKEND`, `OIDC_CLIENT_SECRET_BACKEND`, `OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_REDIRECT`, `OIDC_JWKS_CACHE_TTL_MS`, `OIDC_ADMIN_ROLE` con validación: prod requiere redirect URI si OIDC_ISSUER set, y OIDC_ISSUER si AUTH_LOCAL_ENABLED=false.

## Phase 5 — Frontend — login flow [frontend]

- [x] 5.1 [frontend] **Desviación documentada**: en vez de `oidc-client-ts` se implementa PKCE inline en `lib/oidc.ts` con web crypto (~90 LOC). Razón: cero deps nuevas, superficie mínima, mismo flujo Authorization Code + PKCE.
- [x] 5.2 [frontend] `packages/frontend/src/lib/oidc.ts` — `signinRedirect`, `readCallback` (valida state contra sessionStorage), `signoutRedirect`, `isOidcConfigured`
- [x] 5.3 [frontend] `packages/frontend/src/pages/Callback.tsx` — procesa code, llama `handleOidcCallback`, navega a `/projects`
- [x] 5.4 [frontend] `stores/auth.ts` — `loginOidc`, `handleOidcCallback`, `logoutOidc` (back-channel via `POST /auth/oidc/logout` + `signoutRedirect`); `refresh` routea según `authSource` persistido en sessionStorage
- [x] 5.5 [frontend] `LoginPage.tsx` — botón principal "Iniciar sesión con Keycloak"; form local en `<details>` cuando OIDC está activo y `VITE_AUTH_LOCAL_ENABLED=true`
- [x] 5.6 [frontend] Ruta `/callback` en `App.tsx` (sin gate de auth)

## Phase 6 — Frontend — token management [frontend]

- [x] 6.1 [frontend] Access token vive en Zustand (`useAuthStore.accessToken`) y mirror en `lib/api.ts` (modulo-level). Cero localStorage.
- [x] 6.2 [frontend] Auto-refresh schedule en `stores/auth.ts` — decodifica `exp` del JWT y agenda `setTimeout(exp - 30s)`. Cancelado en `logout()`.
- [x] 6.3 [frontend] `lib/api.ts` añade Authorization header, retry on 401 con refresh (`setRefreshHandler` + `_refreshInFlight` para de-dup concurrente). Endpoints de refresh excluidos del retry.

## Phase 7 — Migración híbrida [backend, frontend]

- [x] 7.1 [backend] Flag `AUTH_LOCAL_ENABLED` en config (default `true`)
- [x] 7.2 [backend] `enforceLocalAuthEnabled` middleware devuelve `410 Gone` + `code: LOCAL_AUTH_DISABLED` en `/auth/login`, `/auth/login/*`, `/auth/register`, `/auth/register/*`, `/auth/refresh` cuando `AUTH_LOCAL_ENABLED=false`
- [x] 7.3 [frontend] `components/layout/MigrationBanner.tsx` — visible cuando `authSource='local'` ∧ `user.kc_subject===null` ∧ OIDC configurado. Botón "Vincular ahora" arranca el flujo OIDC. `/auth/me` ahora devuelve `kc_subject` + `email`.
- [x] 7.4 [backend] `POST /admin/auth/link { user_id, kc_subject, email? }` en `admin/routes.ts` — 400 si faltan campos, 404 si user no existe, 409 si el sub ya está linkeado a otro user.

## Phase 8 — Documentación y verificación [infra]

- [x] 8.1 [infra] `AUTH_OIDC.md` — flujo, env vars backend+frontend, configuración KC (realm, clientes, roles), endpoints, troubleshooting, ventana híbrida.
- [x] 8.2 [infra] `PRODUCTION_READINESS.md` actualizado — items de password reset / email verification / lockout marcados como resueltos por 008.
- [x] 8.3 [infra] `README.md` Auth row actualizado (referencia a `AUTH_OIDC.md`).
- [ ] 8.4 [infra] **Manual (requiere KC real)**: end-to-end login → callback → /projects → refresh → logout
- [ ] 8.5 [infra] **Manual (requiere KC real)**: user local con email coincidente → linking automático al primer OIDC login
- [ ] 8.6 [infra] **Manual (requiere KC real)**: KC down → frontend muestra error claro
- [x] 8.7 [infra] `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` green (validado en checkpoint final de cada fase)

## Phase 9 — Cleanup post-migración [backend, frontend] (NO en v1)

> Esta fase se ejecuta cuando `AUTH_LOCAL_ENABLED=false` lleve ≥30 días
> en producción y se confirme que todos los users activos tienen
> `kc_subject` set.

- [ ] 9.1 [backend] Migration `023_drop_local_auth.sql` — drop `password_hash`, `mfa_secret`, tabla `refresh_tokens` (la propia, no la cookie OIDC)
- [ ] 9.2 [backend] Borrar `auth/password-policy.ts`, `password-policy.test.ts`, `refresh-tokens.ts`
- [ ] 9.3 [backend] Borrar `/auth/login`, `/auth/register`, `/auth/confirm-mfa`, `/auth/setup-mfa`
- [ ] 9.4 [backend] Borrar `JWT_SECRET` del config (ya no se firman tokens locales)
- [ ] 9.5 [frontend] Borrar form local de `LoginPage`, página de TOTP setup
- [ ] 9.6 [frontend] Borrar banner de migración
- [ ] 9.7 [infra] Borrar columna `kc_subject` (mantenerla — sigue siendo PK referencia a KC), pero hacerla NOT NULL en migration `024`
