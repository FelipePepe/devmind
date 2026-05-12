import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.js';

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="top-bar">
      <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)', color: 'var(--accent)', letterSpacing: 'var(--tracking-tight)' }}>
        DevMind
      </span>
      {user && (
        <>
          <Link to="/projects" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Projects</Link>
          <Link to="/chat" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Legacy Chat</Link>
          {user.is_admin === 1 && (
            <>
              <span style={{ color: 'var(--border-default)', userSelect: 'none' }}>|</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Admin</span>
              <Link to="/admin/flags" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Flags</Link>
              <Link to="/admin/users" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Users</Link>
              <Link to="/admin/jobs" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Jobs</Link>
              <Link to="/admin/ollama" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Ollama</Link>
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {user.display_name ?? user.username}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>Logout</button>
          </div>
        </>
      )}
    </header>
  );
}
