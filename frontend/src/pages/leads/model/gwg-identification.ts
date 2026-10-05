import type { DocumentItem } from "@/pages/documents/model/types";

/**
 * The GwG identification sheet ("Dokumentationsbogen für natürliche
 * Personen") of a lead: one for the patient and one for a third-party payer.
 * The server fills it from the lead; the only choice is whose sheet it is.
 */
export const GWG_IDENTIFICATION_TEMPLATE = "gwg_identification";

export type GwgSheetSubject = "contract_partner" | "payer";

/** Whose sheet a stored document is; older or foreign documents count as the patient's. */
export function gwgSheetSubject(document: Pick<DocumentItem, "generated_bindings">): GwgSheetSubject {
  const binding = document.generated_bindings?.gwg_identification;
  const subject = binding && typeof binding === "object" ? (binding as { subject?: unknown }).subject : null;
  return subject === "payer" ? "payer" : "contract_partner";
}

/** The current sheet of that person, which a new one replaces as the next version. */
export function currentGwgSheet(
  documents: readonly DocumentItem[],
  subject: GwgSheetSubject,
): DocumentItem | undefined {
  return documents
    .filter((document) =>
      document.generated_template_id === GWG_IDENTIFICATION_TEMPLATE
      && !document.file_deleted_at
      && document.is_latest_version !== false
      && gwgSheetSubject(document) === subject)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

/** Request body of `POST /documents/generate` for the sheet of a lead. */
export function gwgSheetRequest(input: {
  leadId: string;
  subject: GwgSheetSubject;
  orderId?: string | null;
  orderNumber?: string | null;
  replaceDocumentId?: string | null;
}): Record<string, unknown> {
  return {
    template_id: GWG_IDENTIFICATION_TEMPLATE,
    lead_id: input.leadId,
    order_id: input.orderId ?? undefined,
    replace_document_id: input.replaceDocumentId ?? undefined,
    language: "de",
    document_language: "de",
    document_direction: "outgoing",
    document_variant: "original",
    access_category: "patient",
    status: "active",
    auto_name:
      input.subject === "payer"
        ? "Dokumentationsbogen natürliche Personen – Kostenübernehmer"
        : undefined,
    bindings: {
      order_number: input.orderNumber ?? undefined,
      gwg_identification: { subject: input.subject },
    },
  };
}
