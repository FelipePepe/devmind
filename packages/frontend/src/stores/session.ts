import { create } from 'zustand';
import { type Session, type ChatMessage } from '../types/index.js';
import { apiFetch } from '../lib/api.js';

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  loadSessions: () => Promise<void>;
  selectSession: (id: string | null) => void;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  reloadMessages: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],

  loadSessions: async () => {
    const sessions = await apiFetch<Session[]>('/api/sessions');
    set((s) => ({
      sessions,
      currentSessionId: s.currentSessionId ?? (sessions[0]?.id ?? null),
    }));
    const { currentSessionId } = get();
    if (currentSessionId) {
      await get().reloadMessages();
    }
  },

  selectSession: (id) => {
    set({ currentSessionId: id });
    if (id) {
      void get().reloadMessages();
    } else {
      set({ messages: [] });
    }
  },

  reloadMessages: async () => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;
    const messages = await apiFetch<ChatMessage[]>(`/api/sessions/${currentSessionId}/messages`);
    set({ messages });
  },

  createSession: async () => {
    const session = await apiFetch<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Session' }),
      headers: { 'Content-Type': 'application/json' },
    });
    set((s) => ({ sessions: [session, ...s.sessions], currentSessionId: session.id }));
    await get().reloadMessages();
  },

  deleteSession: async (id) => {
    await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    const { sessions, currentSessionId } = get();
    const remaining = sessions.filter((s) => s.id !== id);
    const nextId = currentSessionId === id ? (remaining[0]?.id ?? null) : currentSessionId;
    set({ sessions: remaining, currentSessionId: nextId });
    if (nextId) {
      await get().reloadMessages();
    } else {
      set({ messages: [] });
    }
  },
}));
