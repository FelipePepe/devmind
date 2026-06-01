import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { SessionSidebar } from '../components/session/SessionSidebar.js';
import { useChatStore } from '../stores/chat.js';
import { useSessionStore } from '../stores/session.js';
import { parseArtifacts } from '../lib/artifacts.js';

// Lazy: pulls highlight.js + language defs only when an artifact is rendered.
const ArtifactViewer = lazy(() =>
  import('../components/artifacts/ArtifactViewer.js').then((m) => ({
    default: m.ArtifactViewer,
  }))
);

export default function Chat() {
  const [input, setInput] = useState('');

  const { sessions, currentSessionId, messages, loadSessions, selectSession, createSession, deleteSession, reloadMessages } = useSessionStore();
  const { streamingContent, isStreaming, error, toolEvents, send } = useChatStore();

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || !currentSessionId || isStreaming) return;
    const msg = input;
    setInput('');
    void send(currentSessionId, msg, reloadMessages);
  }, [input, currentSessionId, isStreaming, send, reloadMessages]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const artifacts = lastAssistantMsg ? parseArtifacts(lastAssistantMsg.content) : [];
  const liveArtifacts = isStreaming ? parseArtifacts(streamingContent) : [];
  const displayArtifacts = liveArtifacts.length > 0 ? liveArtifacts : artifacts;

  return (
    <>
      <SessionSidebar
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={selectSession}
        onCreate={() => void createSession()}
        onDelete={(id) => void deleteSession(id)}
      />
      <main className="main-area" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={null}>
          <ArtifactViewer artifacts={displayArtifacts} isStreaming={isStreaming && liveArtifacts.length > 0} />
        </Suspense>
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
