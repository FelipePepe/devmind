import { useState, useCallback, useEffect } from 'react';
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiFetch, setAccessToken } from '../lib/api.js';

export interface User {
  id: string;
  display_name: string;
  is_admin: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
}

// Module-level token store — never localStorage
let moduleToken: string | null = null;

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const applyAuthState = useCallback((result: { accessToken: string; user: User }) => {
    moduleToken = result.accessToken;
    setAccessToken(moduleToken);
    setState({ user: result.user, accessToken: moduleToken, isLoading: false });
  }, []);

  const register = useCallback(async (displayName = 'User') => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const opts = await apiFetch<PublicKeyCredentialCreationOptionsJSON & { _userId: string }>(
        '/auth/register/challenge',
        { method: 'POST', body: JSON.stringify({ displayName }), headers: { 'Content-Type': 'application/json' } }
      );
      const { _userId, ...regOpts } = opts;
      const response = await startRegistration({ optionsJSON: regOpts });
      const result = await apiFetch<{ accessToken: string; user: User }>(
        '/auth/register/verify',
        {
          method: 'POST',
          body: JSON.stringify({ userId: _userId, displayName, response }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      applyAuthState(result);
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err;
    }
  }, [applyAuthState]);

  const login = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const opts = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
        '/auth/login/challenge',
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const response = await startAuthentication({ optionsJSON: opts });
      const result = await apiFetch<{ accessToken: string; user: User }>(
        '/auth/login/verify',
        {
          method: 'POST',
          body: JSON.stringify({ response }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      applyAuthState(result);
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err;
    }
  }, [applyAuthState]);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'DELETE' }).catch(() => null);
    moduleToken = null;
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
  }, []);

  const refresh = useCallback(async () => {
    const result = await apiFetch<{ accessToken: string; user: User }>('/auth/refresh', { method: 'POST' });
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
        if (!cancelled) {
          setState({ user: null, accessToken: null, isLoading: false });
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { ...state, register, login, logout, refresh };
}
