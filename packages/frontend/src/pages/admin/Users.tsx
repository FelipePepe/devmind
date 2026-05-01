import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api.js';

interface User {
  id: string;
  display_name: string;
  is_admin: number;
  created_at: string;
}

export default function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([]);

  const load = () => {
    apiFetch<User[]>('/admin/users').then(setUsers).catch(() => null);
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Users</h2>
      {/* Admin revocation note: isAdmin changes take up to 15 min to propagate (JWT TTL) */}
      <p style={{ color: '#888', fontSize: 12 }}>
        Note: Admin privilege changes take effect after the current access token expires (up to 15 min).
      </p>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Admin</th><th>Created</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{u.id}</td>
              <td>{u.display_name}</td>
              <td>{u.is_admin ? '✓' : '—'}</td>
              <td>{u.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
