import { describe, expect, it } from "vitest";
import { accessResponse, connectionResponse, eventsResponse, fiscalYear, readResponse } from "./live-validation";
const connected = { configured: true, revision: "test", generation: "test-generation", mode: "sandbox", redirect_uri: "http://localhost/callback", exchange_enabled: true, status: "connected", has_tokens: true, expires_at: "2026-09-14T12:00:00Z", accounting_writes_enabled: false, invoice_originals_supported: false };
const result = { source: "DATEV", mode: "sandbox", kind: "fiscal-years", fiscal_year: null, company: "Synthetic", consultant_number: 1, client_number: 2, retrieved_at: "2026-09-14T12:00:00Z", records: [{ id: 20260401 }], accounting_writes_performed: false, invoice_originals_included: false };
describe("DATEV response boundaries", () => {
  it("rejects unknown or contradictory connection states", () => {
    expect(connectionResponse(connected).status).toBe("connected");
    expect(connectionResponse({ ...connected, long_term: true, bound_consultant: 29098, bound_client: 55003, session_expires_at: null }).long_term).toBe(true);
    for (const v of [{ ...connected, long_term: true }, { ...connected, long_term: "yes" }, { ...connected, session_expires_at: "invalid" }]) expect(() => connectionResponse(v)).toThrow();
    for (const v of [[], null, { ...connected, generation: undefined }, { ...connected, generation: "" }, { ...connected, status: "mystery" }, { ...connected, has_tokens: false }, { ...connected, mode: "demo" }, { ...connected, accounting_writes_enabled: true }, { ...connected, expires_at: "invalid" }]) expect(() => connectionResponse(v)).toThrow();
  });
  it("checks result identity, period, size and object records before display/download", () => {
    expect(readResponse(result, "fiscal-years").records).toHaveLength(1);
    for (const v of [{ ...result, kind: "documents" }, { ...result, fiscal_year: 20260101 }, { ...result, records: [null] }, { ...result, records: Array(10001).fill({}) }, { ...result, records: {} }, { ...result, invoice_originals_included: true }, { ...result, consultant_number: 0 }]) expect(() => readResponse(v, "fiscal-years")).toThrow();
    expect(readResponse({ ...result, records: [] }, "fiscal-years").records).toEqual([]);
  });
  it("rejects malformed services and history", () => {
    expect(() => accessResponse({ mode: "sandbox", checked_at: "2026-09-14T12:00:00Z", clients: [{ name: "test", services: null }] })).toThrow();
    expect(() => eventsResponse([{ operation: "check", outcome: "success", record_count: -1, created_at: "bad" }])).toThrow();
    expect(eventsResponse([])).toEqual([]);
  });
  it("requires a real fiscal start date including non-calendar years", () => {
    expect(fiscalYear("2026-04-01")).toBe(20260401);
    expect(fiscalYear("2024-02-29")).toBe(20240229);
    for (const v of ["", "2026", "2026-02-30", "1991-12-31", "2100-01-01", "2026-13-01"]) expect(fiscalYear(v)).toBeUndefined();
  });
});
