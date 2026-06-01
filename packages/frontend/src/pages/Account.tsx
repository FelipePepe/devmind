import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { apiFetch } from '../lib/api.js';

export default function Account() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [phase, setPhase] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setPhase('deleting');
    setError(null);
    try {
      await apiFetch('/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete my account' }),
      });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setPhase('idle');
    }
  };

  if (!user) return null;

  return (
    <div style={{ gridColumn: '1 / -1', overflowY: 'auto', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

        <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
          <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
            Profile
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <span style={{ color: 'var(--text-tertiary)', minWidth: '100px', fontSize: 'var(--text-sm)' }}>Display name</span>
              <span style={{ fontSize: 'var(--text-sm)' }}>{user.display_name}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <span style={{ color: 'var(--text-tertiary)', minWidth: '100px', fontSize: 'var(--text-sm)' }}>Username</span>
              <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}>{user.username}</span>
            </div>
            {user.email && (
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <span style={{ color: 'var(--text-tertiary)', minWidth: '100px', fontSize: 'var(--text-sm)' }}>Email</span>
                <span style={{ fontSize: 'var(--text-sm)' }}>{user.email}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <span style={{ color: 'var(--text-tertiary)', minWidth: '100px', fontSize: 'var(--text-sm)' }}>Role</span>
              <span style={{ fontSize: 'var(--text-sm)' }}>{user.is_admin === 1 ? 'Admin' : 'User'}</span>
            </div>
          </div>
        </section>

        <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
          <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--color-error)', marginBottom: 'var(--space-3)' }}>
            Danger zone
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Delete account</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
              Permanently deletes your account and all data: projects, files, snapshots, chat history. This action cannot be undone.
            </div>
          </div>
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>{error}</div>
          )}
          {phase === 'idle' && (
            <button
              className="btn btn-sm"
              style={{ background: 'transparent', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}
              onClick={() => setPhase('confirm')}
            >
              Delete my account…
            </button>
          )}
          {phase === 'confirm' && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Are you sure? This is irreversible.</span>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--color-error)', color: '#fff', border: 'none' }}
                onClick={() => void handleDelete()}
              >
                Yes, delete everything
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPhase('idle')}>Cancel</button>
            </div>
          )}
          {phase === 'deleting' && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Deleting…</span>
          )}
        </section>

      </div>
    </div>
  );
}
