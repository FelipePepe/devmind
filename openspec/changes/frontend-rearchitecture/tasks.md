# Tasks: Frontend Rearquitectura

## Phase 1: Foundation — Types

- [x] 1.1 Create `src/types/index.ts` with User, Session, ChatMessage, ToolEvent, PendingStep
- [x] 1.2 Install Zustand: `pnpm --filter @devmind/frontend add zustand`

## Phase 2: Zustand Stores

- [x] 2.1 Create `src/stores/auth.ts` — move logic from `useAuth.ts` to Zustand store (user, accessToken, isLoading, pendingStep, login, confirmMfa, register, confirmRegister, logout, refresh)
- [x] 2.2 Create `src/stores/chat.ts` — move SSE logic from `useChatStore.ts` to Zustand store (streamingContent, isStreaming, error, toolEvents, send, cancel, clearError)
- [x] 2.3 Create `src/stores/session.ts` — move logic from `useSession.ts` to Zustand store (sessions, currentSessionId, messages, createSession, deleteSession, selectSession, reloadMessages)

## Phase 3: Auth Components

- [x] 3.1 Create `src/components/auth/LoginForm.tsx` — extract credentials form from App.tsx lines 185-232
- [x] 3.2 Create `src/components/auth/RegisterForm.tsx` — extract register form from App.tsx lines 233-284
- [x] 3.3 Create `src/components/auth/MfaForm.tsx` — extract MFA verification from App.tsx lines 147-182
- [x] 3.4 Create `src/components/auth/TotpSetupForm.tsx` — extract TOTP setup from App.tsx lines 285-330
- [x] 3.5 Create `src/components/auth/LoginPage.tsx` — orchestrate auth forms using authStore.pendingStep
- [x] 3.6 Extract TopBar to `src/components/layout/TopBar.tsx` from App.tsx
- [x] 3.7 Create `src/components/layout/AppLayout.tsx` — grid wrapper with TopBar + Outlet

## Phase 4: Wiring — App.tsx + Pages

- [x] 4.1 Rewrite `src/App.tsx` — ~40 lines: routes only, LoginPage for unauth, AppLayout + Outlet for protected routes
- [x] 4.2 Update `src/pages/Chat.tsx` — read from Zustand stores instead of hooks
- [x] 4.3 Update `src/components/session/SessionSidebar.tsx` — import Session from types
- [x] 4.4 Update `src/components/chat/MessageList.tsx` — import ChatMessage from types
- [x] 4.5 Update `src/components/chat/AgentConsole.tsx` — import ToolEvent from types

## Phase 5: Cleanup

- [x] 5.1 Delete `src/hooks/useAuth.ts`
- [x] 5.2 Delete `src/hooks/useChat.ts`
- [x] 5.3 Delete `src/hooks/useChatStore.ts`
- [x] 5.4 Delete `src/hooks/useSession.ts`
- [x] 5.5 Add CSS classes for auth forms to `src/styles/globals.css`
- [x] 5.6 Build verify — OMITIDO (regla del proyecto: never build after changes; verificar manualmente)
