# Runtime and sandbox policy — spec 003

## V1 decisions

- Generated frontend target: static JS first. React/Vite may be generated later, but v1 keeps static preview compatible.
- Generated backend target: Hono + Node only.
- Generated database target: SQLite only.
- Preview strategy: static preview fallback first, service preview second.

## Runtime cleanup policy

- Runtime metadata is stored in `project_runtime_instances`.
- A runtime can be `pending`, `building`, `ready`, `failed`, `stale`, or `stopped`.
- Generation marks runtime `stale` before rebuilding static/runtime state.
- Restore marks preview/runtime stale by setting preview `building` and enqueueing `rebuildPreview`.
- Future service processes must be tied to a project runtime instance and stopped before a new runtime is started.

## Command policy

- Generated project validation may run manifest commands only when their first token is allowlisted.
- Default allowlist: `node,npm,pnpm,tsc,vitest`.
- Logs are truncated before persistence.
- Generated services are materialized under `WORKSPACE_ROOT/generated-projects/:projectId` and path containment is enforced.

## Future sandbox boundary

- Full service preview should run in a container or equivalent process sandbox before arbitrary generated commands are allowed.
- Until that boundary exists, runtime execution must remain opt-in and allowlisted.
