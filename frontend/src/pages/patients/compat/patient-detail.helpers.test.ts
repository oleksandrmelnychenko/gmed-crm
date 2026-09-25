import { describe, expect, it } from "vitest";

import { t as translateCatalog } from "@/lib/i18n";

import {
  buildPatientLabelPrintHtml,
  buildPatientTimelineSummary,
  canManagePatientProfile,
  canOpenPatientDocumentsWorkspace,
  canViewPatientAppointmentsSurface,
  canViewPatientCareHistorySurface,
  canViewPatientContractsSurface,
  canViewPatientClinicalProfile,
  canViewPatientDocumentsSurface,
  canViewPatientInvoicesSurface,
  canViewPatientOperationalSurface,
  normalizePatientDetailTab,
  filterPatientTimelineItems,
  formatRelatedPatientName,
  formatRelatedPatientOption,
  resolvePatientTimelineRoute,
} from "./patient-detail.helpers";
import {
  canLoadPatientAssignableStaff,
  canViewPatientAssignmentsSurface,
} from "../model/detail-model";

describe("canManagePatientProfile", () => {
  it.each([
    ["ceo", true],
    ["patient_manager", true],
    ["it_admin", false],
    ["billing", false],
    [undefined, false],
  ])("matches the backend patient update and compliance policy for %s", (role, expected) => {
    expect(canManagePatientProfile(role)).toBe(expected);
  });
});

describe("filterPatientTimelineItems", () => {
  const items = [
    {
      entity_type: "appointment",
      entity_id: "apt-1",
      title: "Follow-up visit",
      category: "medical",
      status: "planned",
      happened_at: "2026-04-02T10:00:00Z",
      source_label: "Klinik Mitte",
    },
    {
      entity_type: "invoice",
      entity_id: "inv-1",
      title: "Invoice sent",
      category: "billing",
      status: "paid",
      happened_at: "2026-03-01T12:00:00Z",
      source_label: "Billing",
    },
  ];

  it("filters by entity type, category, source, range and free-text search", () => {
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "appointment",
        categoryFilter: "all",
        sourceFilter: "",
        search: "",
        rangeFilter: "all",
      })
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "all",
        categoryFilter: "billing",
        sourceFilter: "",
        search: "",
        rangeFilter: "all",
      })
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "all",
        categoryFilter: "all",
        sourceFilter: "Klinik Mitte",
        search: "",
        rangeFilter: "all",
      })
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "all",
        categoryFilter: "all",
        sourceFilter: "",
        search: "billing",
        rangeFilter: "all",
      })
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "all",
        categoryFilter: "all",
        sourceFilter: "",
        search: "",
        rangeFilter: "30d",
        now: new Date("2026-04-10T00:00:00Z"),
      })
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(items, {
        entityFilter: "invoice",
        categoryFilter: "all",
        sourceFilter: "",
        search: "follow-up",
        rangeFilter: "all",
      })
    ).toHaveLength(0);
  });

  it("filters new clinical timeline entities for interpreter and drug verification", () => {
    const clinicalItems = [
      {
        entity_type: "interpreter_preference",
        entity_id: "int-1",
        title: "Interpreter preference: Iryna -> preferred",
        category: "interpreter_preference",
        status: "preferred",
        happened_at: "2026-04-05T10:00:00Z",
        source_label: "Patient manager",
      },
      {
        entity_type: "drug_verification",
        entity_id: "match-1",
        title: "Drug match verified: Sortis",
        category: "drug_verification",
        status: "verified",
        happened_at: "2026-04-06T10:00:00Z",
        source_label: "Sortis",
      },
    ];

    expect(
      filterPatientTimelineItems(clinicalItems, {
        entityFilter: "drug_verification",
        categoryFilter: "all",
        sourceFilter: "",
        search: "",
        rangeFilter: "all",
      }),
    ).toHaveLength(1);
    expect(
      filterPatientTimelineItems(clinicalItems, {
        entityFilter: "all",
        categoryFilter: "interpreter_preference",
        sourceFilter: "",
        search: "preferred",
        rangeFilter: "all",
      }),
    ).toHaveLength(1);
  });
});

