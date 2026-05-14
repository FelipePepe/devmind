import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { useAuthStore } from '../../stores/auth.js';

interface OllamaHealth {
  ok: boolean;
  model: string | null;
  baseUrl: string;
}

export function OllamaStatusDot() {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<OllamaHealth | null>(null);

  useEffect(() => {
    const poll = () => {
      apiFetch<OllamaHealth>('/api/ollama/health')
        .then(setStatus)
        .catch(() => setStatus({ ok: false, model: null, baseUrl: '' }));
    };

    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  const dotColor =
    status === null
      ? 'var(--text-tertiary)'
      : status.ok
        ? 'var(--color-success)'
        : 'var(--color-error)';

  const tooltip = status === null
    ? 'Ollama — checking…'
    : status.ok
      ? `Ollama online${status.model ? ` — ${status.model}` : ''}`
      : 'Ollama offline';

  const dot = (
    <span
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: dotColor,
        flexShrink: 0,
        transition: 'background 0.3s',
      }}
    />
  );

  if (user?.is_admin === 1) {
    return (
      <Link
        to="/admin/ollama"
        title={tooltip}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}
      >
        {dot}
        <span>Ollama</span>
      </Link>
    );
  }

  return (
    <span
      title={tooltip}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}
    >
      {dot}
      <span>Ollama</span>
    </span>
  );
}
