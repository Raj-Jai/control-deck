const TOKEN_KEY = 'dash_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent('auth:invalidated'));
}

/** Append auth token to a URL as ?token= for SSE/WebSocket connections */
export function authUrl(base: string): string {
  const token = getToken();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

/** fetch wrapper that adds Authorization header and handles 401 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (token) {
    options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    clearToken();
    throw new Error('auth required');
  }
  return res;
}
