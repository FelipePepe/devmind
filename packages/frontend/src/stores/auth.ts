import { create } from 'zustand';
import { type User, type PendingStep } from '../types/index.js';
import { apiFetch, setAccessToken, setRefreshHandler } from '../lib/api.js';
import { useLogStore } from './log.js';
import { isOidcConfigured, readCallback, signinRedirect, signoutRedirect } from '../lib/oidc.js';

type AuthSource = 'local' | 'oidc';
const SOURCE_KEY = 'auth.source';

// Module-level flag: prevents double-invoke from React StrictMode or re-renders.
// Lives outside React so it survives unmount/remount cycles.
let _oidcCallbackInFlight = false;

function readSource(): AuthSource | null {
  const value = sessionStorage.getItem(SOURCE_KEY);
  return value === 'local' || value === 'oidc' ? value : null;
}

function writeSource(source: AuthSource | null): void {
  if (source) sessionStorage.setItem(SOURCE_KEY, source);
  else sessionStorage.removeItem(SOURCE_KEY);
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  pendingStep: PendingStep;
  authSource: AuthSource | null;
  login: (username: string, password: string) => Promise<void>;
  confirmMfa: (code: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  confirmRegister: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  loginOidc: () => Promise<void>;
  handleOidcCallback: () => Promise<void>;
}

let moduleToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const middle = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = middle + '='.repeat((4 - (middle.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function scheduleRefresh(accessToken: string): void {
  clearRefreshTimer();
  const exp = decodeJwtExp(accessToken);
  if (!exp) return;
  const ms = exp * 1000 - Date.now() - 30_000; // refresh 30s before expiry
  if (ms <= 0) {
    void useAuthStore.getState().refresh().catch(() => null);
    return;
  }
  refreshTimer = setTimeout(() => {
    void useAuthStore.getState().refresh().catch(() => null);
  }, ms);
}

function applyAuthState(result: { accessToken: string; user: User }, source: AuthSource): void {
  moduleToken = result.accessToken;
  setAccessToken(moduleToken);
  writeSource(source);
  scheduleRefresh(result.accessToken);
  console.log('[INFO][auth] Auth state applied, user:', result.user.username, 'source:', source);
  useLogStore.getState().addEntry({
    type: 'response',
    label: 'Auth',
    content: `Logged in as ${result.user.username} (${result.user.display_name}) — ${source}`,
  });
  useAuthStore.setState({
    user: result.user,
    accessToken: moduleToken,
    isLoading: false,
    pendingStep: { step: 'idle' },
    authSource: source,
  });
}

interface OidcTokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

function normalizeOidcResponse(res: OidcTokenResponse): { accessToken: string; user: User } {
  return { accessToken: res.access_token, user: res.user };
}

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  accessToken: null,
  isLoading: true,
  pendingStep: { step: 'idle' },
  authSource: null,

  login: async (username, password) => {
    console.log('[INFO][auth] Login attempt for:', username);
    useLogStore.getState().addEntry({ type: 'request', label: 'Auth: Login', content: username });
    useAuthStore.setState({ isLoading: true });
    try {
      const res = await apiFetch<
        | { mfaRequired: true; mfaToken: string }
        | { accessToken: string; user: User }
      >('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        headers: { 'Content-Type': 'application/json' },
      });
      if ('mfaRequired' in res && res.mfaRequired) {
        console.log('[INFO][auth] MFA required');
        useLogStore.getState().addEntry({ type: 'request', label: 'Auth: MFA Required', content: 'Enter TOTP code' });
        useAuthStore.setState({ pendingStep: { step: 'mfa', mfaToken: res.mfaToken }, isLoading: false });
      } else {
        applyAuthState(res as { accessToken: string; user: User }, 'local');
      }
    } catch (err) {
      console.error('[ERROR][auth] Login failed:', err);
      useLogStore.getState().addEntry({ type: 'error', label: 'Auth: Login Failed', content: err instanceof Error ? err.message : String(err) });
      useAuthStore.setState({ isLoading: false });
      throw err;
    }
  },

  confirmMfa: async (code) => {
    const { pendingStep } = useAuthStore.getState();
    if (pendingStep.step !== 'mfa') return;
    console.log('[INFO][auth] Confirming MFA...');
    useAuthStore.setState({ isLoading: true });
    try {
      const result = await apiFetch<{ accessToken: string; user: User }>('/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ mfaToken: pendingStep.mfaToken, code }),
        headers: { 'Content-Type': 'application/json' },
      });
      applyAuthState(result, 'local');
    } catch (err) {
      console.error('[ERROR][auth] MFA confirm failed:', err);
      useAuthStore.setState({ isLoading: false });
      throw err;
    }
  },

  register: async (username, password, displayName) => {
    console.log('[INFO][auth] Register attempt:', username);
    useLogStore.getState().addEntry({ type: 'request', label: 'Auth: Register', content: username });
    useAuthStore.setState({ isLoading: true });
    try {
      const res = await apiFetch<{ totpUri: string; totpSecret: string; confirmToken: string }>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ username, password, displayName: displayName ?? username }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      console.log('[INFO][auth] Register OK, awaiting TOTP confirm');
      useLogStore.getState().addEntry({ type: 'request', label: 'Auth: TOTP Setup', content: 'Scan QR code and enter TOTP code' });
      useAuthStore.setState({
        pendingStep: {
          step: 'register-totp',
          totpUri: res.totpUri,
          totpSecret: res.totpSecret,
          confirmToken: res.confirmToken,
        },
        isLoading: false,
      });
    } catch (err) {
      console.error('[ERROR][auth] Register failed:', err);
      useLogStore.getState().addEntry({ type: 'error', label: 'Auth: Register Failed', content: err instanceof Error ? err.message : String(err) });
      useAuthStore.setState({ isLoading: false });
      throw err;
    }
  },

  confirmRegister: async (code) => {
    const { pendingStep } = useAuthStore.getState();
    if (pendingStep.step !== 'register-totp') return;
    useAuthStore.setState({ isLoading: true });
    try {
      const result = await apiFetch<{ accessToken: string; user: User }>(
        '/auth/register/confirm',
        {
          method: 'POST',
          body: JSON.stringify({ confirmToken: pendingStep.confirmToken, code }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      applyAuthState(result, 'local');
    } catch (err) {
      useAuthStore.setState({ isLoading: false });
      throw err;
    }
  },

  loginOidc: async () => {
    if (!isOidcConfigured()) {
      throw new Error('OIDC is not configured');
    }
    useLogStore.getState().addEntry({ type: 'request', label: 'Auth: Login (Keycloak)', content: 'Redirecting…' });
    await signinRedirect();
  },

  handleOidcCallback: async () => {
    if (_oidcCallbackInFlight) return;
    if (!new URLSearchParams(window.location.search).get('code')) return;
    _oidcCallbackInFlight = true;
    useAuthStore.setState({ isLoading: true });
    try {
      const params = readCallback();
      const res = await apiFetch<OidcTokenResponse>('/auth/oidc/exchange', {
        method: 'POST',
        body: JSON.stringify(params),
        headers: { 'Content-Type': 'application/json' },
      });
      applyAuthState(normalizeOidcResponse(res), 'oidc');
    } catch (err) {
      _oidcCallbackInFlight = false;
      console.error('[ERROR][auth] OIDC callback failed:', err);
      useLogStore.getState().addEntry({
        type: 'error',
        label: 'Auth: OIDC Callback Failed',
        content: err instanceof Error ? err.message : String(err),
      });
      useAuthStore.setState({ isLoading: false, authSource: null });
      writeSource(null);
      throw err;
    }
  },

  logout: async () => {
    const source = useAuthStore.getState().authSource ?? readSource();
    console.log('[INFO][auth] Logout source=', source);
    useLogStore.getState().addEntry({ type: 'response', label: 'Auth: Logout', content: 'Session ended' });
    if (source === 'oidc') {
      await apiFetch('/auth/oidc/logout', { method: 'POST' }).catch(() => null);
    } else {
      await apiFetch('/auth/logout', { method: 'DELETE' }).catch(() => null);
    }
    clearRefreshTimer();
    moduleToken = null;
    setAccessToken(null);
    writeSource(null);
    useAuthStore.setState({ user: null, accessToken: null, isLoading: false, pendingStep: { step: 'idle' }, authSource: null });
    if (source === 'oidc') {
      signoutRedirect();
    }
  },

  refresh: async () => {
    const source = useAuthStore.getState().authSource ?? readSource();
    if (source === 'oidc') {
      const res = await apiFetch<OidcTokenResponse>('/auth/oidc/refresh', { method: 'POST' });
      applyAuthState(normalizeOidcResponse(res), 'oidc');
      return;
    }
    const result = await apiFetch<{ accessToken: string; user: User }>('/auth/refresh', { method: 'POST' });
    applyAuthState(result, 'local');
  },
}));

export const authStore = useAuthStore;

setRefreshHandler(() => useAuthStore.getState().refresh());

void useAuthStore.getState().refresh().catch(() => {
  clearRefreshTimer();
  moduleToken = null;
  setAccessToken(null);
  writeSource(null);
  useAuthStore.setState({ user: null, accessToken: null, isLoading: false, authSource: null });
});
