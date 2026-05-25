import { useEffect, useRef } from 'react';
import { MessageList } from './MessageList.js';
import { InputBar } from './InputBar.js';
import { AgentConsole } from './AgentConsole.js';
import type { ChatMessage, ToolEvent } from '../../types/index.js';

interface ChatPanelProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  error: string | null;
  toolEvents: ToolEvent[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export function ChatPanel({
  messages,
  streamingContent,
  isStreaming,
  error,
  toolEvents,
  inputValue,
  onInputChange,
  onSubmit,
  disabled,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingContent]);

  return (
    <section className="chat-area">
      <div
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-caps)',
          color: 'var(--text-tertiary)',
          flexShrink: 0,
        }}
      >
        Chat
      </div>

      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        bottomRef={bottomRef}
      />

      <AgentConsole toolEvents={toolEvents} isStreaming={isStreaming} />

      {error && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-error)',
            background: 'var(--color-error-bg)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {error}
        </div>
      )}

      <InputBar
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        disabled={disabled}
        isStreaming={isStreaming}
        placeholder={disabled ? 'Select a session to start chatting' : 'Ask DevMind…'}
      />
    </section>
  );
}