describe("buildPatientTimelineSummary", () => {
  it("counts total, open, recent and entity distribution", () => {
    const summary = buildPatientTimelineSummary(
      [
        {
          entity_type: "appointment",
          entity_id: "apt-1",
          title: "Follow-up visit",
          category: "medical",
          status: "planned",
          happened_at: "2026-04-02T10:00:00Z",
          source_label: null,
        },
        {
          entity_type: "appointment",
          entity_id: "apt-2",
          title: "Completed visit",
          category: "medical",
          status: "completed",
          happened_at: "2026-02-01T10:00:00Z",
          source_label: null,
        },
        {
          entity_type: "invoice",
          entity_id: "inv-1",
          title: "Invoice sent",
          category: "billing",
          status: "overdue",
          happened_at: "2026-03-20T10:00:00Z",
          source_label: null,
        },
      ],
      new Date("2026-04-10T00:00:00Z")
    );

    expect(summary.total).toBe(3);
    expect(summary.open).toBe(2);
    expect(summary.recent).toBe(2);
    expect(summary.entityCounts).toEqual([
      { entityType: "appointment", count: 2 },
      { entityType: "invoice", count: 1 },
    ]);
  });

  it("does not treat historical facts or future appointments as open recent work", () => {
    const summary = buildPatientTimelineSummary(
      [
        {
          entity_type: "document",
          entity_id: "doc-1",
          title: "Signed consent",
          category: "consent",
          status: "active",
          happened_at: "2026-04-05T10:00:00Z",
          source_label: null,
        },
        {
          entity_type: "risk_score",
          entity_id: "risk-1",
          title: "NEWS2 1",
          category: "NEWS2",
          status: "recorded",
          happened_at: "2026-04-06T10:00:00Z",
          source_label: null,
        },
        {
          entity_type: "appointment",
          entity_id: "apt-future",
          title: "Future consultation",
          category: "medical",
          status: "planned",
          happened_at: "2026-05-01T10:00:00Z",
          source_label: null,
        },
      ],
      new Date("2026-04-10T00:00:00Z"),
    );

    expect(summary.open).toBe(1);
    expect(summary.recent).toBe(2);
  });
});

describe("formatRelatedPatientOption", () => {
  it("builds a stable linked-patient label", () => {
    expect(
      formatRelatedPatientOption({
        patient_id: "P-20260410-0001",
        title: "Dr.",
        first_name: "Anna",
        last_name: "Schmidt",
      })
    ).toBe("P-20260410-0001 · Dr. Anna Schmidt");
  });
});

describe("formatRelatedPatientName", () => {
  it("returns a patient-facing name without duplicating the PID", () => {
    expect(
      formatRelatedPatientName({
        patient_id: "P-20260410-0001",
        first_name: "Anna",
        last_name: "Schmidt",
      })
    ).toBe("Anna Schmidt");
  });
});

describe("buildPatientLabelPrintHtml", () => {
  it("renders a print-ready patient label with the requested format metadata", () => {
    const tr = translateCatalog("ru");
    const html = buildPatientLabelPrintHtml({
      patient_id: "P-20260410-0001",
      title: "Dr.",
      salutation: "Herr",
      first_name: "Max",
      last_name: "Mustermann",
      birth_date: "1990-04-10",
      country_code: "DE",
      insurance_provider: "AXA",
      agency: {
        name: "GMED",
        care_of: "c/o GMED",
        address: "Main Street 1, Berlin",
        phone: "+49 30 000000",
        email: "ops@gmed.de",
      },
      format: {
        id: "sheet-70x37",
        label: "Sheet 70 x 37 mm",
        width_mm: 70,
        height_mm: 37,
      },
      generated_at: "2026-04-10T12:00:00Z",
    });

    expect(html).toContain("@page");
    expect(html).toContain("70mm 37mm");
    expect(html).toContain("Herr Dr. Max Mustermann");
    expect(html).toContain("P-20260410-0001");
    expect(html).toContain(`${tr.patient_label_print_insurance} AXA`);
    expect(html).toContain("c/o GMED");
  });
});

