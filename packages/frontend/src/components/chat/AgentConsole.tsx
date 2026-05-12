import { useState } from 'react';
import type { ToolEvent } from '../../types/index.js';

interface AgentConsoleProps {
  toolEvents: ToolEvent[];
  isStreaming: boolean;
}

function truncate(s: string, max = 120): string {
  try {
    const parsed = JSON.parse(s) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    return pretty.length > max ? pretty.slice(0, max) + '…' : pretty;
  } catch {
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
}

export function AgentConsole({ toolEvents, isStreaming }: AgentConsoleProps) {
  const [collapsed, setCollapsed] = useState(false);

  const hasActivity = toolEvents.length > 0 || isStreaming;
  if (!hasActivity) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
        maxHeight: collapsed ? '32px' : 'var(--console-height)',
        overflow: 'hidden',
        transition: 'max-height var(--duration-default) var(--ease-standard)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        className="btn-ghost"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          padding: 'var(--space-1) var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          width: '100%',
          height: '32px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
          cursor: 'pointer',
          background: 'none',
          border: 'none',
          borderRadius: 0,
        }}
      >
        <span style={{ color: 'var(--accent)', fontSize: '8px' }}>
          {isStreaming ? '●' : '○'}
        </span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>
          Agent Console
        </span>
        <span style={{ marginLeft: 'auto' }}>{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-2)' }}>
          {toolEvents.map((evt) => (
            <div key={evt.id} className="tool-call">
              <span>⚙</span>
              <span className="tool-name">{evt.name}</span>
              <span style={{ color: 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {truncate(evt.args, 80)}
              </span>
              <span className="tool-status">
                {evt.result === undefined ? (
                  <span style={{ color: 'var(--color-warning)' }}>…</span>
                ) : evt.error ? (
                  <span className="badge badge-error">error</span>
                ) : (
                  <span className="badge badge-success">done</span>
                )}
              </span>
            </div>
          ))}

          {isStreaming && toolEvents.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}>
              Streaming…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
