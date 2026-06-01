# Design: 008-keycloak-oidc

## Arquitectura

```
┌──────────────┐     1. /login click      ┌────────────────────────┐
│              │ ───────────────────────► │                        │
│   Browser    │ ◄─── 2. redirect ─────── │   devmind frontend     │
│  (devmind    │                          │  (Vite + React, 5173)  │
│   .casa)     │                          │                        │
└──────────────┘                          └────────────────────────┘
       │                                              ▲
       │  3. authorization_code flow                  │  6. POST /auth/oidc/exchange
       │     redirect a auth.casa                     │     { code, verifier }
       ▼                                              │
┌──────────────────────────────────────────┐          │
│  Keycloak realm "casa"                   │          │
│  https://auth.casa                       │          │
│  - client: devmind-frontend (public+PKCE)│          │
│  - client: devmind-backend (confidential)│          │
└────────────┬─────────────────────────────┘          │
             │                                        │
             │ 4. user login                          │
             ▼                                        │
        ┌────────┐                                    │
        │ Login  │   5. redirect callback con code    │
        │  UI    │ ───────────────────────────────────┘
        └────────┘
                                              7. POST /token (server-to-server)
                                                 a Keycloak
                                              8. valida id_token con JWKS
                                              9. busca/crea user local
┌──────────────────────────────────────┐          ▲
│  devmind backend (Hono, 3001)        │ ◄────────┘
│  - /auth/oidc/exchange               │
│  - /auth/oidc/logout                 │
│  - /api/* (Bearer JWT validation)    │
└──────────────────────────────────────┘
             │
             ▼
        ┌────────┐
        │SQLite  │ users.kc_subject indexes
        └────────┘
```

## Decisiones técnicas

### D1: PKCE en frontend, no client_secret

Frontend es SPA pública → el client `devmind-frontend` es `publicClient=true`
con `pkce.s256` obligatorio. El client `devmind-backend` (confidential) se
usa solo si necesitamos introspection o server-initiated logout — no es
crítico para el flujo principal.

### D2: Token en memoria, refresh en backend cookie httpOnly

- `access_token` (corta vida ~5min) vive en memoria del frontend (store
  Zustand). Se pierde al recargar → backend lo refresca.
- `refresh_token` (vida ~30min) en cookie httpOnly + SameSite=Strict
  emitida por el backend tras `/auth/oidc/exchange`. El frontend nunca
  lo ve. Sigue el patrón actual de refresh tokens (migración 020).
- Si recargo página: frontend hace `POST /auth/refresh` con la cookie →
  backend pide nuevo access_token a KC → devuelve al frontend.

### D3: Validación local con JWKS, no introspection

Validar cada request contra KC vía introspection es caro (1 round-trip
por request). En su lugar:
1. Descargar JWKS al boot (`GET /realms/casa/protocol/openid-connect/certs`).
2. Cache con TTL 1h.
3. Validar signature, `iss`, `aud`, `exp` localmente con `jose`.
4. Si signature falla → refetch JWKS y reintentar (key rotation).

Coste: ~0.5ms por request, no requiere red.

### D4: Multi-issuer guard durante ventana híbrida

`requireAuth` lee el JWT y mira `iss`:
- Si `iss == 'http://localhost:3001/devmind'` (o lo que use auth local) → valida con `JWT_SECRET`.
- Si `iss == 'https://auth.casa/realms/casa'` → valida con JWKS.
- Else → 401.

Los dos paths actualizan `ctx.user` con el mismo shape.

### D5: Migración por email matching

Cuando un user entra por OIDC:

```ts
const sub = id_token.sub;
const email = id_token.email;

let user = usersRepo.findByKcSubject(sub);
if (user) {
  // already linked
  return user;
}

const localUser = usersRepo.findByEmail(email);
if (localUser) {
  // link
  usersRepo.linkKcSubject(localUser.id, sub);
  return localUser;
}

// create new
return usersRepo.createFromOidc({ kc_subject: sub, email, username: id_token.preferred_username });
```

Edge case: email collision (un user local y un user KC tienen el mismo
email pero son personas distintas). Riesgo bajo en intranet. Si pasa,
admin lo resuelve a mano via endpoint dedicado.

