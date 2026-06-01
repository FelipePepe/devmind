import { useState } from 'react';
import type { ProjectSnapshotsTimeline, SnapshotRetention, SnapshotTrigger, TimelineNode } from '../../types/index.js';

const TRIGGER_ICON: Record<SnapshotTrigger, string> = {
  'manual': '◆',
  'auto-pre-agent': '◐',
  'auto-post-agent': '●',
  'milestone': '★',
  'branch-root': '↳',
};

const TRIGGER_LABEL: Record<SnapshotTrigger, string> = {
  'manual': 'manual',
  'auto-pre-agent': 'pre-agent',
  'auto-post-agent': 'post-agent',
  'milestone': 'milestone',
  'branch-root': 'branch',
};

interface Props {
  timeline: ProjectSnapshotsTimeline | null;
  onRestore: (snapshotId: string) => void;
  onUpdateLabel: (snapshotId: string, label: string | null) => Promise<void>;
  onUpdateRetention: (snapshotId: string, retention: SnapshotRetention) => Promise<void>;
}

interface IndentedNode extends TimelineNode {
  depth: number;
}

function indentNodes(nodes: TimelineNode[]): IndentedNode[] {
  // Simple depth = chain length from the first ancestor without a parent.
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const depthCache = new Map<string, number>();
  const depthOf = (n: TimelineNode): number => {
    const cached = depthCache.get(n.id);
    if (cached !== undefined) return cached;
    if (!n.parent_id || !byId.has(n.parent_id)) {
      depthCache.set(n.id, 0);
      return 0;
    }
    const d = depthOf(byId.get(n.parent_id) as TimelineNode) + 1;
    depthCache.set(n.id, d);
    return d;
  };
  return nodes
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((n) => ({ ...n, depth: depthOf(n) }));
}

export function SnapshotsTimeline({ timeline, onRestore, onUpdateLabel, onUpdateRetention }: Props) {
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  if (!timeline || timeline.nodes.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
        No snapshots yet.
      </div>
    );
  }

  const nodes = indentNodes(timeline.nodes);

  const commitLabel = async (id: string) => {
    const trimmed = labelDraft.trim();
    await onUpdateLabel(id, trimmed.length === 0 ? null : trimmed);
    setEditingLabelId(null);
    setLabelDraft('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2) var(--space-2)' }}>
        Timeline
      </div>
      {nodes.map((node) => {
        const isTip = node.id === timeline.tip_id;
        const isPinned = node.retention === 'pinned';
        const isEditing = editingLabelId === node.id;
        return (
          <div
            key={node.id}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              marginLeft: `${node.depth * 12}px`,
              background: isTip ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              border: `1px solid ${isTip ? 'var(--accent)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span title={TRIGGER_LABEL[node.trigger]} style={{ color: 'var(--text-tertiary)' }}>
                {TRIGGER_ICON[node.trigger]}
              </span>
              {isEditing ? (
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => void commitLabel(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitLabel(node.id);
                    if (e.key === 'Escape') {
                      setEditingLabelId(null);
                      setLabelDraft('');
                    }
                  }}
                  style={{ flex: 1, background: 'transparent', border: '1px solid var(--accent)', color: 'var(--text-primary)', padding: '2px 4px', fontSize: 'inherit' }}
                />
              ) : (
                <span
                  style={{ flex: 1, fontWeight: isTip ? 'var(--weight-semibold)' : 'var(--weight-regular)', cursor: 'text' }}
                  onClick={() => {
                    setEditingLabelId(node.id);
                    setLabelDraft(node.label ?? '');
                  }}
                  title="Click to rename"
                >
                  {node.label ?? `${TRIGGER_LABEL[node.trigger]} snapshot`}
                </span>
              )}
              {isTip && <span style={{ color: 'var(--accent)', fontSize: '10px' }}>● now</span>}
              <button
                type="button"
                onClick={() => void onUpdateRetention(node.id, isPinned ? 'ephemeral' : 'pinned')}
                title={isPinned ? 'Unpin' : 'Pin (survives prune)'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: isPinned ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontSize: '12px',
                  padding: 0,
                }}
              >
                {isPinned ? '📌' : '📍'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)', color: 'var(--text-tertiary)', fontSize: '10px' }}>
              <span>{new Date(node.created_at).toLocaleTimeString()}</span>
              {!isTip && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRestore(node.id)}
                  style={{ padding: '0 var(--space-2)', fontSize: '10px' }}
                >
                  Restore…
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
