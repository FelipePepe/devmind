import { useState } from 'react';
import type { Session } from '../../types/index.js';

interface SessionSidebarProps {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function SessionSidebar({ sessions, currentId, onSelect, onCreate, onDelete }: SessionSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
            color: 'var(--text-tertiary)',
          }}
        >
          Sessions
        </span>
        <button
          className="btn btn-ghost btn-icon"
          onClick={onCreate}
          title="New session"
          style={{ fontSize: 'var(--text-md)', padding: 'var(--space-1)' }}
        >
          +
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
        {sessions.length === 0 && (
          <div
            style={{
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-4)',
              textAlign: 'center',
            }}
          >
            No sessions yet
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{ position: 'relative', marginBottom: 'var(--space-1)' }}
            onMouseEnter={() => setHoveredId(s.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              onClick={() => onSelect(s.id)}
              className="btn-ghost"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: 'var(--space-2) var(--space-3)',
                paddingRight: 'var(--space-8)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
                color: currentId === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: currentId === s.id ? 'var(--tint-2)' : 'transparent',
                border: currentId === s.id ? '1px solid var(--border-subtle)' : '1px solid transparent',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.title}
            </button>
            {hoveredId === s.id && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete session"
                style={{
                  position: 'absolute',
                  right: 'var(--space-2)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1,
                  padding: '2px 4px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--tint-2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

