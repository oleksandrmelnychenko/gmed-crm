import { afterEach, describe, expect, it, vi } from "vitest";

function setWindowOrigin(origin: string) {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin,
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
}

function setTokenStorage(accessToken: string | null = null, refreshToken: string | null = null) {
  const values = new Map<string, string>();
  if (accessToken) values.set("gmed_access_token", accessToken);
  if (refreshToken) values.set("gmed_refresh_token", refreshToken);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  });
}

function jwtWithExp(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

async function loadApiModule(apiOrigin = "") {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", apiOrigin);
  return import("./api");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("API URL builders", () => {
  it("keeps HTTP API paths relative when no dedicated API origin is configured", async () => {
    setWindowOrigin("http://app.local:4173");
    const { buildApiUrl, buildApiWebSocketUrl } = await loadApiModule();

    expect(buildApiUrl("/documents/123/download")).toBe(
      "/api/v1/documents/123/download",
    );
    expect(
      buildApiUrl("/stats/reports/export", {
        section: "provider_costs",
        include_archived: false,
      }),
    ).toBe(
      "/api/v1/stats/reports/export?section=provider_costs&include_archived=false",
    );
    expect(buildApiWebSocketUrl("/messages/ws", { token: "abc123" })).toBe(
      "ws://app.local:4173/api/v1/messages/ws?token=abc123",
    );
  });

  it("uses the explicit API origin for HTTP and derives WebSocket protocol from that origin", async () => {
    setWindowOrigin("http://app.local:4173");
    const { buildApiUrl, buildApiWebSocketUrl } = await loadApiModule(
      "https://api.example.com",
    );

    expect(buildApiUrl("/documents/123/download")).toBe(
      "https://api.example.com/api/v1/documents/123/download",
    );
    expect(buildApiWebSocketUrl("/messages/ws", { token: "abc123" })).toBe(
      "wss://api.example.com/api/v1/messages/ws?token=abc123",
    );
  });
});

describe("API request deduplication and cache", () => {
  it("deduplicates concurrent GET requests for the same URL", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("token-a");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiFetch } = await loadApiModule();
    const [left, right] = await Promise.all([
      apiFetch<{ ok: boolean }>("/patients"),
      apiFetch<{ ok: boolean }>("/patients"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(left).toEqual({ ok: true });
    expect(right).toEqual({ ok: true });
  });

  it("uses short-lived GET cache and clears it after a mutation", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("token-a");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 1 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 2 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { apiFetch } = await loadApiModule();
    const [first, cached, afterMutation] = await apiFetch<{
      version: number;
    }>("/meta", {
      cacheTtlMs: 30_000,
    }).then((firstResult) =>
      apiFetch<{ version: number }>("/meta", {
        cacheTtlMs: 30_000,
      }).then((cachedResult) =>
        apiFetch<{ ok: boolean }>("/meta/update", {
          method: "POST",
          body: JSON.stringify({ ok: true }),
        }).then(() =>
          apiFetch<{ version: number }>("/meta", {
            cacheTtlMs: 30_000,
          }).then(
            (afterMutationResult) =>
              [firstResult, cachedResult, afterMutationResult] as const,
          ),
        ),
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(first.version).toBe(1);
    expect(cached.version).toBe(1);
    expect(afterMutation.version).toBe(2);
  });
});

describe("API auth session refresh", () => {
  it("reads the access-token expiry from the JWT payload", async () => {
    setWindowOrigin("http://app.local:4173");
    const exp = Math.floor(Date.now() / 1000) + 600;
    setTokenStorage(jwtWithExp(exp), "refresh-a");

    const { getAccessTokenExpiresAtMs } = await loadApiModule();

    expect(getAccessTokenExpiresAtMs()).toBe(exp * 1000);
  });

  it("deduplicates concurrent refresh calls and stores rotated tokens", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("stale-access", "refresh-a");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "access-b", refresh_token: "refresh-b" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { refreshAuthSession } = await loadApiModule();
    const [left, right] = await Promise.all([
      refreshAuthSession(),
      refreshAuthSession(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(left).toBe("access-b");
    expect(right).toBe("access-b");
    expect(localStorage.setItem).toHaveBeenCalledWith("gmed_access_token", "access-b");
    expect(localStorage.setItem).toHaveBeenCalledWith("gmed_refresh_token", "refresh-b");
  });

  it("refreshes an expiring access token before sending a protected request", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage(jwtWithExp(Math.floor(Date.now() / 1000) + 10), "refresh-a");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "access-b", refresh_token: "refresh-b" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { apiFetch } = await loadApiModule();
    await expect(
      apiFetch<{ ok: boolean }>("/framework-contracts/contract-1/status", {
        method: "POST",
        body: JSON.stringify({ status: "signed" }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/refresh");
    const retriedInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(new Headers(retriedInit?.headers).get("Authorization")).toBe(
      "Bearer access-b",
    );
  });
});

describe("API error handling", () => {
  it("rejects stalled requests with a timeout error", async () => {
    vi.useFakeTimers();
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("token-a");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    const { apiFetch } = await loadApiModule();
    const request = apiFetch<{ ok: boolean }>("/slow", { timeoutMs: 25 });
    const assertion = expect(request).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it("surfaces HTTP status and error code for server errors", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("token-a");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "internal", message: "Failed" }), {
          status: 500,
          statusText: "Internal Server Error",
        }),
      ),
    );

    const { apiFetch } = await loadApiModule();

    await expect(apiFetch("/meta")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 500,
      code: "internal",
      message: "Failed",
    });
  });

  it("clears tokens and emits session-expired when refresh fails after a 401", async () => {
    setWindowOrigin("http://app.local:4173");
    setTokenStorage("stale-access", "stale-refresh");
    const sessionExpired = vi.fn();
    window.addEventListener("gmed:auth-session-expired", sessionExpired);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }),
        ),
    );

    const { apiFetch } = await loadApiModule();

    await expect(apiFetch("/me")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(localStorage.removeItem).toHaveBeenCalledWith("gmed_access_token");
    expect(localStorage.removeItem).toHaveBeenCalledWith("gmed_refresh_token");
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });
});