describe("patient surface access helpers", () => {
  it("gives Concierge the service-side patient card without clinical or financial surfaces", () => {
    expect(canViewPatientOperationalSurface("concierge")).toBe(true);
    expect(canViewPatientAssignmentsSurface("concierge")).toBe(true);
    // The server serves /patients/{id}/appointments to the concierge but
    // refuses /orders and /timeline, so only the appointments tab shows.
    expect(canViewPatientAppointmentsSurface("concierge")).toBe(true);
    expect(canViewPatientCareHistorySurface("concierge")).toBe(false);
    expect(canViewPatientDocumentsSurface("concierge")).toBe(true);
    expect(canOpenPatientDocumentsWorkspace("concierge")).toBe(true);
    expect(canViewPatientClinicalProfile("concierge")).toBe(false);
    expect(canViewPatientContractsSurface("concierge")).toBe(false);
    expect(canViewPatientInvoicesSurface("concierge")).toBe(false);
  });

  it("shows the ceo assistant only the surfaces the server serves to the role (read-only)", () => {
    // Refused by the server role lists: documents, relations, workflow,
    // assignments (curators), orders, appointments and the timeline.
    expect(canViewPatientOperationalSurface("ceo_assistant")).toBe(false);
    expect(canViewPatientAssignmentsSurface("ceo_assistant")).toBe(false);
    expect(canViewPatientCareHistorySurface("ceo_assistant")).toBe(false);
    expect(canViewPatientAppointmentsSurface("ceo_assistant")).toBe(false);
    expect(canViewPatientDocumentsSurface("ceo_assistant")).toBe(false);
    expect(canOpenPatientDocumentsWorkspace("ceo_assistant")).toBe(false);
    expect(canLoadPatientAssignableStaff("ceo_assistant")).toBe(false);
    // Served: profile, clinical profile, contracts, invoices and finance.
    expect(canViewPatientClinicalProfile("ceo_assistant")).toBe(true);
    expect(canViewPatientContractsSurface("ceo_assistant")).toBe(true);
    expect(canViewPatientInvoicesSurface("ceo_assistant")).toBe(true);
    expect(canManagePatientProfile("ceo_assistant")).toBe(false);
    const access = {
      canViewOperationalSurface: false,
      canViewCareHistory: false,
      canViewAssignments: false,
      canViewDocuments: false,
      canViewContracts: true,
      canViewInvoices: true,
      canViewClinical: true,
    };
    for (const tab of ["documents", "relations", "appointments", "orders", "timeline", "curators", "workflow"]) {
      expect(normalizePatientDetailTab(tab, access)).toBe("profile");
    }
    expect(normalizePatientDetailTab("contracts", access)).toBe("contracts");
    expect(normalizePatientDetailTab("clinical", access)).toBe("clinical");
  });

  it("hides the curators tab from Billing (no access to patient assignments)", () => {
    expect(canViewPatientAssignmentsSurface("billing")).toBe(false);
    expect(
      normalizePatientDetailTab("curators", {
        canViewOperationalSurface: true,
        canViewAssignments: false,
        canViewDocuments: true,
        canViewContracts: true,
        canViewInvoices: true,
      }),
    ).toBe("profile");
    expect(
      normalizePatientDetailTab("relations", {
        canViewOperationalSurface: true,
        canViewAssignments: false,
        canViewDocuments: true,
        canViewContracts: true,
        canViewInvoices: true,
      }),
    ).toBe("relations");
  });

  it("keeps IT admin out of every patient surface", () => {
    expect(canViewPatientOperationalSurface("it_admin")).toBe(false);
    expect(canViewPatientDocumentsSurface("it_admin")).toBe(false);
    expect(canOpenPatientDocumentsWorkspace("it_admin")).toBe(false);
    expect(canViewPatientClinicalProfile("it_admin")).toBe(false);
    expect(canViewPatientContractsSurface("it_admin")).toBe(false);
    expect(canViewPatientInvoicesSurface("it_admin")).toBe(false);
  });

  it("gives Billing the financial surfaces without the clinical profile", () => {
    expect(canViewPatientOperationalSurface("billing")).toBe(true);
    expect(canViewPatientClinicalProfile("billing")).toBe(false);
    expect(canViewPatientContractsSurface("billing")).toBe(true);
    expect(canViewPatientInvoicesSurface("billing")).toBe(true);
    expect(canManagePatientProfile("billing")).toBe(false);
  });

  it("keeps sales outside patient-bound commercial and document surfaces", () => {
    expect(canViewPatientOperationalSurface("sales")).toBe(false);
    expect(canViewPatientDocumentsSurface("sales")).toBe(false);
    expect(canOpenPatientDocumentsWorkspace("sales")).toBe(false);
    expect(canViewPatientContractsSurface("sales")).toBe(false);
    expect(canViewPatientInvoicesSurface("sales")).toBe(false);
  });
});

