/**
 * Klien API untuk mode produksi (VITE_API_MODE=api).
 * Mode default 'local' tetap memakai localStorage sehingga prototype bisa terus dipakai.
 */
export type ApiMode = 'local' | 'api';

export const API_MODE: ApiMode = (import.meta.env.VITE_API_MODE as ApiMode) || 'local';
export const isApiMode = (): boolean => API_MODE === 'api';

const BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001';

let csrfToken: string | undefined;

export const setCsrfToken = (token?: string): void => {
  csrfToken = token;
};

export const getCsrfToken = (): string | undefined => csrfToken;

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipCsrf?: boolean } = {}
): Promise<T> {
  const { skipCsrf, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const headers = new Headers(fetchOptions.headers);

  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD'].includes(method) && !skipCsrf) {
    if (!csrfToken) await refreshCsrf();
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
    credentials: 'include',
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || `Request gagal (HTTP ${response.status})`);
  }
  return payload as T;
}

export async function refreshCsrf(): Promise<void> {
  const me = await apiRequest<{ data?: { csrfToken?: string } }>('/api/auth/me');
  setCsrfToken(me.data?.csrfToken);
}

export interface ApiLoginResult {
  user: { id: string; username: string; nama: string; role: 'super_admin' | 'admin' | 'pemilik' };
  csrfToken: string;
}

export async function apiLogin(username: string, password: string): Promise<ApiLoginResult> {
  const response = await apiRequest<{ data: ApiLoginResult }>('/api/auth/login', {
    method: 'POST',
    skipCsrf: true,
    body: JSON.stringify({ username, password }),
  });
  setCsrfToken(response.data.csrfToken);
  return response.data;
}

export async function apiSetup(nama: string, username: string, password: string): Promise<void> {
  await apiRequest('/api/auth/setup', {
    method: 'POST',
    skipCsrf: true,
    body: JSON.stringify({ nama, username, password }),
  });
  await apiLogin(username, password);
}

export async function apiNeedsSetup(): Promise<boolean> {
  const status = await apiRequest<{ data: { needsSetup: boolean } }>('/api/auth/setup-status');
  return status.data.needsSetup;
}

export async function apiLogout(): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST' });
  setCsrfToken(undefined);
}
