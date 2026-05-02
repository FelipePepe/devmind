# DevMind Recovery Plan

> **DOCUMENTO HISTÓRICO** — Este plan describe la situación del repo a principios de 2025 y las decisiones de arquitectura tomadas en ese momento. La mayoría de las fases descritas aquí ya están implementadas. Para el estado actual del producto ver `README.md`.
>
> Supuestos de este documento que ya no aplican:
> - Auth objetivo: ~~WebAuthn (passkeys)~~ → reemplazado por Password + MFA (TOTP)
> - Arquitectura centrada en chat → migrada a **project-first builder** (ver `openspec/changes/002-project-first-builder/`)
> - Firebase como v2 → descartado en favor de infraestructura local-first extendida

---

## Objetivo

Corregir el desvío entre:

- la arquitectura objetivo descrita en `devmind-implementation-prompt.md`
- la ampliación cloud descrita en `devmind-firebase-addendum.md`
- la implementación real actual del repositorio

El objetivo no es reescribir sin control, sino llevar el repo a una base coherente, usable y extensible, con una secuencia de trabajo que reduzca riesgo y preserve el código aprovechable ya existente.

## Principios de ejecución

- Elegir una arquitectura fuente de verdad antes de añadir más features.
- Cerrar primero el flujo crítico de usuario antes de atacar mejoras de plataforma.
- No mezclar en paralelo tres modelos de auth, transporte y persistencia.
- Convertir stubs en contratos explícitos o eliminarlos temporalmente.
- Mantener cada fase desplegable y verificable por separado.

## Diagnóstico resumido

### Implementado hoy

- Monorepo `pnpm` con `frontend`, `backend` y `workers`.
- Backend con Hono, SQLite, WebAuthn, JWT, flags, admin, WebSocket y cola de jobs.
- Frontend mínimo con login passkey, listado de sesiones, chat simple y pantallas admin.
- Workers con archivado de sesiones e indexación de codebase en estado parcial.

### Desvíos principales

- Falta el núcleo de chat/agent descrito en el prompt original: `POST /api/chat`, SSE, loop de tools, runtime de LangGraph operativo.
- El frontend real no coincide con la suite prevista: no hay editor, terminal, explorer, console multi-agente ni stores dedicados.
- El modelo de auth está desalineado entre documentos y código:
  - prompt original: `X-DevMind-Key`
  - repo actual: WebAuthn + JWT
  - addendum: Firebase Auth
- La persistencia también está desalineada:
  - prompt original: local-first
  - addendum: capa cloud Firebase
  - repo actual: SQLite + filesystem local
- La parte de indexación y herramientas del agente está en stub.

## Decisión arquitectónica obligatoria

Antes de seguir implementando, hay que fijar una arquitectura objetivo única.

### Opción recomendada

Adoptar una estrategia en dos etapas:

1. `v1 local-first`
   - Backend Hono
   - SQLite
   - WebAuthn + JWT
   - Chat/agent real por SSE
   - Workers locales

2. `v2 hybrid cloud`
   - Mantener el core local-first
   - Añadir Firebase como sincronización, notificaciones y operaciones pesadas
   - No sustituir el core hasta tener la integración estabilizada

### Decisiones a fijar formalmente

- Auth oficial de `v1`: WebAuthn + JWT
- Transporte oficial de chat: SSE
- Transporte oficial de eventos auxiliares: WebSocket opcional
- Persistencia oficial de `v1`: SQLite + storage local
- Firebase: fuera del critical path hasta completar `v1`

## Fase 0 — Congelar alcance y documentar target

### Objetivo

Crear una especificación interna realista para el repo actual.

### Tareas

- Redactar un `TARGET_ARCHITECTURE.md`.
- Marcar qué partes del prompt original se adoptan en `v1`.
- Marcar qué partes quedan diferidas a `v2`.
- Marcar qué componentes actuales se mantienen, refactorizan o eliminan.

### Entregables

- Documento de arquitectura objetivo.
- Matriz `documento -> implementación -> estado`.

### Criterio de cierre

- No quedan ambigüedades sobre auth, chat, runtime de agente y persistencia.

## Fase 1 — Estabilizar la base actual

### Objetivo

Llevar el repo a estado compilable y funcional mínimo.

### Tareas backend

