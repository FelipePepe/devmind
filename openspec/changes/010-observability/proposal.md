# Proposal: 010-observability

## Intent

Add production-grade observability to DevMind so operators can monitor system
health, detect failures, and investigate incidents without needing to SSH into
the host.

## Problem

The current `/api/metrics` endpoint exposes only uptime and HTTP request
counts. There are no metrics for the job queue, agent loop, or Ollama health.
There is no alerting — failures are only noticed when a user reports them.
Application logs exist (pino → stdout) but are not collected or queryable.

## Scope

- **Extend `MetricsRegistry`** with job queue depth, tool call safety counts,
  agent loop duration histogram, blob store blob count, Ollama latency gauge.
- **Prometheus scraping** in docker-compose (Prometheus service, scrape config).
- **Loki + Promtail** for log collection from container stdout.
- **Grafana** with one dashboard covering all key metrics + logs.
- **Five minimal alerts** wired via Grafana alerting:
  1. Backend unreachable (uptime flatlines)
  2. Workers stalled (queue depth grows, no completions)
  3. Job queue depth > 50
  4. Ollama latency > 10s or unreachable
  5. SQLite DB file > 1 GB
- Update `PRODUCTION_READINESS.md` and `OPERATIONS.md` with observability ops.

## Out of Scope

- OpenTelemetry distributed traces (deferred — no multi-service spans yet).
- Per-user or per-project metrics.
- PagerDuty/OpsGenie integration (alert channel = Grafana notification, email or webhook).
- Dashboards for Keycloak or Infisical (external services).
