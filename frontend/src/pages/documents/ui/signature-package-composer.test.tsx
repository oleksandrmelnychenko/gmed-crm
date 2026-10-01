import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  blockingWarning, combinedSignerPolicy, packageMinimumLevel, packageWarnings, requiredAttachmentTemplates, signatureErrorText, signerPolicyError, validSigners,
  type PackageCandidate, type PackageCandidates, type SignatureRequest, type Signer,
} from "../data/document-signature-api";
import { SignatureRequestMembers, signersForPolicy } from "./document-signature-panel";
import { SignaturePackageComposer, emptyPackageSelection, expiryInstant, resolvePackage } from "./signature-package-composer";
import { rolesForPolicy } from "./signature-signer-fields";

vi.mock("@/lib/i18n", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, useLang: () => ({ lang: "de" as const, t: actual.t("de") }) };
});

const candidate = (id: string, patch: Partial<PackageCandidate> = {}): PackageCandidate => ({
  id, title: `Dokument ${id}`, template: "privacy_consents", art: "consent", version: 1, order_id: null, size: 1000,
  signer_policy: "client_only", minimum_level: "AES", frame_roles: ["client"], has_frames: true, companion: null,
  is_medical: false, pending_elsewhere: false, electronic_form_excluded: null, ineligible_reason: null, ...patch,
});

const limits = { max_documents: 10, max_bundle_bytes: 18 * 1024 * 1024, max_expiry_days: 180, max_message_chars: 500 };

const candidates = (documents: PackageCandidate[], attachments: PackageCandidates["attachments"] = []): PackageCandidates => ({
  scope: { patient_id: "p", lead_id: null }, documents, attachments, preset_document_ids: [], suggested_signers: [],
  suggested_language: "de", languages: ["de", "en", "fr", "it"], limits,
});

const client: Signer = { first_name: "Anna", last_name: "Beispiel", email: "anna@example.org", role: "client" };
const agency: Signer = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };

describe("signature package composer rules", () => {
  it("takes the strictest signer policy and the highest minimum level of the package", () => {
    expect(combinedSignerPolicy(["client_only", "flexible"])).toBe("client_only");
    expect(combinedSignerPolicy(["client_only", "both_parties"])).toBe("both_parties");
    expect(combinedSignerPolicy(["agency_only", "client_only"])).toBe("conflict");
    expect(combinedSignerPolicy(["agency_only"])).toBe("agency_only");
    expect(packageMinimumLevel(["AES", "AES"])).toBe("AES");
    expect(packageMinimumLevel(["AES", "QES"])).toBe("QES");
    expect(packageMinimumLevel([])).toBe("QES");
  });

  it("checks signers against the package policy like the server", () => {
    expect(signerPolicyError("client_only", [client])).toBeNull();
    expect(signerPolicyError("client_only", [client, agency])).toBe("patient_signature_only");
    expect(signerPolicyError("both_parties", [client])).toBe("both_contract_parties_required");
    expect(signerPolicyError("both_parties", [client, { ...client, email: "bernd@example.org" }, agency])).toBeNull();
    expect(signerPolicyError("client_only", [{ ...client, role: "minor" }])).toBe("minor_needs_representative");
    expect(signerPolicyError("client_only", [client, { ...client, email: "kind@example.org", role: "minor" }])).toBeNull();
    expect(signerPolicyError("conflict", [agency])).toBe("signature_policy_conflict");
    expect(validSigners([client, { ...client, email: "kind@example.org", role: "minor" }])).toBe(true);
    expect(rolesForPolicy("client_only")).toEqual(["client", "minor"]);
    expect(rolesForPolicy("agency_only")).toEqual(["agency"]);
  });

  it("suggests every recorded guardian for the patient side", () => {
    const guardians = [client, { ...client, email: "bernd@example.org" }, agency];
    expect(signersForPolicy(guardians, "client_only").map(signer => signer.email)).toEqual(["anna@example.org", "bernd@example.org"]);
    expect(signersForPolicy(guardians, "both_parties")).toHaveLength(3);
    expect(signersForPolicy([], "agency_only")[0].role).toBe("agency");
  });

  it("warns about missing frames, pending documents, excluded forms and size", () => {
    const warnings = packageWarnings([
      candidate("a", { has_frames: false }),
      candidate("b", { pending_elsewhere: true }),
      candidate("c", { electronic_form_excluded: "§ 766 S. 2 BGB" }),
      candidate("d", { size: 19 * 1024 * 1024 }),
    ], limits);
    expect(warnings).toContainEqual({ document_id: "a", kind: "no_frames" });
    expect(warnings).toContainEqual({ document_id: "b", kind: "pending_elsewhere" });
    expect(warnings).toContainEqual({ document_id: "c", kind: "electronic_form_excluded" });
    expect(warnings).toContainEqual({ kind: "too_large" });
    expect(warnings.find(warning => warning.kind === "no_frames") && blockingWarning({ kind: "no_frames" })).toBe(false);
    expect(blockingWarning({ kind: "too_large" })).toBe(true);
    expect(packageWarnings([candidate("x", { signer_policy: "agency_only" }), candidate("y")], limits)).toContainEqual({ kind: "policy_conflict" });
  });

  it("requires every companion attachment and picks a single option automatically", () => {
    expect(requiredAttachmentTemplates([candidate("a", { companion: "privacy_information" }), candidate("b", { companion: "privacy_information" }), candidate("c")])).toEqual(["privacy_information"]);
    const pool = candidates(
      [candidate("contract", { template: "framework_contract", signer_policy: "both_parties", minimum_level: "QES", companion: "privacy_information" }), candidate("consent")],
      [{ id: "info", title: "Datenschutzinformation", template: "privacy_information", art: "privacy_information", version: 1, order_id: null, size: 10 }],
    );
    const resolved = resolvePackage(pool, { ...emptyPackageSelection("contract"), documentIds: ["contract", "consent"] });
    expect(resolved.required).toEqual(["privacy_information"]);
    expect(resolved.attachmentIds).toEqual(["info"]);
    expect(resolved.minimumLevel).toBe("QES");
    expect(resolved.complete).toBe(true);
    expect(resolved.blocked).toBe(false);
    const missing = resolvePackage({ ...pool, attachments: [] }, { ...emptyPackageSelection("contract"), documentIds: ["contract"] });
    expect(missing.complete).toBe(false);
  });

  it("renders the selection in order, disables AES under a contract and lists attachments", () => {
    const pool = candidates(
      [candidate("contract", { title: "Rahmenvertrag", template: "framework_contract", signer_policy: "both_parties", minimum_level: "QES", companion: "privacy_information" }), candidate("consent", { title: "Einwilligung", has_frames: false })],
      [{ id: "info", title: "Datenschutzinformation", template: "privacy_information", art: "privacy_information", version: 2, order_id: null, size: 10 }],
    );
    const markup = renderToStaticMarkup(<SignaturePackageComposer documentId="contract" candidates={pool} previewedDocumentIds={["contract"]}
      selection={{ ...emptyPackageSelection("contract"), documentIds: ["contract", "consent"] }} onChange={vi.fn()} onPreview={vi.fn()} />);
    expect(markup.indexOf("Rahmenvertrag")).toBeLessThan(markup.indexOf("Einwilligung"));
    expect(markup).toContain("Kein Unterschriftsfeld");
    expect(markup).toContain("Datenschutzinformation (Art. 13/14 DSGVO)");
    expect(markup).toContain('value="info"');
    expect(markup).toContain("Verträge und Aufträge erfordern eine QES");
    expect(markup).toContain("Noch nicht angesehen");
  });

  it("maps server errors to German texts and converts the expiry date", () => {
    const tx = (_ru: string, de: string) => de;
    expect(signatureErrorText("electronic_form_excluded", tx, { statute: "§ 766 S. 2 BGB" })).toContain("§ 766 S. 2 BGB");
    expect(signatureErrorText("signature_bundle_too_large", tx)).toContain("18 MB");
    expect(signatureErrorText("signature_level_too_low", tx, { minimum_level: "QES" })).toContain("QES");
    expect(signatureErrorText("unknown_code", tx)).toContain("Aktion fehlgeschlagen");
    expect(expiryInstant("2026-10-31")).toBe("2026-10-31T21:59:00.000Z");
    expect(expiryInstant("")).toBeNull();
  });
});

describe("signature request members", () => {
  const request: SignatureRequest = {
    id: "r", status: "completed", test_mode: false, signers: [client, agency], result_document_id: "bundle", has_report: true,
    last_error: null, created_at: "2026-10-01T10:00:00Z", evidence: {}, is_package: true,
    members: [
      { document_id: "contract", position: 0, page_start: 1, page_count: 2, result_document_id: "bundle", accessible: true, title: "Rahmenvertrag", template: "framework_contract", version: 3 },
      { document_id: "order", position: 1, page_start: 3, page_count: 1, result_document_id: "bundle", accessible: false, title: null, template: null, version: null },
      { document_id: "consent", position: 2, page_start: 4, page_count: 3, result_document_id: "bundle", accessible: true, title: "Einwilligung", template: "privacy_consents", version: 1 },
    ],
    attachments: [{ document_id: "info", stage: "sent", title: "Datenschutzinformation" }],
  };

  it("lists every document with its pages and marks the current one", () => {
    const markup = renderToStaticMarkup(<SignatureRequestMembers request={request} documentId="consent" />);
    expect(markup).toContain("Paket aus 3 Dokumenten");
    expect(markup).toContain("1. Rahmenvertrag · v3 · S. 1–2");
    expect(markup).toContain("2. Dokument ohne Zugriff · S. 3");
    expect(markup).toContain("3. Einwilligung · v1 · S. 4–6 · dieses Dokument");
    expect(markup).toContain("Zur Kenntnisnahme: Datenschutzinformation");
    expect(markup).toContain("nicht aufgeteilt");
  });

  it("shows nothing extra for a single document without attachments", () => {
    const markup = renderToStaticMarkup(<SignatureRequestMembers request={{ ...request, is_package: false, members: request.members!.slice(0, 1), attachments: [] }} documentId="contract" />);
    expect(markup).toBe("");
  });
});
