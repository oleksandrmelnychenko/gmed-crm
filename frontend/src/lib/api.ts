import { uiText } from "@/lib/i18n";

const CLIENT_API_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const API_PREFIX = "/api/v1";
const ACCESS_TOKEN_KEY = "gmed_access_token";
const REFRESH_TOKEN_KEY = "gmed_refresh_token";
const AUTH_REFRESH_LOCK_NAME = "gmed-auth-refresh";
export const AUTH_SESSION_EXPIRED_EVENT = "gmed:auth-session-expired";
export const DEFAULT_API_TIMEOUT_MS = 20_000;

type ApiErrorBody = {
  error?: string;
  message?: string;
  [key: string]: unknown;
};

type ApiFetchInit = RequestInit & {
  cacheTtlMs?: number;
  forceFresh?: boolean;
  skipDedupe?: boolean;
  timeoutMs?: number;
};

type ApiFileFetchInit = RequestInit & {
  timeoutMs?: number;
};

type ApiRequestErrorOptions = {
  status?: number;
  code?: string;
  body?: ApiErrorBody | null;
  cause?: unknown;
};

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { mode?: "exclusive" | "shared" },
    callback: () => T | Promise<T>,
  ): Promise<T>;
};

export class ApiRequestError extends Error {
  status?: number;
  code?: string;
  body?: ApiErrorBody | null;
  cause?: unknown;

  constructor(message: string, options: ApiRequestErrorOptions = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.cause = options.cause;
  }
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function getBrowserLockManager() {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { locks?: BrowserLockManager }).locks ?? null;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload || typeof globalThis.atob !== "function") return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function getAccessTokenExpiresAtMs(token = getAccessToken()) {
  if (!token) return null;
  const exp = parseJwtPayload(token)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) {
    return null;
  }
  return exp * 1000;
}

function dispatchAuthSessionExpired() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
}

function clearAuthTokens() {
  const hadTokens =
    Boolean(localStorage.getItem(ACCESS_TOKEN_KEY)) ||
    Boolean(localStorage.getItem(REFRESH_TOKEN_KEY));
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (hadTokens) {
    dispatchAuthSessionExpired();
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefreshAccessToken(timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const initialRefreshToken = getRefreshToken();
  if (!initialRefreshToken) {
    clearAuthTokens();
    jsonCache.clear();
    return null;
  }

  const refreshWithCurrentToken = async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearAuthTokens();
        jsonCache.clear();
        return null;
      }

      if (refreshToken !== initialRefreshToken) {
        return getAccessToken();
      }

      const res = await fetchWithApiTimeout(buildApiUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, timeoutMs);
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
      if (getRefreshToken() !== refreshToken) {
        jsonCache.clear();
        return getAccessToken();
      }
      localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
      jsonCache.clear();
      return tokens.access_token;
    } catch {
      return null;
    }
  };

  const lockManager = getBrowserLockManager();
  refreshInFlight = (lockManager
    ? lockManager.request(AUTH_REFRESH_LOCK_NAME, { mode: "exclusive" }, refreshWithCurrentToken)
    : refreshWithCurrentToken()
  ).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export function refreshAuthSession(timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  return tryRefreshAccessToken(timeoutMs);
}

