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

interface PasswordRule {
  label: string;
  test: (pw: string) => boolean;
}

const passwordRules: PasswordRule[] = [
  { label: 'At least 12 characters', test: (p) => p.length >= 12 },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
  { label: 'A symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function RegisterForm({ onRegister, onShowLogin }: RegisterFormProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<string[]>([]);

  const ruleStatus = passwordRules.map((r) => ({ label: r.label, ok: r.test(password) }));
  const policyOk = ruleStatus.every((r) => r.ok);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorDetails([]);
    try {
      await onRegister(username, password, displayName || username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      const details = (err as { details?: unknown }).details;
      if (Array.isArray(details)) {
        setErrorDetails(details.filter((d): d is string => typeof d === 'string'));
      }
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
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Password</label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={isLoading} />
        <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-1) 0 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {ruleStatus.map((r) => (
            <li
              key={r.label}
              style={{
                fontSize: 'var(--text-xs)',
                color: r.ok ? 'var(--color-success, #4ade80)' : 'var(--text-tertiary)',
              }}
            >
              {r.ok ? '✓' : '○'} {r.label}
            </li>
          ))}
        </ul>
      </div>
      {error && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>
          <div>{error}</div>
          {errorDetails.length > 0 && (
            <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
              {errorDetails.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={isLoading || !username || !policyOk} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Creating…' : 'Create account'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onShowLogin} disabled={isLoading} style={{ justifyContent: 'center' }}>
        Already have an account
      </button>
    </form>
  );
}
