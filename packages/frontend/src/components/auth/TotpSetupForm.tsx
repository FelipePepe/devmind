import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { useAuthStore } from '../../stores/auth.js';
import type { PendingStep } from '../../types/index.js';

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

interface TotpSetupFormProps {
  pendingStep: Extract<PendingStep, { step: 'register-totp' }>;
  onConfirm: (code: string) => Promise<void>;
}

export function TotpSetupForm({ pendingStep, onConfirm }: TotpSetupFormProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, pendingStep.totpUri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [pendingStep.totpUri]);

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

  const copySecret = () => {
    void navigator.clipboard.writeText(pendingStep.totpSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-3)' }}>
          Scan this code with your authenticator app<br />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>(Google Authenticator, Authy, 1Password…)</span>
        </p>
        <div style={{ display: 'inline-block', background: '#fff', padding: '8px', borderRadius: 'var(--radius-sm)' }}>
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Manual entry key</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copySecret} style={{ fontSize: 'var(--text-xs)' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <code style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', wordBreak: 'break-all' }}>
          {pendingStep.totpSecret}
        </code>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Enter the 6-digit code to confirm</label>
        <input
          style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.3em', fontSize: 'var(--text-lg)' }}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          autoFocus
          inputMode="numeric"
          disabled={isLoading}
        />
      </div>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)', textAlign: 'center' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || code.length !== 6} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Confirming…' : 'Confirm & sign in'}
      </button>
    </form>
  );
}
