import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { NO_CONSENT_FORM_CHOICES, saveLeadConsentFormChoicesAndRefresh, type LeadRequest } from "./lead-request-api";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  apiFetch: vi.fn(),
}));

const choices = { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, doctors_to_agency: true, data_system: true };

describe("consent choice save refresh", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("returns the canonical request with its submission marker and newer saved fields", async () => {
    const refreshed = {
      lead_id: "lead-1",
      changed_since_submit: true,
      personal_data: { city: "Bonn" },
      consent_form: { choices, chosen_at: "2026-10-13T11:00:00Z" },
    } as LeadRequest;
    let finishSave!: (value: unknown) => void;
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }))
      .mockResolvedValueOnce(refreshed);
    const saving = saveLeadConsentFormChoicesAndRefresh("lead-1", choices, "2026-10-12", "en", []);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    finishSave(refreshed.consent_form);
    expect(await saving).toBe(refreshed);
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/me/lead-requests/lead-1", { forceFresh: true });
  });

  it("does not fetch or report a saved snapshot when saving was refused", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("consent_version_outdated"));
    await expect(saveLeadConsentFormChoicesAndRefresh("lead-1", choices, "old", "en"))
      .rejects.toThrow("consent_version_outdated");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
