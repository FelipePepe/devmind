const BASE_URL = import.meta.env['VITE_API_URL'] ?? '';

let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

function log(level: 'info' | 'warn' | 'error', tag: string, message: string, detail?: unknown): void {
  const prefix = `[${level.toUpperCase()}][api][${tag}]`;
  const args: unknown[] = [`${prefix} ${message}`];
  if (detail !== undefined && detail !== null) args.push(detail);
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
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

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    log('error', path, `HTTP ${response.status}: ${body.error ?? 'Unknown'}`, { status: response.status, body });
    throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), {
      status: response.status,
    });
  }

  const data = await response.json();
  log('info', path, `OK (${elapsed}ms)`);
  return data as Promise<T>;
}
