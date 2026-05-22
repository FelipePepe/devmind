# Delta Spec: 003-full-stack-project-generator

> This change defines DevMind as a full-stack project generation platform.

---

## ### ADDED — generated-project-manifest

**Package**: `packages/backend/src/builder/`, `packages/backend/src/db/repos/`

### Requirement: Project Manifest

The system MUST support a versioned project manifest for each generated project. The manifest SHALL describe app type, selected stack, service entrypoints, commands, runtime expectations, and environment requirements.

#### Scenario: Manifest created for new generated app

- GIVEN an authenticated user creates a project from a prompt that asks for an app
- WHEN the first generation run starts
- THEN the system creates a project manifest with version, app type, stack, commands, and entrypoints

#### Scenario: Manifest survives chat reset

- GIVEN a project has a manifest
- WHEN the user starts a new chat thread for the same project
- THEN the manifest remains unchanged unless the agent explicitly mutates project state

---

## ### ADDED — generated-services

**Package**: `packages/backend/src/db/repos/project-services.ts`

### Requirement: Project Services

The system MUST model generated frontend, backend, and worker services as project-owned resources. Services SHALL include kind, root path, runtime, port preference, status, and configuration.

#### Scenario: Frontend and backend services generated

- GIVEN a user asks for a CRM with dashboard, API, and database
- WHEN generation completes
- THEN the project contains at least one frontend service and one backend service

#### Scenario: Service status shown in builder

- GIVEN a project has generated services
- WHEN the builder loads the project
- THEN the frontend displays service kind, runtime, root path, and latest status

---

## ### ADDED — generated-api-routes

**Package**: `packages/backend/src/db/repos/project-api-routes.ts`

### Requirement: API Route Model

The system MUST persist generated API routes as structured project state. API routes SHALL include HTTP method, path, owning service, handler path, and optional request/response schemas.

#### Scenario: Agent adds API endpoint

- GIVEN a project has a backend service
- WHEN the user asks "add an endpoint to list customers"
- THEN the agent creates or updates a structured API route and writes the handler file

#### Scenario: Route can be inspected without reading files

- GIVEN a project has generated API routes
- WHEN the frontend requests backend details
- THEN the system returns the route list without requiring source parsing

---

## ### ADDED — generated-database

**Package**: `packages/backend/src/db/repos/project-db-schemas.ts`, `packages/backend/src/db/repos/project-db-migrations.ts`

### Requirement: Database Schema and Migrations

The system MUST model generated database schemas and migrations separately from DevMind's own SQLite schema. Generated database changes SHALL be project-owned and restorable from snapshots.

#### Scenario: Agent creates collection/table

- GIVEN a project has database support enabled
- WHEN the user asks for customers and invoices
- THEN the agent stores a database schema and creates an initial migration

#### Scenario: Migration is generated with schema change

- GIVEN a project already has a database schema
- WHEN the user asks to add a status field to invoices
- THEN the system creates a new migration rather than silently editing the existing applied migration

---

## ### ADDED — generated-env-vars

**Package**: `packages/backend/src/db/repos/project-env-vars.ts`

### Requirement: Environment Variable Contract

The system MUST track environment variables required by generated services. Secret values SHALL NOT be stored directly in project records; only names, requirements, descriptions, defaults, and secret references MAY be stored.

#### Scenario: Backend requires secret

- GIVEN a generated backend needs a JWT secret
- WHEN the agent configures auth
- THEN the project stores an env var requirement with a secret reference instead of the raw secret

---

## ### ADDED — project-validation

**Package**: `packages/workers/src/handlers/validate-project.ts`, `packages/backend/src/builder/validation-routes.ts`

### Requirement: Validation Reports

The system MUST store validation reports for generated projects. A validation report SHALL include status, check list, relevant logs, and associated run id.

#### Scenario: Validation succeeds

- GIVEN generated files and manifest are coherent
- WHEN the validation worker runs
- THEN the system stores a passing validation report

#### Scenario: Validation fails

- GIVEN generated files contain a backend type error
- WHEN the validation worker runs
- THEN the system stores a failed validation report with a truncated log excerpt

---

## ### ADDED — full-stack-preview-runtime

**Package**: `packages/workers/src/handlers/rebuild-preview.ts`, `packages/backend/src/builder/runtime-routes.ts`

### Requirement: Runtime Preview

The system MUST support preview state for generated full-stack projects. Full-stack preview MAY start with materialized static preview, but it SHALL be able to represent frontend and backend runtime URLs separately.

#### Scenario: Static preview fallback

- GIVEN a full-stack runtime cannot start
- WHEN a generated `index.html` exists
- THEN the builder MAY fall back to static preview and show runtime failure details

#### Scenario: Runtime ready

- GIVEN a generated project builds and starts successfully
- WHEN preview rebuild completes
- THEN the runtime instance stores frontend URL, backend URL, ports, and status `ready`

---

## ### ADDED — project-snapshots

**Package**: `packages/backend/src/db/repos/project-snapshots.ts`

### Requirement: Snapshot and Restore

The system SHOULD create snapshots for significant generation and refinement runs. Snapshots SHALL contain manifest, file tree metadata, and resource graph data sufficient to restore project state.

#### Scenario: Snapshot after generation

- GIVEN a generation run completes
- WHEN validation has produced a report
- THEN the system creates a project snapshot linked to the run

#### Scenario: Restore snapshot

- GIVEN a project has multiple snapshots
- WHEN the user restores a previous snapshot
- THEN manifest, resources, files, and preview stale state are restored without replaying chat

---

## ### MODIFIED — project-scoped-agent

**Package**: `packages/backend/src/chat/routes.ts`, `packages/backend/src/tools/`

### Requirement: Full-Stack Agent Context

The project-scoped agent MUST load manifest, services, API routes, database schemas, app resources, files, validation reports, and preview status when a project id is present.

#### Scenario: User asks for backend

- GIVEN a project has no backend service
- WHEN the user asks "add an API and database"
- THEN the agent creates backend service, database schema, API routes, and files rather than only editing frontend files

#### Scenario: User asks for visual-only change

- GIVEN a project has full-stack state
- WHEN the user asks for a visual color/layout change
- THEN the agent MAY update frontend files without mutating backend/database records
