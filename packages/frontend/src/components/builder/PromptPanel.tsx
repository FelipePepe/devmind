import { useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: string;
  linked_snapshot_id?: string | null;
}

interface PromptPanelProps {
  messages: ChatMessage[];
  streamingContent: string;
  chatInput: string;
  isStreaming: boolean;
  hasSession: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onSubmit: (overrideInput?: string) => void;
  // Spec 004 — phase 11: when set, assistant messages with a linked snapshot
  // get a hover-revealed "revert to here" affordance.
  onRevertToMessage?: (linkedSnapshotId: string) => void;
}

const QUICK_PROMPTS = ['Build the app', 'Add dark mode', 'Make it mobile-friendly', 'Add animations'] as const;

export function PromptPanel({
  messages,
  streamingContent,
  chatInput,
  isStreaming,
  hasSession,
  error,
  onInputChange,
  onSubmit,
  onRevertToMessage,
}: PromptPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <aside className="chat-area" style={{ borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)' }}>Agent</span>
        {isStreaming && <span style={{ fontSize: '8px', color: 'var(--accent)' }}>●</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {messages.filter((m) => m.role !== 'tool').map((m) => {
          const canRevert = m.role === 'assistant' && !!m.linked_snapshot_id && !!onRevertToMessage;
          return (
            <div
              key={m.id}
              className={canRevert ? 'message-revertable' : undefined}
              style={{
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)',
                background: m.role === 'user' ? 'var(--tint-2)' : 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '92%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                position: 'relative',
              }}
            >
              {m.content}
              {canRevert && (
                <button
                  type="button"
                  onClick={() => onRevertToMessage?.(m.linked_snapshot_id as string)}
                  title="Revert project to the state captured after this message"
                  className="revert-button"
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-tertiary)',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    opacity: 0,
                    transition: 'opacity 120ms ease',
                  }}
                >
                  ⟲ revert to here
                </button>
              )}
            </div>
          );
        })}
        {streamingContent && (
          <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', alignSelf: 'flex-start', maxWidth: '92%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {streamingContent}
            <span style={{ display: 'inline-block', width: '2px', height: '1em', background: 'var(--accent)', marginLeft: '2px', verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', padding: 'var(--space-2)', textAlign: 'center' }}>
            {error}
          </div>
        )}
        {messages.length === 0 && !isStreaming && !error && (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center', marginTop: 'var(--space-6)', lineHeight: 'var(--leading-relaxed)' }}>
            Describe the app you want to build and the agent will generate the code.
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11px', padding: '2px var(--space-2)' }}
              onClick={() => onSubmit(p)}
              disabled={isStreaming}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <textarea
            className="input"
            placeholder="Describe what to build or change…"
            value={chatInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            disabled={isStreaming || !hasSession}
            rows={2}
            style={{ flex: 1, resize: 'none', fontSize: 'var(--text-sm)' }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSubmit()}
            disabled={isStreaming || !chatInput.trim() || !hasSession}
            style={{ alignSelf: 'flex-end' }}
          >
            {isStreaming ? '…' : '↑'}
          </button>
        </div>
      </div>
    </aside>
  );
}
