import { describe, expect, it } from "vitest";
import {
  contractUsability, defaultOrderContractId, documentCheckEvidence, documentCheckStatus, type DocumentCheckReadiness,
  identityDocumentOnFile, isDocumentCheckReady, passportReviewStatus, stillMissingRequiredDocuments,
} from "./order-document-review";
import { isContractUsable } from "./order-intake";

const reviewDocument = (patch: Record<string, unknown>) => ({
  art: "other", compliance_kind: null, generated_template_id: null, signed_at: null, status: "active", file_deleted_at: null,
  is_latest_version: true, original_filename: "file.pdf", auto_name: "", ...patch,
});
const signedConsent = reviewDocument({ art: "dsgvo", compliance_kind: "dsgvo", signed_at: "2026-10-24T09:00:00Z", original_filename: "consent.pdf" });
const signedRelease = reviewDocument({ art: "confidentiality_release", compliance_kind: "confidentiality_release", signed_at: "2026-10-24T09:05:00Z" });
const verifiedPassport = reviewDocument({ art: "identity", compliance_kind: "identity", signed_at: "2026-10-24T09:10:00Z", original_filename: "passport-anna.pdf" });
const missingRules = [{ key: "passport", label: "Reisepass" }, { key: "consent_form", label: "Einverständniserklärung" }];
const cardReadiness = (patch: Partial<DocumentCheckReadiness> = {}): DocumentCheckReadiness => ({
  requires_recheck: true, compliance_ready: false, confidentiality_release_ready: false, identity_ready: false, document_pack_ready: false,
  document_alerts: { missing_count: missingRules.length, out_of_sync: false, missing_documents: missingRules },
  ...patch,
});
const statuses = (readiness: DocumentCheckReadiness, documents: ReturnType<typeof reviewDocument>[]) => {
  const evidence = documentCheckEvidence(readiness, documents);
  return Object.fromEntries((["compliance_ready", "confidentiality_release_ready", "identity_ready", "document_pack_ready"] as const)
    .map(key => [key, documentCheckStatus(key, readiness, evidence)]));
};

describe("patient document check status", () => {
  it("reports a check the card has not confirmed as missing only while no document in hand covers it", () => {
    expect(statuses(cardReadiness(), [])).toEqual({
      compliance_ready: "missing", confidentiality_release_ready: "missing", identity_ready: "missing", document_pack_ready: "missing",
    });
    // A passport file that still waits for verification does not count as checked.
    const waiting = reviewDocument({ art: "passport_scan" });
    expect(statuses(cardReadiness(), [waiting]).identity_ready).toBe("missing");
  });

  it("reads a signed consent and a verified identity scan from the documents before conversion writes the card (map item 96)", () => {
    const readiness = cardReadiness();
    const documents = [signedConsent, signedRelease, verifiedPassport];
    expect(statuses(readiness, documents)).toEqual({
      compliance_ready: "signed", confidentiality_release_ready: "signed", identity_ready: "verified", document_pack_ready: "on_file",
    });
    const evidence = documentCheckEvidence(readiness, documents);
    expect(evidence).toMatchObject({ consentDate: "2026-10-24T09:00:00Z", releaseDate: "2026-10-24T09:05:00Z", identity: { name: "passport-anna.pdf", verifiedAt: "2026-10-24T09:10:00Z" }, missingDocuments: [] });
    for (const status of Object.values(statuses(readiness, documents))) expect(isDocumentCheckReady(status)).toBe(true);
    // An unsigned, archived or replaced consent is no evidence.
    expect(statuses(readiness, [reviewDocument({ art: "dsgvo", compliance_kind: "dsgvo" })]).compliance_ready).toBe("missing");
    expect(statuses(readiness, [{ ...signedConsent, status: "archived" }, { ...signedConsent, is_latest_version: false }]).compliance_ready).toBe("missing");
  });

  it("keeps the card's own verdict when it is set, and the out-of-sync warning", () => {
    const confirmed = cardReadiness({ compliance_ready: true, confidentiality_release_ready: true, identity_ready: true, document_pack_ready: true,
      document_alerts: { missing_count: 0, out_of_sync: false, missing_documents: [] } });
    expect(statuses(confirmed, [])).toEqual({
      compliance_ready: "confirmed", confidentiality_release_ready: "confirmed", identity_ready: "confirmed", document_pack_ready: "confirmed",
    });
    expect(statuses(cardReadiness({ document_pack_ready: true }), [signedConsent, verifiedPassport]).document_pack_ready).toBe("out_of_sync");
    expect(isDocumentCheckReady("out_of_sync")).toBe(false);
  });

  it("does not read documents as evidence without a re-check, where a false flag is a revoked consent", () => {
    expect(statuses(cardReadiness({ requires_recheck: false, compliance_ready: false }), [signedConsent])).toEqual({
      compliance_ready: "not_checked", confidentiality_release_ready: "not_checked", identity_ready: "not_checked", document_pack_ready: "not_checked",
    });
  });

  it("counts only the required documents nobody has yet, so the summary agrees with the rows", () => {
    expect(stillMissingRequiredDocuments(missingRules, [])).toEqual(missingRules);
    expect(stillMissingRequiredDocuments(missingRules, [verifiedPassport])).toEqual([missingRules[1]]);
    // The passport rule asks for a file, not a verification; the consent rule asks for a signature.
    expect(stillMissingRequiredDocuments(missingRules, [reviewDocument({ art: "passport_scan" }), reviewDocument({ art: "consent_form" })])).toEqual([missingRules[1]]);
    expect(stillMissingRequiredDocuments(missingRules, [reviewDocument({ art: "consent_form", generated_template_id: "consent_data_release", signed_at: "2026-10-24T09:00:00Z" })])).toEqual([missingRules[0]]);
    // A rule an administrator added is matched on the server only.
    const custom = { key: "insurance_card", label: "Versichertenkarte" };
    expect(stillMissingRequiredDocuments([...missingRules, custom], [signedConsent, verifiedPassport])).toEqual([custom]);
    // Documents of another person do not count for the patient.
    expect(stillMissingRequiredDocuments(missingRules, [reviewDocument({ art: "payer_identity" })])).toEqual(missingRules);
    expect(statuses(cardReadiness(), [signedConsent]).document_pack_ready).toBe("missing");
  });
});

