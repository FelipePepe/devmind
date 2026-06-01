import { useRef, useCallback, useEffect, useState } from 'react';
import { useLogStore, type LogEntry, type LogEntryType } from '../../stores/log.js';

const TYPE_COLOR: Record<LogEntryType, string> = {
  request: 'var(--color-info)',
  response: 'var(--accent)',
  tool_call: 'var(--color-warning)',
  tool_result: 'var(--color-success)',
  done: 'var(--color-success)',
  error: 'var(--color-error)',
};

const TYPE_BADGE: Record<LogEntryType, string> = {
  request: 'REQ',
  response: 'RES',
  tool_call: 'TOOL',
  tool_result: 'RES',
  done: 'DONE',
  error: 'ERR',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function EntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(entry.type === 'request');
  const color = TYPE_COLOR[entry.type];
  const badge = TYPE_BADGE[entry.type];
  const hasContent = entry.content.length > 0;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
      }}
    >
      <div
        onClick={() => hasContent && setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '3px var(--space-3)',
          cursor: hasContent ? 'pointer' : 'default',
        }}
      >
        <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{formatTime(entry.timestamp)}</span>
        <span
          style={{
            color,
            fontWeight: 'var(--weight-semibold)',
            fontSize: '9px',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
            padding: '1px 4px',
            border: `1px solid ${color}`,
            borderRadius: 'var(--radius-xs)',
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
        <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.label}
        </span>
        {hasContent && (
          <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && hasContent && (
        <pre
          style={{
            margin: '0 var(--space-3) var(--space-2)',
            padding: 'var(--space-2)',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            color: 'var(--text-tertiary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '180px',
            overflowY: 'auto',
            fontSize: 'var(--text-xs)',
            lineHeight: 'var(--leading-code)',
          }}
        >
          {entry.content}
        </pre>
      )}
    </div>
  );
}

export function LogPanel() {
  const { entries, isOpen, height, setOpen, setHeight, clearEntries } = useLogStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, isOpen]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startY = e.clientY;
      const startH = height;

      const onMove = (ev: MouseEvent) => {
        setHeight(startH + (startY - ev.clientY));
      };
      const onUp = () => {
        isDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, setHeight]
  );

  const showPanel = entries.length > 0 || isOpen;
  if (!showPanel) return null;

  const panelHeight = isOpen ? height : 29;

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-sidebar)',
        borderTop: '1px solid var(--border-subtle)',
        height: `${panelHeight}px`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Drag handle — only visible when open */}
      {isOpen && (
        <div
          onMouseDown={onDragStart}
          title="Drag to resize"
          style={{
            height: '4px',
            cursor: 'ns-resize',
            flexShrink: 0,
            background: 'transparent',
            transition: 'background var(--duration-fast)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'; }}
          onMouseLeave={(e) => { if (!isDragging.current) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        />
      )}

      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '0 var(--space-3)',
          height: '25px',
          flexShrink: 0,
          borderBottom: isOpen ? '1px solid var(--border-subtle)' : 'none',
          background: 'var(--bg-surface)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--weight-semibold)',
          }}
        >
          Agent Log
        </span>
        {entries.length > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
            {entries.length} events
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
          {entries.length > 0 && (
            <button
              onClick={clearEntries}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: 'var(--radius-xs)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setOpen(!isOpen)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: 'var(--radius-xs)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}
          >
            {isOpen ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* Entry list */}
      {isOpen && (
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
          {entries.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-4)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-xs)',
                textAlign: 'center',
              }}
            >
              Waiting for agent activity…
            </div>
          ) : (
            entries.map((e) => <EntryRow key={e.id} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}
