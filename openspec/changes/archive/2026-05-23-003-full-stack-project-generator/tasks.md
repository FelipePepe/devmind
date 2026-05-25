# Tasks: 003 — Full-Stack Project Generator

## Phase 0 — SDD Baseline [infra]

- [x] 0.1 [infra] Approve `003-full-stack-project-generator` proposal, design, and spec
- [x] 0.2 [infra] Confirm whether generated full-stack apps target static JS, React/Vite, or both for v1
- [x] 0.3 [infra] Confirm v1 backend target: Hono + Node only
- [x] 0.4 [infra] Confirm v1 database target: SQLite only
- [x] 0.5 [infra] Define v1 runtime policy: static preview fallback first, service preview second

## Phase 1 — Domain Schema [backend]

- [x] 1.1 [backend] Add migration `012_project_manifests.sql`
- [x] 1.2 [backend] Add migration `013_project_services.sql`
- [x] 1.3 [backend] Add migration `014_project_api_routes.sql`
- [x] 1.4 [backend] Add migration `015_project_database.sql`
- [x] 1.5 [backend] Add migration `016_project_env_validation_runtime.sql`
- [x] 1.6 [backend] Add migration `017_project_snapshots.sql`
- [x] 1.7 [backend] Ensure all migrations are additive and preserve existing builder behavior

## Phase 2 — Repositories and Types [backend]

- [x] 2.1 [backend] Add `ProjectManifestsRepo`
- [x] 2.2 [backend] Add `ProjectServicesRepo`
- [x] 2.3 [backend] Add `ProjectApiRoutesRepo`
- [x] 2.4 [backend] Add `ProjectDbSchemasRepo`
- [x] 2.5 [backend] Add `ProjectDbMigrationsRepo`
- [x] 2.6 [backend] Add `ProjectEnvVarsRepo`
- [x] 2.7 [backend] Add `ProjectValidationReportsRepo`
- [x] 2.8 [backend] Add `ProjectRuntimeInstancesRepo`
- [x] 2.9 [backend] Add `ProjectSnapshotsRepo`
- [x] 2.10 [backend] Add shared Zod schemas for manifest, service, API route, DB schema, env var, validation report

## Phase 3 — Builder APIs [backend]

- [x] 3.1 [backend] Add manifest CRUD routes under `/api/projects/:id/manifest`
- [x] 3.2 [backend] Add service CRUD routes under `/api/projects/:id/services`
- [x] 3.3 [backend] Add API route CRUD routes under `/api/projects/:id/api-routes`
- [x] 3.4 [backend] Add database schema routes under `/api/projects/:id/database`
- [x] 3.5 [backend] Add env var routes under `/api/projects/:id/env`
- [x] 3.6 [backend] Add validation report routes under `/api/projects/:id/validation`
- [x] 3.7 [backend] Add runtime routes under `/api/projects/:id/runtime`
- [x] 3.8 [backend] Add snapshot list/restore routes under `/api/projects/:id/snapshots`
- [x] 3.9 [backend] Keep current file and static preview routes compatible

## Phase 4 — Structured Agent Tools [backend]

- [x] 4.1 [backend] Add `read_project_manifest`
- [x] 4.2 [backend] Add `update_project_manifest`
- [x] 4.3 [backend] Add `create_project_service`
- [x] 4.4 [backend] Add `upsert_api_route`
- [x] 4.5 [backend] Add `upsert_database_schema`
- [x] 4.6 [backend] Add `create_database_migration`
- [x] 4.7 [backend] Add `upsert_env_var`
- [x] 4.8 [backend] Add `request_project_validation`
- [x] 4.9 [backend] Add `create_project_snapshot`
- [x] 4.10 [backend] Register structured tools only for project-scoped agent runs
- [x] 4.11 [backend] Update system prompt to use structured tools for API/backend/BBDD requests

## Phase 5 — Generation Worker [workers]

- [x] 5.1 [workers] Replace `generateProject` skeleton with manifest-aware generation orchestration
- [x] 5.2 [workers] Materialize project files into a per-project workspace path under `WORKSPACE_ROOT`
- [x] 5.3 [workers] Generate default static app structure for frontend-only projects
- [x] 5.4 [workers] Generate Hono backend structure for backend-enabled projects
- [x] 5.5 [workers] Generate SQLite migration files for database-enabled projects
- [x] 5.6 [workers] Store generation logs and update `project_runs`
- [x] 5.7 [workers] Mark preview stale after successful generation