describe("existing patient document validity", () => {
  it.each([
    [null, null, "unknown"], ["2026-09-11", null, "expired"],
    ["2026-09-12", null, "expiring"], ["2026-12-11", null, "expiring"],
    ["2026-12-12", null, "valid"],
    ["2027-05-01", "2027-05-02", "expires_during_order"],
    ["2027-05-01", "2027-05-01", "valid"],
  ])("checks passport %s through %s", (expiry, end, expected) => {
    expect(passportReviewStatus(expiry, end, "2026-09-12")).toBe(expected);
  });

  it("names the identity document already on file instead of asking for it again", () => {
    const document = (patch: Record<string, unknown>) => ({
      art: "passport_scan", compliance_kind: null, signed_at: null, status: "active", file_deleted_at: null,
      is_latest_version: true, original_filename: "pass.pdf", auto_name: "Reisepass", ...patch,
    });
    expect(identityDocumentOnFile([])).toBeNull();
    expect(identityDocumentOnFile([document({ art: "arztbrief" })])).toBeNull();
    // A passport scan from the patient card counts, verified or not.
    expect(identityDocumentOnFile([document({})])).toEqual({ name: "pass.pdf", verifiedAt: null });
    expect(identityDocumentOnFile([
      document({}),
      document({ art: "identity", compliance_kind: "identity", signed_at: "2026-03-01T10:00:00Z", original_filename: "alt.pdf" }),
      document({ art: "identity", compliance_kind: "identity", signed_at: "2026-09-01T10:00:00Z", original_filename: "", auto_name: "Identity document" }),
    ])).toEqual({ name: "Identity document", verifiedAt: "2026-09-01T10:00:00Z" });
    // Replaced, archived and deleted files are not on file any more.
    expect(identityDocumentOnFile([
      document({ is_latest_version: false }), document({ status: "archived" }), document({ file_deleted_at: "2026-09-01T10:00:00Z" }),
    ])).toBeNull();
  });

  it("attaches a new order to the latest signed contract unless staff choose another", () => {
    const contract = (id: string, status: string, signed_at: string | null, created_at: string) => ({ id, status, signed_at, created_at });
    expect(defaultOrderContractId([])).toBeNull();
    expect(defaultOrderContractId([contract("draft", "draft", null, "2026-09-01T00:00:00Z"), contract("ended", "terminated", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")])).toBeNull();
    expect(defaultOrderContractId([
      contract("old", "signed", "2025-03-01T00:00:00Z", "2025-02-01T00:00:00Z"),
      contract("new", "signed", "2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      contract("ended", "terminated", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    ])).toBe("new");
  });

  it("treats a signed framework contract as usable regardless of its dates", () => {
    const contract = { status: "signed", valid_from: "2020-01-01", valid_to: "2021-08-31" };
    expect(contractUsability(contract)).toBe("usable");
    expect(isContractUsable(contract)).toBe(true);
  });

  it("does not reuse terminated, expired or unsigned contracts", () => {
    expect(contractUsability({ status: "terminated" })).toBe("terminated");
    expect(contractUsability({ status: "expired" })).toBe("expired");
    expect(contractUsability({ status: "sent" })).toBe("sent");
    expect(contractUsability({ status: "draft" })).toBe("draft");
    for (const status of ["terminated", "expired", "sent", "draft"]) {
      expect(isContractUsable({ status })).toBe(false);
    }
  });
});
