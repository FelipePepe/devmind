// Minimal OIDC client for Keycloak Authorization Code + PKCE.
// Deliberate choice: inline implementation instead of oidc-client-ts.
// Web crypto + URLSearchParams cover the entire surface area we need
// (signin redirect, callback parsing with state validation, signout redirect).

const ISSUER = import.meta.env['VITE_OIDC_ISSUER'] as string | undefined;
const CLIENT_ID = (import.meta.env['VITE_OIDC_CLIENT_ID'] as string | undefined) ?? 'devmind-frontend';
const REDIRECT_URI =
  (import.meta.env['VITE_OIDC_REDIRECT_URI'] as string | undefined) ??
  `${window.location.origin}/callback`;
const POST_LOGOUT =
  (import.meta.env['VITE_OIDC_POST_LOGOUT_REDIRECT'] as string | undefined) ??
  window.location.origin;

const VERIFIER_KEY = 'oidc.verifier';
const STATE_KEY = 'oidc.state';

export function isOidcConfigured(): boolean {
  return Boolean(ISSUER);
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest('SHA-256', data);
}

export async function signinRedirect(): Promise<void> {
  if (!ISSUER) {
    throw new Error('VITE_OIDC_ISSUER is not configured');
  }
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = base64UrlEncode(randomBytes(16));

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(`${trimSlash(ISSUER)}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  window.location.assign(url.toString());
}

export interface OidcCallbackParams {
  code: string;
  code_verifier: string;
  redirect_uri: string;
}

export function readCallback(search: string = window.location.search): OidcCallbackParams {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error) {
    throw new Error(params.get('error_description') ?? error);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    throw new Error('OIDC callback missing code/state');
  }
  const expectedState = sessionStorage.getItem(STATE_KEY);
  if (!expectedState || state !== expectedState) {
    throw new Error('OIDC state mismatch — possible CSRF, aborting');
  }
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error('OIDC verifier missing from session');
  }
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return { code, code_verifier: verifier, redirect_uri: REDIRECT_URI };
}

export function signoutRedirect(): void {
  if (!ISSUER) {
    window.location.assign(POST_LOGOUT);
    return;
  }
  const url = new URL(`${trimSlash(ISSUER)}/protocol/openid-connect/logout`);
  url.searchParams.set('post_logout_redirect_uri', POST_LOGOUT);
  url.searchParams.set('client_id', CLIENT_ID);
  window.location.assign(url.toString());
}
