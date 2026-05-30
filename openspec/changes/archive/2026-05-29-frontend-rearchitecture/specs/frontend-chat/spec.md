# Delta for frontend-chat

## MODIFIED Requirements

### Requirement: SSE Chat Communication

La aplicación SHALL enviar mensajes al backend via POST `/api/chat` y recibir respuestas como SSE stream con eventos: `token`, `tool_call`, `tool_result`, `done`, `error`.

(Previously: Duplicate logic in both useChat.ts and useChatStore.ts making identical SSE fetches)

#### Scenario: Send message and receive tokens

- GIVEN una sesión está seleccionada
- WHEN el usuario envía un mensaje
- THEN se hace POST a `/api/chat` con sessionId y content
- AND los tokens se acumulan en `streamingContent` del chat store
- AND el mensaje user se añade al array de mensajes

#### Scenario: Tool events surface in agent console

- GIVEN el stream emite eventos `tool_call` y `tool_result`
- WHEN el chat store procesa el stream
- THEN los tool events se guardan en `toolEvents` del store
- AND la consola agente los muestra con nombre, argumentos y estado

#### Scenario: Stream completion triggers reload

- GIVEN el stream emite evento `done`
- WHEN el evento se procesa
- THEN `isStreaming` vuelve a false
- AND `streamingContent` se limpia
- AND messages se recargan del backend

#### Scenario: Stream error shows to user

- GIVEN el stream emite evento `error` o falla con HTTP error
- WHEN el error ocurre
- THEN `error` se establece en el chat store
- AND el error se muestra en el ChatPanel

### Requirement: Single Source for Chat State

El estado del chat SHALL vivir exclusivamente en el Zustand store, eliminando hooks duplicados.

(Previously: useChat.ts y useChatStore.ts ambos gestionan SSE state independientemente, ChatPage usaba useChatStore, legacy usaba useChat)

#### Scenario: Component reads from chat store

- GIVEN ChatPanel necesita `streamingContent`
- WHEN se renderiza
- THEN lee directamente del chat Zustand store
- AND no necesita pasar props desde padre

#### Scenario: useChat hook is removed

- GIVEN el código referencia `useChat`
- WHEN se auditán imports
- THEN `useChat` no existe como módulo
- AND solo existe `useChatStore` (el Zustand store con el mismo nombre)
