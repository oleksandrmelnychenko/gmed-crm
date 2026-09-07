import { describe, expect, it } from "vitest";
import { datevReadiness } from "./readiness-model";
import { datevSetupBrief } from "./setup-model";
import type { DatevProfile } from "./setup-api";

const profile: DatevProfile = { company_name: "", consultant_number: "", client_number: "", modules: ["belege"], belege_version: "", export_service: "unknown" };
describe("preparation without DATEV credentials", () => {
  it("does not count empty identifier pairs as completed setup", () => {
    expect(datevReadiness(profile).filter((check) => check.complete).map((check) => check.id)).toEqual(["modules"]);
    expect(datevReadiness({ ...profile, consultant_number: "1234", client_number: "1e3" }).find((check) => check.id === "numbers")?.complete).toBe(false);
  });
  it("only asks for a Belege version when the module is selected", () => {
    expect(datevReadiness({ ...profile, modules: ["bank"] }).some((check) => check.id === "version")).toBe(false);
  });
  it("reports completed preparation as declared information, never access", () => {
    const complete = { ...profile, company_name: "Test", consultant_number: "0012345", client_number: "00012", belege_version: "Neue Version", export_service: "not_ordered" as const };
    expect(datevReadiness(complete).every((check) => check.complete)).toBe(true);
    const brief = datevSetupBrief(complete);
    expect(brief).toContain("Nicht bestellt");
    expect(brief).toContain("Keine DATEV-Verbindung");
    expect(brief).toContain("keine Zahlungen auslösen");
    expect(brief).toContain("Rechnungsdatenservice 1.0 derzeit nicht unterstützt");
  });
});
