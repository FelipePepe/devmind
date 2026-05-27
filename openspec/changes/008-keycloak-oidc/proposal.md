# Proposal: 008-keycloak-oidc

## Intent

Migrar la auth propia de DevMind (password + TOTP + JWT firmados con
`JWT_SECRET`) a delegación OIDC contra Keycloak (`https://auth.casa`,
realm `casa`). El IdP se gestiona fuera del repo y servirá también a otras
apps de la intranet `.casa`. DevMind deja de emitir tokens y se limita a
**validar** los emitidos por Keycloak.

La transición es **híbrida transitoria**: el sistema acepta simultáneamente
auth local y OIDC durante una ventana. Cada usuario existente queda
"linkeado" a su cuenta KC la primera vez que entra por el nuevo flujo. Una
vez todos hayan migrado se elimina la rama de auth local.

## Scope

### In Scope

- Cliente OIDC en Keycloak (realm `casa`) para frontend (`devmind-frontend`,
  public + PKCE) y backend (`devmind-backend`, confidential, opcional para
  introspection).
- Backend (`packages/backend/src/auth/`):
  - Validación de JWT contra JWKS de KC (`iss`, `aud`, expiry, signature).
  - Middleware `requireAuth` reconoce tokens KC además de los actuales.
  - Endpoint `/auth/oidc/callback` que recibe el authorization code,
    intercambia por tokens contra KC y linkea/crea el user local.
  - Endpoint `/auth/oidc/logout` que invalida sesión local + redirige a KC
    end_session.
  - Repo `users` extendido con `kc_subject` (UUID del subject KC).
- Frontend (`packages/frontend/src/`):
  - Reemplazar `LoginPage` con redirect a KC (Authorization Code + PKCE).
  - Nueva ruta `/callback` que intercambia el code y guarda el access
    token en memoria + refresh transparente.
  - Logout que llama a backend + redirige a KC end_session.
- Documentación: nuevo `AUTH_OIDC.md` describiendo flujo, redirect URIs,
  cómo crear un user nuevo.
- Migración: tabla `oidc_links` opcional para histórico de linkings, o
  simplemente columna `kc_subject` en `users`.

### Out of Scope

- Migración masiva via API admin de KC (no se exporta la BD).
- SSO con otras apps de la intranet (se materializa cuando otras apps se
  integren al mismo realm).
- Multi-realm o per-project realms — v1 usa realm único `casa`.
- Adapt of admin endpoints — `/admin/*` sigue gated por el guard actual,
  solo cambia el reconocimiento del token.
- Eliminar TOTP local. El TOTP MFA queda en KC (configurable por user en
  `auth.casa`). El campo `mfa_secret` en la tabla `users` se mantiene
  durante la ventana híbrida y se elimina con la limpieza final.

## Problem Statement

1. **Auth duplicada por app.** Cada app de la intranet `.casa` que se
   construya re-implementaría password+JWT desde cero. Es trabajo
   duplicado y cada uno con bugs diferentes.
2. **Política de password local frágil.** El servidor implementa su propia
   policy en `password-policy.ts`. KC tiene políticas configurables por
   realm, password reset, lockout tras N intentos, etc., todo de fábrica.
3. **Refresh token rotation hecho a mano.** Tabla `refresh_tokens` propia
   (migración 020). KC ya gestiona rotación, blacklist por logout, ttl
   configurable. Eliminar la propia reduce superficie de bugs.
4. **No hay SSO.** Cualquier usuario tiene que loguearse en cada app
   separada. Con KC, un único login sirve para todas las apps que
   compartan realm.
5. **Sin federación.** El día que se quiera integrar Google/GitHub OAuth o
   un IdP corporativo, KC lo soporta nativamente (Identity Providers).

## Proposed Direction

### Flujo de login (Authorization Code + PKCE)

```text
[Browser]  → click "Iniciar sesión"
           → window.location = https://auth.casa/realms/casa/protocol/openid-connect/auth?
               client_id=devmind-frontend
               response_type=code
               scope=openid profile email
               redirect_uri=http://devmind.casa/callback
               code_challenge=<sha256(verifier)>
               code_challenge_method=S256
               state=<random>

[Keycloak] → muestra login page (o redirect si ya hay sesión)
           → tras éxito, redirect a http://devmind.casa/callback?code=<code>&state=<state>

[Frontend] /callback
           → POST /auth/oidc/exchange { code, code_verifier }

[Backend]  → POST https://auth.casa/realms/casa/protocol/openid-connect/token
               grant_type=authorization_code
               client_id=devmind-frontend
               code=...
               code_verifier=...
               redirect_uri=http://devmind.casa/callback
           → recibe { access_token, refresh_token, id_token }
           → valida id_token (signature contra JWKS, iss, aud, exp)
           → busca user por kc_subject=id_token.sub
             - si existe: ok, login
             - si no existe: crea o linkea (matching por email si user local existe)
           → devuelve al frontend: { access_token, expires_in, user }
           NOTA: refresh_token se queda en backend (httpOnly cookie) o se devuelve también si el flow es "public"

[Frontend] guarda access_token en memoria (no localStorage), inicia refresh schedule
```

