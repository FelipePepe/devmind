# Design: Frontend Rearquitectura

## Technical Approach

Fase lineal: tipos centralizados → Zustand stores (auth, chat, session) → componentes auth extraídos → App.tsx limpio → CSS cleanup. Cada fase es atómica y reversible.

## Architecture Decisions

### Decision: Zustand over Redux Toolkit

**Choice**: Zustand con `create()`
**Alternatives**: Redux Toolkit, React Context + useReducer
**Rationale**: No boilerplate, sin providers en el tree, integración directa con React, ~2KB bundle. El proyecto ya tiene hooks con setState → Zustand mantiene API similar sin reescribir lógica.

### Decision: Mantener useChatStore.ts como bridge, reemplazar con store

**Choice**: Crear `stores/chat.ts` que importa la lógica SSE de useChatStore.ts, luego eliminar el hook
**Alternatives**: Reusar useChatStore.ts como middleware de Zustand
**Rationale**: El hook usa useState/useStateRefs que no son compatibles con Zustand. Mover la lógica `send` a un store con `setState` imperativo mantiene el comportamiento SSE sin reescribir el parser.

### Decision: Tipos first, stores después

**Choice**: Escribir `types/index.ts` antes de tocar cualquier store
**Alternatives**: Inline types en cada store
**Rationale**: Los specs requieren que User, Session, ChatMessage sean importables desde cualquier componente. Definir contratos antes evita drift.

### Decision: Preservar admin pages intactas

**Choice**: No tocar `/admin/*`
**Alternatives**: Rearquitecturar todo junto
**Rationale**: Admin pages usan useState local correctamente — no tienen el problema de duplicación. Incluirlos aumenta riesgo sin ROI.

## Data Flow

```
App.tsx
  │
  ├── Routes (unprotected)
  │     └── / → LoginPage → {LoginForm | MfaForm | RegisterForm | TotpSetupForm}
  │           └── dispatchs → authStore
  │
  ├── Routes (protected)
  │     ├── /projects → ProjectsPage → apiDirect
  │     ├── /projects/:id → BuilderPage → apiDirect
  │     ├── /chat → ChatPage
  │     │         ├── sessionStore (sessions[], currentSessionId, messages[])
  │     │         ├── chatStore (streamingContent, isStreaming, toolEvents)
  │     │         ├── SessionSidebar
  │     │         ├── ChatPanel → MessageList + AgentConsole + InputBar
  │     │         └── ArtifactViewer
  │     └── /admin/* → (no cambios)
  │
  └── Layout
        └── AppLayout
              ├── TopBar ← authStore.user
              └── <Outlet />
```

```
SSE Data Flow:
  ChatPage
    └── chatStore.send(sessionId, content)
          → POST /api/chat
          → readSSE() generator
            → token   → set streamingContent += chunk
            → tool_call → set toolEvents.push({id, name, args})
            → tool_result → set toolEvents[id].result
            → done    → set isStreaming=false, call onDone()
            → error   → set error
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/types/index.ts` | Create | User, Session, ChatMessage, ToolEvent, PendingStep |
| `src/stores/auth.ts` | Create | Zustand store reemplaza useAuth hook |
| `src/stores/chat.ts` | Create | Zustand store reemplaza useChatStore hook |
| `src/stores/session.ts` | Create | Zustand store reemplaza useSession hook |
| `src/components/auth/LoginForm.tsx` | Create | Extract credentials form from App.tsx |
| `src/components/auth/RegisterForm.tsx` | Create | Extract register form from App.tsx |
| `src/components/auth/MfaForm.tsx` | Create | Extract MFA verification from App.tsx |
| `src/components/auth/TotpSetupForm.tsx` | Create | Extract TOTP setup from App.tsx |
| `src/components/auth/LoginPage.tsx` | Create | Orchestrates auth forms using authStore pendingStep |
| `src/components/layout/AppLayout.tsx` | Create | Grid wrapper con TopBar + Outlet |
| `src/components/layout/TopBar.tsx` | Create | Extract TopBar from App.tsx |
| `src/App.tsx` | Modify | ~40 líneas: routing + providers only |
| `src/hooks/useAuth.ts` | Delete | Logic moves to stores/auth.ts |
| `src/hooks/useChat.ts` | Delete | Duplicate of useChatStore |
| `src/hooks/useChatStore.ts` | Delete | Logic moves to stores/chat.ts |
| `src/hooks/useSession.ts` | Delete | Logic moves to stores/session.ts |
| `src/hooks/useFlags.ts` | Keep | Solo polling, no state global |
| `src/pages/Chat.tsx` | Modify | Read from stores instead of hooks |
| `src/styles/globals.css` | Modify | Nueva CSS para auth forms + page containers |

## Interfaces

```typescript
// types/index.ts
export interface User {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: boolean;
}

export type PendingStep =
  | { step: 'idle' }
  | { step: 'mfa'; mfaToken: string }
  | { step: 'register-totp'; totpUri: string; totpSecret: string; confirmToken: string };
```

```typescript
// stores/auth.ts
interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  pendingStep: PendingStep;
  login: (u: string, p: string) => Promise<void>;
  confirmMfa: (code: string) => Promise<void>;
  register: (u: string, p: string, dn?: string) => Promise<void>;
  confirmRegister: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
```

## Testing Strategy

No test runner en proyecto. Validación manual:
1. Build limpio `pnpm --filter @devmind/frontend build`
2. Auth flow: login → MFA → dashboard → logout
3. Chat flow: nuevo mensaje → stream → done → reload messages
4. Session flow: crear → seleccionar → borrar

## Migration / Rollout

Rollback: `git reset --hard` a commit previo.

## Open Questions

None