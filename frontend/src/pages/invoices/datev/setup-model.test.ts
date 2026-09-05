import { describe, expect, it } from "vitest";
import { datevSetupBrief, profileNumbersValid } from "./setup-model";
import { DATEV_MODULES, type DatevProfile } from "./setup-api";

const profile: DatevProfile = { company_name: "Test", consultant_number: "0012345", client_number: "00012", belege_version: "", modules: [...DATEV_MODULES], export_service: "ordered" };
describe("DATEV onboarding", () => {
  it("keeps leading zeroes and rejects incomplete identifier pairs", () => {
    expect(profileNumbersValid(profile)).toBe(true);
    expect(profileNumbersValid({ ...profile, client_number: "" })).toBe(false);
    expect(profileNumbersValid({ ...profile, client_number: "1e3" })).toBe(false);
    expect(profileNumbersValid({ ...profile, consultant_number: "", client_number: "" })).toBe(true);
  });
  it("exports declared modules and pending access without claiming authorization", () => {
    const brief = datevSetupBrief(profile);
    expect(brief).toContain("0012345");
    expect(brief).toContain("Liquiditätsmonitor online");
    expect(brief).toContain("API-Zugriff nicht geprüft");
    expect(brief).toContain("Keine DATEV-Verbindung");
    expect(brief).toContain("keine Zahlungen auslösen");
  });
});
