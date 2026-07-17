import { describe, expect, it } from "vitest";

import {
  buildGeneratedDocumentManualTextDraft,
  buildGenerateDocumentPayload,
  buildStandardDocumentName,
  buildStandardDocumentNameFromMetadata,
  buildDocumentsPath,
  detailToEditForm,
  emptyGenerateForm,
  emptyUploadForm,
  patientDocumentAddresseeLabel,
} from "./document-model";
import type { DocumentItem, DocumentTemplate, GenerateFormState, PatientOption } from "./types";

function template(overrides: Partial<DocumentTemplate> = {}): DocumentTemplate {
  return {
    art: "appointment_confirmation",
    category: "clinic_correspondence",
    default_auto_name: "appointment_confirmation",
    default_status: "active",
    default_visibility: "patient_visible",
    description: "Appointment confirmation",
    id: "appointment_confirmation",
    is_medical: false,
    label: "Terminbestätigung",
    supported_languages: ["de"],
    text_block_keys: [],
    ...overrides,
  };
}

function generateForm(overrides: Partial<GenerateFormState> = {}): GenerateFormState {
  return {
    ...emptyGenerateForm("p1"),
    templateId: "appointment_confirmation",
    autoName: "appointment_confirmation",
    status: "active",
    visibility: "patient_visible",
    language: "de",
    documentLanguage: "de",
    documentDate: "2026-06-25",
    sourceInstitution: "GMED",
    addresseePerson: "Anna Müller",
    ...overrides,
  };
}

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
        category: "administrative_appointment_confirmation",
        art: "appointment_confirmation",
        documentDate: "2026-06-04",
        source: "GMED",
        addressee: "A. Müller",
      }),
    ).toBe("ADMIN-Terminbestätigung vom 04.06.2026-GMED-A. Müller");

    expect(
      buildStandardDocumentName({
        category: "administrative_single_order",
        art: "single_order",
        documentDate: "2026-06-04",
      }),
    ).toBe("VERTRAG-Einzelauftrag vom 04.06.2026");

    expect(
      buildStandardDocumentName({
        category: "consent",
        art: "privacy_information",
        documentDate: "2026-06-04",
      }),
    ).toBe("ADMIN-Informationsblatt zum Datenschutz vom 04.06.2026");
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

