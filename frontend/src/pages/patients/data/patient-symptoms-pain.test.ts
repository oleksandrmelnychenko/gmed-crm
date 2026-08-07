import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/api";
import {
  fetchPatientPain,
  fetchPatientSymptoms,
  savePatientPain,
  savePatientSymptoms,
} from "./patient-symptoms-pain";

describe("patient symptoms and pain API", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("uses patient-owned list endpoints", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ items: [{ beschreibung: "Husten" }] })
      .mockResolvedValueOnce({ items: [{ lokalisierung: "Brust" }] });

    await expect(fetchPatientSymptoms("patient-1")).resolves.toEqual([
      { beschreibung: "Husten" },
    ]);
    await expect(fetchPatientPain("patient-1")).resolves.toEqual([
      { lokalisierung: "Brust" },
    ]);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/patients/patient-1/symptoms");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/patients/patient-1/pain");
  });

  it("saves replace-all payloads without case context", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, count: 1 });
    await savePatientSymptoms("patient-1", [{ beschreibung: "Husten" }]);
    await savePatientPain("patient-1", [{ lokalisierung: "Brust", nrs_aktuell: 7 }]);

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/patients/patient-1/symptoms", {
      method: "POST",
      body: JSON.stringify({ items: [{ beschreibung: "Husten" }] }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/patients/patient-1/pain", {
      method: "POST",
      body: JSON.stringify({ items: [{ lokalisierung: "Brust", nrs_aktuell: 7 }] }),
    });
  });
});
