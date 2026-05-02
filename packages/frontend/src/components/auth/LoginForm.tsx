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

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onShowRegister: () => void;
}

export function LoginForm({ onLogin, onShowRegister }: LoginFormProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Username</label>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Password</label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={isLoading} />
      </div>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || !username || !password} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Signing in…' : 'Sign in'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onShowRegister} disabled={isLoading} style={{ justifyContent: 'center' }}>
        Create account
      </button>
    </form>
  );
}
