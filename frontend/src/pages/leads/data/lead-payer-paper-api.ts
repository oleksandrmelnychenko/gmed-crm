import { fetchDocuments, generateDocument, uploadDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";

import {
  paperSelfDisclosurePayload,
  payerIdentityUploadForm,
  type PayerIdentityFields,
} from "../model/lead-payer-paper";

/**
 * The staff paper path of a third-party payer (DEV re-check V-A7) through the
 * generic document routes: `POST /documents/upload` (type `payer_identity`
 * on the lead), `POST /documents/generate` (`payer_self_disclosure` with
 * `paper_form`) and `POST /documents/{id}/paper-signature` (the signed scan,
 * `PaperSignatureConfirmButton`).
 */

/** The lead's documents (current versions); the paper path picks the payer's from them. */
export function fetchPayerPaperDocuments(leadId: string): Promise<DocumentItem[]> {
  return fetchDocuments(`/documents?lead_id=${encodeURIComponent(leadId)}`);
}

export function uploadPayerIdentity(leadId: string, file: File, payerName: string, fields: PayerIdentityFields) {
  return uploadDocument(payerIdentityUploadForm(leadId, file, payerName, fields));
}

export function generatePaperSelfDisclosure(leadId: string, replaceDocumentId?: string | null) {
  return generateDocument(paperSelfDisclosurePayload(leadId, replaceDocumentId));
}
