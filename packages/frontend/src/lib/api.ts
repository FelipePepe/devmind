const BASE_URL = import.meta.env['VITE_API_URL'] ?? '';

let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (_accessToken) {
    headers.set('Authorization', `Bearer ${_accessToken}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), {
      status: response.status,
    });
  }

  return response.json() as Promise<T>;
}
