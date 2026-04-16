const CLIENT_API_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const API_PREFIX = "/api/v1";
const ACCESS_TOKEN_KEY = "gmed_access_token";

type ApiErrorBody = {
  error?: string;
  message?: string;
};

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function normalizeApiPath(path: string) {
  return `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveApiBaseOrigin() {
  if (CLIENT_API_ORIGIN) {
    return CLIENT_API_ORIGIN;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost";
}

function applySearchParams(
  url: URL,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
}

export function buildApiUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const url = new URL(normalizeApiPath(path), resolveApiBaseOrigin());
  applySearchParams(url, params);
  if (CLIENT_API_ORIGIN) {
    return url.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildApiHeaders(init: RequestInit = {}) {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function parseContentDispositionFilename(header: string | null) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildApiHeaders(init);
  const res = await fetch(buildApiUrl(path), { ...init, headers });

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = null;
    }

    throw new Error(body?.message ?? body?.error ?? `${res.status} ${res.statusText}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export function buildApiWebSocketUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const url = new URL(normalizeApiPath(path), resolveApiBaseOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  applySearchParams(url, params);
  return url.toString();
}

export async function apiFetchFile(path: string, init: RequestInit = {}) {
  const headers = buildApiHeaders(init);
  const res = await fetch(buildApiUrl(path), { ...init, headers });

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = null;
    }

    throw new Error(body?.message ?? body?.error ?? `${res.status} ${res.statusText}`);
  }

  return {
    blob: await res.blob(),
    filename: parseContentDispositionFilename(res.headers.get("content-disposition")),
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadApiFile(
  path: string,
  fallbackFilename: string,
  init: RequestInit = {},
) {
  const { blob, filename } = await apiFetchFile(path, init);
  const resolvedFilename = filename || fallbackFilename;
  downloadBlob(blob, resolvedFilename);
  return resolvedFilename;
}