## Phase 6 — Validation Worker [workers]

- [x] 6.1 [workers] Add `validate-project.ts` handler
- [x] 6.2 [workers] Validate manifest JSON and required service paths
- [x] 6.3 [workers] Validate generated file tree against manifest entrypoints
- [x] 6.4 [workers] Run typecheck/build commands from controlled allowlist
- [x] 6.5 [workers] Run lightweight smoke checks for generated API routes
- [x] 6.6 [workers] Store pass/fail validation reports with truncated logs
- [x] 6.7 [backend] Add job enqueue endpoint `POST /api/projects/:id/validate`

## Phase 7 — Preview Runtime [workers] [backend]

- [x] 7.1 [workers] Extend `rebuildPreview` to read manifest/services
- [x] 7.2 [workers] Keep static preview path working for frontend-only apps
- [x] 7.3 [workers] Add materialized workspace preview for generated services
- [x] 7.4 [workers] Store runtime instance status, URLs, ports, and errors
- [x] 7.5 [backend] Return runtime state to builder UI
- [x] 7.6 [infra] Define cleanup policy for stale runtime instances

## Phase 8 — Frontend Builder IA [frontend]

- [x] 8.1 [frontend] Split `Builder.tsx` into hooks and domain panels
- [x] 8.2 [frontend] Add `ServicesPanel`
- [x] 8.3 [frontend] Add `ApiRoutesPanel`
- [x] 8.4 [frontend] Add `DatabasePanel`
- [x] 8.5 [frontend] Add `EnvPanel`
- [x] 8.6 [frontend] Add `ValidationPanel`
- [x] 8.7 [frontend] Add `RuntimePanel`
- [x] 8.8 [frontend] Add navigation between files, screens, services, API, database, resources, validation, and runtime
- [x] 8.9 [frontend] Show static preview fallback and full-stack runtime status distinctly

## Phase 9 — Snapshots and Restore [backend] [workers] [frontend]

- [x] 9.1 [backend] Create snapshot after successful generation
- [x] 9.2 [backend] Create snapshot before destructive restore
- [x] 9.3 [backend] Restore manifest, files, services, API routes, DB schema, app resources, and env records
- [x] 9.4 [workers] Mark preview/runtime stale after restore
- [x] 9.5 [frontend] Add snapshot timeline and restore action

## Phase 10 — Security Hardening [backend] [workers] [infra]

- [x] 10.1 [backend] Replace unauthenticated preview access with scoped preview tickets or signed preview URLs
- [x] 10.2 [workers] Enforce materialized workspace path containment
- [x] 10.3 [workers] Enforce command allowlist by manifest command role
- [x] 10.4 [backend] Store only secret references for generated app env vars
- [x] 10.5 [workers] Truncate and sanitize runtime logs
- [x] 10.6 [infra] Document future container sandbox boundary for generated service preview

## Phase 11 — Verification [infra]

- [x] 11.1 [infra] Repair dependency state if `node_modules/.bin/tsc` is broken
- [x] 11.2 [infra] Run `pnpm -r build`
- [x] 11.3 [infra] Smoke: create project and manifest
- [x] 11.4 [infra] Smoke: generate static frontend project
- [x] 11.5 [infra] Smoke: generate project with Hono API route
- [x] 11.6 [infra] Smoke: generate database schema and migration
- [x] 11.7 [infra] Smoke: validate generated project and inspect validation report
- [x] 11.8 [infra] Smoke: rebuild preview and inspect runtime state
- [x] 11.9 [infra] Smoke: restore snapshot and verify files/resources revert

## Recommended First Implementation Sessions

- [x] R.1 [backend] Implement Phase 1 and Phase 2 for manifest + services only
- [x] R.2 [backend] Add `/manifest` and `/services` APIs and wire repos in `index.ts`
- [x] R.3 [frontend] Add read-only manifest/services panels
- [x] R.4 [backend] Add agent tools for manifest and services
- [x] R.5 [workers] Make `generateProject` create a manifest-aware static app while preserving current preview

## Archive

- **Status**: ARCHIVED
- **Archived at**: 2026-05-23
- **Verify result**: PASS (`pnpm -r build`)
- **Branch**: feature/password-mfa-auth
- **Last pre-archive commit**: b423194 (`feat: add password-mfa-auth`)
