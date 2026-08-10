import { describe, expect, it } from "vitest";

import type {
  ClinicalDocumentImportCandidate,
  MedicationImportHistoryEvent,
} from "./clinical-document-import";
import {
  groupMedicationImportHistory,
  medicationCandidateDisplay,
  medicationCandidateNeedsWirkstoff,
  medicationCandidateReviewBlockReason,
  medicationFieldConfidence,
  medicationImportPayload,
  partitionMedicationReviewSelection,
  updateMedicationCandidateField,
} from "./medication-document-import";
import type { ClinicalMedication } from "./patient-clinical";

function candidate(
  normalized: Record<string, unknown>,
): ClinicalDocumentImportCandidate {
  return {
    id: "med-1",
    target: "medication",
    value: "OCR source row",
    normalized,
    confidence: 0.91,
    selected: true,
    source: { page: 2, section: "Medikation", text: "OCR source row" },
  };
}

const structured = {
  wirkstoff: "Metoprolol",
  handelsname: "Metohexal",
  staerke: "50 mg",
  form: "Tablette",
  einnahmeform: "oral",
  dose_morgens: "1",
  dose_mittags: "0",
  dose_abends: "1",
  dose_nachts: "0",
  einheit: "Tablette",
  grund: "Hypertonie",
  verordnet_am: "2026-08-01",
  einnahme_von: "2026-08-02",
  einnahme_bis: null,
  status: "aktiv",
};

