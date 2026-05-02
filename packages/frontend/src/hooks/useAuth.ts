import { useState, useCallback, useEffect } from 'react';
import { apiFetch, setAccessToken } from '../lib/api.js';

export interface User {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
}

export type PendingStep =
  | { step: 'idle' }
  | { step: 'mfa'; mfaToken: string }
  | { step: 'register-totp'; totpUri: string; totpSecret: string; confirmToken: string };

// Module-level token store — never localStorage
let moduleToken: string | null = null;

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });
  const [pendingStep, setPendingStep] = useState<PendingStep>({ step: 'idle' });

  const applyAuthState = useCallback((result: { accessToken: string; user: User }) => {
    moduleToken = result.accessToken;
    setAccessToken(moduleToken);
    setState({ user: result.user, accessToken: moduleToken, isLoading: false });
    setPendingStep({ step: 'idle' });
  }, []);

  // ── Login: step 1 — credentials ──────────────────────────────────────────
  const login = useCallback(
    async (username: string, password: string) => {
      setState((s) => ({ ...s, isLoading: true }));
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
          setPendingStep({ step: 'mfa', mfaToken: res.mfaToken });
          setState((s) => ({ ...s, isLoading: false }));
        } else {
          applyAuthState(res as { accessToken: string; user: User });
        }
      } catch (err) {
        setState((s) => ({ ...s, isLoading: false }));
        throw err;
      }
    },
    [applyAuthState]
  );

  // ── Login: step 2 — TOTP code ────────────────────────────────────────────
  const confirmMfa = useCallback(
    async (code: string) => {
      if (pendingStep.step !== 'mfa') return;
      setState((s) => ({ ...s, isLoading: true }));
      try {
        const result = await apiFetch<{ accessToken: string; user: User }>('/auth/login/mfa', {
          method: 'POST',
          body: JSON.stringify({ mfaToken: pendingStep.mfaToken, code }),
          headers: { 'Content-Type': 'application/json' },
        });
        applyAuthState(result);
      } catch (err) {
        setState((s) => ({ ...s, isLoading: false }));
        throw err;
      }
    },
    [pendingStep, applyAuthState]
  );

  // ── Register: step 1 — credentials ──────────────────────────────────────
  const register = useCallback(
    async (username: string, password: string, displayName?: string) => {
      setState((s) => ({ ...s, isLoading: true }));
      try {
        const res = await apiFetch<{
          totpUri: string;
          totpSecret: string;
          confirmToken: string;
        }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, displayName: displayName ?? username }),
          headers: { 'Content-Type': 'application/json' },
        });
        setPendingStep({
          step: 'register-totp',
          totpUri: res.totpUri,
          totpSecret: res.totpSecret,
          confirmToken: res.confirmToken,
        });
        setState((s) => ({ ...s, isLoading: false }));
      } catch (err) {
        setState((s) => ({ ...s, isLoading: false }));
        throw err;
      }
    },
    []
  );

  // ── Register: step 2 — confirm TOTP ─────────────────────────────────────
  const confirmRegister = useCallback(
    async (code: string) => {
      if (pendingStep.step !== 'register-totp') return;
      setState((s) => ({ ...s, isLoading: true }));
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
        setState((s) => ({ ...s, isLoading: false }));
        throw err;
      }
    },
    [pendingStep, applyAuthState]
  );

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'DELETE' }).catch(() => null);
    moduleToken = null;
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
    setPendingStep({ step: 'idle' });
  }, []);

  const refresh = useCallback(async () => {
    const result = await apiFetch<{ accessToken: string; user: User }>('/auth/refresh', {
      method: 'POST',
    });
    applyAuthState(result);
  }, [applyAuthState]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        await refresh();
      } catch {
        moduleToken = null;
        setAccessToken(null);
        if (!cancelled) setState({ user: null, accessToken: null, isLoading: false });
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [refresh]);

  return { ...state, pendingStep, login, confirmMfa, register, confirmRegister, logout, refresh };
}

