import type { ApiErrorDto } from '@scribe/shared';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * Access token lives in memory only (never localStorage) — see security.md. The
 * refresh token is an httpOnly cookie the browser attaches automatically, so the
 * client never sees or stores it.
 */
let accessToken: string | null = null;
let onAuthFailure: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function setOnAuthFailure(cb: (() => void) | null): void {
  onAuthFailure = cb;
}

/** Seconds until a JWT expires, or 0 if it can't be read (treat as expired). */
function secondsUntilExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (typeof json.exp !== 'number') return 0;
    return json.exp - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/**
 * Returns a valid short-lived access token for the WebSocket collaboration
 * connection, refreshing via the httpOnly refresh cookie when the current token
 * is missing or about to expire. The WebSocket layer therefore only ever sees the
 * short-lived access token — never the refresh token (security.md). Returns null
 * if no session can be established (the provider then fails auth and stops).
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (accessToken && secondsUntilExpiry(accessToken) > 30) return accessToken;
  const refreshed = await refreshAccessToken();
  return refreshed ? accessToken : null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Internal: prevents infinite refresh recursion. */
  _isRetry?: boolean;
  /** Skip the automatic refresh-on-401 (used by auth endpoints themselves). */
  skipRefresh?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'request_error';
  let message = res.statusText || 'Request failed';
  let details: Record<string, string[]> | undefined;
  try {
    const data = (await res.json()) as ApiErrorDto;
    if (data?.error) {
      code = data.error.code;
      message = data.error.message;
      details = data.error.details;
    }
  } catch {
    // non-JSON error body; keep defaults
  }
  return new ApiError(res.status, code, message, details);
}

/**
 * De-duplicates concurrent refreshes. With refresh-token rotation on the server, two
 * simultaneous refreshes would each try to consume the same cookie; the client only
 * ever needs one in flight, so callers share a single promise. This keeps the server
 * from having to treat the app's own parallel calls (WS token callback racing an API
 * 401) as suspicious token reuse.
 */
let inFlightRefresh: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

/** Core request. Handles JSON, auth header, and a single transparent refresh on 401. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts._isRetry && !opts.skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, { ...opts, _isRetry: true });
    accessToken = null;
    onAuthFailure?.();
    throw await parseError(res);
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Metadata returned by a successful media upload (drives the editor media node). */
export interface UploadedMedia {
  mediaId: string;
  mime: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

/**
 * Uploads a binary file via multipart with the same auth semantics as {@link request}
 * (Bearer header + a single transparent refresh on 401). The body is FormData, so the
 * browser sets the multipart Content-Type/boundary — we must NOT set it ourselves.
 */
export async function uploadMedia(
  documentId: string,
  file: File,
  _isRetry = false,
): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}/documents/${documentId}/media`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: form,
  });

  if (res.status === 401 && !_isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return uploadMedia(documentId, file, true);
    accessToken = null;
    onAuthFailure?.();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as UploadedMedia;
}

/**
 * Fetches a document's media as a Blob over the authenticated endpoint (Bearer +
 * transparent refresh). The caller creates an object URL for `<img>`; the binary never
 * has a public URL, so a non-member cannot retrieve it by guessing an id.
 */
export async function fetchMediaBlob(
  documentId: string,
  mediaId: string,
  _isRetry = false,
): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}/documents/${documentId}/media/${mediaId}`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });

  if (res.status === 401 && !_isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return fetchMediaBlob(documentId, mediaId, true);
    accessToken = null;
    onAuthFailure?.();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  return res.blob();
}
