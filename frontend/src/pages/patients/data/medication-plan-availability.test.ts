import { describe, expect, it } from "vitest";
import { hasCurrentPlanMedications } from "./medication-plan-availability";

const today = new Date("2026-09-08T12:00:00Z");
const active = { status: "aktiv" as const, on_hold: false, einnahme_von: null, einnahme_bis: null };

describe("medication plan availability", () => {
  it("requires at least one current medication", () => {
    expect(hasCurrentPlanMedications([], today)).toBe(false);
    expect(hasCurrentPlanMedications([active], today)).toBe(true);
  });
  it.each(["pausiert", "abgesetzt", "geplant"] as const)("excludes %s medications", (status) => {
    expect(hasCurrentPlanMedications([{ ...active, status }], today)).toBe(false);
  });
  it("excludes active medications on hold", () => {
    expect(hasCurrentPlanMedications([{ ...active, on_hold: true }], today)).toBe(false);
  });
  it("excludes future and expired intake periods", () => {
    expect(hasCurrentPlanMedications([{ ...active, einnahme_von: "2026-09-09" }], today)).toBe(false);
    expect(hasCurrentPlanMedications([{ ...active, einnahme_bis: "2026-09-07" }], today)).toBe(false);
  });
  it("includes both date boundaries and trims empty dates like the server", () => {
    expect(hasCurrentPlanMedications([{ ...active, einnahme_von: " 2026-09-08 ", einnahme_bis: "2026-09-08" }], today)).toBe(true);
    expect(hasCurrentPlanMedications([{ ...active, einnahme_von: " ", einnahme_bis: " " }], today)).toBe(true);
  });
  it.each(["2026-09-07T22:30:00Z", "2026-01-07T23:30:00Z"])("uses Berlin dates at midnight (%s)", (timestamp) => {
    const date = timestamp.startsWith("2026-09") ? "2026-09-08" : "2026-01-08";
    expect(hasCurrentPlanMedications([{ ...active, einnahme_von: date, einnahme_bis: date }], new Date(timestamp))).toBe(true);
  });
});
