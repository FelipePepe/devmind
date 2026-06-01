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

interface MfaFormProps {
  onConfirm: (code: string) => Promise<void>;
  onCancel: () => void;
}

export function MfaForm({ onConfirm, onCancel }: MfaFormProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onConfirm(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setCode('');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
        Enter the 6-digit code from your authenticator app
      </p>
      <input
        style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.3em', fontSize: 'var(--text-lg)' }}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        autoFocus
        inputMode="numeric"
        disabled={isLoading}
      />
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)', textAlign: 'center' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || code.length !== 6} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Verifying…' : 'Verify'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel} style={{ justifyContent: 'center' }}>
        Back
      </button>
    </form>
  );
}