describe("buildGenerateDocumentPayload", () => {
  const patients: PatientOption[] = [
    { id: "p1", patient_id: "GM-001", first_name: "Anna", last_name: "Müller" },
  ];

  it("builds the compliant generated document payload for patient shortcuts", () => {
    const payload = buildGenerateDocumentPayload({
      template: template(),
      form: generateForm({
        bindings: {
          passport_number: " MA1234567 ",
          passport_valid_until: "2050-01-01",
        },
      }),
      patients,
    });

    expect(payload).toMatchObject({
      template_id: "appointment_confirmation",
      patient_id: "p1",
      auto_name: "ADMIN-Terminbestätigung vom 25.06.2026-GMED-Anna Müller",
      status: "active",
      visibility: "patient_visible",
      language: "de",
      document_direction: "outgoing",
      document_variant: "original",
      document_language: "de",
      access_category: "patient",
      document_date: "2026-06-25",
      source_institution: "GMED",
      addressee_person: "Anna Müller",
      manual_text: null,
      text_block_keys: [],
      bindings: {
        passport_number: "MA1234567",
        passport_valid_until: "2050-01-01",
      },
    });
  });

  it("keeps the structured template renderer active until the operator edits the text", () => {
    expect(
      buildGenerateDocumentPayload({
        template: template(),
        form: generateForm({ manualText: "Edited text", manualTextDirty: false }),
        patients,
        displayedManualText: "Generated preview text",
      }).manual_text,
    ).toBeNull();

    expect(
      buildGenerateDocumentPayload({
        template: template(),
        form: generateForm({ manualText: "Form fallback text", manualTextDirty: true }),
        patients,
        displayedManualText: "Form fallback text",
      }).manual_text,
    ).toBe("Form fallback text");
  });

  it.each([
    "framework_contract",
    "single_order",
    "cost_estimate",
    "confidentiality_release",
    "privacy_consents",
    "privacy_information",
  ])(
    "never sends free-form overrides for the designed agency template %s",
    (templateId) => {
      const payload = buildGenerateDocumentPayload({
        template: template({
          id: templateId,
          art: templateId,
          category: "consent",
        }),
        form: generateForm({
          templateId,
          titleOverride: "Changed title",
          introduction: "Changed introduction",
          closingNote: "Changed closing note",
          manualText: "Arbitrary replacement",
          manualTextDirty: true,
        }),
        patients,
        displayedManualText: "Arbitrary replacement",
      });

      expect(payload).toMatchObject({
        title_override: null,
        introduction: null,
        closing_note: null,
        manual_text: null,
        text_block_keys: [],
      });
    },
  );

  it("resolves generated finance templates to financial access", () => {
    const payload = buildGenerateDocumentPayload({
      template: template({
        id: "cost_coverage_declaration",
        art: "cost_coverage_declaration",
        category: "finance_cost_coverage",
        default_auto_name: "Kostenübernahmeerklärung",
        default_visibility: "internal",
      }),
      form: generateForm({
        accessCategory: "patient",
        autoName: "Kostenübernahmeerklärung",
      }),
      patients,
      displayedManualText: "Kostenübernahme text",
    });

    expect(payload.access_category).toBe("financial");
    expect(payload.auto_name).toBe(
      "FIN-Kostenübernahmeerklärung vom 25.06.2026-GMED-Anna Müller",
    );
  });

  it("keeps an explicitly edited filename instead of regenerating auto_name", () => {
    expect(
      buildGenerateDocumentPayload({
        template: template(),
        form: generateForm({ autoName: "Custom patient letter" }),
        patients,
      }).auto_name,
    ).toBe("Custom patient letter");
  });
});

describe("buildGeneratedDocumentManualTextDraft", () => {
  it("exposes the generated document text before submit", () => {
    const draft = buildGeneratedDocumentManualTextDraft({
      template: template({
        id: "generic_patient_letter",
        art: "Patientenbrief",
        label: "Patientenbrief",
      }),
      form: generateForm({
        templateId: "generic_patient_letter",
        titleOverride: "Vorbereitung",
        introduction: "Bitte nüchtern erscheinen.",
        bindings: { unknown: "ignored" },
      }),
      patientLabel: "GM-001 · Anna Müller",
      lang: "de",
      labels: {
        appointmentsTitle: "Termin",
        documentDate: "Dokumentdatum",
        sourceInstitution: "Quelle",
        addresseePerson: "Adressat",
        ordersPatient: "Patient",
        ordersTitle: "Auftrag",
        sectionBindings: "Vorlagenfelder",
        textBlocks: "Textbausteine",
      },
    });

    expect(draft).toContain("Vorbereitung");
    expect(draft).toContain("Dokumentdatum: 2026-06-25");
    expect(draft).toContain("Patient: GM-001 · Anna Müller");
    expect(draft).toContain("Quelle: GMED");
    expect(draft).toContain("Adressat: Anna Müller");
    expect(draft).toContain("Bitte nüchtern erscheinen.");
  });

  it("uses the patient addressee instead of the UI patient label inside known drafts", () => {
    const draft = buildGeneratedDocumentManualTextDraft({
      template: template(),
      form: generateForm(),
      patientLabel: "GM-001 · Anna Müller",
      patientAddressee: "Anna Müller",
      lang: "de",
      labels: {
        appointmentsTitle: "Termin",
        documentDate: "Dokumentdatum",
        sourceInstitution: "Quelle",
        addresseePerson: "Adressat",
        ordersPatient: "Patient",
        ordersTitle: "Auftrag",
        sectionBindings: "Vorlagenfelder",
        textBlocks: "Textbausteine",
      },
    });

    expect(draft).toContain("Für: Anna Müller");
    expect(draft).toContain("Terminbestätigung für Anna Müller");
    expect(draft).not.toContain("GM-001 · Anna Müller");
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
