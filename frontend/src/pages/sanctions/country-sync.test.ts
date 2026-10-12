import { describe, expect, it, vi } from "vitest";

import { EU_REGIMES_URL, fetchEuCountryCodes, regimeCountryCodes, syncEuBlockedCountries } from "./country-sync";

const NOW = Date.UTC(2026, 9, 12);
const regime = (code: string, changes: Record<string, unknown> = {}) => ({
  type: 0,
  country: { data: { code } },
  expiration: null,
  measures: { data: [{ suspend: false, type: { data: { id: 6 } } }] },
  ...changes,
});
const feed = (...regimes: unknown[]) => ({ data: regimes });
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

describe("EU sanctions country source", () => {
  it("uses geographic regimes, never citizenships or addresses of listed people", () => {
    expect(regimeCountryCodes(feed(regime("RU"), regime("IR"), regime("RU"),
      regime("DE", { type: 1 }), { citizenships: ["DE"], address: { country: "FR" } }), NOW)).toEqual(["IR", "RU"]);
  });

  it("excludes expired and fully suspended regimes, and unknown country codes", () => {
    expect(regimeCountryCodes(feed(regime("RU"), regime("BY", { expiration: NOW / 1000 }),
      regime("SY", { measures: { data: [{ suspend: true, type: { data: { id: 6 } } }] } }),
      regime("XX")), NOW)).toEqual(["RU"]);
  });

  it("keeps active arms embargoes but excludes the Blocking Statute and repealed-regime claims", () => {
    const measures = (id: number) => ({ data: [{ suspend: false, type: { data: { id } } }] });
    expect(regimeCountryCodes(feed(regime("CN", { measures: measures(2) }),
      regime("US", { measures: measures(65) }), regime("RS", { measures: measures(17) }),
      regime("ME", { measures: measures(17) })), NOW)).toEqual(["CN"]);
  });

  it("rejects empty, malformed or uncertain data instead of saving a new policy", () => {
    for (const data of [null, {}, { data: {} }, feed(), feed(regime("RU", { expiration: "unknown" })),
      feed(regime("RU", { measures: null }))]) {
      expect(() => regimeCountryCodes(data, NOW)).toThrow();
    }
  });

  it("fetches only the public feed without credentials or a referrer", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(feed(regime("RU"))));
    expect(await fetchEuCountryCodes(fetcher)).toEqual(["RU"]);
    expect(fetcher).toHaveBeenCalledWith(EU_REGIMES_URL, expect.objectContaining({
      credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: expect.any(AbortSignal),
    }));
  });

  it("rejects HTTP failures and oversized responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("failed", { status: 503 }));
    await expect(fetchEuCountryCodes(fetcher)).rejects.toThrow();
    fetcher.mockResolvedValue(new Response("{}", { headers: { "content-length": String(9 * 1024 * 1024) } }));
    await expect(fetchEuCountryCodes(fetcher)).rejects.toThrow("too large");
  });
});

describe("downloaded countries in the saved blocking policy", () => {
  it("preserves the latest manual additions and saves the union once", async () => {
    const api = {
      listStatus: vi.fn().mockResolvedValue({ blocked_countries: ["CU", "RU"] }),
      setBlockedCountries: vi.fn(async (countries: string[]) => ({ blocked_countries: countries })),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(feed(regime("RU"), regime("IR"))));
    expect(await syncEuBlockedCountries(api, fetcher)).toEqual({ countries: ["CU", "IR", "RU"], added: 1, sourceCount: 2 });
    expect(api.setBlockedCountries).toHaveBeenCalledExactlyOnceWith(["CU", "IR", "RU"]);
  });

  it("does not rewrite an unchanged policy or overwrite it when the source fails", async () => {
    const api = { listStatus: vi.fn().mockResolvedValue({ blocked_countries: ["RU"] }), setBlockedCountries: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(feed(regime("RU"))));
    await syncEuBlockedCountries(api, fetcher);
    expect(api.setBlockedCountries).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(response(feed()));
    await expect(syncEuBlockedCountries(api, fetcher)).rejects.toThrow();
    expect(api.setBlockedCountries).not.toHaveBeenCalled();
  });
});
