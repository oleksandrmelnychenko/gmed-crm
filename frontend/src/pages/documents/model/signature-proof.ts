import type { DocumentItem } from "./types";

// Kinds GMED generates for a signature that count as signed only with proof
// (owner decisions 2026-10-11): the scan of the signed copy ("Подписано на
// бумаге") or a QES — the consents, the framework contract, the enhanced due
// diligence form and the payer's Kostenübernahmeerklärung. Confirming an
// identity document is a check, not a signature, and stays one click.
// Mirrors `mark_signed_needs_proof` in crates/server/src/routes/contracts.rs.
const PROOF_REQUIRED_SIGNATURE_KINDS = new Set([
  "dsgvo",
  "confidentiality_release",
  "framework_contract",
  "enhanced_due_diligence",
  "cost_coverage_declaration",
]);

// Templates whose generated document needs that proof whatever kind confirms
// it (also "other"): the documents above and the lead's patient form
// (Patientenformular). GMED's own GwG identification sheet stays one click.
const PROOF_REQUIRED_SIGNATURE_TEMPLATES = new Set([
  "privacy_consents",
  "consent_data_release",
  "consent_data_release_child",
  "consent_data_release_single",
  "confidentiality_release",
  "framework_contract",
  "enhanced_due_diligence",
  "cost_coverage_declaration",
  "lead_self_disclosure",
  // The single order (Einzelauftrag), owner decision 2026-10-12 (QA C2-14).
  "single_order",
]);

/**
 * Whether confirming the signature of this document needs the signed scan
 * ("Подписано на бумаге") or a QES instead of a one-click confirmation: an
 * unsigned document GMED generated of a kind or template that needs proof.
 * An uploaded scan is the proof itself.
 */
export function signatureNeedsProof(
  document: Pick<DocumentItem, "generated_template_id" | "signed_at">,
  kind: string | null | undefined,
): boolean {
  const template = document.generated_template_id?.trim();
  return Boolean(
    kind
    && template
    && !document.signed_at
    && (PROOF_REQUIRED_SIGNATURE_KINDS.has(kind) || PROOF_REQUIRED_SIGNATURE_TEMPLATES.has(template)),
  );
}

/**
 * Whether the document counts as signed for the compliance kind a list
 * confirms: the recorded kind; for "other" (the patient form, the GwG sheet)
 * any signature, as a paper-signed patient form records no compliance kind.
 */
export function documentSignedFor(
  document: Pick<DocumentItem, "signed_at" | "compliance_kind">,
  kind: string | null | undefined,
): boolean {
  if (!kind || !document.signed_at) return false;
  return kind === "other" || document.compliance_kind === kind;
}
