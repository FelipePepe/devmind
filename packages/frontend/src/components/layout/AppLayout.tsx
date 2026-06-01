import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { TopBar } from './TopBar.js';
import { LogPanel } from './LogPanel.js';
import { MigrationBanner } from './MigrationBanner.js';
import { useAuthStore } from '../../stores/auth.js';
import { useLogStore } from '../../stores/log.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

const Chat = lazy(() => import('../../pages/Chat.js'));
const Projects = lazy(() => import('../../pages/Projects.js'));
const Builder = lazy(() => import('../../pages/Builder.js'));
const FlagsAdmin = lazy(() => import('../../pages/admin/Flags.js'));
const UsersAdmin = lazy(() => import('../../pages/admin/Users.js'));
const JobsAdmin = lazy(() => import('../../pages/admin/Jobs.js'));
const OllamaSettings = lazy(() => import('../../pages/admin/OllamaSettings.js'));
const Account = lazy(() => import('../../pages/Account.js'));

function PageLoader() {
  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
      Loading…
    </div>
  );
}

function Page({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <ErrorBoundary scope={scope}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function AdminRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function AppLayout() {
  const isLogOpen = useLogStore((s) => s.isOpen);
  const logHeight = useLogStore((s) => s.height);

  return (
    <div
      className="app-layout"
      style={{
        gridTemplateRows: isLogOpen ? `var(--topbar-height) 1fr ${logHeight}px` : 'var(--topbar-height) 1fr',
      }}
    >
      <TopBar />
      <MigrationBanner />
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Page scope="Projects"><Projects /></Page>} />
        <Route path="/projects/:id" element={<Page scope="Builder"><Builder /></Page>} />
        <Route path="/chat" element={<Page scope="Chat"><Chat /></Page>} />
        <Route path="/admin/flags" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><Page scope="Flags"><FlagsAdmin /></Page></div></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><Page scope="Users"><UsersAdmin /></Page></div></AdminRoute>} />
        <Route path="/admin/jobs" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><Page scope="Jobs"><JobsAdmin /></Page></div></AdminRoute>} />
        <Route path="/admin/ollama" element={<AuthRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><Page scope="Ollama settings"><OllamaSettings /></Page></div></AuthRoute>} />
        <Route path="/account" element={<AuthRoute><Page scope="Account"><Account /></Page></AuthRoute>} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <ErrorBoundary scope="Log panel">
        <LogPanel />
      </ErrorBoundary>
    </div>
  );
}
