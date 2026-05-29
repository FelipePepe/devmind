# frontend-state-management — Full Specification

## Purpose

Gestión centralizada de estado global del frontend mediante Zustand, reemplazando hooks dispersos con stores únicos observables.

## Requirements

### Requirement: Auth Store

La aplicación SHALL mantener un único Zustand store para el estado de autenticación que contenga:
- `user`: Usuario autenticado o null
- `accessToken`: Token JWT o null
- `isLoading`: Estado de carga durante bootstrap
- Acciones: `login`, `confirmMfa`, `register`, `confirmRegister`, `logout`, `refresh`

#### Scenario: Bootstrap auth

- GIVEN el usuario abre la aplicación
- WHEN el auth store inicializa
- THEN llama a `/auth/refresh` para restaurar la sesión
- AND si falla, establece `user` como null

#### Scenario: Login sin MFA

- GIVEN el usuario envía credenciales válidas sin MFA activo
- WHEN el store ejecuta `login(username, password)`
- THEN recibe `accessToken` y `user`, los guarda en el store
- AND `isLoading` pasa a false

### Requirement: Chat Store

La aplicación SHALL mantener un único Zustand store para el chat que contenga:
- `streamingContent`: Contenido acumulado del stream actual
- `isStreaming`: Boolean durante SSE active
- `toolEvents`: Array de eventos de tool calls con resultados
- Acciones: `send`, `cancel`, `clearError`

#### Scenario: Send message via SSE

- GIVEN el usuario envía un mensaje
- WHEN `send(sessionId, content)` se ejecuta
- THEN hace POST a `/api/chat` y lee el SSE stream
- AND acumula tokens en `streamingContent`
- AND actualiza `toolEvents` con tool_call y tool_result

#### Scenario: Cancel streaming

- GIVEN `isStreaming` es true
- WHEN el usuario llama a `cancel()`
- THEN aborta el fetch en curso
- AND `isStreaming` vuelve a false

### Requirement: Session Store

La aplicación SHALL mantener un Zustand store para la gestión de sesiones que contenga:
- `sessions`: Lista de sesiones disponibles
- `currentSessionId`: Sesión activa
- `messages`: Mensajes de la sesión actual
- Acciones: `createSession`, `deleteSession`, `selectSession`, `reloadMessages`

#### Scenario: Create session

- GIVEN el usuario presiona "+ new session"
- WHEN `createSession()` se ejecuta
- THEN postea a `/api/sessions` con título "New Session"
- AND añade la nueva sesión al array y la selecciona

#### Scenario: Delete active session

- GIVEN la sesión activa es eliminada
- WHEN `deleteSession(id)` se ejecuta
- THEN la sesión se remueve del array
- AND se selecciona la primera sesión remanente o null

### Requirement: Shared Types

La aplicación SHALL definir tipos compartidos en `types/index.ts`:
- `User`, `Session`, `ChatMessage`, `ToolEvent`, `PendingStep`
- Cada tipo SHALL ser importable desde cualquier store o componente

#### Scenario: No duplicate types

- GIVEN un tipo como `ChatMessage` existe en `types/index.ts`
- WHEN un hook, store o componente necesita ese tipo
- THEN lo importa desde `types/index.ts`
- AND no existe una copia local del tipo
