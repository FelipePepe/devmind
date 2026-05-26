# Authentication — Keycloak OIDC

DevMind delegates authentication to Keycloak (realm `casa`, `https://auth.casa`).
Spec: `openspec/changes/008-keycloak-oidc/`.

## Flow (Authorization Code + PKCE)

```
Browser              Frontend (SPA)         Backend (Hono)        Keycloak
   │                       │                      │                  │
   │  click "Iniciar      │                      │                  │
   │   sesión con KC"      │                      │                  │
   ├──────────────────────►│  signinRedirect()    │                  │
   │                       ├──── 302 ──────────────────────────────►│
   │                                                                 │
   │  user authenticates at https://auth.casa                        │
   │                                                                 │
   │                       │                      │                  │
   │◄─── 302 /callback?code=…&state=… ─────────────────────────────  │
   │                       │                      │                  │
   ├──────────────────────►│ POST /auth/oidc/exchange                │
   │                       │  { code, code_verifier, redirect_uri }  │
   │                       ├─────────────────────►│                  │
   │                       │                      ├─ POST /token ───►│
   │                       │                      │◄── tokens ───────│
   │                       │                      │ verify id_token  │
   │                       │                      │ link/create user │
   │                       │                      │ set httpOnly     │
   │                       │                      │  refresh cookie  │
   │                       │◄─ { access_token, expires_in, user }    │
   │                       │ schedule auto-refresh                   │
```

## Environment variables

### Backend (`packages/backend`)

| Var | Default | Notes |
|---|---|---|
| `AUTH_LOCAL_ENABLED` | `true` | Set to `false` after the hybrid window to disable `/auth/login`, `/auth/register`, `/auth/refresh` (returns `410 Gone`). |
| `OIDC_ISSUER` | empty | e.g. `https://auth.casa/realms/casa`. Empty disables OIDC. |
| `OIDC_CLIENT_ID_FRONTEND` | `devmind-frontend` | Public client + PKCE. |
| `OIDC_CLIENT_ID_BACKEND` | `devmind-backend` | Confidential client (introspection/backchannel logout, optional). |
| `OIDC_CLIENT_SECRET_BACKEND` | empty | Only required if using the backend client. |
| `OIDC_REDIRECT_URI` | empty | Must match a Valid Redirect URI registered in KC. |
| `OIDC_POST_LOGOUT_REDIRECT` | empty | Where Keycloak sends users after end-session. |
| `OIDC_JWKS_CACHE_TTL_MS` | `3600000` | 1h cache; on signature failure the cache is reset and refetched once. |
| `OIDC_ADMIN_ROLE` | `admin` | Realm role name that grants admin in DevMind. Combined with the local `users.is_admin` column (either is enough). |

Strict validation rules in `config.ts`:

- If `OIDC_ISSUER` is set, `OIDC_REDIRECT_URI` is required.
- If `AUTH_LOCAL_ENABLED=false`, `OIDC_ISSUER` is required.

### Frontend (`packages/frontend`)

Build-time Vite vars (`.env`, `.env.production`, etc.):

| Var | Default | Notes |
|---|---|---|
| `VITE_AUTH_LOCAL_ENABLED` | `true` | When `false`, the local login form disappears from `LoginPage`. |
| `VITE_OIDC_ISSUER` | empty | When empty, the "Iniciar sesión con Keycloak" button is hidden. |
| `VITE_OIDC_CLIENT_ID` | `devmind-frontend` | Must match the backend's client ID. |
| `VITE_OIDC_REDIRECT_URI` | `${origin}/callback` | Must match the redirect URI registered in KC. |
| `VITE_OIDC_POST_LOGOUT_REDIRECT` | `${origin}` | Optional. |

## Keycloak setup

### Realm `casa`

Already provisioned at `https://auth.casa`. Display name `Casa Intranet`. Default
signature algorithm RS256.

### Client `devmind-frontend` (public + PKCE)

| Setting | Value |
|---|---|
| Client ID | `devmind-frontend` |
| Client authentication | OFF (public client) |
| Standard flow | ON |
| Implicit flow | OFF |
| Direct access grants | OFF |
| Service account | OFF |
| Valid redirect URIs | `http://devmind.casa/callback`, `http://localhost:5173/callback` |
| Valid post logout redirect URIs | `http://devmind.casa/`, `http://localhost:5173/` |
| Web origins | `http://devmind.casa`, `http://localhost:5173` |
| Proof Key for Code Exchange | `S256` |

### Client `devmind-backend` (confidential, optional)

