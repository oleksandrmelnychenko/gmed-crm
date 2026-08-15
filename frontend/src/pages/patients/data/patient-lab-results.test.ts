import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import {
  deletePatientLabResult,
  updatePatientLabResult,
  type PatientLabResultCorrectionPayload,
} from "./patient-lab-results";

describe("updatePatientLabResult", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("PATCHes only the explicit correction payload and returns the canonical row", async () => {
    const payload: PatientLabResultCorrectionPayload = {
      measured_at: "2026-08-10",
      panel: "Blutbild",
      laboratory_name: "SYNLAB Berlin",
      analyte_name: "Hämoglobin",
      result_text: "13.4",
      numeric_result: 13.4,
      comparator: null,
      unit: "g/dL",
      reference_text: "12.0–16.0",
      reference_low: 12,
      reference_high: 16,
      abnormal_flag: "normal",
      correction_note: "OCR decimal corrected",
    };
    const item = {
      id: "lab-1",
      ...payload,
      measured_at: "2026-08-10T00:00:00Z",
      measured_at_precision: "date" as const,
      corrected_at: "2026-08-14T18:00:00Z",
      corrected_by_name: "Dr. Test",
      created_at: "2026-08-10T00:00:00Z",
    };
    apiFetchMock.mockResolvedValue({ ok: true, item });

    await expect(updatePatientLabResult("patient-1", "lab-1", payload)).resolves.toBe(item);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/patients/patient-1/lab-results/lab-1",
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).not.toHaveProperty("source_import_id");
    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).not.toHaveProperty("measured_at_precision");
  });

  it("soft-deletes a lab row with an explicit audit reason", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, id: "lab-1" });

    await expect(
      deletePatientLabResult("patient-1", "lab-1", "Wrong patient"),
    ).resolves.toBeUndefined();
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/patients/patient-1/lab-results/lab-1",
      {
        method: "DELETE",
        body: JSON.stringify({ deletion_note: "Wrong patient" }),
      },
    );
  });
});
