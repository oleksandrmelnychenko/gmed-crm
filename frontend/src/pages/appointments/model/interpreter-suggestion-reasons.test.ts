import { describe, expect, it } from "vitest";

import { interpreterSuggestionReasonLabel } from "./labels";

describe("interpreterSuggestionReasonLabel", () => {
  it("localizes every reason the suggestion service sends", () => {
    for (const reason of [
      "preferred for this patient",
      "worked before (2 appointments)",
      "worked before (1 appointment)",
      "high feedback",
      "good feedback",
      "language match",
      "language unknown",
      "available interpreter",
    ]) {
      const label = interpreterSuggestionReasonLabel(reason);
      expect(label, reason).not.toBe(reason);
      expect(label, reason).not.toMatch(/[a-z]{4,} [a-z]{4,}/);
    }
  });

  it("keeps the appointment count of a previous collaboration", () => {
    expect(interpreterSuggestionReasonLabel("worked before (2 appointments)")).toMatch(
      /\(2\)$/,
    );
  });
});
