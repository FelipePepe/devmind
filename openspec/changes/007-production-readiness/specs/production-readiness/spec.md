# production-readiness Spec

## Requirements

### Requirement: Production runtime safety
DevMind SHALL provide a production compose file using built images, persistent volumes, service healthchecks, and restart policies.

#### Scenario: Backend healthcheck
- **WHEN** the backend container starts
- **THEN** Docker can check `/api/health` and mark it healthy only when SQLite is reachable.

### Requirement: Strict production configuration
The backend SHALL fail startup in production when critical secrets or paths use insecure defaults.

#### Scenario: Missing production secret
- **WHEN** `NODE_ENV=production` and `JWT_SECRET` is missing, short, or a known placeholder
- **THEN** startup fails before binding the HTTP port.

### Requirement: HTTP security baseline
The backend SHALL emit security headers, restrict CORS to configured origins, and use secure refresh cookies in production.

### Requirement: Refresh-token rotation
The auth flow SHALL store refresh tokens server-side as hashes, revoke refresh tokens on use, and reject reuse or logged-out tokens.

### Requirement: Operational baseline
DevMind SHALL expose minimal Prometheus metrics, provide backup/restore instructions, and include at least one automated test command in CI.
