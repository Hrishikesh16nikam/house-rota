export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const listeners = new Set<() => void>();
/** Called whenever the server says the session is gone. */
export function onSignedOut(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: Blob } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = opts.raw;
    headers['Content-Type'] = opts.raw.type || 'application/octet-stream';
  } else if (method !== 'GET') {
    body = JSON.stringify(opts.body ?? {});
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'You seem to be offline.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me/pin')) listeners.forEach((f) => f());
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Something went wrong (${res.status})`);
  }
  return data as T;
}

export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
