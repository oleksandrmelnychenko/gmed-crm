import { describe, expect, it } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";

import { normalizePayerDeclarationResponse, payerReadinessReasonFields, payerReasonLabel, PAYER_SECTION_ID } from "./lead-payer";
import {
  EMPTY_PAYER_IDENTITY_FIELDS,
  normalizePayerIdentification,
  PAYER_PAPER_PATH_ID,
  paperSelfDisclosurePayload,
  payerIdentificationLine,
  payerIdentityAnswersPatch,
  payerIdentityDocumentName,
  payerIdentityNotes,
  payerIdentityUploadForm,
  payerPaperDocuments,
  payerPaperPathDerived,
} from "./lead-payer-paper";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const document = (patch: Partial<DocumentItem>): DocumentItem => ({
  id: "doc",
  patient_id: null,
  auto_name: "Dokument",
  original_filename: "scan.pdf",
  art: "uploaded_document",
  status: "active",
  generated_template_id: null,
  is_latest_version: true,
  created_at: "2026-10-25T08:00:00Z",
  signed_at: null,
  notes: null,
  ...patch,
} as DocumentItem);

describe("payer paper path (re-check V-A7)", () => {
  it("files the payer's identity document on the lead with the optional ID data as German notes", () => {
    const file = new File(["%PDF-1.4"], "pass.pdf", { type: "application/pdf" });
    const form = payerIdentityUploadForm("lead-1", file, " Erika Zahler ", {
      type: "passport",
      number: " P7654321 ",
      issuingCountry: "at",
      validUntil: "2031-12-31",
    });
    expect(form.get("lead_id")).toBe("lead-1");
    expect(form.get("art")).toBe("payer_identity");
    expect(form.get("category")).toBe("identity");
    expect(form.get("auto_name")).toBe("Ausweisdokument – Kostenübernehmer/in Erika Zahler");
    expect(form.get("is_medical")).toBe("false");
    expect(form.get("visibility")).toBe("internal");
    expect(form.get("source_person")).toBe("payer");
    expect(form.get("notes")).toBe("Reisepass Nr. P7654321, Ausstellungsstaat AT, gültig bis 31.12.2031");
    expect((form.get("file") as File).name).toBe("pass.pdf");
    // Every ID field is optional: no notes without any.
    const bare = payerIdentityUploadForm("lead-1", file, "", EMPTY_PAYER_IDENTITY_FIELDS);
    expect(bare.get("notes")).toBeNull();
    expect(bare.get("auto_name")).toBe("Ausweisdokument – Kostenübernehmer/in");
    expect(payerIdentityNotes({ ...EMPTY_PAYER_IDENTITY_FIELDS, number: "X1" })).toBe("Ausweisdokument Nr. X1");
  });

  it("generates the Selbstauskunft as a paper form, a new version replacing the unsigned one", () => {
    expect(paperSelfDisclosurePayload("lead-1")).toMatchObject({
      template_id: "payer_self_disclosure",
      lead_id: "lead-1",
      paper_form: true,
      language: "de",
    });
    expect(paperSelfDisclosurePayload("lead-1")).not.toHaveProperty("replace_document_id");
    expect(paperSelfDisclosurePayload("lead-1", "doc-1")).toMatchObject({ replace_document_id: "doc-1" });
  });

  it("picks the current Selbstauskunft and the payer's identity documents", () => {
    const picked = payerPaperDocuments([
      document({ id: "old", generated_template_id: "payer_self_disclosure", is_latest_version: false }),
      document({ id: "sd", generated_template_id: "payer_self_disclosure", created_at: "2026-10-25T09:00:00Z" }),
      document({ id: "id-1", art: "payer_identity" }),
      document({ id: "id-archived", art: "payer_identity", status: "archived" }),
      document({ id: "other", art: "representative_identity" }),
    ]);
    expect(picked.selfDisclosure?.id).toBe("sd");
    expect(picked.identity.map((item) => item.id)).toEqual(["id-1"]);
  });

  it("says what is missing and where the readiness reason leads", () => {
    const missing = { required: true, identified: false, statement_sent: false, self_disclosure_signed: false, identity_document: true };
    expect(payerIdentificationLine(missing, ru)).toEqual({
      tone: "warning",
      text: "Заполните анкету плательщика по ссылке или загрузите подписанную на бумаге Selbstauskunft и документ плательщика",
    });
    expect(payerIdentificationLine({ ...missing, identified: true }, de)?.tone).toBe("success");
    expect(payerIdentificationLine({ ...missing, required: false }, ru)?.tone).toBe("neutral");
    expect(payerIdentificationLine(null, ru)).toBeNull();
    expect(payerReasonLabel("payer_not_identified", de)).toBe(
      "Fragebogen des Zahlers über den Link ausfüllen lassen oder die auf Papier unterschriebene Selbstauskunft und den Ausweis des Zahlers hochladen",
    );
    const fields = payerReadinessReasonFields();
    expect(fields["Third-party payer is not identified"]).toBe(PAYER_PAPER_PATH_ID);
    expect(fields["Payer declaration is missing"]).toBe(PAYER_SECTION_ID);
  });

  it("reads the identification of the payer declaration's status", () => {
    expect(normalizePayerIdentification({ required: true, identified: false, identity_document: true })).toEqual({
      required: true,
      identified: false,
      statement_sent: false,
      self_disclosure_signed: false,
      identity_document: true,
      statement_by_staff: false,
    });
    expect(normalizePayerIdentification({ statement_sent: true, statement_by_staff: true })?.statement_by_staff).toBe(true);
    expect(normalizePayerIdentification(null)).toBeNull();
    const response = normalizePayerDeclarationResponse({
      declaration: null,
      status: { complete: false, missing: [], cost_assumption: {}, identification: { required: true, identified: true } },
    });
    expect(response?.status.identification?.identified).toBe(true);
    const older = normalizePayerDeclarationResponse({ declaration: null, status: { complete: false, missing: [], cost_assumption: {} } });
    expect(older?.status).not.toHaveProperty("identification");
  });

  it("keeps the paper path after a reload when the payer answered on paper (DEV QA 2026-10-30)", () => {
    const none = { required: true, identified: false, statement_sent: false, self_disclosure_signed: false, identity_document: false };
    expect(payerPaperPathDerived(none, 0, false)).toBe(false);
    expect(payerPaperPathDerived(none, 2, false)).toBe(true);
    expect(payerPaperPathDerived({ ...none, self_disclosure_signed: true }, 0, false)).toBe(true);
    expect(payerPaperPathDerived({ ...none, statement_sent: true, statement_by_staff: true }, 0, false)).toBe(true);
    // The payer answered on the link: the link stays the default.
    expect(payerPaperPathDerived({ ...none, statement_sent: true }, 2, false)).toBe(false);
    expect(payerPaperPathDerived(none, 2, true)).toBe(false);
    expect(payerPaperPathDerived(null, 2, false)).toBe(false);
  });

  it("names an organisation's copy by its contact person or as the register extract, and feeds the ID data", () => {
    const fields = { ...EMPTY_PAYER_IDENTITY_FIELDS, type: "id_card" as const, number: " L01X00T47 ", issuingCountry: "de", validUntil: "2031-01-31", holder: "Vera Vertreter" };
    expect(payerIdentityDocumentName("Beispiel GmbH", fields, true)).toBe(
      "Ausweisdokument – vertretungsberechtigte Person Vera Vertreter für Kostenübernehmer Beispiel GmbH",
    );
    expect(payerIdentityDocumentName("Beispiel GmbH", { ...fields, registerExtract: true }, true)).toBe(
      "Handelsregisterauszug – Kostenübernehmer Beispiel GmbH",
    );
    expect(payerIdentityDocumentName("Erika Zahler", fields)).toBe("Ausweisdokument – Kostenübernehmer/in Erika Zahler");
    expect(payerIdentityNotes(fields)).toBe("Inhaber/in Vera Vertreter, Personalausweis Nr. L01X00T47, Ausstellungsstaat DE, gültig bis 31.01.2031");
    expect(payerIdentityAnswersPatch(fields)).toEqual({
      id_document_type: "id_card",
      id_document_number: "L01X00T47",
      id_issuing_country: "DE",
      id_valid_until: "2031-01-31",
    });
    expect(payerIdentityAnswersPatch({ ...fields, registerExtract: true })).toEqual({});
    expect(payerIdentityAnswersPatch(EMPTY_PAYER_IDENTITY_FIELDS)).toEqual({});
  });
});
