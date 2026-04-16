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

async function loadApiModule(apiOrigin = "") {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", apiOrigin);
  return import("./api");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "window");
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