function shouldRefreshAccessTokenBeforeRequest(leewayMs: number) {
  const expiresAtMs = getAccessTokenExpiresAtMs();
  return expiresAtMs !== null && expiresAtMs - Date.now() <= leewayMs;
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

function cancelledRequestError() {
  return new ApiRequestError(uiText("api_request_cancelled"), { code: "aborted" });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function timeoutError(timeoutMs: number) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new ApiRequestError(uiText("api_request_timeout", undefined, { seconds }), {
    code: "timeout",
  });
}

export async function fetchWithApiTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<Response> {
  const callerSignal = init.signal;
  if (callerSignal?.aborted) {
    throw cancelledRequestError();
  }

  if (timeoutMs <= 0) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw cancelledRequestError();
      }
      throw new ApiRequestError(uiText("api_network_error"), {
        code: "network",
        cause: error,
      });
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = () => {
    controller.abort();
  };
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw timeoutError(timeoutMs);
    }
    if (callerSignal?.aborted || isAbortError(error)) {
      throw cancelledRequestError();
    }
    throw new ApiRequestError(uiText("api_network_error"), {
      code: "network",
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function waitForRetryDelay(ms: number, signal?: AbortSignal | null) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(cancelledRequestError());

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(cancelledRequestError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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
  timeoutMs: number,
  attempt = 0,
): Promise<Response> {
  const res = await fetchWithApiTimeout(url, init, timeoutMs);
  if (res.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) {
    return res;
  }
  const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
  const backoffMs = retryAfterMs ?? RATE_LIMIT_DEFAULT_BACKOFF_MS * 2 ** attempt;
  await waitForRetryDelay(backoffMs, init.signal);
  return fetchWithRateLimitRetry(url, init, timeoutMs, attempt + 1);
}

const JSON_CACHE_MAX_ENTRIES = 160;

type JsonCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const jsonCache = new Map<string, JsonCacheEntry>();
type InFlightJsonGet = {
  generation: number;
  request: Promise<unknown>;
  token: symbol;
};

const inFlightJsonGets = new Map<string, InFlightJsonGet>();
let jsonCacheGeneration = 0;

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
  jsonCacheGeneration += 1;

  if (!pathPrefix) {
    jsonCache.clear();
    inFlightJsonGets.clear();
    return;
  }

  const urlPrefix = buildApiUrl(pathPrefix);
  for (const key of jsonCache.keys()) {
    if (key.startsWith(urlPrefix)) {
      jsonCache.delete(key);
    }
  }
  for (const key of inFlightJsonGets.keys()) {
    if (key.startsWith(urlPrefix)) {
      inFlightJsonGets.delete(key);
    }
  }
}

async function readApiJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiErrorBody | null;
    const message = body?.message ?? body?.error ?? `${res.status} ${res.statusText}`;
    if (res.status === 429) {
      throw new ApiRequestError(
        message || uiText("api_rate_limited"),
        { status: res.status, code: "rate_limited", body },
      );
    }
    throw new ApiRequestError(message, {
      status: res.status,
      code: body?.error ?? "http_error",
      body,
    });
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
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestInit
  } = init;
  const headers = buildApiHeaders(requestInit);
  const url = buildApiUrl(path);
  const method = requestMethod(requestInit);
  const canRetryAuth = headers.has("Authorization") && !isAuthEndpoint(path);

  if (canRetryAuth && shouldRefreshAccessTokenBeforeRequest(30_000)) {
    const newAccessToken = await tryRefreshAccessToken(timeoutMs);
    if (newAccessToken) {
      headers.set("Authorization", `Bearer ${newAccessToken}`);
    }
  }

  const canCacheGet = isCacheableJsonGet(requestInit);
  const cacheKey = canCacheGet ? jsonRequestCacheKey(url, headers) : "";

  if (canCacheGet && !forceFresh) {
    const cached = readFreshJsonCache(cacheKey);
    if (cached !== undefined) return cached as T;

    if (!skipDedupe) {
      const inFlight = inFlightJsonGets.get(cacheKey);
      if (inFlight?.generation === jsonCacheGeneration) {
        return cloneJsonPayload(await inFlight.request) as T;
      }
    }
  }

  const requestGeneration = jsonCacheGeneration;
  const request = (async () => {
    let res = await fetchWithRateLimitRetry(url, { ...requestInit, headers }, timeoutMs);

    if (res.status === 401 && canRetryAuth) {
      const newAccessToken = await tryRefreshAccessToken(timeoutMs);
      if (newAccessToken) {
        const retriedHeaders = new Headers(headers);
        retriedHeaders.set("Authorization", `Bearer ${newAccessToken}`);
        res = await fetchWithRateLimitRetry(
          url,
          { ...requestInit, headers: retriedHeaders },
          timeoutMs,
        );
      } else {
        clearAuthTokens();
        jsonCache.clear();
      }
    }

    const payload = await readApiJsonResponse<T>(res);
    if (canCacheGet && requestGeneration === jsonCacheGeneration) {
      rememberJsonCache(cacheKey, payload, cacheTtlMs);
    } else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      clearApiCache();
    }
    return payload;
  })();

  if (!canCacheGet || skipDedupe) {
    return request;
  }

  const requestToken = Symbol(cacheKey);
  inFlightJsonGets.set(cacheKey, {
    generation: requestGeneration,
    request,
    token: requestToken,
  });
  try {
    return await request;
  } finally {
    const current = inFlightJsonGets.get(cacheKey);
    if (current?.token === requestToken) {
      inFlightJsonGets.delete(cacheKey);
    }
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

export async function apiFetchFile(path: string, init: ApiFileFetchInit = {}) {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...requestInit } = init;
  const headers = buildApiHeaders(requestInit);
  const url = buildApiUrl(path);
  const canRetryAuth = headers.has("Authorization") && !isAuthEndpoint(path);

  if (canRetryAuth && shouldRefreshAccessTokenBeforeRequest(30_000)) {
    const newAccessToken = await tryRefreshAccessToken(timeoutMs);
    if (newAccessToken) {
      headers.set("Authorization", `Bearer ${newAccessToken}`);
    }
  }

  let res = await fetchWithRateLimitRetry(url, { ...requestInit, headers }, timeoutMs);

  if (res.status === 401 && canRetryAuth) {
    const newAccessToken = await tryRefreshAccessToken(timeoutMs);
    if (newAccessToken) {
      const retriedHeaders = new Headers(headers);
      retriedHeaders.set("Authorization", `Bearer ${newAccessToken}`);
      res = await fetchWithRateLimitRetry(
        url,
        { ...requestInit, headers: retriedHeaders },
        timeoutMs,
      );
    } else {
      clearAuthTokens();
      jsonCache.clear();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiErrorBody | null;
    const message = body?.message ?? body?.error ?? `${res.status} ${res.statusText}`;
    if (res.status === 429) {
      throw new ApiRequestError(
        message || uiText("api_rate_limited"),
        { status: res.status, code: "rate_limited", body },
      );
    }
    throw new ApiRequestError(message, {
      status: res.status,
      code: body?.error ?? "http_error",
      body,
    });
  }

  return {
    blob: await res.blob(),
    contentType: res.headers.get("content-type") ?? "",
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
  init: ApiFileFetchInit = {},
) {
  const { blob, filename } = await apiFetchFile(path, init);
  const resolvedFilename = filename || fallbackFilename;
  downloadBlob(blob, resolvedFilename);
  return resolvedFilename;
}
