import { describe, expect, it } from "vitest";

import { leadSourceTone } from "./status-appearance";

describe("leadSourceTone", () => {
  it.each([
    ["Website Wizard", "warning"],
    ["existing_patient", "success"],
    ["manual", "neutral"],
    ["Website Contact Form", "info"],
    ["referral", "brand"],
    ["unexpected_source", "error"],
  ] as const)("maps %s to %s", (source, tone) => {
    expect(leadSourceTone(source)).toBe(tone);
  });
});