### D6: TOTP gestionado por KC, no DevMind

Tras la migración:
- KC pide TOTP setup al primer login (en `auth.casa`, no en devmind).
- Devmind quita su flujo `/auth/confirm-mfa`.
- Campo `mfa_secret` queda durante la ventana híbrida (por si user vuelve
  a auth local), se borra en cleanup.

### D7: Roles vía realm_access.roles del id_token

KC emite `id_token` con claim `realm_access.roles: ["admin", "user", ...]`.
Backend extrae y normaliza a `ctx.user.roles`. Admin endpoints comprueban
`ctx.user.roles.includes('admin')`.

Mapeo inicial:
- Role `realm:admin` en KC → `admin` en devmind.
- Default authenticated user (sin role especial) → `user` en devmind.

### D8: Logout

```
1. Frontend → POST /auth/oidc/logout
2. Backend → invalida refresh_token local (revoke)
            → opcional: POST /realms/casa/protocol/openid-connect/logout
              (back-channel logout, requiere client_id + refresh_token)
3. Backend → 204
4. Frontend → window.location = https://auth.casa/realms/casa/protocol/openid-connect/logout?
              post_logout_redirect_uri=http://devmind.casa
```

## Alternativas consideradas

### A1: Mantener auth local, añadir Keycloak como Identity Provider externo en KC

Esto sería al revés: devmind sigue siendo IdP, KC sirve como aggregator
para otros. Descartado porque (a) no resuelve el problema de duplicación
en otras apps, (b) KC tiene mejor UX que cualquier login propio.

### A2: Backend monta su propio JWKS endpoint (sigue firmando JWTs)

Es decir, KC emite id_token, devmind backend lo intercambia por SU PROPIO
JWT que firma con su clave. Más complejidad sin valor: el frontend tendría
que tratar con dos formatos. Descartado.

### A3: Eliminar auth local de golpe (cut-over)

Sin ventana híbrida. Más simple de código, peor UX: los users no pueden
migrar a su ritmo. Si KC tiene un bug, no hay fallback. Descartado.

### A4: Sub-MCP de Keycloak en mcp-gateway

Que Claude pueda gestionar realms/clients/users via MCP. Descartado por el
usuario (no hay MCP oficial robusto de Keycloak).

## Configuración Keycloak

### Realm `casa`

| Setting | Valor |
|---|---|
| Display name | Casa Intranet |
| Frontend URL | `https://auth.casa` |
| Default signature algorithm | RS256 |
| SSL required | external requests (intranet OK por http internamente) |

### Client `devmind-frontend`

| Setting | Valor |
|---|---|
| Client type | OpenID Connect |
| Client ID | devmind-frontend |
| Client authentication | OFF (publicClient) |
| Authorization | OFF |
| Standard flow | ON (authorization code) |
| Direct access grants | OFF |
| Implicit flow | OFF |
| Service account | OFF |
| Valid redirect URIs | `http://devmind.casa/callback`, `http://localhost:5173/callback` |
| Valid post logout redirect URIs | `http://devmind.casa/`, `http://localhost:5173/` |
| Web origins | `http://devmind.casa`, `http://localhost:5173` |
| Proof Key for Code Exchange | `S256` |

### Client `devmind-backend` (confidential, opcional)

| Setting | Valor |
|---|---|
| Client type | OpenID Connect |
| Client ID | devmind-backend |
| Client authentication | ON (confidential) |
| Authorization | OFF |
| Standard flow | OFF |
| Direct access grants | OFF |
| Service account | ON (para introspection si hace falta) |

### Scopes

Default optional scopes para `devmind-frontend`:
- `openid` (siempre)
- `profile` (preferred_username, name)
- `email`

### Mappers

- `realm-roles` mapper en client scopes para incluir `realm_access.roles` en id_token.

## Esquema BD

### Migración `022_users_kc_subject.sql`

```sql
ALTER TABLE users ADD COLUMN kc_subject TEXT;
CREATE UNIQUE INDEX idx_users_kc_subject ON users(kc_subject) WHERE kc_subject IS NOT NULL;
```

NULL allowed → durante la ventana híbrida, users que no han migrado lo
tienen vacío. Tras cleanup, se hace NOT NULL.
