import { describe, expect, it } from "vitest";

import {
  buildStandardDocumentName,
  buildStandardDocumentNameFromMetadata,
  buildDocumentsPath,
  detailToEditForm,
  emptyGenerateForm,
  emptyUploadForm,
  patientDocumentAddresseeLabel,
} from "./document-model";
import type { DocumentItem, PatientOption } from "./types";

describe("buildStandardDocumentName", () => {
  it("builds the requested medical specialty document naming pattern", () => {
    expect(
      buildStandardDocumentName({
        category: "medical",
        art: "Arztbrief Kardiologie",
        isMedical: true,
        documentDate: "2011-11-11",
        source: "Dr. med. A. Smith, LMU Klinikum",
        addressee: "A. Müller",
      }),
    ).toBe("KARDIO-Arztbrief Kardiologie vom 11.11.2011-Dr. med. A. Smith, LMU Klinikum-A. Müller");
  });

  it("maps generated administrative template names into stable filename parts", () => {
    expect(
      buildStandardDocumentName({
        category: "clinic_correspondence",
        art: "appointment_confirmation",
        documentDate: "2026-06-04",
        source: "GMED",
        addressee: "A. Müller",
      }),
    ).toBe("ADMIN-Terminbestätigung vom 04.06.2026-GMED-A. Müller");
  });

  it("keeps finance documents in the finance prefix even with German labels", () => {
    expect(
      buildStandardDocumentName({
        category: "finance",
        art: "Kostenübernahmeerklärung",
        documentDate: "11.11.25",
        addressee: "M. Mustermann",
      }),
    ).toBe("FIN-Kostenübernahmeerklärung vom 11.11.2025-M. Mustermann");
  });

  it("maps the expanded document category tree into the expected filename prefixes", () => {
    expect(
      buildStandardDocumentName({
        category: "finance_cost_coverage",
        art: "Kostenübernahmeerklärung",
        documentDate: "2026-06-04",
      }),
    ).toBe("FIN-Kostenübernahmeerklärung vom 04.06.2026");

    expect(
      buildStandardDocumentName({
        category: "visa_invitation_letter",
        art: "Einladungsschreiben",
        documentDate: "2026-06-04",
      }),
    ).toBe("AMT-Einladungsschreiben vom 04.06.2026");

    expect(
      buildStandardDocumentName({
        category: "personal_passport",
        art: "Reisepass",
        documentDate: "2026-06-04",
      }),
    ).toBe("PERS-Reisepass vom 04.06.2026");

    expect(
      buildStandardDocumentName({
        category: "medical_radiology",
        art: "MRT Befund",
        documentDate: "2026-06-04",
        isMedical: true,
      }),
    ).toBe("RAD-MRT Befund vom 04.06.2026");

    expect(
      buildStandardDocumentName({
        category: "medication_summary",
        art: "Medikationsplan",
        documentDate: "2026-06-04",
      }),
    ).toBe("MED-Medikationsplan vom 04.06.2026");
  });

  it("uses a stable fallback code for other documents", () => {
    expect(
      buildStandardDocumentName({
        category: "other",
        art: "Freitext",
        source: "Extern",
      }),
    ).toBe("SONST-Freitext-Extern");
  });
});

describe("buildStandardDocumentNameFromMetadata", () => {
  it("uses operational metadata before legacy provider/source fields", () => {
    expect(
      buildStandardDocumentNameFromMetadata({
        category: "finance",
        art: "Rechnung",
        documentDate: "2026-06-30",
        sourcePerson: "Frau Schmidt",
        sourceInstitution: "Klinikum Rechts der Isar",
        legacySource: "Alte Quelle",
        legacySourceInstitution: "Legacy Klinik",
        addresseePerson: "Anna Müller",
        addresseeInstitution: "GMED",
        patientAddressee: "P-20260630",
      }),
    ).toBe(
      "FIN-Rechnung vom 30.06.2026-Frau Schmidt, Klinikum Rechts der Isar-Anna Müller, GMED",
    );
  });

  it("falls back to legacy source and patient addressee when metadata is empty", () => {
    expect(
      buildStandardDocumentNameFromMetadata({
        category: "administrative",
        art: "Terminbestätigung",
        fallbackDocumentDate: "2026-06-30",
        legacySource: "GMED",
        legacySourceInstitution: "GMED Agentur",
        patientAddressee: "Anna Müller",
      }),
    ).toBe("ADMIN-Terminbestätigung vom 30.06.2026-GMED, GMED Agentur-Anna Müller");
  });
});

