import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import { wsClient } from './lib/ws.js';
import { useEffect } from 'react';
import LoginPage from './components/auth/LoginPage.js';
import AppLayout from './components/layout/AppLayout.js';
import Callback from './pages/Callback.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const pendingStep = useAuthStore((s) => s.pendingStep);

  const hasAuth = !!user;
  useEffect(() => {
    if (!hasAuth) return;
    void wsClient.connect();
    return () => wsClient.close();
  }, [hasAuth]);

  if (isLoading && pendingStep.step === 'idle') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-tertiary)', background: 'var(--bg-app)' }}>
        Loading…
      </div>
    );
  }

  return (
    <ErrorBoundary scope="App">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/projects" replace /> : <LoginPage />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="/*" element={user ? <AppLayout /> : <Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
