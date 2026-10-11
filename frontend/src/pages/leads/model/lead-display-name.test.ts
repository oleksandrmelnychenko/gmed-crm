import { describe, expect, it } from "vitest";

import { deletedLeadLabel, isAnonymizedLead, leadDisplayName } from "./lead-display-name";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("the name staff see for a lead", () => {
  it("joins first and last name", () => {
    expect(leadDisplayName({ first_name: "Anna", last_name: "MusterA" }, ru)).toBe("Anna MusterA");
    expect(leadDisplayName({ first_name: " Anna ", last_name: "" }, ru)).toBe("Anna");
    expect(leadDisplayName({ first_name: null, last_name: "MusterA" }, ru)).toBe("MusterA");
  });

  it("names an anonymised lead in the UI language, never «Deleted Lead»", () => {
    const anonymised = {
      first_name: "Deleted",
      last_name: "Lead",
      qualification_status: "deleted",
      failed_outcome: { status: "delete_anonymized" },
    };
    expect(isAnonymizedLead(anonymised)).toBe(true);
    expect(leadDisplayName(anonymised, ru)).toBe("Удалённый лид");
    expect(leadDisplayName(anonymised, de)).toBe("Gelöschter Lead");
    expect(deletedLeadLabel(de)).toBe("Gelöschter Lead");
    // A list row without the failed outcome still carries the sentinel name and the status.
    expect(isAnonymizedLead({ first_name: "Deleted", last_name: "Lead", qualification_status: "deleted" })).toBe(true);
  });

  it("keeps the name of a lead that is only archived, or really called so", () => {
    expect(isAnonymizedLead({ first_name: "Anna", last_name: "MusterA", failed_outcome: { status: "archived" } })).toBe(false);
    expect(isAnonymizedLead({ first_name: "Deleted", last_name: "Lead", qualification_status: "new" })).toBe(false);
    expect(isAnonymizedLead(null)).toBe(false);
  });
});
