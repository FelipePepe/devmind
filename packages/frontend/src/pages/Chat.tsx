import { useState, useEffect, useCallback } from 'react';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { SessionSidebar } from '../components/session/SessionSidebar.js';
import { ArtifactViewer } from '../components/artifacts/ArtifactViewer.js';
import { useSession } from '../hooks/useSession.js';
import { useChatStore } from '../hooks/useChatStore.js';
import { apiFetch } from '../lib/api.js';
import { parseArtifacts } from '../lib/artifacts.js';

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

  const deleteSession = useCallback(async (id: string) => {
    await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        setCurrentSessionId(remaining[0]?.id ?? null);
        return remaining;
      });
    }
  }, [currentSessionId]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || !currentSessionId || isStreaming) return;
    const msg = input;
    setInput('');
    void send(currentSessionId, msg);
  }, [input, currentSessionId, isStreaming, send]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const artifacts = lastAssistantMsg ? parseArtifacts(lastAssistantMsg.content) : [];
  const liveArtifacts = isStreaming ? parseArtifacts(streamingContent) : [];
  const displayArtifacts = liveArtifacts.length > 0 ? liveArtifacts : artifacts;

  return (
    <>
      <SessionSidebar
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={setCurrentSessionId}
        onCreate={() => void createSession()}
        onDelete={(id) => void deleteSession(id)}
      />

      <main className="main-area" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ArtifactViewer
          artifacts={displayArtifacts}
          isStreaming={isStreaming && liveArtifacts.length > 0}
        />
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