describe("patientDocumentAddresseeLabel", () => {
  it("uses the patient name as addressee and falls back to PID", () => {
    const patients: PatientOption[] = [
      { id: "p1", patient_id: "GM-001", first_name: "Anna", last_name: "Müller" },
      { id: "p2", patient_id: "GM-002" },
    ];

    expect(patientDocumentAddresseeLabel("p1", patients)).toBe("Anna Müller");
    expect(patientDocumentAddresseeLabel("p2", patients)).toBe("GM-002");
    expect(patientDocumentAddresseeLabel("missing", patients)).toBe("");
  });
});

describe("buildDocumentsPath", () => {
  it("keeps operational metadata filters in the documents query string", () => {
    const path = buildDocumentsPath({
      search: "",
      patientId: "",
      orderId: "",
      appointmentId: "",
      status: "",
      visibility: "",
      art: "",
      category: "",
      dateFrom: "",
      dateTo: "",
      klinik: "",
      ursprung: "",
      documentDirection: "incoming",
      documentVariant: "translation",
      accessCategory: "financial",
      financialStatus: "open",
    });

    expect(path).toBe(
      "/documents?document_direction=incoming&document_variant=translation&access_category=financial&financial_status=open",
    );
  });
});

describe("document operational metadata forms", () => {
  it("defaults upload and generation to the expected document flow metadata", () => {
    expect(emptyUploadForm()).toMatchObject({
      documentDirection: "incoming",
      documentVariant: "original",
      accessCategory: "internal",
      addresseeInstitution: "GMED",
    });
    expect(emptyGenerateForm()).toMatchObject({
      documentDirection: "outgoing",
      documentVariant: "original",
      documentLanguage: "de",
      accessCategory: "patient",
      sourceInstitution: "GMED",
    });
  });

  it("maps stored document metadata into the edit form", () => {
    const detail = {
      id: "d1",
      patient_id: "p1",
      has_active_patient_portal_user: true,
      order_id: null,
      appointment_id: null,
      patient_pid: "GM-001",
      patient_name: "Anna Mueller",
      order_number: null,
      appointment_title: null,
      auto_name: "FIN-Rechnung",
      original_filename: null,
      art: "invoice",
      category: "finance",
      status: "active",
      visibility: "internal",
      is_medical: false,
      mime_type: "application/pdf",
      file_size: 123,
      has_stored_file: true,
      klinik: "Clinic",
      ursprung: "Billing",
      document_direction: "incoming",
      document_variant: "original",
      document_language: "de",
      access_category: "financial",
      document_date: "2026-06-19",
      source_person: "Frau Schmidt",
      source_institution: "Clinic",
      addressee_person: "Anna Mueller",
      addressee_institution: "GMED",
      financial_status: "open",
      payment_due_date: "2026-06-30",
      payment_date: null,
      payment_method: "bank_transfer",
      generated_template_id: null,
      notes: null,
      uploaded_by_name: "System Admin",
      version_root_document_id: "d1",
      replaces_document_id: null,
      superseded_by_document_id: null,
      version_number: 1,
      version_count: 1,
      is_latest_version: true,
      file_deleted_at: null,
      file_deleted_by: null,
      file_deleted_by_name: null,
      file_delete_reason: null,
      created_at: "2026-06-19T10:00:00Z",
      updated_at: "2026-06-19T10:00:00Z",
      share_count: 0,
      shared_to_current: false,
      data_sensitivity: "Financial",
      needs_categorization: false,
      classification_suggestion: null,
    } satisfies DocumentItem;

    expect(detailToEditForm(detail)).toMatchObject({
      documentDirection: "incoming",
      documentVariant: "original",
      documentLanguage: "de",
      accessCategory: "financial",
      documentDate: "2026-06-19",
      sourcePerson: "Frau Schmidt",
      addresseeInstitution: "GMED",
      financialStatus: "open",
      paymentDueDate: "2026-06-30",
      paymentMethod: "bank_transfer",
    });
  });
});
