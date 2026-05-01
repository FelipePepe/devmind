import { useState, useEffect, useCallback } from 'react';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { SessionSidebar } from '../components/session/SessionSidebar.js';
import { useSession } from '../hooks/useSession.js';
import { useChatStore } from '../hooks/useChatStore.js';
import { apiFetch } from '../lib/api.js';

interface Session {
  id: string;
  title: string;
  created_at: string;
}

export default function Chat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const { messages: rawMessages, reloadMessages } = useSession(currentSessionId);
  const messages = rawMessages as import('../hooks/useChatStore.js').ChatMessage[];
  const { streamingContent, isStreaming, error, toolEvents, send } = useChatStore(reloadMessages);

  useEffect(() => {
    apiFetch<Session[]>('/api/sessions')
      .then((data) => {
        setSessions(data);
        if (data.length > 0 && !currentSessionId) {
          setCurrentSessionId(data[0]?.id ?? null);
        }
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSession = useCallback(async () => {
    const session = await apiFetch<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Session' }),
      headers: { 'Content-Type': 'application/json' },
    });
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.id);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || !currentSessionId || isStreaming) return;
    const msg = input;
    setInput('');
    void send(currentSessionId, msg);
  }, [input, currentSessionId, isStreaming, send]);

  return (
    <>
      <SessionSidebar
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={setCurrentSessionId}
        onCreate={() => void createSession()}
      />

      <main className="main-area">
        <div
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-sm)',
            textAlign: 'center',
            padding: 'var(--space-8)',
          }}
        >
          {currentSessionId
            ? 'Editor & Terminal coming in Fase 5'
            : 'Select or create a session to start'}
        </div>
      </main>

      <ChatPanel
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        error={error}
        toolEvents={toolEvents}
        inputValue={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        disabled={!currentSessionId}
      />
    </>
  );
}