describe("structured medication document import", () => {
  it("blocks a brand-only OCR candidate until the active ingredient is reviewed", () => {
    const item = candidate({ handelsname: "Metohexal", wirkstoff: "" });

    expect(medicationCandidateNeedsWirkstoff(item)).toBe(true);
    expect(medicationImportPayload(item, "DE")).toBeNull();
  });

  it("keeps checked but blocked medication candidates visible to the staged review", () => {
    const missingWirkstoff = candidate({ handelsname: "Metohexal", wirkstoff: "" });
    const ambiguous = {
      ...candidate({ wirkstoff: "Metoprolol" }),
      id: "med-2",
    };

    const selection = partitionMedicationReviewSelection(
      [missingWirkstoff, ambiguous],
      (item) => (item.id === "med-2" ? 2 : 0),
    );

    expect(selection.selected.map((item) => item.id)).toEqual(["med-1", "med-2"]);
    expect(selection.blockedSelected.map((item) => item.id)).toEqual(["med-1", "med-2"]);
    expect(medicationCandidateReviewBlockReason(missingWirkstoff, 0)).toBe("missing_wirkstoff");
    expect(medicationCandidateReviewBlockReason(ambiguous, 2)).toBe("ambiguous_series");
  });

  it("requires an explicit series decision for same-Wirkstoff siblings in one batch", () => {
    const first = { ...candidate({ wirkstoff: "Metoprolol", staerke: "50 mg" }), id: "med-a" };
    const second = { ...candidate({ wirkstoff: "  METOPROLOL ", staerke: "100 mg" }), id: "med-b" };

    const selection = partitionMedicationReviewSelection(
      [first, second],
      () => 0,
      () => 2,
    );

    expect(selection.blockedSelected.map((item) => item.id)).toEqual(["med-a", "med-b"]);
    expect(medicationCandidateReviewBlockReason(first, 0, 2)).toBe("ambiguous_series");

    const reviewedFirst = {
      ...first,
      normalized: { ...first.normalized, create_new_series: true },
    };
    const reviewedSecond = {
      ...second,
      normalized: { ...second.normalized, create_new_series: true },
    };
    expect(medicationCandidateReviewBlockReason(reviewedFirst, 0, 2)).toBeNull();
    expect(medicationCandidateReviewBlockReason(reviewedSecond, 0, 2)).toBeNull();
    expect(medicationImportPayload(reviewedFirst, "DE")).toMatchObject({
      candidate_id: "med-a",
      create_new_series: true,
    });
    expect(medicationImportPayload(reviewedSecond, "DE")).toMatchObject({
      candidate_id: "med-b",
      create_new_series: true,
    });
  });

  it("maps all reviewed regimen fields and preserves source provenance without verification", () => {
    const imported = medicationImportPayload(
      candidate({
        ...structured,
        as_needed: true,
        source_country: "PL",
        source_date: "2026-08-10",
        identifiers: { national: "ABC-123", atc: "C07AB02" },
        field_confidence: { wirkstoff: 0.68, ignored: "bad" },
      }),
      "DE",
    );

    expect(imported).toMatchObject({
      candidate_id: "med-1",
      wirkstoff: "Metoprolol",
      handelsname: "Metohexal",
      staerke: "50 mg",
      einnahmeform: "oral",
      dose_morgens: "1",
      dose_mittags: "0",
      dose_abends: "1",
      dose_nachts: "0",
      einheit: "Tablette",
      verordnet_am: "2026-08-01",
      einnahme_von: "2026-08-02",
      status: "aktiv",
      source_country: "DE",
      source_date: "2026-08-10",
      source_page: 2,
      source_raw_text: "OCR source row",
      source_identifiers: { national: "ABC-123", atc: "C07AB02" },
      source_field_confidence: { wirkstoff: 0.68 },
      hinweis: "Bei Bedarf (PRN)",
    });
    expect(imported?.hinweis).toContain("Bei Bedarf (PRN)");
    expect(medicationFieldConfidence(candidate({ field_confidence: { wirkstoff: 0.68 } }), "wirkstoff")).toBe(0.68);

    const ukrainianPrn = medicationImportPayload(
      candidate({ ...structured, as_needed: true, hinweis: "за потреби" }),
      "UA",
    );
    expect(ukrainianPrn?.hinweis).toBe("за потреби");
  });

  it("preserves explicit null clears, omits absent fields, and never truncates country names", () => {
    const payload = medicationImportPayload(
      candidate({
        wirkstoff: "Metoprolol",
        staerke: null,
        hinweis: "",
        source_country: "Germany",
        medication_series_id: null,
      }),
      "DE",
    );

    expect(payload).toMatchObject({
      staerke: null,
      hinweis: null,
      source_country: "DE",
      medication_series_id: null,
    });
    expect(payload).not.toHaveProperty("form");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("on_hold");

    const seriesSelection = updateMedicationCandidateField(
      candidate({ wirkstoff: "Metoprolol" }),
      "medication_series_id",
      "series-b",
    );
    expect(
      medicationImportPayload({ ...candidate(seriesSelection.normalized), value: seriesSelection.value }, "DE"),
    ).toMatchObject({ medication_series_id: "series-b" });
  });

  it("maps explicit new-series review without sending a sentinel or series id", () => {
    const reviewed = candidate({
      wirkstoff: "Metoprolol",
      medication_series_id: "__create_new_medication_series__",
      create_new_series: true,
    });
    const payload = medicationImportPayload(reviewed, "DE");

    expect(payload).toMatchObject({ create_new_series: true });
    expect(payload?.medication_series_id).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("__create_new_medication_series__");
    expect(medicationCandidateReviewBlockReason(reviewed, 2)).toBeNull();
  });

  it("uses only the exact prepared country and never falls back to candidate metadata", () => {
    expect(
      medicationImportPayload(candidate({ ...structured, source_country: "DE" }), "UA")
        ?.source_country,
    ).toBe("UA");
    expect(
      medicationImportPayload(candidate({ ...structured, source_country: "UA" }), "")
        ?.source_country,
    ).toBeNull();
    expect(
      medicationImportPayload(candidate({ ...structured, source_country: "UA" }), "ua")
        ?.source_country,
    ).toBeNull();
  });

  it("groups history by medication series without merging equal active ingredients", () => {
    const current = [
      { id: "med-a", medication_series_id: "series-a", wirkstoff: "Metoprolol", handelsname: "Brand A" },
      { id: "med-b", medication_series_id: "series-b", wirkstoff: "Metoprolol", handelsname: "Brand B" },
    ] as ClinicalMedication[];
    const events = [
      {
        id: "event-a",
        patient_medication_id: "med-a",
        medication_series_id: "series-a",
        event_type: "created",
        source_date: "2026-08-01",
        created_at: "2026-08-01T12:00:00Z",
        new_value: { medication_series_id: "series-a", wirkstoff: "Metoprolol" },
      },
      {
        id: "event-b",
        patient_medication_id: "med-b",
        medication_series_id: "series-b",
        event_type: "historical_observation",
        source_date: "2025-04-02",
        created_at: "2026-08-10T12:00:00Z",
        new_value: { medication_series_id: "series-b", wirkstoff: "Metoprolol" },
      },
    ] as MedicationImportHistoryEvent[];

    const groups = groupMedicationImportHistory(current, events);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.medicationSeriesId === "series-a")?.events[0]?.id).toBe("event-a");
    expect(groups.find((group) => group.medicationSeriesId === "series-b")?.events[0]?.id).toBe("event-b");
  });

  it("builds candidate.value from structured fields for synchronized review edits", () => {
    const display = medicationCandidateDisplay(structured);
    expect(display).toBe(
      "Metohexal · Metoprolol | 50 mg · Tablette · oral | 1-0-1-0 Tablette",
    );
    expect(display).not.toContain("\uFFFD");
    expect(medicationCandidateDisplay({ ...structured, source_date: "2026-08-10" })).toContain(
      "Datum: 2026-08-10",
    );

    const edited = updateMedicationCandidateField(
      candidate({ ...structured, source_date: "2026-08-09" }),
      "source_date",
      "2026-08-10",
    );
    expect(edited.normalized.source_date).toBe("2026-08-10");
    expect(edited.value).toContain("Datum: 2026-08-10");
  });
});
