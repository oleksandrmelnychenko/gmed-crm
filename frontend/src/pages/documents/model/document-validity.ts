import { formatAppDate } from "@/lib/app-time-zone";

/**
 * Optional validity date of a document, «Действует до» / «Gültig bis» (owner
 * decision 2026-11-15). The server derives the status by the Berlin day
 * (`services::document_validity`): `valid` (more than 30 days left),
 * `expiring` (30 days or fewer, 0 = the last day), `expired` (passed). A
 * document without a date is not tracked: no status, no hint.
 */
export type DocumentValidityStatus = "valid" | "expiring" | "expired";

export type DocumentValidity = {
  valid_until?: string | null;
  validity_status?: DocumentValidityStatus | null;
  validity_days_left?: number | null;
  status?: string | null;
  is_latest_version?: boolean | null;
};

/** The list filter (`GET /documents?validity=`). */
export type DocumentValidityFilter = "" | "attention" | "expired" | "expiring";

type Tx = (ru: string, de: string) => string;

/** «Действует» / «Истекает через N дн.» / «Просрочен»; null without a date. */
export function validityStatusText(document: DocumentValidity, tx: Tx): string | null {
  if (!document.valid_until || !document.validity_status) return null;
  if (document.validity_status === "expired") return tx("Просрочен", "Abgelaufen");
  if (document.validity_status === "expiring") {
    const days = Math.max(0, document.validity_days_left ?? 0);
    if (days === 0) return tx("Истекает сегодня", "Läuft heute ab");
    return tx(`Истекает через ${days} дн.`, days === 1 ? "Läuft in 1 Tag ab" : `Läuft in ${days} Tagen ab`);
  }
  return tx("Действует", "Gültig");
}

/** «Действует до DD.MM.YYYY»; null without a date. */
export function validUntilText(document: DocumentValidity, tx: Tx): string | null {
  if (!document.valid_until) return null;
  const date = formatAppDate(document.valid_until);
  return date ? tx(`Действует до ${date}`, `Gültig bis ${date}`) : null;
}

/**
 * A current document that needs attention: expiring or expired, the newest
 * version, not archived. Older versions are history.
 */
export function needsValidityAttention(document: DocumentValidity): boolean {
  return Boolean(document.valid_until)
    && (document.validity_status === "expiring" || document.validity_status === "expired")
    && document.is_latest_version !== false
    && document.status !== "archived";
}

/**
 * What renews an expiring or expired document (QA 2026-11-16 S2-1):
 * - `extend_quote`: a Kostenvoranschlag takes its date from its quote, so a new
 *   version alone would carry the same date; «Продлить срок до …» extends the
 *   quote and makes the new version;
 * - `new_version`: another document made from a template;
 * - `upload_new`: an uploaded scan gets its next version by upload;
 * - null: nothing to renew.
 */
export type ValidityRenewalKind = "extend_quote" | "new_version" | "upload_new";

export function validityRenewalKind(
  document: DocumentValidity & { generated_template_id?: string | null; order_id?: string | null },
): ValidityRenewalKind | null {
  if (!needsValidityAttention(document)) return null;
  if (document.generated_template_id === "order_cost_estimate" && document.order_id) return "extend_quote";
  if (document.generated_template_id) return "new_version";
  return "upload_new";
}

/** The date «Продлить срок до …» suggests: today + the usual offer validity (30 days). */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export function countValidityAttention(documents: ReadonlyArray<DocumentValidity>): number {
  return documents.filter(needsValidityAttention).length;
}

/** The list filter applied in the browser (patient card, order). */
export function matchesValidityFilter(document: DocumentValidity, filter: DocumentValidityFilter): boolean {
  if (!filter) return true;
  if (!needsValidityAttention(document)) return false;
  return filter === "attention" || document.validity_status === filter;
}

export function parseValidityFilter(value: string | null | undefined): DocumentValidityFilter {
  return value === "attention" || value === "expired" || value === "expiring" ? value : "";
}
