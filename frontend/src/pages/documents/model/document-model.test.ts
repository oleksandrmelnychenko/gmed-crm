import { describe, expect, it } from "vitest";

import {
  buildGeneratedDocumentManualTextDraft,
  buildGenerateDocumentPayload,
  buildStandardDocumentName,
  buildStandardDocumentNameFromMetadata,
  buildDocumentsPath,
  detailToEditForm,
  documentTemplateRequiresOrder,
  documentTemplateSupportsAppointmentContext,
  documentTemplateSupportsOrderContext,
  documentPartyUpload,
  documentPartyUploadTypeLabel,
  emptyGenerateForm,
  emptyUploadForm,
  formatBusinessDocumentNumber,
  intakeOpenAction,
  intakeReviewNeedsClassification,
  isMedicalDocumentClassification,
  patientDocumentAddresseeLabel,
  reviewEditForm,
  withDocumentCategory,
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

describe("commercial document context", () => {
  it("hides technical version suffixes from displayed business numbers", () => {
    expect(formatBusinessDocumentNumber("FC-20260714-0010-V18")).toBe(
      "FC-20260714-0010",
    );
    expect(formatBusinessDocumentNumber("KV-20260721-0019-V01")).toBe(
      "KV-20260721-0019",
    );
    expect(formatBusinessDocumentNumber("DOC-1001")).toBe("DOC-1001");
  });

  it("requires an order only for order-bound commercial templates", () => {
    expect(documentTemplateRequiresOrder("single_order")).toBe(true);
    expect(documentTemplateRequiresOrder("order_cost_estimate")).toBe(true);
    expect(documentTemplateRequiresOrder("cost_estimate")).toBe(false);
    expect(documentTemplateRequiresOrder("privacy_consents")).toBe(false);
  });

  it("shows order and appointment context only where the renderer consumes it", () => {
    expect(documentTemplateSupportsOrderContext("framework_contract")).toBe(true);
    expect(documentTemplateSupportsOrderContext("enhanced_due_diligence")).toBe(true);
    expect(documentTemplateSupportsOrderContext("patient_sticker_compact")).toBe(false);
    expect(documentTemplateSupportsAppointmentContext("appointment_confirmation")).toBe(true);
    expect(documentTemplateSupportsAppointmentContext("medication_summary")).toBe(false);
    expect(documentTemplateSupportsAppointmentContext("privacy_consents")).toBe(false);
    expect(documentTemplateSupportsOrderContext("provider_template:demo")).toBe(true);
    expect(documentTemplateSupportsAppointmentContext("provider_template:demo")).toBe(true);
  });
});

describe("buildStandardDocumentName", () => {
  it("names the payer's and a representative's uploads as another person's documents", () => {
    expect(buildStandardDocumentName({ category: "identity", art: "payer_identity", documentDate: "2026-10-06" })).toBe(
      "PERS-Ausweis (Zahler/in) vom 06.10.2026",
    );
    expect(buildStandardDocumentName({ category: "identity", art: "payer_funds_proof", documentDate: "2026-10-06" })).toBe(
      "PERS-Nachweis der Mittelherkunft vom 06.10.2026",
    );
    expect(buildStandardDocumentName({ category: "identity", art: "representative_identity", documentDate: "2026-10-06" })).toBe(
      "PERS-Ausweis (Vertreter/in) vom 06.10.2026",
    );
  });

  it("names the documents of the payer's signature package", () => {
    const name = (art: string, category: string) => buildStandardDocumentName({ category, art, documentDate: "2026-10-06" });
    expect(name("payer_self_disclosure", "compliance_aml")).toContain("Selbstauskunft der zahlenden Person vom 06.10.2026");
    expect(name("patient_payer_statement", "compliance_aml")).toContain("Erklärung zur Kostenübernahme durch Dritte vom 06.10.2026");
    expect(name("payer_cost_estimate", "finance_payer_cost_estimate")).toContain("Kostenvoranschlag für die zahlende Person vom 06.10.2026");
    // The lead's own patient form, signed in the lead's package.
    expect(name("lead_self_disclosure", "compliance_aml")).toContain("Patientenformular – Angaben und Erklärungen vom 06.10.2026");
    // The payer's copy of the cost estimate belongs to an order.
    expect(documentTemplateRequiresOrder("payer_cost_estimate")).toBe(true);
    expect(documentTemplateSupportsOrderContext("payer_cost_estimate")).toBe(true);
  });

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

  it("names a document dated by an instant after its Berlin calendar day", () => {
    // 27 Sep 23:30 in Berlin (28 Sep in Kyiv) and 28 Sep 00:30 in Berlin (27 Sep in UTC).
    expect(
      buildStandardDocumentName({ category: "consent", art: "privacy_information", documentDate: new Date("2026-09-27T21:30:00Z") }),
    ).toBe("ADMIN-Informationsblatt zum Datenschutz vom 27.09.2026");
    expect(
      buildStandardDocumentName({ category: "consent", art: "privacy_information", documentDate: new Date("2026-09-27T22:30:00Z") }),
    ).toBe("ADMIN-Informationsblatt zum Datenschutz vom 28.09.2026");
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

  it("uses every configured medical specialty abbreviation in generated names", () => {
    const specialties = {
      medical_gastro: "GASTRO",
      medical_onko: "ONKO",
      medical_kardio: "KARDIO",
      medical_kardch: "KARDCH",
      medical_derma: "DERMA",
      medical_dermch: "DERMCH",
      medical_radiology: "RAD",
      medical_lab: "LAB",
      medical_patho_histo: "HISTO/PATHO",
      medical_neuro: "NEURO",
      medical_neurch: "NEURCH",
      medical_chir: "CHIR",
      medical_gyn: "GYN",
      medical_gynch: "GYNCH",
      medical_auge: "AUGE",
      medical_augch: "AUGCH",
      medical_hamat: "HÄMAT",
      medical_uro: "URO",
      medical_uroch: "UROCH",
      medical_schlaf: "SCHLAF",
      medical_endo: "ENDO",
      medical_endoch: "ENDOCH",
      medical_vask: "VASK",
      medical_orthol: "ORTHOL",
      medical_unfal: "UNFAL",
      medical_mkg: "MKG",
      medical_dent: "DENT",
      medical_kfo: "KFO",
      medical_plastchir: "PLASTCHIR",
      medical_pad: "PÄD",
      medical_physio_reha: "PHYSIO/REHA",
      medical_hno: "HNO",
      medical_infekt: "INFEKT",
      medical_ana: "ANA",
      medical_nephro: "NEPHRO",
      medical_psych: "PSYCH",
      medical_pneumo_resp: "PNEUMO/RESP",
      medical_prokto: "PROKTO",
      medical_rheum: "RHEUM",
      medical_ger: "GER",
      medical_allmed: "ALLMED",
    } as const;

    for (const [category, code] of Object.entries(specialties)) {
      expect(
        buildStandardDocumentName({
          category,
          art: "Befund",
          isMedical: true,
          documentDate: "2026-08-23",
          source: "Dr. Test, Klinikum Test",
          addressee: "Max Mustermann",
        }),
      ).toBe(
        `${code}-Befund vom 23.08.2026-Dr. Test, Klinikum Test-Max Mustermann`,
      );
    }
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

  it("keeps the structured template renderer active even when legacy form text is dirty", () => {
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
    ).toBeNull();
  });

  it("always sends the operator text for a free text document", () => {
    const payload = buildGenerateDocumentPayload({
      template: template({
        id: "free_text_document",
        art: "free_text_document",
        category: "administrative",
        label: "Freies Dokument",
      }),
      form: generateForm({
        templateId: "free_text_document",
        titleOverride: "Individuelles Dokument",
        manualText: "Individueller Freitext",
        manualTextDirty: false,
      }),
      patients,
      displayedManualText: "Individueller Freitext",
    });

    expect(payload).toMatchObject({
      template_id: "free_text_document",
      title_override: "Individuelles Dokument",
      manual_text: "Individueller Freitext",
    });
  });

  it.each([
    "treatment_plan",
    "medication_summary",
    "framework_contract",
    "visa_invitation_letter",
    "patient_sticker_compact",
    "patient_sticker_standard",
    "patient_sticker_sheet",
    "single_order",
    "order_cost_estimate",
    "cost_coverage_declaration",
    "cost_estimate",
    "appointment_confirmation",
    "confidentiality_release",
    "privacy_consents",
    "privacy_information",
    "enhanced_due_diligence",
    "consent_data_release_child",
    "consent_data_release_single",
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

  it("keeps typed treatment-plan text blocks without enabling free-form replacement", () => {
    const payload = buildGenerateDocumentPayload({
      template: template({
        id: "treatment_plan",
        art: "treatment_plan",
        category: "treatment_plan",
        text_block_keys: ["fasting"],
      }),
      form: generateForm({
        templateId: "treatment_plan",
        textBlockKeys: ["fasting"],
        manualText: "Arbitrary replacement",
        manualTextDirty: true,
      }),
      patients,
      displayedManualText: "Arbitrary replacement",
    });

    expect(payload).toMatchObject({
      manual_text: null,
      text_block_keys: ["fasting"],
    });
  });

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
  it("starts a free text document with the operator text only", () => {
    const draft = buildGeneratedDocumentManualTextDraft({
      template: template({
        id: "free_text_document",
        art: "free_text_document",
        label: "Freies Dokument",
      }),
      form: generateForm({
        templateId: "free_text_document",
        manualText: "Eigener Inhalt",
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

    expect(draft).toBe("Eigener Inhalt");
  });

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

    expect(
      detailToEditForm({
        ...detail,
        ursprung: "manual_intake",
        source_person: "manual_intake",
      }),
    ).toMatchObject({
      ursprung: "manual_intake",
      sourcePerson: "",
    });
  });
});

describe("document intake review", () => {
  const categories = [
    { key: "administrative", is_medical: false },
    { key: "medical_arztbrief", is_medical: true },
  ];

  it("marks a document medical when a medical category is chosen", () => {
    const form = { ...emptyUploadForm(), isMedical: false, accessCategory: "internal" as const };
    expect(withDocumentCategory(form, "medical_arztbrief", categories)).toMatchObject({
      category: "medical_arztbrief",
      isMedical: true,
      accessCategory: "medical",
    });
    expect(withDocumentCategory(form, "administrative", categories)).toMatchObject({
      category: "administrative",
      isMedical: false,
      accessCategory: "internal",
    });
  });

  it("recognises a medical category or document type like the server", () => {
    expect(isMedicalDocumentClassification("medical_arztbrief", "", categories)).toBe(true);
    expect(isMedicalDocumentClassification(" Medical_Arztbrief ", null, categories)).toBe(true);
    expect(isMedicalDocumentClassification("administrative", "medical_arztbrief", categories)).toBe(
      true,
    );
    expect(isMedicalDocumentClassification("administrative", "invoice", categories)).toBe(false);
    expect(isMedicalDocumentClassification("", "", categories)).toBe(false);
  });

  it("sets the medical access category when a medical category is chosen", () => {
    const flaggedOnly = { ...emptyUploadForm(), isMedical: true, accessCategory: "internal" as const };
    expect(withDocumentCategory(flaggedOnly, "medical_arztbrief", categories)).toMatchObject({
      isMedical: true,
      accessCategory: "medical",
    });
  });

  it("never clears the medical flag by picking another category", () => {
    const medical = { ...emptyUploadForm(), isMedical: true, accessCategory: "medical" as const };
    expect(withDocumentCategory(medical, "administrative", categories)).toMatchObject({
      category: "administrative",
      isMedical: true,
      accessCategory: "medical",
    });
  });

  it("asks for a specific document type and a category like the server", () => {
    expect(intakeReviewNeedsClassification("uploaded_document", "medical_arztbrief")).toBe(true);
    expect(intakeReviewNeedsClassification("medical_report", "")).toBe(true);
    expect(intakeReviewNeedsClassification("medical_report", "portal_upload")).toBe(true);
    expect(intakeReviewNeedsClassification("medical_report", "medical_arztbrief")).toBe(false);
    // Every portal upload kind is a placeholder until staff pick a real type.
    expect(intakeReviewNeedsClassification("patient_analysis_upload", "lab_analysis")).toBe(true);
    expect(intakeReviewNeedsClassification("patient_upload", "portal_upload")).toBe(true);
    expect(intakeReviewNeedsClassification("lab_report", "lab_analysis")).toBe(false);
  });

  it("reopens the same intake document without dropping its loaded detail", () => {
    expect(intakeOpenAction("", null, "doc-1")).toBe("select");
    expect(intakeOpenAction("doc-2", "doc-2", "doc-1")).toBe("select");
    // Closed and reopened: restart the review from the loaded document.
    expect(intakeOpenAction("doc-1", "doc-1", "doc-1")).toBe("reset-form");
    // Reopened before it loaded (or after a failed load): load it again.
    expect(intakeOpenAction("doc-1", null, "doc-1")).toBe("reload");
  });

  it("starts the review of a manual intake upload as active", () => {
    const upload = {
      id: "d1",
      auto_name: "scan.pdf",
      art: "uploaded_document",
      category: null,
      status: "draft",
      visibility: "internal",
      is_medical: false,
      ursprung: "manual_intake",
    } as unknown as DocumentItem;
    expect(reviewEditForm(upload).status).toBe("active");
    expect(reviewEditForm({ ...upload, ursprung: "upload" }).status).toBe("draft");
  });
});

describe("uploads of a payer or a legal representative", () => {
  it("names whose upload it is and its type from the art", () => {
    expect(documentPartyUpload({ art: "payer_identity", source_person: "payer" })).toBe("payer");
    expect(documentPartyUpload({ art: "payer_funds_proof", source_person: null })).toBe("payer");
    // The source alone also says so (an art the list does not know yet).
    expect(documentPartyUpload({ art: "identity", source_person: "payer" })).toBe("payer");
    expect(documentPartyUpload({ art: "representative_identity", source_person: "patient_portal" })).toBe("representative");
    expect(documentPartyUpload({ art: "representative_authority", source_person: "patient_portal" })).toBe("representative");
    // The patient's own identity document.
    expect(documentPartyUpload({ art: "identity", source_person: "patient_portal" })).toBeNull();
    expect(documentPartyUpload({})).toBeNull();

    expect(documentPartyUploadTypeLabel("payer_identity")).toBe("Ausweis (Zahler/in)");
    expect(documentPartyUploadTypeLabel("payer_funds_proof")).toBe("Nachweis der Mittelherkunft");
    expect(documentPartyUploadTypeLabel("representative_identity")).toBe("Ausweis (Vertreter/in)");
    expect(documentPartyUploadTypeLabel("representative_authority")).toBe("Vertretungsnachweis");
    expect(documentPartyUploadTypeLabel("identity")).toBeNull();
    expect(documentPartyUploadTypeLabel("cost_estimate")).toBeNull();
    expect(documentPartyUploadTypeLabel(null)).toBeNull();
  });
});