- Hacer que `pnpm -r build` pase de forma consistente.
- Revisar rutas existentes y eliminar contratos rotos.
- Añadir tests básicos de:
  - auth
  - sesiones
  - mensajes
  - flags admin

### Tareas frontend

- Consolidar estado auth en un provider o store único.
- Añadir bootstrap de sesión al cargar la app.
- Corregir navegación básica y estados de error.
- Validar flujo login -> crear sesión -> enviar mensaje -> ver respuesta.

### Tareas de infraestructura

- Añadir `.env.example` realista.
- Documentar arranque local.
- Verificar creación automática de DB y storage.

### Entregables

- Build limpia.
- Flujo mínimo funcional extremo a extremo.

### Criterio de cierre

- Un usuario puede autenticarse, crear sesión y conversar sin errores 404 o estados inconsistentes.

## Fase 2 — Reconciliar el contrato de chat

### Objetivo

Migrar del chat REST mínimo actual al contrato objetivo basado en streaming.

### Decisión recomendada

- Mantener `/api/sessions` para persistencia y navegación.
- Introducir `/api/chat` como endpoint principal de conversación por SSE.
- Tratar WebSocket como canal secundario, no como transporte principal del chat.

### Tareas

- Diseñar contrato de `POST /api/chat`.
- Definir eventos SSE:
  - `message_start`
  - `token`
  - `tool_call`
  - `tool_result`
  - `message_done`
  - `error`
- Hacer persistencia transaccional:
  - mensaje usuario
  - mensaje asistente en streaming
  - resultado final persistido
- Asegurar reintentos y cancelación.

### Entregables

- Ruta `chat` funcional.
- Cliente frontend de SSE.

### Criterio de cierre

- El chat muestra tokens en tiempo real sin depender de polling manual.

## Fase 3 — Implementar el runtime real de agente

### Objetivo

Conectar el backend con Ollama y herramientas reales.

### Subfase 3.1 — Cliente Ollama

- Crear `ollama/client.ts`.
- Implementar:
  - `chat`
  - `chatStream`
  - `embed`
  - `health`
- Añadir manejo correcto de errores, timeouts y modelos configurables.

### Subfase 3.2 — Registry y executor de tools

- Crear `tools/registry.ts`.
- Crear `tools/executor.ts`.
- Estandarizar tool contract con JSON Schema.
- Introducir contexto de ejecución con timeout, request id y workspace root.

### Subfase 3.3 — Tools mínimas de v1

- `file_read`
- `file_list`
- `search_code`
- `run_command`
- `session_history`
- `task_update`
- `artifact_list`

### Subfase 3.4 — Loop de agente

- Empezar con loop simple y deterministicamente testeable.
- Si LangGraph se usa, hacerlo después de validar el loop mínimo.
- No introducir complejidad de grafo antes de tener el runtime básico estable.

### Entregables

- El asistente puede responder usando modelo y tools reales.

### Criterio de cierre

- Un prompt puede leer contexto del repo, ejecutar herramientas permitidas y devolver respuesta persistida.

## Fase 4 — Rediseñar el frontend hacia la suite objetivo

### Objetivo

Pasar de UI mínima a aplicación operativa de desarrollo asistido.

### Prioridad de construcción

1. `ChatPanel`
2. `MessageList`
3. `InputBar`
4. stores de chat
5. `FileExplorer`
6. `CodeEditor`
7. `Terminal`
8. `AgentConsole`

### Tareas

- Introducir estructura de componentes estable.
- Añadir stores dedicados.
- Integrar `DESIGN.md` en tokens reales.
- Sustituir estilos inline por sistema consistente.
- Añadir estados de loading, error y reconnect.

### Entregables

- Layout funcional de suite.
- Chat, archivos y consola conviviendo en una sola experiencia.

### Criterio de cierre

- La UI deja de ser una demo lineal y pasa a soportar el flujo real de trabajo.

## Fase 5 — Persistencia, artefactos y tareas

### Objetivo

Convertir sesiones y jobs en un sistema coherente de trabajo asistido.

### Tareas

- Revisar el modelo de datos de:
  - sesiones
  - mensajes
  - tareas
  - artefactos
  - jobs
- Definir estados de tarea del agente.
- Persistir artefactos de ejecución:
  - diffs
  - logs
  - resultados de test
  - archivos generados
- Añadir trazabilidad por sesión.

### Entregables

- Modelo de dominio alineado con el producto.

