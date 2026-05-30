# Proposal: 002-project-first-builder

## Intent

DevMind needs to pivot from a chat-first coding assistant into a project-first app builder. The target product is a local platform that combines:

- visual app generation and iteration similar to Google Stitch / Claude Design
- an AI editing loop that can refine UI, behavior, and code
- a Firebase-like backend layer for generated apps

The current architecture is centered on `sessions`, `messages`, and `agent_runs`. That is useful as an implementation detail, but it is the wrong product boundary for the intended platform.

## Scope

### In Scope
- `packages/backend/src/` domain reorientation around projects, screens, components, app environments, and generated app resources
- `packages/frontend/src/` builder shell, project navigation, screen/canvas flows, and preview entry points
- `packages/workers/src/` generation, indexing, preview-sync, and publish jobs for generated apps
- `openspec/specs/` and `openspec/changes/` architecture and migration definitions

### Out of Scope
- replacing the existing chat runtime in one step
- remote cloud deployment targets outside `.casa`
- mobile-native builders
- a fully general Figma replacement

## Problem Statement

The current system behaves like a local coding agent:

- chat drives the main UX
- backend state is organized around conversations
- vector search indexes code, not product structure
- admin settings do not control a full app-building pipeline

That architecture does not naturally support:

- a durable `project` as the primary object
- multiple generated screens and flows per project
- previewing and iterating on an app independent of a single chat session
- backend resources attached to the generated app instead of DevMind itself

## Proposed Direction

Introduce a project-first architecture with six primary domains:

1. `builder-projects`
2. `builder-design`
3. `builder-generation`
4. `builder-preview`
5. `builder-backend`
6. `builder-agent`

The chat system remains, but is demoted to an interaction surface within a project instead of being the system's organizing principle.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend/src/db/` | High | New project-centric schema and repositories |
| `packages/backend/src/chat/` | Medium | Chat becomes project-scoped and subordinate to builder flows |
| `packages/backend/src/tools/` | High | Tools must act on project graphs, generated files, preview state, and backend resources |
| `packages/frontend/src/pages/` | High | Add builder shell and replace session-first navigation |
| `packages/workers/src/` | High | Add generation and publish orchestration jobs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Product pivot stalls current working chat flow | Med | Keep chat runtime as compatibility layer during migration |
| Schema churn causes brittle migration path | Med | Introduce additive project tables before deprecating session-first tables |
| Preview runtime becomes too tightly coupled to generation worker | High | Separate preview state from generation execution via explicit job and artifact boundaries |
| Firebase-like scope expands uncontrollably | High | Limit v1 backend layer to auth, data collections, storage, realtime, and jobs for generated apps |

## Rollback Plan

The migration SHALL be additive-first. Existing `sessions`, `messages`, and `agent_runs` remain supported until the builder shell and project APIs are stable. If the pivot fails, the frontend can continue to use the current chat routes and the new project routes can be disabled at route-registration level.

## Dependencies

- Existing Ollama integration for generation and refinement
- Existing SQLite migrations and worker queue
- Existing filesystem artifact storage
- Possible new frontend libraries for canvas/preview only after design approval

## Success Criteria

- [ ] A user can create a `project` without creating a chat session first
- [ ] A project can own multiple `screens` and `backend resources`
- [ ] A generated app can be previewed independently of the chat transcript
- [ ] The agent can edit a project graph and generated code, not only reply in chat
- [ ] The backend layer is modeled as resources for generated apps, not only as infrastructure for DevMind itself
