# Delta Spec: 002-project-first-builder

> This change introduces new project-first capabilities and reclassifies chat as a supporting capability.

---

## ### ADDED — builder-projects

**Package**: `packages/backend/src/builder/` and `packages/backend/src/db/repos/`

### Requirement: Project as Primary Resource

The system MUST support a top-level `project` resource that exists independently of chat sessions. A project SHALL be the primary container for generated screens, components, backend resources, runs, and previews.

#### Scenario: Create project without chat

- GIVEN an authenticated user
- WHEN the user creates a new project
- THEN the backend stores a `project` record without requiring a chat session

#### Scenario: Project list is durable

- GIVEN a user has created multiple projects
- WHEN the frontend loads the projects view
- THEN the system returns the user's projects regardless of any existing chat history

---

## ### ADDED — builder-design

**Package**: `packages/frontend/src/components/builder/` and `packages/backend/src/db/repos/`

### Requirement: Screen and Component Graph

The system MUST model generated UI as a project-owned graph of screens and components. The graph SHALL be stored independently from transient assistant responses.

#### Scenario: Screen belongs to project

- GIVEN a project exists
- WHEN a screen is created for that project
- THEN the screen record is stored with a `project_id` and can be loaded without replaying chat

#### Scenario: Component reuse

- GIVEN a project has reusable components
- WHEN multiple screens reference the same component
- THEN the system SHALL preserve that reuse in the project graph

---

## ### ADDED — builder-preview

**Package**: `packages/backend/src/builder/preview-routes.ts` and `packages/workers/src/handlers/`

### Requirement: Preview as First-Class State

The system MUST provide explicit preview state for each project. Preview state SHALL include lifecycle status and SHALL NOT be inferred only from assistant messages or artifacts.

#### Scenario: Preview requested

- GIVEN a project has a generation snapshot
- WHEN the user requests a preview
- THEN the system creates or updates a preview record with status `building`, `ready`, or `failed`

#### Scenario: Preview survives chat reset

- GIVEN a project preview is ready
- WHEN the user starts a new chat thread for the same project
- THEN the existing preview remains addressable and unchanged until a new generation updates it

---

## ### ADDED — builder-backend

**Package**: `packages/backend/src/builder/` and `packages/backend/src/db/repos/`

### Requirement: Generated App Resources

The system MUST model backend resources for generated apps separately from DevMind's own platform resources. At minimum, the resource model SHOULD support auth configuration, data collections, storage resources, realtime channels, and background jobs.

#### Scenario: App resources attached to project

- GIVEN a project requires a user profile collection and file uploads
- WHEN the backend resource plan is stored
- THEN those resources are attached to the project rather than to a chat session

#### Scenario: Resource listing

- GIVEN a project has generated backend resources
- WHEN the frontend requests project backend details
- THEN the system returns a structured list of those resources

---

## ### ADDED — builder-agent

**Package**: `packages/backend/src/chat/`, `packages/backend/src/tools/`

### Requirement: Project-Scoped Agent Context

The agent MUST be able to operate with a `project_id` as primary context. Tooling SHALL load project graph, generated files, preview state, and backend resources before or alongside chat history.

#### Scenario: Project edit request

- GIVEN a project with screens and files
- WHEN the user asks the agent to refine onboarding
- THEN the agent executes against project context and persists the resulting project mutations

#### Scenario: Chat is subordinate to project

- GIVEN a project contains multiple chat threads
- WHEN the user switches threads
- THEN project state remains stable and shared while thread-local conversation state changes

---

## ### MODIFIED — chat-runtime

**Package**: `packages/backend/src/chat/` and `packages/frontend/src/pages/Chat.tsx`

### Requirement: Chat is Supporting UX

The chat runtime MUST continue to work during migration, but it SHALL be treated as a supporting interface within a project rather than as the primary product container.

#### Scenario: Legacy session compatibility

- GIVEN the current session-based chat routes still exist
- WHEN the system is migrated incrementally
- THEN legacy chat remains available until project-scoped chat achieves parity

#### Scenario: New chat thread inside project

- GIVEN a project exists
- WHEN the user opens a new chat thread inside that project
- THEN the chat thread is linked to the project and does not become the system root
