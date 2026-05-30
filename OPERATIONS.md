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

Workspace / storage / vectors incremental backup (run from the repo root or as a cron job):

```bash
scripts/backup-workspace.sh /app/workspace /app/storage /app/vectors ./backups/files
```

Each run creates a timestamped directory under `./backups/files/` and prunes directories older than `BACKUP_RETENTION_DAYS` (default: 14). The SQLite WAL-safe backup and this script should run together; suggested cron: daily at 03:00 local time.

## Migration rollback strategy

DevMind applies migrations forward-only. There is no automated rollback.

**Policy**: migrations MUST be written to be safe to apply to the existing data (additive changes, nullable new columns, etc.). Destructive changes (drop column/table) must be preceded by a deprecation period where the code no longer writes to that column.

**If a migration fails partway**:
1. Stop services: `docker compose -f docker-compose.prod.yml down`
2. Restore DB from the last good backup (see Restore drill below).
3. Fix the migration SQL.
4. Restart services — the runner re-applies missing migrations in order.

Never edit already-applied migration files. Add a new corrective migration instead.

## Nginx reverse-proxy config

DevMind backend (port 3001) and frontend (port 5173 dev / Nginx static prod) should sit behind a TLS-terminating proxy. Minimal nginx snippet for `devmind.casa`:

```nginx
server {
    listen 443 ssl;
    server_name devmind.casa;

    ssl_certificate     /etc/ssl/certs/devmind.casa.crt;
    ssl_certificate_key /etc/ssl/private/devmind.casa.key;

    # Frontend (served by the frontend container on port 80)
    location / {
        proxy_pass         http://devmind-frontend:80;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Backend API + auth
    location ~ ^/(api|auth|admin)/ {
        proxy_pass         http://devmind-backend:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # SSE: disable buffering so token stream reaches the client immediately
        proxy_buffering    off;
        proxy_read_timeout 300s;
    }

    # WebSocket
    location /ws {
        proxy_pass         http://devmind-backend:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 86400s;
    }
}

server {
    listen 80;
    server_name devmind.casa;
    return 301 https://$host$request_uri;
}
```

Set `PUBLIC_ORIGIN=https://devmind.casa` and `CORS_ALLOWED_ORIGINS=https://devmind.casa` in the production env.

## Restore drill

1. Stop services: `docker compose -f docker-compose.prod.yml down`.
2. Verify checksum: `sha256sum -c backups/devmind-YYYYMMDDTHHMMSSZ.db.sha256`.
3. Restore DB into the data volume or bind mount as `devmind.db`.
4. Restore workspace/storage volumes from rsync/snapshot backup.
5. Start services and verify `/api/health`.
6. Run a login + project open smoke test.

## Observability

Start the Prometheus + Loki + Promtail + Grafana stack alongside the app:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.observability.yml up -d
```

Set `GRAFANA_ADMIN_PASSWORD` in `.env` before starting (default `admin` is insecure).
Optionally set `GRAFANA_ALERT_WEBHOOK` to receive alert notifications; leave unset for silent alerts.

**Grafana:** `http://<host>:3000` — login with `admin` / `$GRAFANA_ADMIN_PASSWORD`.

The **DevMind Overview** dashboard loads automatically (provisioned from `observability/grafana/provisioning/`).
It covers: uptime, DB size, HTTP rates, agent loop duration, tool calls, job queue, Ollama health, and live logs.

**Alert rules** (5 active):
- `BackendDown` — backend absent from Prometheus for 2 min (critical)
- `WorkersStalled` — pending queue growing with no loop completions for 5 min (warning)
- `QueueDepthHigh` — pending jobs > 50 for 2 min (warning)
- `OllamaUnreachable` — Ollama health latency = -1 for 3 min (warning)
- `DbSizeCritical` — SQLite file > 1 GB for 5 min (warning)

To silence an alert: Grafana → Alerting → Alert rules → Silence.
To update the webhook: set `GRAFANA_ALERT_WEBHOOK` and redeploy Grafana.
