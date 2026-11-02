import { describe, expect, it } from "vitest";

import { CITIZENSHIP_FIELD_LABELS, citizenshipFieldLabel } from "./citizenship-field-label";

describe("citizenship field label (client decision 2026-11-02)", () => {
  it("reads the client's wording in every language", () => {
    expect(citizenshipFieldLabel("ru")).toBe("Гражданство (если несколько — укажите все)");
    expect(citizenshipFieldLabel("de")).toBe("Staatsangehörigkeit (bei mehreren alle angeben)");
    expect(citizenshipFieldLabel("uk")).toBe("Громадянство (якщо кілька — вкажіть усі)");
    expect(citizenshipFieldLabel("en")).toBe(CITIZENSHIP_FIELD_LABELS.en);
  });

  it("falls back to the German original", () => {
    expect(citizenshipFieldLabel("fr")).toBe(CITIZENSHIP_FIELD_LABELS.de);
    expect(citizenshipFieldLabel("toString")).toBe(CITIZENSHIP_FIELD_LABELS.de);
  });
});
