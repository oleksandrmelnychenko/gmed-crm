import { describe, expect, it } from "vitest";

import { normalizeCountryBlocks, normalizeLeadSanctionsStatus } from "./api";

describe("normalizeCountryBlocks", () => {
  it("keeps leads and patients as the server sent them", () => {
    const lead = { lead_id: "lead-1", name: "Anna Muster", flag: "blocked_country", found: ["RU"], blocking: ["RU"], lift: null };
    const patient = {
      patient_id: "patient-1",
      patient_number: "P-0001",
      name: "Ben Muster",
      flag: "country_lifted",
      found: ["RU"],
      blocking: [],
      lift: null,
    };
    expect(normalizeCountryBlocks({ leads: [lead], patients: [patient] })).toEqual({
      leads: [lead],
      patients: [patient],
    });
  });

  it("reads an older server's answer without patients and a broken one as empty", () => {
    expect(normalizeCountryBlocks({ leads: [] })).toEqual({ leads: [], patients: [] });
    for (const raw of [null, "<html>", { leads: "x", patients: 3 }]) {
      expect(normalizeCountryBlocks(raw)).toEqual({ leads: [], patients: [] });
    }
  });
});

describe("normalizeLeadSanctionsStatus", () => {
  it("keeps a complete status as the server sent it", () => {
    const lift = {
      countries: ["IR"],
      reason: "Humanitarian treatment",
      lifted_by_name: "CEO",
      lifted_at: "2026-10-04T08:00:00Z",
    };
    const status = normalizeLeadSanctionsStatus(
      {
        lead_id: "lead-1",
        list_version_date: "2026-10-01",
        list_available: true,
        list_stale: true,
        screening: "review_pending",
        open_hits: 2,
        confirmed_hits: 1,
        sanctions_block: { code: "sanctions_review_pending" },
        country: { blocked_countries: ["IR", "KP"], found: ["IR"], blocking: [], lift },
        can_lift_country_block: true,
        can_review: true,
      },
      "other-lead",
    );

    expect(status).toMatchObject({
      lead_id: "lead-1",
      list_version_date: "2026-10-01",
      list_available: true,
      list_stale: true,
      screening: "review_pending",
      open_hits: 2,
      confirmed_hits: 1,
      sanctions_block: { code: "sanctions_review_pending" },
      can_lift_country_block: true,
      can_review: true,
    });
    expect(status.country).toEqual({ blocked_countries: ["IR", "KP"], found: ["IR"], blocking: [], lift });
  });

  it("fills an empty, partial or foreign answer with harmless defaults", () => {
    for (const raw of [{}, [], null, "<html>", { country: null }, { country: { blocking: "IR" } }]) {
      const status = normalizeLeadSanctionsStatus(raw, "lead-1");
      expect(status.lead_id).toBe("lead-1");
      expect(status.screening).toBe("not_screened");
      expect(status.list_available).toBe(false);
      expect(status.sanctions_block).toBeNull();
      expect(status.country).toEqual({ blocked_countries: [], found: [], blocking: [], lift: null });
      expect(status.can_review).toBe(false);
    }
  });

  it("drops entries of the wrong type instead of passing them on", () => {
    const status = normalizeLeadSanctionsStatus(
      { screening: "blocked", open_hits: "3", country: { blocking: ["IR", 7, null] } },
      "lead-1",
    );
    expect(status.screening).toBe("not_screened");
    expect(status.open_hits).toBe(0);
    expect(status.country.blocking).toEqual(["IR"]);
  });
});
