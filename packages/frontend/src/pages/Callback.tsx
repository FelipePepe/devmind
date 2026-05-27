import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export default function Callback() {
  const navigate = useNavigate();
  const handleOidcCallback = useAuthStore((s) => s.handleOidcCallback);
  const user = useAuthStore((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    handleOidcCallback()
      .then(() => {
        navigate('/projects', { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [handleOidcCallback, navigate]);

  useEffect(() => {
    if (user && !error) navigate('/projects', { replace: true });
  }, [user, error, navigate]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 'var(--space-4)',
        background: 'var(--bg-app)',
        color: 'var(--text-tertiary)',
      }}
    >
      {error ? (
        <>
          <p style={{ color: 'var(--text-primary)' }}>Sign-in failed</p>
          <p style={{ fontSize: 'var(--text-sm)', maxWidth: 480, textAlign: 'center' }}>{error}</p>
          <a href="/login" style={{ color: 'var(--accent)' }}>
            Back to login
          </a>
        </>
      ) : (
        <p>Completing sign-in…</p>
      )}
    </div>
  );
}
