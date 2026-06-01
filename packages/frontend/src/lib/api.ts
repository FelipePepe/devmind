const BASE_URL = import.meta.env['VITE_API_URL'] ?? '';

let _accessToken: string | null = null;
let _refreshHandler: (() => Promise<void>) | null = null;
let _refreshInFlight: Promise<void> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setRefreshHandler(handler: (() => Promise<void>) | null): void {
  _refreshHandler = handler;
}

async function refreshOnce(): Promise<void> {
  if (!_refreshHandler) throw new Error('No refresh handler registered');
  if (!_refreshInFlight) {
    _refreshInFlight = _refreshHandler().finally(() => {
      _refreshInFlight = null;
    });
  }
  await _refreshInFlight;
}

function log(level: 'info' | 'warn' | 'error', tag: string, message: string, detail?: unknown): void {
  const prefix = `[${level.toUpperCase()}][api][${tag}]`;
  const args: unknown[] = [`${prefix} ${message}`];
  if (detail !== undefined && detail !== null) args.push(detail);
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

const REFRESH_PATHS = new Set(['/auth/refresh', '/auth/oidc/refresh', '/auth/oidc/exchange']);

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  attempt = 0
): Promise<T> {
  const headers = new Headers(options.headers);
  if (_accessToken) {
    headers.set('Authorization', `Bearer ${_accessToken}`);
  }

  log('info', path, `${options.method ?? 'GET'} ${path}`);
  const start = performance.now();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const elapsed = Math.round(performance.now() - start);

  if (response.status === 401 && attempt === 0 && _refreshHandler && !REFRESH_PATHS.has(path)) {
    log('warn', path, '401 received — attempting refresh');
    try {
      await refreshOnce();
      return apiFetch<T>(path, options, attempt + 1);
    } catch (err) {
      log('warn', path, 'Refresh after 401 failed', err);
      // fall through to error below
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; details?: unknown };
    log('error', path, `HTTP ${response.status}: ${body.error ?? 'Unknown'}`, { status: response.status, body });
    throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), {
      status: response.status,
      details: body.details,
    });
  }

  const data = await response.json();
  log('info', path, `OK (${elapsed}ms)`);
  return data as Promise<T>;
}
