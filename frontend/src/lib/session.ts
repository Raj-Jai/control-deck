/**
 * Session plumbing for the deck's authorization boundary.
 *
 * Every endpoint except the handful needed before unlock now requires a token
 * minted by POST /api/auth, and every mutating request must also carry a CSRF
 * marker. A cross-origin page cannot set a custom header without a preflight,
 * and the server never returns CORS headers, so the preflight fails and the
 * real request is never sent.
 *
 * Rather than adding headers to ~25 individual call sites (and every future
 * one), the transport primitives are wrapped once here. Anything same-origin
 * and under a guarded path is decorated; anything else is left untouched.
 */

const TOKEN_KEY = 'dash_session_token';

// Endpoints that are reachable before unlock, and so get no token attached.
// Only the two PIN endpoints belong here. capabilities, features and ping were
// listed too, which matched a server-side omission: any client on the LAN
// could enumerate the host's toolchain without unlocking anything. Nothing
// needs them before unlock - the capability and feature hooks stand down, and
// the latency probes live in cards that only render once unlocked - so they are
// session-gated on both sides now.
const PUBLIC_PATHS = [
  '/api/auth',
  '/api/auth-media',
];

const GUARDED_PREFIXES = ['/api/', '/media-stream', '/seek', '/ws/'];

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply will not survive a reload */
  }
}

export function clearToken(): void {
  setToken('');
}

function pathOf(url: string): string {
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return url;
  }
}

function isGuarded(url: string): boolean {
  const p = pathOf(url);
  if (PUBLIC_PATHS.includes(p)) return false;
  return GUARDED_PREFIXES.some((pre) => p.startsWith(pre));
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Append the token to a query string, for transports that cannot set headers. */
export function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

let installed = false;

export function installSessionInterceptor(): void {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!isGuarded(url) || !isSameOrigin(url)) return originalFetch(input, init);

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const token = getToken();
    if (token) headers.set('X-Control-Deck-Token', token);

    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('X-Control-Deck-CSRF', '1');
      // A body-bearing request must be JSON, or the server refuses it. The few
      // uploads that are genuinely multipart opt out via this marker.
      if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
    return originalFetch(input, { ...init, headers });
  };

  const OriginalEventSource = window.EventSource;
  window.EventSource = class extends OriginalEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(typeof url === 'string' ? withToken(url) : withToken(url.toString()), init);
    }
  } as typeof EventSource;

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(typeof url === 'string' ? withToken(url) : withToken(url.toString()), protocols);
    }
  } as typeof WebSocket;
}
