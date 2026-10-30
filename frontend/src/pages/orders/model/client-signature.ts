import { ApiRequestError } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";
import { uiText } from "@/lib/i18n";
import { formatMoneyLabel } from "@/lib/money";

import type { OrderClientSignature } from "./types";

/**
 * The client's signature of an order covers the terms it was given for (QA
 * C3-01, 2026-10-12): the services, the programme period and the total. The
 * server refuses a staff change of those terms on a signed order with 409
 * `order_signed_terms_change` (its localized message names the signed and
 * the new total); after the user confirms, the same change is sent again with
 * `confirm_signature_reset` and resets the order signatures.
 */
export const SIGNED_TERMS_CHANGE = "order_signed_terms_change";

/** Whether the error refuses a change of the terms the client signed. */
export function isSignedTermsChange(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 409 && error.code === SIGNED_TERMS_CHANGE;
}

/** The user kept the client's signature: the change was not saved. */
export class SignedTermsChangeCancelled extends Error {
  constructor() {
    super(uiText("orders_signed_terms_change_cancelled"));
    this.name = "SignedTermsChangeCancelled";
  }
}

/**
 * Runs `attempt(false)`; when the server refuses a change of signed terms,
 * asks `confirmChange` with the refusal (its message names both totals) and
 * runs `attempt(true)` after a yes. A no throws `SignedTermsChangeCancelled`.
 */
export async function withSignedTermsConfirmation<T>(
  attempt: (confirmSignatureReset: boolean) => Promise<T>,
  confirmChange: (refusal: ApiRequestError) => boolean | Promise<boolean> = (refusal) => window.confirm(refusal.message),
): Promise<T> {
  try {
    return await attempt(false);
  } catch (error) {
    if (!isSignedTermsChange(error)) throw error;
    if (!(await confirmChange(error))) throw new SignedTermsChangeCancelled();
    return attempt(true);
  }
}

/**
 * The confirmation of a refused change: the signed total from the refusal
 * and the new total — the screen's own total when it changes several
 * services at once (the refusal knows only the first one), else the
 * refusal's.
 */
export function signedTermsChangeConfirmText(refusal: ApiRequestError, newTotal: number | null): string {
  const body = (refusal.body ?? {}) as Record<string, unknown>;
  const label = (value: unknown) => (typeof value === "string" && value ? value : "—");
  return uiText("api_orders_signed_terms_change", undefined, {
    signed_total_label: label(body.signed_total_label),
    new_total_label: newTotal != null && Number.isFinite(newTotal)
      ? formatMoneyLabel(newTotal, "EUR")
      : label(body.new_total_label),
  });
}

/**
 * Whether an order document was made after the last change of the order's
 * terms: only such a version can still record the client's signature (an
 * older one shows services or a period the order no longer has).
 */
export function documentMatchesOrderTerms(
  documentCreatedAt: string | null | undefined,
  termsChangedAt: string | null | undefined,
): boolean {
  if (!termsChangedAt) return true;
  if (!documentCreatedAt) return false;
  const created = Date.parse(documentCreatedAt);
  const changed = Date.parse(termsChangedAt);
  if (!Number.isFinite(created) || !Number.isFinite(changed)) return true;
  // As the server's `document_terms_current`: made at or after the change.
  return created >= changed;
}

function sameAmount(left: unknown, right: unknown): boolean {
  const a = Number(String(left ?? "").replace(",", "."));
  const b = Number(String(right ?? "").replace(",", "."));
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * The line an order shows about the client's signed version: "changes wait
 * for the client's signature" after a reset, or the signed total next to a
 * current total that billing actuals (approved interpreter hours, completed
 * visits, approved amendments) have moved. `null` when there is nothing to
 * say.
 */
export function clientSignatureNote(
  signature: OrderClientSignature | null | undefined,
  signedPatient: boolean,
  currentTotal: unknown,
  currency?: string | null,
): { tone: "warning" | "info"; text: string } | null {
  if (!signature?.signed_total) return null;
  const signedTotal = formatMoneyLabel(signature.signed_total, currency);
  const signedAt = signature.signed_at ? formatAppDate(signature.signed_at) : "—";
  if (!signedPatient && signature.changes_await_signature) {
    return {
      tone: "warning",
      text: uiText("orders_client_signature_changes_await", undefined, {
        signed_total: signedTotal,
        signed_at: signedAt,
      }),
    };
  }
  if (signedPatient && currentTotal != null && !sameAmount(signature.signed_total, currentTotal)) {
    return {
      tone: "info",
      text: uiText("orders_client_signature_signed_total_actuals", undefined, {
        signed_total: signedTotal,
        current_total: formatMoneyLabel(currentTotal, currency),
      }),
    };
  }
  return null;
}
