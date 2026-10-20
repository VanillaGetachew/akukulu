/**
 * API origin. Empty (the default) means same-origin: the web app proxies
 * /api and /socket.io to the API server (see next.config.mjs).
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export const DEV_AUTH = process.env.NEXT_PUBLIC_DEV_AUTH === 'true';

const TOKEN_KEY = 'akukulu.token';

export function storedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null, persist: boolean) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (token) (persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session lives in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

let currentToken: string | null = null;
export function setApiToken(token: string | null) {
  currentToken = token;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Cannot reach the game server. Check your connection.', 0, 'NETWORK');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new ApiError(Array.isArray(message) ? message.join(', ') : String(message), res.status, data?.code);
  }
  return data as T;
}
