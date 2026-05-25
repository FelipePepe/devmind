import { Routes, Route, Navigate } from 'react-router-dom';
import { type ReactNode } from 'react';
import { TopBar } from './TopBar.js';
import { LogPanel } from './LogPanel.js';
import { useAuthStore } from '../../stores/auth.js';
import { useLogStore } from '../../stores/log.js';
import Chat from '../../pages/Chat.js';
import Projects from '../../pages/Projects.js';
import Builder from '../../pages/Builder.js';
import FlagsAdmin from '../../pages/admin/Flags.js';
import UsersAdmin from '../../pages/admin/Users.js';
import JobsAdmin from '../../pages/admin/Jobs.js';
import OllamaSettings from '../../pages/admin/OllamaSettings.js';

function AdminRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
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
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<Builder />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/admin/flags" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><FlagsAdmin /></div></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><UsersAdmin /></div></AdminRoute>} />
        <Route path="/admin/jobs" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><JobsAdmin /></div></AdminRoute>} />
        <Route path="/admin/ollama" element={<AdminRoute><div style={{ gridColumn: '1 / -1', overflowY: 'auto' }}><OllamaSettings /></div></AdminRoute>} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <LogPanel />
    </div>
  );
}
