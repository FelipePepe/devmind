# Security Policy

DevMind is intended for the private `.casa` intranet unless explicitly hardened for public exposure.

## Baseline controls

- TLS must terminate at the reverse proxy.
- `CORS_ALLOWED_ORIGINS` must list explicit production origins.
- Refresh cookies are `HttpOnly`, `SameSite=Strict`, and secure in production.
- Refresh tokens are rotated and stored server-side as SHA-256 hashes.
- Security headers are emitted by the backend.
- Destructive agent tools can be blocked with `tools.autonomy_level=block-destructive`.

## Reporting

Report vulnerabilities privately to the repository owner. Do not open public issues with exploit details for auth, token, tool-execution or data-exfiltration bugs.
