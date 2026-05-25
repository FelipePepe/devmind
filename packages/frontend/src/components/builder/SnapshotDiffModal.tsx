import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import type { SnapshotDiff } from '../../types/index.js';

interface Props {
  projectId: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  onCancel: () => void;
  onConfirmRestore: () => void;
  // The snapshot the user clicked (toSnapshotId by default) — used as the
  // restore target. If null, the modal hides the restore button (read-only).
  restoreTargetId?: string | null;
}

interface ExpandedFile {
  path: string;
  aText: string | null;
  bText: string | null;
  loading: boolean;
  error: string | null;
}

async function fetchBlobText(projectId: string, hash: string): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}/snapshot-blobs/${hash}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`blob ${hash}: ${res.status}`);
  return res.text();
}

function lineDiff(a: string, b: string): Array<{ kind: '+' | '-' | ' '; line: string }> {
  // Minimal LCS-based line diff. Good enough for the modal preview; resists
  // misalignment on small edits without pulling in an npm package.
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  // Build LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const out: Array<{ kind: '+' | '-' | ' '; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: ' ', line: aLines[i] ?? '' });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: '-', line: aLines[i] ?? '' });
      i++;
    } else {
      out.push({ kind: '+', line: bLines[j] ?? '' });
      j++;
    }
  }
  while (i < m) out.push({ kind: '-', line: aLines[i++] ?? '' });
  while (j < n) out.push({ kind: '+', line: bLines[j++] ?? '' });
  return out;
}

export function SnapshotDiffModal({ projectId, fromSnapshotId, toSnapshotId, onCancel, onConfirmRestore, restoreTargetId }: Props) {
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Map<string, ExpandedFile>>(new Map());

  useEffect(() => {
    let cancelled = false;
    apiFetch<SnapshotDiff>(`/api/projects/${projectId}/snapshots/${fromSnapshotId}/diff/${toSnapshotId}`)
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [projectId, fromSnapshotId, toSnapshotId]);

  const toggleFile = async (path: string, aHash: string, bHash: string) => {
    const current = expanded.get(path);
    if (current) {
      const next = new Map(expanded);
      next.delete(path);
      setExpanded(next);
      return;
    }
    const placeholder: ExpandedFile = { path, aText: null, bText: null, loading: true, error: null };
    setExpanded((prev) => new Map(prev).set(path, placeholder));
    try {
      const [aText, bText] = await Promise.all([
        fetchBlobText(projectId, aHash),
        fetchBlobText(projectId, bHash),
      ]);
      setExpanded((prev) => new Map(prev).set(path, { path, aText, bText, loading: false, error: null }));
    } catch (e) {
      setExpanded((prev) => new Map(prev).set(path, { path, aText: null, bText: null, loading: false, error: e instanceof Error ? e.message : 'fetch failed' }));
    }
  };

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 'var(--space-4)',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          width: 'min(900px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 'var(--weight-semibold)' }}>Snapshot diff</div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {fromSnapshotId.slice(0, 8)} → {toSnapshotId.slice(0, 8)}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </header>

        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
          {error && <div style={{ color: 'var(--color-error)' }}>{error}</div>}
          {!diff && !error && <div style={{ color: 'var(--text-tertiary)' }}>Loading diff…</div>}

          {diff && (
            <>
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <Counter label="Added" value={diff.files.added.length} color="var(--color-success, #6c8)" />
                <Counter label="Removed" value={diff.files.removed.length} color="var(--color-error, #c66)" />
                <Counter label="Modified" value={diff.files.modified.length} color="var(--accent)" />
              </section>

              {diff.files.added.length > 0 && (
                <FileList title="Added files" entries={diff.files.added.map((e) => e.path)} color="var(--color-success, #6c8)" />
              )}
              {diff.files.removed.length > 0 && (
                <FileList title="Removed files" entries={diff.files.removed.map((e) => e.path)} color="var(--color-error, #c66)" />
              )}

              {diff.files.modified.length > 0 && (
                <section style={{ marginBottom: 'var(--space-4)' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Modified files</div>
                  {diff.files.modified.map((m) => {
                    const exp = expanded.get(m.path);
                    return (
                      <div key={m.path} style={{ marginBottom: 'var(--space-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                        <button
                          type="button"
                          onClick={() => void toggleFile(m.path, m.a_hash, m.b_hash)}
                          style={{ width: '100%', textAlign: 'left', padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}
                        >
                          {exp ? '▾' : '▸'} {m.path}
                        </button>
                        {exp && (
                          <div style={{ padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-subtle)' }}>
                            {exp.loading && <div style={{ color: 'var(--text-tertiary)' }}>Loading…</div>}
                            {exp.error && <div style={{ color: 'var(--color-error)' }}>{exp.error}</div>}
                            {exp.aText !== null && exp.bText !== null && <DiffView a={exp.aText} b={exp.bText} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}

              <ResourceChanges resources={diff.resources} />
            </>
          )}
        </div>

        <footer style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {restoreTargetId && (
            <button type="button" className="btn btn-primary" onClick={onConfirmRestore}>
              Restore (creates new branch)
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color }}>{value}</div>
    </div>
  );
}

function FileList({ title, entries, color }: { title: string; entries: string[]; color: string }) {
  return (
    <section style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>{title}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
        {entries.map((p) => <li key={p} style={{ color, padding: '2px 0' }}>{p}</li>)}
      </ul>
    </section>
  );
}

function DiffView({ a, b }: { a: string; b: string }) {
  const lines = lineDiff(a, b);
  return (
    <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', lineHeight: 1.4, maxHeight: '300px', overflow: 'auto' }}>
      {lines.map((l, i) => (
        <div key={i} style={{
          background: l.kind === '+' ? 'rgba(120, 180, 100, 0.15)' : l.kind === '-' ? 'rgba(200, 100, 100, 0.15)' : 'transparent',
          color: l.kind === '+' ? 'var(--color-success, #8c8)' : l.kind === '-' ? 'var(--color-error, #c88)' : 'var(--text-secondary)',
          paddingLeft: '4px',
        }}>
          {l.kind} {l.line}
        </div>
      ))}
    </pre>
  );
}

function ResourceChanges({ resources }: { resources: Record<string, { added: unknown[]; removed: unknown[] }> }) {
  const rows = Object.entries(resources).filter(([, v]) => v.added.length > 0 || v.removed.length > 0);
  if (rows.length === 0) return null;
  return (
    <section>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Resource changes</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 'var(--text-xs)' }}>
        {rows.map(([type, change]) => (
          <li key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{type}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              +{change.added.length} / −{change.removed.length}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
