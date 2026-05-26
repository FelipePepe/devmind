# DevMind Operations

## Production start

```bash
cp .env.example .env
# Fill Infisical bootstrap variables and production overrides.
docker compose -f docker-compose.prod.yml up -d --build
```

The backend health endpoint is public for container probes:

```bash
curl http://127.0.0.1:3001/api/health
```

Prometheus metrics are exposed at:

```bash
curl http://127.0.0.1:3001/api/metrics
```

## Required production environment

Set these via Infisical or the deployment environment:

- `JWT_SECRET` — random, >= 32 chars, not a placeholder.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- `DB_PATH=/app/data/devmind.db`.
- `STORAGE_BASE_PATH=/app/storage`.
- `WORKSPACE_ROOT=/app/workspace`.
- `VECTOR_DB_PATH=/app/vectors`.
- `PUBLIC_ORIGIN=https://devmind.casa`.
- `CORS_ALLOWED_ORIGINS=https://devmind.casa`.
- `COOKIE_SECURE=true`.

Terminate TLS in Caddy/nginx/Traefik in front of the frontend/backend and pass `X-Forwarded-*` headers.

## Stop / update

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend workers
```

Backend handles SIGTERM by closing WebSockets, HTTP server and SQLite. Workers stop after the in-flight job.

## Backups

Manual WAL-safe backup:

```bash
scripts/backup-sqlite.sh /path/to/devmind.db ./backups
```

Daily sidecar backup:

```bash
docker compose -f docker-compose.prod.yml --profile backup up -d sqlite-backup
```

Also back up the `devmind-workspace`, `devmind-storage` and `devmind-vectors` volumes. The vector DB is recomputable, but restoring it reduces recovery time.

## Restore drill

1. Stop services: `docker compose -f docker-compose.prod.yml down`.
2. Verify checksum: `sha256sum -c backups/devmind-YYYYMMDDTHHMMSSZ.db.sha256`.
3. Restore DB into the data volume or bind mount as `devmind.db`.
4. Restore workspace/storage volumes from rsync/snapshot backup.
5. Start services and verify `/api/health`.
6. Run a login + project open smoke test.
