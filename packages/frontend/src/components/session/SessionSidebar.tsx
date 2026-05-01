import { apiFetch } from '../../lib/api.js';

interface Session {
  id: string;
  title: string;
  created_at: string;
}

interface SessionSidebarProps {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function SessionSidebar({ sessions, currentId, onSelect, onCreate }: SessionSidebarProps) {
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
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="btn-ghost"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-sm)',
              color: currentId === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: currentId === s.id ? 'var(--tint-2)' : 'transparent',
              border: currentId === s.id ? '1px solid var(--border-subtle)' : '1px solid transparent',
              cursor: 'pointer',
              marginBottom: 'var(--space-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.title}
          </button>
        ))}
      </div>
    </aside>
  );
}

export type { Session };
export { apiFetch };
