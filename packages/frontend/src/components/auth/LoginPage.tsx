import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { LoginForm } from './LoginForm.js';
import { RegisterForm } from './RegisterForm.js';
import { MfaForm } from './MfaForm.js';
import { TotpSetupForm } from './TotpSetupForm.js';

type LoginView = 'login' | 'register';

export default function LoginPage() {
  const { login, confirmMfa, register, confirmRegister, pendingStep } = useAuthStore();
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
          <MfaForm onConfirm={confirmMfa} onCancel={() => setView('login')} />
        )}
        {pendingStep.step === 'register-totp' && (
          <TotpSetupForm pendingStep={pendingStep} onConfirm={confirmRegister} />
        )}
        {pendingStep.step === 'idle' && view === 'login' && (
          <LoginForm onLogin={login} onShowRegister={() => setView('register')} />
        )}
        {pendingStep.step === 'idle' && view === 'register' && (
          <RegisterForm onRegister={register} onShowLogin={() => setView('login')} />
        )}
      </div>
    </div>
  );
}
