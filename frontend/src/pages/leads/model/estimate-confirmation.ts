/**
 * How the estimate of an order (Kostenvoranschlag) is confirmed in the lead
 * wizard. Owner decision 2026-11-11: by the client's signature on its
 * document — electronic, or on paper with the scan of the signed copy —
 * which accepts the quote on the server; never by a click alone (the status
 * route answers 409 `estimate_signature_required` without a signed document).
 */
export type EstimateDocumentState = {
  id: string;
  created_at: string;
  signed_at?: string | null;
};

export type EstimateConfirmationStep =
  /** The quote is accepted: nothing to do. */
  | "accepted"
  /** No estimate document yet: it is generated first. */
  | "needs_document"
  /** The document waits for the signature: «Подписано на бумаге» or the e-signature. */
  | "sign"
  /** The document is signed and the quote was made anew for it: one confirmation, which the server allows. */
  | "confirm_signed";

/** The newest current version among the order's estimate documents. */
export function currentEstimateDocument<T extends EstimateDocumentState>(documents: readonly T[]): T | null {
  return [...documents].sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

export function estimateConfirmationStep(
  quoteAccepted: boolean,
  document: EstimateDocumentState | null,
): EstimateConfirmationStep {
  if (quoteAccepted) return "accepted";
  if (!document) return "needs_document";
  return document.signed_at ? "confirm_signed" : "sign";
}
