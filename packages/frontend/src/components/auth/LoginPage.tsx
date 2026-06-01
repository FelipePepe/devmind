import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { LoginForm } from './LoginForm.js';
import { RegisterForm } from './RegisterForm.js';
import { MfaForm } from './MfaForm.js';
import { TotpSetupForm } from './TotpSetupForm.js';
import { isOidcConfigured } from '../../lib/oidc.js';

type LoginView = 'login' | 'register';

const LOCAL_ENABLED = (import.meta.env['VITE_AUTH_LOCAL_ENABLED'] ?? 'true') !== 'false';
const OIDC_ENABLED = isOidcConfigured();

export default function LoginPage() {
  const { login, confirmMfa, register, confirmRegister, pendingStep, loginOidc } = useAuthStore();
  const [view, setView] = useState<LoginView>('login');
  const [oidcError, setOidcError] = useState<string | null>(null);

  const titles: Record<string, string> = {
    login: 'Sign in',
    register: 'Create account',
    mfa: 'Two-factor auth',
    'register-totp': 'Set up 2FA',
  };
  const currentTitle = pendingStep.step !== 'idle' ? titles[pendingStep.step] : titles[view];

  const triggerOidc = (): void => {
    setOidcError(null);
    void loginOidc().catch((err: unknown) => {
      setOidcError(err instanceof Error ? err.message : String(err));
    });
  };

  const showLocalForms = LOCAL_ENABLED && pendingStep.step === 'idle';
  const localFormsCollapsed = OIDC_ENABLED; // when KC is the default, hide local behind <details>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 'var(--space-4)', background: 'var(--bg-app)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', padding: 'var(--space-8)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', width: '360px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--accent)', margin: 0 }}>DevMind</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>{currentTitle}</p>
        </div>

        {OIDC_ENABLED && pendingStep.step === 'idle' && (
          <button
            type="button"
            onClick={triggerOidc}
            style={{
              width: '100%',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--accent)',
              color: 'var(--bg-app)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
            }}
          >
            Iniciar sesión con Keycloak
          </button>
        )}

        {oidcError && (
          <p style={{ color: 'var(--text-danger, #c62828)', fontSize: 'var(--text-xs)', margin: 0 }}>
            {oidcError}
          </p>
        )}

        {pendingStep.step === 'mfa' && (
          <MfaForm onConfirm={confirmMfa} onCancel={() => setView('login')} />
        )}
        {pendingStep.step === 'register-totp' && (
          <TotpSetupForm pendingStep={pendingStep} onConfirm={confirmRegister} />
        )}

        {showLocalForms && (
          localFormsCollapsed ? (
            <details style={{ width: '100%', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Login local (transitorio)</summary>
              <div style={{ marginTop: 'var(--space-3)' }}>
                {view === 'login' ? (
                  <LoginForm onLogin={login} onShowRegister={() => setView('register')} />
                ) : (
                  <RegisterForm onRegister={register} onShowLogin={() => setView('login')} />
                )}
              </div>
            </details>
          ) : view === 'login' ? (
            <LoginForm onLogin={login} onShowRegister={() => setView('register')} />
          ) : (
            <RegisterForm onRegister={register} onShowLogin={() => setView('login')} />
          )
        )}

        {!LOCAL_ENABLED && !OIDC_ENABLED && (
          <p style={{ color: 'var(--text-danger, #c62828)', fontSize: 'var(--text-sm)', margin: 0 }}>
            No authentication method is configured.
          </p>
        )}
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
        v{__APP_VERSION__}
      </p>
    </div>
  );
}
