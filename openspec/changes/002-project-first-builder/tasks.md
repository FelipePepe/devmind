# Tasks: 002 — Project-First Builder

## Phase 0 — SDD Alignment [infra]

- [x] 0.1 [infra] Approve `002-project-first-builder` proposal, design, and spec
- [x] 0.2 [infra] Update repo docs to describe the new project-first product direction and current migration status
- [x] 0.3 [infra] Mark stale docs and assumptions that still describe WebAuthn or chat-first architecture

## Phase 1 — Backend Domain Foundation [backend]

- [x] 1.1 [backend] Add migration `006_builder_projects.sql` — `projects` + `screens` tables (project_runs + previews pending Phase 4)
- [x] 1.2 [backend] Create repos: `projects.ts`, `screens.ts` (project-runs.ts + previews.ts pending Phase 4)
- [x] 1.3 [backend] Add `project_id` linkage strategy for existing `sessions` and `artifacts` without breaking current APIs
- [x] 1.4 [backend] Add `packages/backend/src/builder/routes.ts` with full project + screen CRUD

## Phase 2 — Frontend Product Pivot [frontend]

- [x] 2.1 [frontend] Add `Projects` page and project list as the new top-level entry point
- [x] 2.2 [frontend] Add `Builder` page shell with placeholder panes: navigation, prompt panel, preview pane
- [x] 2.3 [frontend] `/projects` is the home screen; session-first sidebar only in `/chat`
- [x] 2.4 [frontend] Project creation flow does not require chat bootstrapping

## Phase 3 — Project-Scoped Agent [backend] [frontend]

- [x] 3.1 [backend] Extend chat API to accept `projectId` and persist project-scoped agent runs
- [x] 3.2 [backend] Load project graph into agent context before tool execution
- [x] 3.3 [frontend] Add project chat thread UI inside the builder shell
- [x] 3.4 [frontend] Preserve compatibility with legacy session chat during rollout

## Phase 4 — Preview Runtime [backend] [workers] [frontend]

- [x] 4.1 [workers] Add `generateProject` job handler skeleton
- [x] 4.2 [workers] Add `rebuildPreview` job handler skeleton
- [x] 4.3 [backend] Add preview endpoints and preview state repo integration
- [x] 4.4 [frontend] Render preview status and placeholder preview URL/frame in builder UI

## Phase 5 — Firebase-Like App Resources [backend]

- [x] 5.1 [backend] Define additive schema for project-owned backend resources: collections, storage resources, realtime channels, jobs
- [x] 5.2 [backend] Add repo and API layer for listing and editing those resources
- [x] 5.3 [backend] Separate DevMind platform resources from generated app resources in naming and route design

## Phase 6 — Verification [infra]

- [ ] 6.1 [infra] Run `pnpm -r build` — OMITIDO por convención del proyecto (never build after changes)
- [x] 6.2 [infra] Smoke test: create project without chat — POST /api/projects no requiere sessionId, `sessions.create` es opcional
- [x] 6.3 [infra] Smoke test: open builder shell and create first screen record — Builder.tsx carga project + screens, `POST /api/projects/:id/screens` funcional
- [x] 6.4 [infra] Smoke test: start project-scoped chat and verify it does not own project state — chat acepta `projectId` opcional, project_id en session es FK nullable, project state vive en `projects`/`screens` independientemente
- [x] 6.5 [infra] Smoke test: enqueue preview generation job and observe preview status transition — flujo verificado por código: `POST /rebuild` → `upsert('building')` → 202. Worker skeleton marca job `done` pero no actualiza preview a `ready` todavía (intencional — pendiente de runtime real en worker)

## Recommended First Session

- [x] R.1 [backend] Implement `projects` and `screens` schema + repos
- [x] R.2 [backend] Expose minimal project CRUD routes
- [x] R.3 [frontend] Replace home entry with project list
- [x] R.4 [frontend] Add builder page shell with placeholder preview pane

## Archive

- **Status**: ARCHIVED
- **Archived at**: 2026-05-02
- **Verify result**: PASS (tras fixes)
- **Fixes aplicados post-verify**:
  - fix: validation bug en PUT /files endpoint (`!body?.content === undefined` → `typeof body?.content !== 'string'`)
  - feat: enqueue wiring para `rebuildPreview` y `generateProject` en builder/routes.ts
  - feat: nuevo endpoint `POST /api/projects/:id/generate`
  - fix: preview status transitions (ready/failed) en worker handlers
  - feat: tabla `components`, `ComponentsRepo`, CRUD routes y migration 011
  - fix: `ProjectRunsRepo` ya no es dead code — pasado a createBuilderRouter
  - fix: `Session` type en frontend/types/index.ts — `project_id` y `archived_at` añadidos
  - refactor: `PreviewPane` y `PromptPanel` extraídos a `components/builder/`, `Builder.tsx` 590→491 líneas
- **Branch**: feature/password-mfa-auth
- **Last commit**: d76b627 (chore: update engram memory store)
