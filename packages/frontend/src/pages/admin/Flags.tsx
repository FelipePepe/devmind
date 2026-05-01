import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api.js';

interface FeatureFlag {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export default function FlagsAdmin() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const load = () => {
    apiFetch<FeatureFlag[]>('/admin/flags').then(setFlags).catch(() => null);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/admin/flags', {
      method: 'POST',
      body: JSON.stringify({ key: newKey, value: JSON.parse(newValue), description: newDesc }),
      headers: { 'Content-Type': 'application/json' },
    });
    setNewKey(''); setNewValue(''); setNewDesc('');
    load();
  };

  const update = async (key: string, value: string) => {
    await apiFetch(`/admin/flags/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value: JSON.parse(value) }),
      headers: { 'Content-Type': 'application/json' },
    });
    load();
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Feature Flags</h2>
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Description</th><th>Updated</th><th>Action</th></tr></thead>
        <tbody>
          {flags.map((f) => (
            <FlagRow key={f.key} flag={f} onUpdate={update} />
          ))}
        </tbody>
      </table>
      <h3>New Flag</h3>
      <form onSubmit={(e) => void create(e)}>
        <input placeholder="Key" value={newKey} onChange={(e) => setNewKey(e.target.value)} required />
        <input placeholder="Value (JSON)" value={newValue} onChange={(e) => setNewValue(e.target.value)} required />
        <input placeholder="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
        <button type="submit">Create</button>
      </form>
    </div>
  );
}

function FlagRow({ flag, onUpdate }: { flag: FeatureFlag; onUpdate: (key: string, value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(flag.value);
  return (
    <tr>
      <td>{flag.key}</td>
      <td>
        {editing ? <input value={val} onChange={(e) => setVal(e.target.value)} /> : flag.value}
      </td>
      <td>{flag.description}</td>
      <td>{flag.updated_at}</td>
      <td>
        {editing
          ? <><button onClick={() => { onUpdate(flag.key, val); setEditing(false); }}>Save</button><button onClick={() => setEditing(false)}>Cancel</button></>
          : <button onClick={() => setEditing(true)}>Edit</button>
        }
      </td>
    </tr>
  );
}
