/**
 * Proofs of the origin of assets attached to the enhanced due-diligence form
 * (§ 15 Abs. 4 Nr. 2 GwG). Each one is an uploaded document of the patient or
 * lead; the form keeps only the reference and the file name.
 */
export type AssetOriginEvidence = {
  documentId: string;
  filename: string;
};

/** Document type (`art`) of an uploaded proof; the server accepts no other type as a proof. */
export const AML_ASSET_ORIGIN_EVIDENCE_ART = "aml_asset_origin_evidence";

export const MAX_ASSET_ORIGIN_EVIDENCE = 20;

/**
 * Reads the stored list: an array (wizard state, generated bindings) or its
 * JSON text (the string-valued binding form). Anything else is an empty list.
 */
export function parseAssetOriginEvidence(value: unknown): AssetOriginEvidence[] {
  let source = value;
  if (typeof source === "string") {
    if (!source.trim()) return [];
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const items: AssetOriginEvidence[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const documentId = typeof record.documentId === "string" ? record.documentId.trim() : "";
    if (!documentId || seen.has(documentId)) continue;
    seen.add(documentId);
    items.push({ documentId, filename: typeof record.filename === "string" ? record.filename : "" });
  }
  return items;
}

/** The list as the text value of the binding form; empty when nothing is attached. */
export function serializeAssetOriginEvidence(items: AssetOriginEvidence[]): string {
  return items.length > 0 ? JSON.stringify(items) : "";
}

export const MAX_ASSET_ORIGIN_EVIDENCE_FILE_SIZE = 25 * 1024 * 1024;

/** The patient or, before conversion, the lead a proof is filed under. */
export type AssetOriginEvidenceSubject = {
  patientId?: string | null;
  leadId?: string | null;
};

/**
 * The upload form that stores one proof as an internal compliance document of
 * the patient (preferred) or the lead; `null` without either.
 */
export function assetOriginEvidenceUploadForm(
  file: File,
  subject: AssetOriginEvidenceSubject,
): FormData | null {
  const patientId = subject.patientId?.trim() ?? "";
  const leadId = subject.leadId?.trim() ?? "";
  if (!patientId && !leadId) return null;
  const form = new FormData();
  if (patientId) form.set("patient_id", patientId);
  else form.set("lead_id", leadId);
  form.set("file", file);
  form.set("auto_name", `Herkunftsnachweis (GwG) · ${file.name}`);
  form.set("art", AML_ASSET_ORIGIN_EVIDENCE_ART);
  form.set("category", "compliance_aml");
  form.set("status", "active");
  form.set("visibility", "internal");
  form.set("document_direction", "incoming");
  return form;
}
