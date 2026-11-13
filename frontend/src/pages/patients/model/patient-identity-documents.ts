import { isOtherPersonUploadArt } from "@/pages/leads/model/gwg-identification";

import type { DocumentItem } from "./detail-tab-types";

/**
 * The patient's own identity document. An upload about another person — a
 * representative's or the payer's passport, a proof of authority or of the
 * source of funds — is filed with category `identity` too, and is never the
 * patient's.
 */
export function isPatientIdentityDocument(document: Pick<DocumentItem, "art" | "category" | "compliance_kind">) {
  if (isOtherPersonUploadArt(document.art)) return false;
  const markers = [document.art, document.category, document.compliance_kind]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  return markers.some((value) => [
    "identity",
    "passport",
    "passport_scan",
    "personal_passport",
  ].includes(value ?? ""));
}
