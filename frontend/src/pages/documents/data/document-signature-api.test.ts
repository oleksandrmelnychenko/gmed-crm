import { describe, expect, it } from "vitest";
import {
  combinedSignerPolicy, isSignaturePending, signatureErrorText, signatureFrameCoverage, signerPolicyError, validSigners, type Signer,
} from "./document-signature-api";

const signer: Signer = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
describe("document signing", () => {
  it("rejects missing names and malformed or duplicated recipients before dispatch", () => {
    expect(validSigners([signer])).toBe(true);
    expect(validSigners([])).toBe(false);
    expect(validSigners([{ ...signer, first_name: "  " }])).toBe(false);
    expect(validSigners([{ ...signer, email: "bad email@example.org" }])).toBe(false);
    expect(validSigners([signer, { ...signer, email: " ERIKA@EXAMPLE.ORG " }])).toBe(false);
  });
  it("keeps uncertain submissions pending so the client cannot send twice", () => {
    for (const status of ["submitting", "submission_unknown", "pending"] as const) expect(isSignaturePending(status)).toBe(true);
    for (const status of ["completed", "needs_review", "declined", "withdrawn", "expired", "error"] as const) expect(isSignaturePending(status)).toBe(false);
  });
  it("tells whether signers sign in prepared frames or place the signature themselves", () => {
    const framed = { ...signer, positions: [{ page: "0", x: 71, y: 120, width: 170, height: 30 }] };
    const agency: Signer = { ...signer, email: "agency@example.org", role: "agency" };
    expect(signatureFrameCoverage([framed, { ...agency, positions: [{}] }])).toBe("all");
    expect(signatureFrameCoverage([framed, agency])).toBe("some");
    expect(signatureFrameCoverage([signer, { ...agency, positions: [] }])).toBe("none");
  });
  it("matches the server's UTF-8 name limits and ASCII email requirements", () => {
    expect(validSigners([{ ...signer, first_name: "Ö".repeat(60) }])).toBe(true);
    for (const first_name of ["Ö".repeat(61), "A".repeat(121), "Erika\u0001", "Eri\u0085ka"]) {
      expect(validSigners([{ ...signer, first_name }])).toBe(false);
    }
    for (const email of ["erika@.org", "erika@example.", "ä@example.org", "erika@exämple.org", "e\u007f@example.org", `${"a".repeat(250)}@example.org`]) {
      expect(validSigners([{ ...signer, email }])).toBe(false);
    }
    expect(validSigners([{ ...signer, first_name: " Олександр ", email: " ERIKA@EXAMPLE.ORG " }])).toBe(true);
    expect(validSigners(Array.from({ length: 7 }, (_, n) => ({ ...signer, email: `person${n}@example.org` })))).toBe(false);
  });
  it("keeps the payer's package away from the patient side (mirrors the server)", () => {
    expect(combinedSignerPolicy(["payer_package"])).toBe("payer_package");
    expect(combinedSignerPolicy(["payer_package", "payer_and_agency", "flexible"])).toBe("payer_package");
    for (const other of ["client_only", "both_parties", "client_payer_and_agency", "agency_only"] as const) {
      expect(combinedSignerPolicy(["payer_package", other])).toBe("conflict");
    }
    const payer: Signer = { first_name: "Viktor", last_name: "Zahler", email: "viktor.zahler@example.com", role: "payer" };
    const agency: Signer = { first_name: "Ben", last_name: "Muster", email: "ben.muster@example.com", role: "agency" };
    expect(signerPolicyError("payer_package", [payer, agency])).toBeNull();
    expect(signerPolicyError("payer_package", [payer])).toBe("payer_package_signers_required");
    expect(signerPolicyError("payer_package", [payer, agency, signer])).toBe("payer_package_signers_required");
    expect(signerPolicyError("payer_package", [payer, agency, { ...signer, role: "minor" }])).toBe("minor_needs_representative");
    expect(signatureErrorText("payer_package_signers_required", (_ru, de) => de)).toBe(
      "Die Unterlagen des Zahlers unterschreiben nur der Zahler und die GMED-Vertretung – ohne Patientenseite.",
    );
  });
});
