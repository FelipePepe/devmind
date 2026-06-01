# Proposal: 007-production-readiness

## Intent

Close the highest-risk items in `PRODUCTION_READINESS.md` so DevMind can move from local development to a reproducible, safer production deployment.

## Scope

- Production compose/runtime wiring, healthchecks, graceful shutdown.
- Strict startup config validation for production.
- HTTP security baseline: secure headers, strict CORS, secure cookies.
- Refresh token rotation and server-side logout invalidation.
- Worker retry/crash recovery hardening.
- Basic operational docs, backup script, metrics endpoint and minimal tests.

## Out of Scope

- Full hosted TLS certificate automation (documented as reverse-proxy responsibility).
- Full Grafana/Loki stack provisioning.
- Complete E2E Playwright validation (covered by change 005).
