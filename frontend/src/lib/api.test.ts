import { afterEach, describe, expect, it, vi } from "vitest";

function setWindowOrigin(origin: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin,
      },
    },
  });
}

function setAccessToken(token: string | null = null) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => token),
    },
  });
}

async function loadApiModule(apiOrigin = "") {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", apiOrigin);
  return import("./api");
}

afterEach(() => {
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
    setAccessToken("token-a");
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
    setAccessToken("token-a");
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
    const first = await apiFetch<{ version: number }>("/meta", {
      cacheTtlMs: 30_000,
    });
    const cached = await apiFetch<{ version: number }>("/meta", {
      cacheTtlMs: 30_000,
    });
    await apiFetch<{ ok: boolean }>("/meta/update", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    const afterMutation = await apiFetch<{ version: number }>("/meta", {
      cacheTtlMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(first.version).toBe(1);
    expect(cached.version).toBe(1);
    expect(afterMutation.version).toBe(2);
  });
});
