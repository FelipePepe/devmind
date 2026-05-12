import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--bg-app)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-sans)',
  boxSizing: 'border-box',
};

interface RegisterFormProps {
  onRegister: (username: string, password: string, displayName: string) => Promise<void>;
  onShowLogin: () => void;
}

export function RegisterForm({ onRegister, onShowLogin }: RegisterFormProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onRegister(username, password, displayName || username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Username</label>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Display name <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></label>
        <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Password <span style={{ color: 'var(--text-tertiary)' }}>(min 8 chars)</span></label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={isLoading} />
      </div>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || !username || password.length < 8} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Creating…' : 'Create account'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onShowLogin} disabled={isLoading} style={{ justifyContent: 'center' }}>
        Already have an account
      </button>
    </form>
  );
}
