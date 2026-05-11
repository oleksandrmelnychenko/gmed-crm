const CLIENT_API_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const API_PREFIX = "/api/v1";
const ACCESS_TOKEN_KEY = "gmed_access_token";
const REFRESH_TOKEN_KEY = "gmed_refresh_token";

type ApiErrorBody = {
  error?: string;
  message?: string;
};

type ApiFetchInit = RequestInit & {
  cacheTtlMs?: number;
  forceFresh?: boolean;
  skipDedupe?: boolean;
};

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function clearAuthTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(buildApiUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        clearAuthTokens();
        jsonCache.clear();
        return null;
      }
      const tokens = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!tokens.access_token || !tokens.refresh_token) {
        clearAuthTokens();
        jsonCache.clear();
        return null;
      }
      localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
      jsonCache.clear();
      return tokens.access_token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function isAuthEndpoint(path: string) {
  return path.startsWith("/auth/") || path === "/auth";
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

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_DEFAULT_BACKOFF_MS = 1000;
const RATE_LIMIT_MAX_BACKOFF_MS = 10_000;

function parseRetryAfterMs(header: string | null) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RATE_LIMIT_MAX_BACKOFF_MS);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), RATE_LIMIT_MAX_BACKOFF_MS);
  }
  return null;
}

async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) {
    return res;
  }
  const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
  const backoffMs = retryAfterMs ?? RATE_LIMIT_DEFAULT_BACKOFF_MS * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, backoffMs));
  return fetchWithRateLimitRetry(url, init, attempt + 1);
}

const JSON_CACHE_MAX_ENTRIES = 160;

type JsonCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const jsonCache = new Map<string, JsonCacheEntry>();
const inFlightJsonGets = new Map<string, Promise<unknown>>();

function requestMethod(init: RequestInit) {
  return (init.method ?? "GET").toUpperCase();
}

function isCacheableJsonGet(init: RequestInit) {
  return (
    requestMethod(init) === "GET" &&
    !init.body &&
    !init.signal &&
    init.cache !== "no-store"
  );
}

function headersCacheKey(headers: Headers) {
  return Array.from(headers.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
}

function jsonRequestCacheKey(url: string, headers: Headers) {
  return `${url}\n${headersCacheKey(headers)}`;
}

function cloneJsonPayload<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  return value;
}

function rememberJsonCache(key: string, value: unknown, ttlMs?: number) {
  if (!ttlMs || ttlMs <= 0) return;
  if (jsonCache.has(key)) jsonCache.delete(key);
  jsonCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value: cloneJsonPayload(value),
  });
  if (jsonCache.size <= JSON_CACHE_MAX_ENTRIES) return;
  const oldestKey = jsonCache.keys().next().value;
  if (oldestKey) jsonCache.delete(oldestKey);
}

function readFreshJsonCache(key: string) {
  const cached = jsonCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    jsonCache.delete(key);
    return undefined;
  }
  return cloneJsonPayload(cached.value);
}

export function clearApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    jsonCache.clear();
    return;
  }

  const urlPrefix = buildApiUrl(pathPrefix);
  for (const key of jsonCache.keys()) {
    if (key.startsWith(urlPrefix)) {
      jsonCache.delete(key);
    }
  }
}

async function readApiJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiErrorBody | null;
    if (res.status === 429) {
      throw new Error(body?.message ?? body?.error ?? "Забагато запитів. Спробуйте ще раз пізніше.");
    }
    throw new Error(body?.message ?? body?.error ?? `${res.status} ${res.statusText}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
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

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const {
    cacheTtlMs,
    forceFresh = false,
    skipDedupe = false,
    ...requestInit
  } = init;
  const headers = buildApiHeaders(requestInit);
  const url = buildApiUrl(path);
  const method = requestMethod(requestInit);
  const canCacheGet = isCacheableJsonGet(requestInit);
  const cacheKey = canCacheGet ? jsonRequestCacheKey(url, headers) : "";
  const canRetryAuth = headers.has("Authorization") && !isAuthEndpoint(path);

  if (canCacheGet && !forceFresh) {
    const cached = readFreshJsonCache(cacheKey);
    if (cached !== undefined) return cached as T;

    if (!skipDedupe) {
      const inFlight = inFlightJsonGets.get(cacheKey);
      if (inFlight) {
        return cloneJsonPayload(await inFlight) as T;
      }
    }
  }

  const request = (async () => {
    let res = await fetchWithRateLimitRetry(url, { ...requestInit, headers });

    if (res.status === 401 && canRetryAuth) {
      const newAccessToken = await tryRefreshAccessToken();
      if (newAccessToken) {
        const retriedHeaders = new Headers(headers);
        retriedHeaders.set("Authorization", `Bearer ${newAccessToken}`);
        res = await fetchWithRateLimitRetry(url, { ...requestInit, headers: retriedHeaders });
      }
    }

    const payload = await readApiJsonResponse<T>(res);
    if (canCacheGet) {
      rememberJsonCache(cacheKey, payload, cacheTtlMs);
    } else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      clearApiCache();
    }
    return payload;
  })();

  if (!canCacheGet || skipDedupe) {
    return request;
  }

  inFlightJsonGets.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlightJsonGets.delete(cacheKey);
  }
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
  const url = buildApiUrl(path);
  const canRetryAuth = headers.has("Authorization") && !isAuthEndpoint(path);
  let res = await fetchWithRateLimitRetry(url, { ...init, headers });

  if (res.status === 401 && canRetryAuth) {
    const newAccessToken = await tryRefreshAccessToken();
    if (newAccessToken) {
      const retriedHeaders = new Headers(headers);
      retriedHeaders.set("Authorization", `Bearer ${newAccessToken}`);
      res = await fetchWithRateLimitRetry(url, { ...init, headers: retriedHeaders });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiErrorBody | null;
    if (res.status === 429) {
      throw new Error(body?.message ?? body?.error ?? "Забагато запитів. Спробуйте ще раз пізніше.");
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