### Validación de tokens en backend

```text
1. Authorization: Bearer <jwt>
2. Decode header, lookup JWKS de KC (cached con TTL ~1h)
3. Verify signature, exp, iss == 'https://auth.casa/realms/casa', aud contains 'devmind-frontend' or 'devmind-backend'
4. Extract sub, email, preferred_username, realm_access.roles
5. Lookup users.kc_subject = sub → user local
6. Attach to request context: ctx.user = { id, email, roles }
```

### Migración híbrida

Durante la ventana híbrida (~30 días):

- `/auth/login` (password local) **sigue funcionando** y devuelve JWT
  local firmado con `JWT_SECRET`. Bandera `auth.local_enabled = true`.
- `/auth/oidc/*` funciona en paralelo.
- `requireAuth` reconoce ambos tipos de token (mira el `iss` claim).
- Cuando un user existente entra por OIDC y su email matchea uno local,
  se linkea: `UPDATE users SET kc_subject = ? WHERE email = ?`.
- Banner en frontend invitando a migrar.

Al final de la ventana:

- Flag `auth.local_enabled = false` → bloquea `/auth/login`.
- Limpieza: eliminar `password_hash`, `mfa_secret`, tabla
  `refresh_tokens`, `password-policy.ts`, código de TOTP, `/auth/register`
  (se registra en KC), endpoint `/auth/login`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| Keycloak realm `casa` | Out-of-repo | Crear clients `devmind-frontend` y `devmind-backend`, configurar redirect URIs, scopes, mappers |
| `packages/backend/src/auth/` | High | Nuevo `oidc/` con discovery, JWKS cache, callback, exchange. Modificar `middleware.ts` para multi-issuer |
| `packages/backend/src/db/migrations/` | Low | `022_users_kc_subject.sql` añade columna `kc_subject TEXT UNIQUE` |
| `packages/backend/src/db/repos/users.ts` | Low | Métodos `findByKcSubject`, `linkKcSubject`, `createFromOidc` |
| `packages/backend/src/index.ts` | Low | Wire OIDC routes |
| `packages/frontend/src/pages/LoginPage.tsx` | High | Reemplazar form por botón "Login con Keycloak" |
| `packages/frontend/src/pages/Callback.tsx` | New | Handle authorization code |
| `packages/frontend/src/stores/auth.ts` | Medium | Métodos `loginOidc`, `handleCallback`, `logout` redirect a KC |
| `packages/frontend/src/lib/oidc.ts` | New | Wrapper sobre `oidc-client-ts` |
| `.env.example` + `config.ts` | Low | `OIDC_ISSUER`, `OIDC_CLIENT_ID_BACKEND`, `OIDC_CLIENT_SECRET_BACKEND`, `OIDC_REDIRECT_URI` |
| `AUTH_OIDC.md` | New | Documentación |
| `PRODUCTION_READINESS.md` | Low | Marcar items relevantes como ✅ |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Keycloak down rompe login en todas las apps | Medium | Documentar restore procedure; durante la ventana híbrida, local auth sigue activa como fallback |
| JWKS cache stale → tokens válidos rechazados tras key rotation | Low | TTL 1h + refetch on signature failure |
| User existente con email distinto en KC y local → no linkea | Medium | Endpoint admin `POST /admin/auth/link { user_id, kc_subject }` para resolver casos manualmente |
| Redirect URI mismatch (http vs https, dominio) bloquea login | High | Documentar redirect URIs en la spec; configurar `http://devmind.casa/callback` y `http://localhost:5173/callback` para dev |
| TOTP local se pierde al migrar a KC | Medium | KC pide nueva configuración de TOTP la primera vez; documentar en banner de migración |
| `oidc-client-ts` cambia API entre versiones | Low | Pin minor en package.json |
| Long-running agent sessions con access_token expirado | Medium | Refresh transparente en frontend + backend valida en cada request |

## Rollback Plan

Aditivo durante la ventana híbrida:

- Si OIDC tiene un bug grave en producción, `auth.local_enabled = true` y
  todos los users vuelven a auth local sin cambios.
- Si después de eliminar auth local hace falta volver atrás: restaurar la
  migración 022 borrando la columna `kc_subject` y los archivos OIDC del
  backend/frontend. `password_hash` y `mfa_secret` SE PIERDEN si ya se
  ejecutó la limpieza — backup obligatorio antes del cleanup.

## Success Criteria

- [ ] Cliente OIDC `devmind-frontend` (public + PKCE) y `devmind-backend` (confidential) creados en realm `casa` con redirect URIs documentadas.
- [ ] Backend valida JWT emitidos por KC (`iss/aud/exp/signature` contra JWKS).
- [ ] Frontend redirecciona a KC para login y maneja el callback.
- [ ] Usuario local existente con mismo email se linkea automáticamente al primer login OIDC.
- [ ] `/auth/login` (local) sigue funcionando durante la ventana híbrida.
- [ ] Logout limpia sesión local y termina sesión en KC.
- [ ] `requireAuth` middleware acepta tokens de ambos orígenes durante la ventana.
- [ ] `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pasan.
- [ ] `AUTH_OIDC.md` documenta el flujo y los redirect URIs.
