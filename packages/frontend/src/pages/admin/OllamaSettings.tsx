import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api.js';

interface Setting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

interface OllamaModel {
  name: string;
  parameter_size?: string;
  family?: string;
}

const OLLAMA_KEYS = [
  'ollama.base_url',
  'ollama.coding_model',
  'ollama.reasoning_model',
  'ollama.vision_model',
  'ollama.embed_model',
] as const;

const MODEL_KEYS = new Set<string>([
  'ollama.coding_model',
  'ollama.reasoning_model',
  'ollama.vision_model',
  'ollama.embed_model',
]);

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
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const load = () => {
    apiFetch<Setting[]>('/admin/settings')
      .then((list) => {
        const map: Record<string, Setting> = {};
        for (const s of list) map[s.key] = s;
        setSettings(map);
      })
      .catch(() => null);
  };

  const loadModels = () => {
    setModelsError(null);
    apiFetch<{ models: OllamaModel[]; error?: string }>('/admin/settings/ollama/models')
      .then((res) => {
        setModels(res.models ?? []);
        if (res.error) setModelsError(res.error);
      })
      .catch((err: Error & { details?: unknown }) => {
        setModels([]);
        setModelsError(err.message);
      });
  };

  useEffect(() => { load(); loadModels(); }, []);

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
        {OLLAMA_KEYS.map((key) => {
          const isModelKey = MODEL_KEYS.has(key);
          return (
            <SettingRow
              key={key}
              label={LABELS[key] ?? key}
              setting={settings[key]}
              saving={saving === key}
              onSave={(v) => void save(key, v)}
              {...(isModelKey ? { models, modelsError, onReloadModels: loadModels } : {})}
            />
          );
        })}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  setting,
  saving,
  onSave,
  models,
  modelsError,
  onReloadModels,
}: {
  label: string;
  setting: Setting | undefined;
  saving: boolean;
  onSave: (value: string) => void;
  models?: OllamaModel[];
  modelsError?: string | null;
  onReloadModels?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(setting?.value ?? '');
  const isModel = models !== undefined;

  useEffect(() => {
    if (!editing) setVal(setting?.value ?? '');
  }, [setting?.value, editing]);

  // When in edit mode and current value isn't in the list, allow typing it anyway.
  const currentIsKnown = isModel && (models?.some((m) => m.name === val) ?? false);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {isModel && (models?.length ?? 0) > 0 ? (
              <select
                autoFocus
                value={currentIsKnown || val === '' ? val : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') setVal(e.target.value);
                }}
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
              >
                {!currentIsKnown && val !== '' && (
                  <option value={val}>{val} (current, not in Ollama)</option>
                )}
                {models?.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{m.parameter_size ? ` — ${m.parameter_size}` : ''}{m.family ? ` (${m.family})` : ''}
                  </option>
                ))}
              </select>
            ) : (
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
            )}
            <button
              className="btn btn-sm"
              disabled={saving}
              onClick={() => { onSave(val); setEditing(false); }}
            >
              {saving ? '…' : 'Save'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {isModel && modelsError && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>
              Could not load models from Ollama: {modelsError}
              {onReloadModels && (
                <button className="btn btn-ghost btn-sm" onClick={onReloadModels} style={{ marginLeft: 'var(--space-2)' }}>Retry</button>
              )}
            </div>
          )}
          {isModel && !modelsError && (models?.length ?? 0) === 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              No models reported by Ollama. {onReloadModels && (
                <button className="btn btn-ghost btn-sm" onClick={onReloadModels}>Reload</button>
              )}
            </div>
          )}
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
