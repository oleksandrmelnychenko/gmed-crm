import { ApiRequestError } from "@/lib/api";
import type { AccessCheck, Connection, ReadEvent, ReadKind, ReadResult } from "./live-api";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const mode = (v: unknown) => v === "sandbox" || v === "production";
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const positive = (v: unknown) => Number.isInteger(v) && Number(v) > 0;
function requireValid(ok: boolean): asserts ok {
  if (!ok) throw new ApiRequestError("Invalid DATEV response", { code: "datev_protocol_error" });
}
export function connectionResponse(v: unknown): Connection {
  requireValid(object(v));
  requireValid(typeof v.configured === "boolean" && typeof v.has_tokens === "boolean" && v.accounting_writes_enabled === false && v.invoice_originals_supported === false);
  requireValid(["not_configured", "disconnected", "connected", "reconnect_required", "revocation_pending"].includes(String(v.status)));
  if (v.configured) {
    requireValid(text(v.revision) && !!v.revision && text(v.generation) && !!v.generation && mode(v.mode) && text(v.redirect_uri) && typeof v.exchange_enabled === "boolean");
    requireValid(v.status !== "not_configured");
  } else requireValid(v.status === "not_configured" && !v.has_tokens);
  if (v.status === "connected") requireValid(v.has_tokens === true && date(v.expires_at));
  if (v.status === "disconnected") requireValid(v.has_tokens === false);
  requireValid(v.checked_at == null || date(v.checked_at));
  requireValid(v.expires_at == null || date(v.expires_at));
  return v as Connection;
}
export function accessResponse(v: unknown): AccessCheck {
  requireValid(object(v) && mode(v.mode) && date(v.checked_at) && Array.isArray(v.clients));
  requireValid(v.clients.length > 0 && v.clients.length <= 100 && v.clients.every((c: unknown) => object(c) && text(c.id) && text(c.name) && positive(c.consultant_number) && positive(c.client_number) && Array.isArray(c.services) && c.services.every((s: unknown) => object(s) && text(s.name) && Array.isArray(s.scopes) && s.scopes.every(text))));
  return v as unknown as AccessCheck;
}
export function readResponse(v: unknown, kind: ReadKind, year?: number): ReadResult {
  requireValid(object(v) && v.source === "DATEV" && mode(v.mode) && v.kind === kind && v.fiscal_year === (year ?? null));
  requireValid(text(v.company) && positive(v.consultant_number) && positive(v.client_number) && date(v.retrieved_at));
  requireValid(v.accounting_writes_performed === false && v.invoice_originals_included === false && Array.isArray(v.records) && v.records.length <= 10000 && v.records.every(object));
  return v as ReadResult;
}
export function eventsResponse(v: unknown): ReadEvent[] {
  requireValid(Array.isArray(v) && v.length <= 50 && v.every((r: unknown) => object(r) && text(r.operation) && text(r.outcome) && Number.isInteger(r.record_count) && Number(r.record_count) >= 0 && date(r.created_at)));
  return v as ReadEvent[];
}
export function fiscalYear(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  const n = Number(value.replaceAll("-", ""));
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && n >= 19920101 && n <= 20991231 ? n : undefined;
}
