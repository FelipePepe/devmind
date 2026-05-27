import { useAuthStore } from '../../stores/auth.js';
import { isOidcConfigured, signinRedirect } from '../../lib/oidc.js';

export function MigrationBanner() {
  const user = useAuthStore((s) => s.user);
  const authSource = useAuthStore((s) => s.authSource);

  if (!isOidcConfigured()) return null;
  if (!user) return null;
  if (authSource !== 'local') return null;
  if (user.kc_subject) return null;

  return (
    <div
      role="alert"
      style={{
        gridColumn: '1 / -1',
        padding: 'var(--space-2) var(--space-4)',
        background: 'rgba(217, 119, 87, 0.12)',
        borderBottom: '1px solid var(--accent)',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span>
        Esta cuenta sigue usando login local. Vincúlala a Keycloak para no
        perderla cuando se desactive la autenticación local.
      </span>
      <button
        type="button"
        onClick={() => {
          void signinRedirect();
        }}
        style={{
          padding: 'var(--space-1) var(--space-3)',
          background: 'var(--accent)',
          color: 'var(--bg-app)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontWeight: 'var(--weight-semibold)',
          flexShrink: 0,
        }}
      >
        Vincular ahora
      </button>
    </div>
  );
}
