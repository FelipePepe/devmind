import { marked } from 'marked';
import { useMemo } from 'react';
import type { ChatMessage } from '../../hooks/useChatStore.js';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(content: string): string {
  const result = marked.parse(content);
  return typeof result === 'string' ? result : '';
}

function MessageItem({ message }: { message: ChatMessage }) {
  const html = useMemo(() => renderMarkdown(message.content), [message.content]);
  const isUser = message.role === 'user';

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className={`avatar ${isUser ? 'avatar-user' : 'avatar-assistant'}`}>
        {isUser ? 'U' : 'D'}
      </div>
      <div
        className="message-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

interface StreamingMessageProps {
  content: string;
}

function StreamingMessage({ content }: StreamingMessageProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div className="message message-assistant">
      <div className="avatar avatar-assistant">D</div>
      <div className="message-content">
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <span
          style={{
            display: 'inline-block',
            width: '2px',
            height: '1em',
            background: 'var(--accent)',
            marginLeft: '2px',
            verticalAlign: 'text-bottom',
            animation: 'blink 1s step-end infinite',
          }}
        />
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent?: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageList({ messages, streamingContent, bottomRef }: MessageListProps) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {messages.length === 0 && !streamingContent && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            gap: 'var(--space-3)',
            padding: 'var(--space-8)',
          }}
        >
          <span style={{ fontSize: 'var(--text-2xl)' }}>⬡</span>
          <span style={{ fontSize: 'var(--text-sm)' }}>Start a conversation</span>
        </div>
      )}

      {messages.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}

      {streamingContent && <StreamingMessage content={streamingContent} />}

      <div ref={bottomRef as React.Ref<HTMLDivElement>} />

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
