import { create } from 'zustand';
import { type User, type PendingStep } from '../types/index.js';
import { apiFetch, setAccessToken } from '../lib/api.js';
import { useLogStore } from './log.js';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  pendingStep: PendingStep;
  login: (username: string, password: string) => Promise<void>;
  confirmMfa: (code: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  confirmRegister: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

let moduleToken: string | null = null;

function applyAuthState(result: { accessToken: string; user: User }): void {
  moduleToken = result.accessToken;
  setAccessToken(moduleToken);
  console.log('[INFO][auth] Auth state applied, user:', result.user.username);
  useLogStore.getState().addEntry({
    type: 'response',
    label: 'Auth',
    content: `Logged in as ${result.user.username} (${result.user.display_name})`,
  });
  useAuthStore.setState({
    user: result.user,
    accessToken: moduleToken,
    isLoading: false,
    pendingStep: { step: 'idle' },
  });
}

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  accessToken: null,
  isLoading: true,
  pendingStep: { step: 'idle' },

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
        applyAuthState(res as { accessToken: string; user: User });
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
      applyAuthState(result);
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
      applyAuthState(result);
    } catch (err) {
      useAuthStore.setState({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    console.log('[INFO][auth] Logout');
    useLogStore.getState().addEntry({ type: 'response', label: 'Auth: Logout', content: 'Session ended' });
    await apiFetch('/auth/logout', { method: 'DELETE' }).catch(() => null);
    moduleToken = null;
    setAccessToken(null);
    useAuthStore.setState({ user: null, accessToken: null, isLoading: false, pendingStep: { step: 'idle' } });
  },

  refresh: async () => {
    const result = await apiFetch<{ accessToken: string; user: User }>('/auth/refresh', { method: 'POST' });
    applyAuthState(result);
  },
}));

export const authStore = useAuthStore;

void useAuthStore.getState().refresh().catch(() => {
  moduleToken = null;
  setAccessToken(null);
  useAuthStore.setState({ user: null, accessToken: null, isLoading: false });
});
