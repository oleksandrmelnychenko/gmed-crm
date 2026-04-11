import { describe, expect, it } from "vitest";

import {
  buildPatientLabelPrintHtml,
  buildPatientTimelineSummary,
  filterPatientTimelineItems,
  formatRelatedPatientName,
  formatRelatedPatientOption,
} from "./patient-detail.helpers";

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
    expect(html).toContain("Insurance AXA");
    expect(html).toContain("c/o GMED");
  });
});
