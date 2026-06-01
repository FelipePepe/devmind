import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

interface UserStat {
  id: string;
  username: string;
  display_name: string;
  is_admin: number;
  created_at: string;
  projects: number;
  sessions: number;
  messages: number;
  agent_runs: number;
  tool_calls: number;
  last_active: string | null;
}

export default function Stats() {
  const [stats, setStats] = useState<UserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserStat[]>('/admin/stats')
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const total = stats.reduce(
    (acc, u) => ({
      projects: acc.projects + u.projects,
      sessions: acc.sessions + u.sessions,
      messages: acc.messages + u.messages,
      agent_runs: acc.agent_runs + u.agent_runs,
      tool_calls: acc.tool_calls + u.tool_calls,
    }),
    { projects: 0, sessions: 0, messages: 0, agent_runs: 0, tool_calls: 0 }
  );

  const cell = (v: number) => (
    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--text-sm)', color: v === 0 ? 'var(--text-tertiary)' : undefined }}>
      {v.toLocaleString()}
    </td>
  );

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Admin</div>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-6)' }}>Usage stats</h1>

      {error && <div style={{ color: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>{error}</div>}

      {!loading && stats.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                {['User', 'Role', 'Projects', 'Sessions', 'Messages', 'Agent runs', 'Tool calls', 'Last active'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h === 'User' || h === 'Role' ? 'left' : 'right', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', fontWeight: 'var(--weight-medium)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: i < stats.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
                  <td style={{ padding: '8px 12px', fontSize: 'var(--text-sm)' }}>
                    <div style={{ fontWeight: 'var(--weight-medium)' }}>{u.display_name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{u.username}</div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {u.is_admin === 1 ? 'Admin' : 'User'}
                  </td>
                  {cell(u.projects)}
                  {cell(u.sessions)}
                  {cell(u.messages)}
                  {cell(u.agent_runs)}
                  {cell(u.tool_calls)}
                  <td style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                    {u.last_active ? new Date(u.last_active).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border-default)', background: 'var(--bg-surface-2)' }}>
                <td colSpan={2} style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>
                  Total ({stats.length} users)
                </td>
                {cell(total.projects)}
                {cell(total.sessions)}
                {cell(total.messages)}
                {cell(total.agent_runs)}
                {cell(total.tool_calls)}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {loading && <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Loading…</div>}
      {!loading && stats.length === 0 && !error && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>No users found.</div>
      )}
    </div>
  );
}
