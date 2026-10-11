import { describe, expect, it } from "vitest";

import { buildRequestScheduleTitle } from "./queue-sheet";

describe("appointment scheduled from a portal request", () => {
  it("starts the patient-visible title from the requested specialty", () => {
    expect(buildRequestScheduleTitle({ specialty: " Kardiologie " })).toBe("Kardiologie");
  });

  it("leaves the title empty instead of 'Медицинский · <patient>' when no specialty was asked for", () => {
    expect(buildRequestScheduleTitle({ specialty: null })).toBe("");
    expect(buildRequestScheduleTitle({ specialty: "   " })).toBe("");
  });
});