describe("resolvePatientTimelineRoute", () => {
  it("blocks finance and document links when the viewer lacks those surfaces", () => {
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "document", entity_id: "doc-1" },
        {
          canOpenDocumentsWorkspace: false,
          canViewContracts: false,
          canViewInvoices: false,
          canOpenComplianceWorkspace: false,
        }
      )
    ).toBeNull();
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "contract", entity_id: "ctr-1" },
        {
          canOpenDocumentsWorkspace: true,
          canViewContracts: false,
          canViewInvoices: false,
          canOpenComplianceWorkspace: false,
        }
      )
    ).toBeNull();
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "invoice", entity_id: "inv-1" },
        {
          canOpenDocumentsWorkspace: true,
          canViewContracts: true,
          canViewInvoices: false,
          canOpenComplianceWorkspace: false,
        }
      )
    ).toBeNull();
  });

  it("returns the matching route when the viewer has the required scope", () => {
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "document", entity_id: "doc-1" },
        {
          canOpenDocumentsWorkspace: true,
          canViewContracts: true,
          canViewInvoices: true,
          canOpenComplianceWorkspace: true,
        }
      )
    ).toBe("/documents?document=doc-1");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "compliance", entity_id: "cmp-1" },
        {
          canOpenDocumentsWorkspace: true,
          canViewContracts: true,
          canViewInvoices: true,
          canOpenComplianceWorkspace: true,
        }
      )
    ).toBe("/admin/compliance");
  });

  it("routes legacy case timeline entries into the patient clinical profile", () => {
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "case", entity_id: "case-1" },
        {
          patientId: "patient-1",
          canOpenDocumentsWorkspace: true,
          canViewContracts: true,
          canViewInvoices: true,
          canOpenComplianceWorkspace: true,
        }
      )
    ).toBe("/patients/patient-1?tab=clinical");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "order", entity_id: "order-1" },
        {
          patientId: "patient-1",
          canOpenDocumentsWorkspace: true,
          canViewContracts: true,
          canViewInvoices: true,
          canOpenComplianceWorkspace: true,
        }
      )
    ).toBe("/orders/order-1?patient=patient-1");
  });

  it("routes new patient-bound timeline entities back to the patient workspace", () => {
    const access = {
      patientId: "patient-1",
      canOpenDocumentsWorkspace: true,
      canViewContracts: true,
      canViewInvoices: true,
      canOpenComplianceWorkspace: true,
    };

    expect(
      resolvePatientTimelineRoute(
        { entity_type: "service_package", entity_id: "package-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=invoices");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "service_package_change", entity_id: "package-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=invoices");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "invoice_visibility", entity_id: "invoice-1" },
        access,
      ),
    ).toBe("/invoices?invoice=invoice-1");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "interpreter_preference", entity_id: "interpreter-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=appointments");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "drug_verification", entity_id: "match-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=timeline&entity_type=drug_verification");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "translation_request", entity_id: "request-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=documents");
    expect(
      resolvePatientTimelineRoute(
        { entity_type: "recommendation", entity_id: "recommendation-1" },
        access,
      ),
    ).toBe("/patients/patient-1?tab=timeline&entity_type=recommendation");
  });
});