### Criterio de cierre

- Cada ejecución del agente deja huella consultable y reutilizable.

## Fase 6 — Rehacer indexación y búsqueda semántica

### Objetivo

Pasar del stub actual a una indexación útil para el agente.

### Tareas

- Definir estrategia de chunking.
- Implementar embeddings reales con Ollama.
- Guardar índice local en `VECTOR_DB_PATH`.
- Exponer `vector_search`.
- Relacionar chunks con archivos y offsets.
- Añadir reindexación incremental.

### Entregables

- Búsqueda semántica funcional sobre el codebase.

### Criterio de cierre

- El agente puede recuperar contexto relevante sin escanear todo el repo cada vez.

## Fase 7 — Workers reales

### Objetivo

Hacer que `workers` procese trabajo pesado de verdad.

### Tareas

- Separar jobs rápidos y jobs pesados.
- Implementar reintentos y visibilidad de errores.
- Añadir jobs reales:
  - indexación
  - archivado
  - mantenimiento
- Añadir métricas mínimas y observabilidad.

### Entregables

- Cola útil, no decorativa.

### Criterio de cierre

- Los jobs cambian estado de forma fiable y resuelven tareas reales del sistema.

## Fase 8 — Seguridad y gobierno de tools

### Objetivo

Reducir riesgo operativo antes de ampliar capacidades.

### Tareas

- Revisar política de comandos permitidos.
- Añadir validación estricta de inputs para tools.
- Limitar acceso al filesystem por workspace root.
- Añadir auditoría de ejecución de tools.
- Definir niveles de autonomía y confirmación.

### Entregables

- Política de ejecución segura documentada y aplicada.

### Criterio de cierre

- El agente no puede ejecutar operaciones fuera del alcance autorizado sin barreras explícitas.

## Fase 9 — Firebase como v2, no como parche

### Objetivo

Incorporar el addendum Firebase sin romper `v1`.

### Orden recomendado

1. Firebase Admin en backend
2. Firebase Auth opcional o federada, no sustitutiva inicial
3. Firestore para sync selectivo
4. Cloud Storage para artefactos replicados
5. FCM para notificaciones
6. Remote Config para flags/model routing
7. Cloud Functions para operaciones pesadas

### Regla

Ninguna integración Firebase debe bloquear el uso local-first cuando la nube no esté disponible.

### Entregables

- Capa cloud optativa y desacoplada.

### Criterio de cierre

- La app funciona localmente sin Firebase y mejora con Firebase cuando está configurado.

## Fase 10 — Calidad, DX y release

### Objetivo

Cerrar la brecha de producción real.

### Tareas

- Añadir tests unitarios y de integración.
- Añadir linting y checks de tipos fiables.
- Añadir smoke tests de flujo crítico.
- Documentar setup local y troubleshooting.
- Preparar `docker-compose.yml` si sigue siendo requisito.

### Entregables

- Pipeline reproducible de calidad.

### Criterio de cierre

- Cualquier cambio relevante rompe en CI antes de romper en runtime.

## Orden exacto recomendado

1. Fijar arquitectura objetivo `v1` y congelar alcance.
2. Dejar la base actual compilable y estable.
3. Introducir `/api/chat` con SSE.
4. Conectar Ollama real.
5. Implementar registry + executor + tools mínimas.
6. Rediseñar frontend para consumir SSE y estado real.
7. Rehacer indexación semántica.
8. Hacer útiles los workers.
9. Endurecer seguridad y autonomía.
10. Integrar Firebase como `v2`.
11. Cerrar calidad, tests y release.

## Riesgos principales

- Intentar meter Firebase antes de cerrar `v1`.
- Mantener WebSocket y SSE como dos transportes primarios compitiendo.
- Introducir LangGraph antes de validar el loop simple.
- Añadir UI avanzada sin contrato backend estable.
- Reescribir demasiadas capas a la vez.

## Estrategia de ejecución recomendada

- Trabajar por verticales pequeñas, no por grandes reescrituras.
- En cada fase:
  - definir contrato
  - implementar backend
  - implementar frontend
  - validar extremo a extremo
  - documentar

## Próximo paso inmediato

Abrir una `Phase 1` operativa con tareas concretas en el repo:

- hacer pasar `build`
- completar flujo mínimo de auth
- sustituir placeholders rotos
- preparar contrato inicial de `/api/chat`

