import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth, type User, type PendingStep } from './hooks/useAuth.js';
import { wsClient } from './lib/ws.js';
import Chat from './pages/Chat.js';
import FlagsAdmin from './pages/admin/Flags.js';
import UsersAdmin from './pages/admin/Users.js';
import JobsAdmin from './pages/admin/Jobs.js';
import { useEffect, useState, type ReactNode } from 'react';

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

// ── Shared input style ────────────────────────────────────────────────────────
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

// ── Login: step 1 — credentials ───────────────────────────────────────────────
function CredentialsForm({
  onLogin,
  onShowRegister,
  isLoading,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
  onShowRegister: () => void;
  isLoading: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Username</label>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Password</label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={isLoading} />
      </div>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || !username || !password} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Signing in…' : 'Sign in'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onShowRegister} disabled={isLoading} style={{ justifyContent: 'center' }}>
        Create account
      </button>
    </form>
  );
}

// ── Login: step 2 — TOTP code ─────────────────────────────────────────────────
function MfaForm({
  onConfirm,
  onCancel,
  isLoading,
}: {
  onConfirm: (code: string) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}) {
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

// ── Register: step 1 — credentials ───────────────────────────────────────────
function RegisterForm({
  onRegister,
  onShowLogin,
  isLoading,
}: {
  onRegister: (username: string, password: string, displayName: string) => Promise<void>;
  onShowLogin: () => void;
  isLoading: boolean;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onRegister(username, password, displayName || username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Username</label>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Display name <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></label>
        <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" disabled={isLoading} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Password <span style={{ color: 'var(--text-tertiary)' }}>(min 8 chars)</span></label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={isLoading} />
      </div>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #e05252)' }}>{error}</span>}
      <button className="btn btn-primary" type="submit" disabled={isLoading || !username || password.length < 8} style={{ justifyContent: 'center' }}>
        {isLoading ? 'Creating…' : 'Create account'}
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onShowLogin} disabled={isLoading} style={{ justifyContent: 'center' }}>
        Already have an account
      </button>
    </form>
  );
}

// ── Register: step 2 — TOTP setup ────────────────────────────────────────────
function TotpSetupForm({
  pendingStep,
  onConfirm,
  isLoading,
}: {
  pendingStep: Extract<PendingStep, { step: 'register-totp' }>;
  onConfirm: (code: string) => Promise<void>;
  isLoading: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

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
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>
          Scan this code with your authenticator app<br />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>(Google Authenticator, Authy, 1Password…)</span>
        </p>
        <a
          href={pendingStep.totpUri}
          style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', wordBreak: 'break-all' }}
        >
          Open in authenticator app
        </a>
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

// ── Main login page ───────────────────────────────────────────────────────────
type LoginView = 'login' | 'register';

function LoginPage({
  login,
  confirmMfa,
  register,
  confirmRegister,
  pendingStep,
  isLoading,
}: {
  login: (username: string, password: string) => Promise<void>;
  confirmMfa: (code: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  confirmRegister: (code: string) => Promise<void>;
  pendingStep: PendingStep;
  isLoading: boolean;
}) {
  const [view, setView] = useState<LoginView>('login');

  const titles: Record<string, string> = {
    login: 'Sign in',
    register: 'Create account',
    mfa: 'Two-factor auth',
    'register-totp': 'Set up 2FA',
  };
  const currentTitle = pendingStep.step !== 'idle' ? titles[pendingStep.step] : titles[view];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 'var(--space-4)', background: 'var(--bg-app)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', padding: 'var(--space-8)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', width: '360px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--accent)', margin: 0 }}>DevMind</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>{currentTitle}</p>
        </div>

        {pendingStep.step === 'mfa' && (
          <MfaForm
            onConfirm={confirmMfa}
            onCancel={() => { /* reset handled in hook on next login call */ setView('login'); }}
            isLoading={isLoading}
          />
        )}
        {pendingStep.step === 'register-totp' && (
          <TotpSetupForm pendingStep={pendingStep} onConfirm={confirmRegister} isLoading={isLoading} />
        )}
        {pendingStep.step === 'idle' && view === 'login' && (
          <CredentialsForm onLogin={login} onShowRegister={() => setView('register')} isLoading={isLoading} />
        )}
        {pendingStep.step === 'idle' && view === 'register' && (
          <RegisterForm onRegister={register} onShowLogin={() => setView('login')} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}

function TopBar({ user, logout }: { user: User | null; logout: () => Promise<void> }) {
  return (
    <header className="top-bar">
      <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)', color: 'var(--accent)', letterSpacing: 'var(--tracking-tight)' }}>
        DevMind
      </span>
      {user && (
        <>
          <Link to="/" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Chat</Link>
          {user.is_admin === 1 && (
            <>
              <Link to="/admin/flags" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Flags</Link>
              <Link to="/admin/users" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Users</Link>
              <Link to="/admin/jobs" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textDecoration: 'none' }}>Jobs</Link>
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

export default function App() {
  const { user, pendingStep, login, confirmMfa, register, confirmRegister, logout, isLoading } = useAuth();
  useWsConnection(!!user);

  if (isLoading && !pendingStep) {
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
          element={
            user ? (
              <Navigate to="/" replace />
            ) : (
              <LoginPage
                login={login}
                confirmMfa={confirmMfa}
                register={register}
                confirmRegister={confirmRegister}
                pendingStep={pendingStep}
                isLoading={isLoading}
              />
            )
          }
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