describe("normalizePatientDetailTab", () => {
  it("maps the retired cases tab to the clinical profile", () => {
    expect(
      normalizePatientDetailTab("cases", {
        canViewOperationalSurface: true,
        canViewClinical: true,
        canUseMedicationAi: true,
        canViewDocuments: true,
        canViewContracts: true,
        canViewInvoices: true,
      }),
    ).toBe("clinical");
  });

  it("keeps the medication AI screen CEO-gated", () => {
    const access = {
      canViewOperationalSurface: true,
      canViewClinical: true,
      canViewDocuments: true,
      canViewContracts: true,
      canViewInvoices: true,
    };

    expect(normalizePatientDetailTab("medication-ai", {
      ...access,
      canUseMedicationAi: true,
    })).toBe("medication-ai");
    expect(normalizePatientDetailTab("medication-ai", {
      ...access,
      canUseMedicationAi: false,
    })).toBe("profile");
  });

  it("redirects forbidden patient-detail tabs back to profile", () => {
    expect(
      normalizePatientDetailTab("documents", {
        canViewOperationalSurface: false,
        canViewDocuments: false,
        canViewContracts: true,
        canViewInvoices: true,
      })
    ).toBe("profile");
    expect(
      normalizePatientDetailTab("timeline", {
        canViewOperationalSurface: false,
        canViewDocuments: false,
        canViewContracts: true,
        canViewInvoices: true,
      })
    ).toBe("profile");
  });

  it("opens the appointments tab to Concierge but keeps orders and the timeline closed", () => {
    const conciergeAccess = {
      canViewOperationalSurface: canViewPatientOperationalSurface("concierge"),
      canViewCareHistory: canViewPatientCareHistorySurface("concierge"),
      canViewAppointments: canViewPatientAppointmentsSurface("concierge"),
      canViewDocuments: true,
      canViewContracts: false,
      canViewInvoices: false,
    };

    expect(normalizePatientDetailTab("relations", conciergeAccess)).toBe("relations");
    expect(normalizePatientDetailTab("documents", conciergeAccess)).toBe("documents");
    expect(normalizePatientDetailTab("appointments", conciergeAccess)).toBe("appointments");
    expect(normalizePatientDetailTab("orders", conciergeAccess)).toBe("profile");
    expect(normalizePatientDetailTab("timeline", conciergeAccess)).toBe("profile");
  });

  it("closes the appointments tab without appointment access", () => {
    const access = {
      canViewOperationalSurface: true,
      canViewCareHistory: true,
      canViewAppointments: false,
      canViewDocuments: true,
      canViewContracts: true,
      canViewInvoices: true,
    };

    expect(normalizePatientDetailTab("appointments", access)).toBe("profile");
    expect(normalizePatientDetailTab("orders", access)).toBe("orders");
    expect(normalizePatientDetailTab("timeline", access)).toBe("timeline");
  });

  it("keeps allowed commercial tabs intact for read-only executives", () => {
    expect(
      normalizePatientDetailTab("contracts", {
        canViewOperationalSurface: false,
        canViewDocuments: false,
        canViewContracts: true,
        canViewInvoices: true,
      })
    ).toBe("contracts");
    expect(
      normalizePatientDetailTab("invoices", {
        canViewOperationalSurface: false,
        canViewDocuments: false,
        canViewContracts: true,
        canViewInvoices: true,
      })
    ).toBe("invoices");
  });
});
