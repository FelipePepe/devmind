import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api.js';

interface Setting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

const OLLAMA_KEYS = [
  'ollama.base_url',
  'ollama.coding_model',
  'ollama.reasoning_model',
  'ollama.vision_model',
  'ollama.embed_model',
] as const;

const LABELS: Record<string, string> = {
  'ollama.base_url': 'Base URL',
  'ollama.coding_model': 'Coding model',
  'ollama.reasoning_model': 'Reasoning model',
  'ollama.vision_model': 'Vision model',
  'ollama.embed_model': 'Embed model',
};

export default function OllamaSettings() {
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [health, setHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => {
    apiFetch<Setting[]>('/admin/settings')
      .then((list) => {
        const map: Record<string, Setting> = {};
        for (const s of list) map[s.key] = s;
        setSettings(map);
      })
      .catch(() => null);
  };

  useEffect(() => { load(); }, []);

  const save = async (key: string, value: string) => {
    setSaving(key);
    try {
      await apiFetch(`/admin/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
        headers: { 'Content-Type': 'application/json' },
      });
      load();
    } finally {
      setSaving(null);
    }
  };

  const checkHealth = async () => {
    setChecking(true);
    setHealth('unknown');
    try {
      const res = await apiFetch<{ ok: boolean }>('/admin/settings/ollama/health');
      setHealth(res.ok ? 'ok' : 'error');
    } catch {
      setHealth('error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 900, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>Ollama Settings</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {health === 'ok' && <span style={{ fontSize: 'var(--text-sm)', color: '#22c55e' }}>● Connected</span>}
          {health === 'error' && <span style={{ fontSize: 'var(--text-sm)', color: '#ef4444' }}>● Unreachable</span>}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void checkHealth()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Test connection'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {OLLAMA_KEYS.map((key) => (
          <SettingRow
            key={key}
            label={LABELS[key] ?? key}
            setting={settings[key]}
            saving={saving === key}
            onSave={(v) => void save(key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  setting,
  saving,
  onSave,
}: {
  label: string;
  setting: Setting | undefined;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(setting?.value ?? '');

  useEffect(() => {
    if (!editing) setVal(setting?.value ?? '');
  }, [setting?.value, editing]);

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-1)',
  };

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div style={labelStyle}>{label}</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onSave(val); setEditing(false); }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button
            className="btn btn-sm"
            disabled={saving}
            onClick={() => { onSave(val); setEditing(false); }}
          >
            {saving ? '…' : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
          <code style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {setting?.value ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
          </code>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}
      {setting?.description && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
          {setting.description}
        </div>
      )}
    </div>
  );
}
