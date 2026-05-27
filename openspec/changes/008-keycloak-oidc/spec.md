# Spec: 008-keycloak-oidc

## Overview

Migración de auth propia a delegación OIDC contra Keycloak (realm `casa`).
Ventana de coexistencia híbrida durante la migración; cleanup final
elimina la rama local.

## Configuración (variables de entorno)

| Variable | Valor por defecto | Notas |
|---|---|---|
| `OIDC_ISSUER` | `https://auth.casa/realms/casa` | Endpoint base del realm KC |
| `OIDC_CLIENT_ID_FRONTEND` | `devmind-frontend` | Public client, usado por SPA |
| `OIDC_CLIENT_ID_BACKEND` | `devmind-backend` | Confidential client (opcional) |
| `OIDC_CLIENT_SECRET_BACKEND` | (de Infisical) | Solo si se usa introspection o back-channel logout |
| `OIDC_REDIRECT_URI` | `http://devmind.casa/callback` | Redirect URI registrada en KC |
| `OIDC_POST_LOGOUT_REDIRECT` | `http://devmind.casa/` | Post-logout |
| `OIDC_JWKS_CACHE_TTL_MS` | `3600000` | 1h |
| `AUTH_LOCAL_ENABLED` | `true` durante ventana híbrida, `false` tras cleanup | Flag de runtime |

## Endpoints backend (nuevos)

### `POST /auth/oidc/exchange`

Body: `{ "code": string, "code_verifier": string, "redirect_uri": string }`

1. POST a `OIDC_ISSUER/protocol/openid-connect/token` con `grant_type=authorization_code`.
2. Validar `id_token` (signature, iss, aud, exp).
3. Buscar/crear user (ver D5 en design).
4. Devolver `{ access_token, expires_in, user }`.
5. Set cookie `devmind_refresh` (httpOnly, SameSite=Strict, Secure en prod).

Respuestas:
- `200` éxito.
- `400` si code inválido o redirect_uri mismatch.
- `401` si KC rechaza el code.

### `POST /auth/oidc/refresh`

Cookie: `devmind_refresh`.

1. Leer cookie, POST a KC token endpoint con `grant_type=refresh_token`.
2. Validar nuevo `id_token`.
3. Devolver nuevo `access_token`, set nueva cookie (rotation).

### `POST /auth/oidc/logout`

Cookie: `devmind_refresh`.

1. Revocar refresh token en KC (`POST /protocol/openid-connect/logout` con `client_id` + `refresh_token`).
2. Clear cookie.
3. `204`.

Frontend después redirige a `OIDC_ISSUER/protocol/openid-connect/logout?post_logout_redirect_uri=...&id_token_hint=...`.

## Middleware `requireAuth` (modificado)

```ts
async function requireAuth(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
  const token = auth.slice(7);

  const { payload, iss } = await decodeAndVerify(token);
  if (iss === OIDC_ISSUER) {
    c.set('user', await mapOidcClaims(payload));
  } else if (iss === LOCAL_ISSUER && AUTH_LOCAL_ENABLED) {
    c.set('user', await mapLocalClaims(payload));
  } else {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}
```

`mapOidcClaims` mira `users.kc_subject == payload.sub` y devuelve `{ id, email, username, roles }`.

## Schema BD

### Migration `022_users_kc_subject.sql`

```sql
ALTER TABLE users ADD COLUMN kc_subject TEXT;
CREATE UNIQUE INDEX idx_users_kc_subject ON users(kc_subject) WHERE kc_subject IS NOT NULL;
```

### `users` repo (nuevos métodos)

```ts
findByKcSubject(sub: string): User | null
linkKcSubject(userId: string, sub: string): void
createFromOidc(args: { kc_subject: string; email: string; username: string }): User
```

## Frontend

### `LoginPage.tsx`

```tsx
<button onClick={() => oidcClient.signinRedirect()}>
  Iniciar sesión con Keycloak
</button>
{AUTH_LOCAL_ENABLED && (
  <details>
    <summary>Login local (transitorio)</summary>
    {/* form clásico */}
  </details>
)}
```

### `Callback.tsx` (nueva)

```tsx
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  // validate state matches saved verifier
  api.post('/auth/oidc/exchange', { code, code_verifier, redirect_uri })
    .then(({ access_token, user, expires_in }) => {
      authStore.setSession(access_token, user, expires_in);
      navigate('/projects');
    });
}, []);
```

### `lib/oidc.ts`

Wrapper sobre `oidc-client-ts` que genera PKCE verifier, build authorize URL, persist state en sessionStorage.

## Mappeo de roles KC → devmind

| KC `realm_access.roles` contiene | DevMind role |
|---|---|
| `realm:admin` o `casa-admin` (custom) | `admin` |
| (cualquier authenticated) | `user` |

Solo el role admin gates `/admin/*`. Resto de endpoints requieren `user`.

## Cleanup post-migración (fase final, no en v1)

Cuando `AUTH_LOCAL_ENABLED=false` desde hace ≥30 días:

1. Borrar columnas `password_hash`, `mfa_secret` de `users` (migration `023_drop_local_auth.sql`).
2. Drop tabla `refresh_tokens` (la propia).
3. Borrar `packages/backend/src/auth/password-policy.ts`, `password-policy.test.ts`.
4. Borrar `/auth/login`, `/auth/register`, `/auth/confirm-mfa` del router.
5. Borrar TOTP setup en frontend.
6. Borrar `JWT_SECRET` del config (ya no se firman tokens locales).

## Success Criteria

- [ ] Clients `devmind-frontend` y `devmind-backend` creados en realm `casa`.
- [ ] Migration `022_users_kc_subject.sql` aplicada.
- [ ] `POST /auth/oidc/exchange` recibe code, valida, crea/linkea user, devuelve access_token.
- [ ] `requireAuth` reconoce JWTs emitidos por `OIDC_ISSUER` y por auth local mientras `AUTH_LOCAL_ENABLED=true`.
- [ ] Frontend redirige a KC para login; callback intercambia code; sesión persistente vía cookie refresh.
- [ ] Logout invalida sesión en backend Y en KC.
- [ ] Test unit: validación JWT contra JWKS (mock).
- [ ] Test unit: linking de user existente por email.
- [ ] Test e2e (manual): login completo desde devmind → KC → devmind.
- [ ] `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pasan.
- [ ] `AUTH_OIDC.md` documenta flujo, env vars, troubleshooting.