Only required if you want to use backend introspection or backchannel logout
(currently the backend only exchanges code at the token endpoint, no need for
the confidential client). If you do create it:

| Setting | Value |
|---|---|
| Client ID | `devmind-backend` |
| Client authentication | ON |
| Service account | ON |
| Standard/Implicit/Direct flows | OFF |

### Roles

Create realm role `admin` in realm `casa`. Users with this role become admin in
DevMind. Per-user admin via `users.is_admin=1` also works.

## Backend endpoints

| Endpoint | Description |
|---|---|
| `POST /auth/oidc/exchange` | Body `{code, code_verifier, redirect_uri}`. Server-to-server exchange with KC, returns `{access_token, expires_in, user}` and sets `oidc_refresh_token` cookie (httpOnly + SameSite=Strict + Secure in production). |
| `POST /auth/oidc/refresh` | Reads cookie, rotates refresh token with KC, returns new `access_token`. |
| `POST /auth/oidc/logout` | Clears cookie, backchannel logout to KC. Frontend then redirects to KC end-session. |
| `POST /admin/auth/link` | Admin-only. Body `{user_id, kc_subject, email?}`. Resolves cases where email-based auto-linking did not work. |

`requireAuth` reads the JWT's `iss` claim:

- `iss === OIDC_ISSUER` → verifies against JWKS, looks up `users.kc_subject`, returns 401 if no linked user (must run `/exchange` first).
- Other → verifies as a local HS256 JWT, only if `AUTH_LOCAL_ENABLED=true`.

## User linking

When a user logs in via OIDC for the first time, the backend follows this
resolution order:

1. `users.findByKcSubject(sub)` → if found, login.
2. `users.findByEmail(id_token.email)` → if found, link (`linkKcSubject`).
3. Otherwise create a new user with `createFromOidc` (sentinel password hash, no
   local login possible, `totp_confirmed=1` because KC owns the second factor).

Failed cases: an OIDC identity and a local account share the same person but
different emails. Use `POST /admin/auth/link`.

## Migration window

During the hybrid window (recommended ≥30 days):

- `AUTH_LOCAL_ENABLED=true` keeps `/auth/login` etc. alive.
- Frontend renders a banner inviting any local-only user (`authSource=local && !user.kc_subject`) to link their account by clicking through the Keycloak flow.
- New users can be added either by registering locally or by self-registering in KC.

At cleanup time (spec Phase 9, **not** part of v1):

- `AUTH_LOCAL_ENABLED=false` returns `410 Gone` from local endpoints.
- Schema migration `023_drop_local_auth.sql` (TBD) drops `password_hash`, `mfa_secret`, `totp_secret`, `refresh_tokens`.
- Source files removed: `auth/password.ts`, `auth/password-policy.ts`, `auth/totp.ts`, `auth/jwt.ts`, `db/repos/refresh-tokens.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` with `code=NO_LINKED_USER` | Token is a valid KC JWT but no `users` row has matching `kc_subject` | Run the exchange flow once (`POST /auth/oidc/exchange`) or `/admin/auth/link` manually. |
| KC returns `invalid_redirect_uri` | `OIDC_REDIRECT_URI` does not match a registered URI in the client | Edit the client in KC admin or change the env var. Both `http://devmind.casa/callback` and `http://localhost:5173/callback` must be present for dev/prod parity. |
| `403 Forbidden` on `/admin/*` after OIDC login | Local `is_admin=0` and `realm_access.roles` lacks `OIDC_ADMIN_ROLE` | Assign the `admin` realm role in KC or `UPDATE users SET is_admin=1 WHERE id=…`. |
| Browser console: `OIDC state mismatch` | The `sessionStorage` entry was cleared between redirects (incognito, tab restore) | Re-launch the flow from `/login`. |
| Refresh always returns 401 | `oidc_refresh_token` cookie missing (Secure flag mismatch in dev?) | In dev set `COOKIE_SECURE=false` so the cookie travels over HTTP. |
| Hot-reload kills the session | Vite restart loses the in-memory `accessToken` | The frontend auto-refreshes via the cookie on boot; if the refresh cookie is intact, the session restores. |

## Pending (not in v1)

- Phase 0: confirm domain (`devmind.casa`), hybrid-window duration, role mapping.
- Phase 1: clients in KC (this doc lists the intended config; real setup is out-of-repo infra).
- Phase 8.4-8.6: end-to-end manual verification once KC clients exist.
- Phase 9: cleanup migration (drop local auth).
