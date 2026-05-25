# Proposal: 003-full-stack-project-generator

## Intent

DevMind must evolve from a project-aware static artifact builder into a local full-stack app generation platform. The product target is:

- create complete projects, not only HTML artifacts
- generate frontend, API, backend services, database schema, migrations, jobs, storage, auth, and deployment metadata
- preview and validate generated projects locally inside the `.casa` intranet
- keep DevMind's own platform backend separate from generated app backends

This change builds on `002-project-first-builder`, which already introduced projects, screens, components, project files, app resources, project-scoped chat, and preview state.

## Scope

### In Scope

- `packages/backend/src/builder/` project manifest APIs, generation orchestration, resource planning, and runtime metadata
- `packages/backend/src/db/` schema for generated app manifests, services, database resources, migrations, env vars, snapshots, and validation reports
- `packages/backend/src/tools/` project tools for writing structured app manifests, backend resources, API routes, database schemas, and generated files
- `packages/workers/src/handlers/` real project generation, preview build, validation, and runtime synchronization jobs
- `packages/frontend/src/pages/Builder.tsx` and builder components for full-stack project navigation, backend resource inspection, validation output, and runtime status
- `openspec/` SDD workflow for incremental implementation

### Out of Scope

- public cloud deployment outside `.casa`
- Kubernetes or multi-node production orchestration
- arbitrary untrusted command execution without sandbox approval
- native mobile app generation
- replacing DevMind's own auth system

## Problem Statement

DevMind currently stores generated output mainly as project files served by a static preview route. That is enough for frontend prototypes, but not enough for full applications.

The system lacks explicit durable objects for:

- project manifest and framework/runtime choice
- frontend/backend service boundaries
- generated API endpoints
- generated database schema and migrations
- app-level auth and authorization rules
- runtime environment variables and secrets
- build/test/validate results
- preview process lifecycle
- deployable project snapshots

Without those objects, the agent can generate files, but DevMind cannot reliably reason about, validate, preview, rollback, or deploy a full-stack app.

## Proposed Direction

Introduce a generated-app contract centered on `project_manifest`.

Each project SHALL have a manifest that describes:

```text
project
  manifest
  services
    frontend
    backend
    workers
  api_routes
  database
    schema
    migrations
    seed data
  app_resources
    auth
    collections
    storage
    realtime
    jobs
  files
  snapshots
  preview_runtime
  validation_reports
```

The agent SHALL mutate this structured project model and write files from it. Generated files remain important, but they SHALL NOT be the only source of truth.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend/src/db/migrations/` | High | Add manifest, service, database, route, snapshot, validation, runtime tables |
| `packages/backend/src/db/repos/` | High | Add typed repos for generated app domains |
| `packages/backend/src/builder/routes.ts` | High | Expand project APIs beyond static files/screens |
| `packages/backend/src/chat/routes.ts` | Medium | Load structured full-stack context into project-scoped agent |
| `packages/backend/src/tools/` | High | Add tools for manifest/resource/schema/route mutation |
| `packages/workers/src/handlers/` | High | Replace skeleton generation/preview handlers with real orchestration |
| `packages/frontend/src/pages/Builder.tsx` | High | Split into domain views and expose full-stack project state |
| `Dockerfile.*` and `docker-compose.yml` | Medium | Add runtime/preview service strategy if needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope becomes too broad | High | Ship vertical slices: static app, then API, then DB, then jobs |
| Generated backend can affect host machine | High | Use per-project workspace roots, explicit command allowlists, timeouts, and future container sandbox |
| Manifest and files drift apart | High | Workers validate file tree against manifest after every run |
| Preview runtime becomes brittle | Medium | Separate materialized static preview from service-based preview |
| SQLite schema overfits first generator | Medium | Store structured JSON config where flexible, but keep core entities relational |
| Existing builder breaks during migration | Medium | Additive-first APIs; keep current `project_files` preview path working |

## Rollback Plan

The implementation SHALL be additive-first.

- Existing static project file preview remains available.
- New full-stack tables can be ignored by the frontend until each phase is complete.
- New worker jobs are opt-in through new endpoints.
- If runtime preview fails, the system falls back to static preview from `project_files`.
- Migrations SHALL NOT remove existing project, session, message, preview, or app_resource tables.

## Success Criteria

- [ ] A user can create a project from a prompt and receive a structured manifest
- [ ] A project can contain frontend and backend services as separate generated units
- [ ] The agent can add an API endpoint and persist it as structured project state
- [ ] The agent can add a database collection/table and generate a migration
- [ ] The preview runtime can build or serve a generated full-stack app
- [ ] Validation reports show build/typecheck/runtime status per project
- [ ] A project snapshot can be restored without replaying chat history
- [ ] DevMind platform resources remain separate from generated app resources
