import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth, type User } from './hooks/useAuth.js';
import { wsClient } from './lib/ws.js';
import Chat from './pages/Chat.js';
import FlagsAdmin from './pages/admin/Flags.js';
import UsersAdmin from './pages/admin/Users.js';
import JobsAdmin from './pages/admin/Jobs.js';
import { useEffect, type ReactNode } from 'react';

function useWsConnection(hasAuth: boolean) {
  useEffect(() => {
    if (!hasAuth) return;
    void wsClient.connect();
    return () => wsClient.close();
  }, [hasAuth]);
}

function ProtectedRoute({ children, user }: { children: ReactNode; user: { id: string } | null }) {
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children, user }: { children: ReactNode; user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LoginPage({
  login,
  register,
  isLoading,
}: {
  login: () => Promise<void>;
  register: (displayName?: string) => Promise<void>;
  isLoading: boolean;
}) {
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
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-6)',
          padding: 'var(--space-8)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          minWidth: '320px',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)', textAlign: 'center' }}>
            DevMind
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-1)' }}>
            Local AI coding assistant
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
          <button className="btn btn-primary" onClick={() => void login()} disabled={isLoading} style={{ justifyContent: 'center' }}>
            Sign in with Passkey
          </button>
          <button className="btn btn-secondary" onClick={() => void register()} disabled={isLoading} style={{ justifyContent: 'center' }}>
            Register Passkey
          </button>
        </div>
        {isLoading && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Loading…</span>
        )}
      </div>
    </div>
  );
}

function TopBar({ user, logout }: { user: User | null; logout: () => Promise<void> }) {
  return (
    <header className="top-bar">
      <span
        style={{
          fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-md)',
          color: 'var(--accent)',
          letterSpacing: 'var(--tracking-tight)',
        }}
      >
        DevMind
      </span>
      {user && (
        <>
          <Link
            to="/"
            style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            Chat
          </Link>
          {user.is_admin && (
            <>
              <Link to="/admin/flags" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Flags</Link>
              <Link to="/admin/users" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Users</Link>
              <Link to="/admin/jobs" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Jobs</Link>
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {user.display_name ?? user.id.slice(0, 8)}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
              Logout
            </button>
          </div>
        </>
      )}
    </header>
  );
}

export default function App() {
  const { user, login, register, logout, isLoading } = useAuth();
  useWsConnection(!!user);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-tertiary)', background: 'var(--bg-app)' }}>
        Loading…
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage login={login} register={register} isLoading={isLoading} />}
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute user={user}>
              <div className="app-layout">
                <TopBar user={user} logout={logout} />
                <Routes>
                  <Route path="/" element={<Chat />} />
                  <Route path="/admin/flags" element={<AdminRoute user={user}><FlagsAdmin /></AdminRoute>} />
                  <Route path="/admin/users" element={<AdminRoute user={user}><UsersAdmin /></AdminRoute>} />
                  <Route path="/admin/jobs" element={<AdminRoute user={user}><JobsAdmin /></AdminRoute>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
