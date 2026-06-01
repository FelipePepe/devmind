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
  if (crypto.subtle) {
    return crypto.subtle.digest('SHA-256', data);
  }
  // Non-secure context (e.g. plain HTTP with non-localhost origin):
  // pure-JS SHA-256 fallback so dev access via IP still works.
  return sha256Fallback(data);
}

function sha256Fallback(data: Uint8Array): ArrayBuffer {
  // FIPS 180-4 SHA-256, constants and compression function
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const len = data.length;
  const bitLen = len * 8;
  const padded = new Uint8Array(((len + 9 + 63) & ~63));
  padded.set(data);
  padded[len] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLen, false);
  const view = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array<number>(64);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15]!, 7) ^ rotr(w[j-15]!, 18) ^ (w[j-15]! >>> 3);
      const s1 = rotr(w[j-2]!, 17) ^ rotr(w[j-2]!, 19) ^ (w[j-2]! >>> 10);
      w[j] = (w[j-16]! + s0 + w[j-7]! + s1) | 0;
    }
    let [a,b,c,d,e,f,g,hh] = h as number[];
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + S1 + ch + K[j]! + w[j]!) | 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d! + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = [h[0]!+a!,h[1]!+b!,h[2]!+c!,h[3]!+d!,h[4]!+e!,h[5]!+f!,h[6]!+g!,h[7]!+hh!].map(x => x|0);
  }
  const out = new ArrayBuffer(32);
  const outView = new DataView(out);
  h.forEach((v, i) => outView.setUint32(i * 4, v, false));
  return out;
}

export async function signinRedirect(): Promise<void> {
  if (!ISSUER) {
    throw new Error('VITE_OIDC_ISSUER is not configured');
  }
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = base64UrlEncode(randomBytes(16));

  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);

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
  const expectedState = localStorage.getItem(STATE_KEY);
  if (!expectedState || state !== expectedState) {
    throw new Error('OIDC state mismatch — possible CSRF, aborting');
  }
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error('OIDC verifier missing from session');
  }
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
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
