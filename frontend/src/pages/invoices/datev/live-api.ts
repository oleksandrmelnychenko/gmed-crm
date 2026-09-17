import { apiFetch } from "@/lib/api";
import { accessResponse, connectionResponse, eventsResponse, readResponse } from "./live-validation";

export type Connection = {
  configured: boolean; revision?: string; generation?: string; mode?: "sandbox" | "production";
  redirect_uri?: string; exchange_enabled?: boolean; status: string; has_tokens: boolean;
  checked_at?: string | null; expires_at?: string | null;
  checked_consultant?: number | null; checked_client?: number | null;
  long_term?: boolean; bound_consultant?: number | null; bound_client?: number | null; session_expires_at?: string | null;
  revocation_confirmed?: boolean;
  accounting_writes_enabled: false; invoice_originals_supported: false;
};
export type Credentials = { client_id: string; client_secret: string; mode: "sandbox" | "production"; redirect_uri: string; exchange_enabled: boolean };
export type AccessCheck = {
  mode: string; checked_at: string; clients: { id: string; name: string; consultant_number: number; client_number: number; services: { name: string; scopes: string[] }[] }[];
};
export type ReadKind = "fiscal-years" | "terms-of-payment" | "sums-and-balances";
export type ReadResult = {
  source: "DATEV"; mode: string; kind: ReadKind; fiscal_year: number | null;
  company: string; consultant_number: number; client_number: number; retrieved_at: string;
  records: Record<string, unknown>[]; accounting_writes_performed: false; invoice_originals_included: false;
};
export type ReadEvent = { operation: string; outcome: string; record_count: number; created_at: string };
export type ConnectionTarget = Pick<ConfirmedTarget, "revision" | "generation" | "mode">;
export type ConfirmedTarget = { revision: string; generation: string; mode: "sandbox" | "production"; profile_revision: string; consultant_number: number; client_number: number };
const base = "/admin/datev";
export const loadConnection = async () => connectionResponse(await apiFetch<unknown>(`${base}/connection`, { forceFresh: true }));
export const saveCredentials = async (credentials: Credentials, revision?: string, generation?: string) => connectionResponse(await apiFetch<unknown>(`${base}/connection`, { method: "PUT", body: JSON.stringify({ credentials, revision: revision ?? null, generation: generation ?? null }) }));
export const authorizeDatev = (expected: ConnectionTarget, longTerm = false) => apiFetch<{ authorization_url: string }>(`${base}/authorize`, { method: "POST", body: JSON.stringify({ expected, long_term: longTerm }), credentials: "same-origin" });
export const disconnectDatev = async (expected: ConnectionTarget, force = false) => connectionResponse(await apiFetch<unknown>(`${base}/disconnect`, { method: "POST", body: JSON.stringify({ expected, force }), timeoutMs: 60000 }));
export const checkDatev = async (expected: ConfirmedTarget) => accessResponse(await apiFetch<unknown>(`${base}/check`, { method: "POST", body: JSON.stringify({ expected }), timeoutMs: 90000 }));
export const readDatev = async (expected: ConfirmedTarget, kind: ReadKind, fiscalYear?: number) => readResponse(await apiFetch<unknown>(`${base}/read`, { method: "POST", body: JSON.stringify({ expected, kind, fiscal_year: fiscalYear ?? null }), timeoutMs: 120000 }), kind, fiscalYear);
export const loadDatevEvents = async () => eventsResponse(await apiFetch<unknown>(`${base}/events`, { forceFresh: true }));

export function safeAuthorizationUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== "https://login.datev.de" || !["/openid/authorize", "/openidsandbox/authorize"].includes(url.pathname) || url.username || url.password) throw new Error("datev_authorization_url_invalid");
  return url.href;
}
export function downloadDatevResult(result: ReadResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `DATEV-${result.mode}-${result.kind}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CALLBACK = "/api/v1/datev/oauth/callback";
export const datevRedirects = { dev: `https://console-dev.gmed-health.com${CALLBACK}`, production: `https://console.gmed-health.com${CALLBACK}` };
/** Only the registered GMed consoles; a localhost callback is not offered. */
export const redirectOptions = [datevRedirects.dev, datevRedirects.production];
export function defaultRedirect(origin: string, mode: Credentials["mode"]) {
  const own = `${origin}${CALLBACK}`;
  if (own === datevRedirects.dev || own === datevRedirects.production) return own;
  return mode === "production" ? datevRedirects.production : datevRedirects.dev;
}
/** DATEV returns the browser to the redirect URL; the sign-in cookie exists only on the site that started it. */
export const sameSite = (redirect: string | undefined, origin: string) => !!redirect && redirect.startsWith(`${origin}/`);
