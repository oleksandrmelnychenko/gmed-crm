import { describe, expect, it } from "vitest";

import { buildConsentFormPatchAfterSuccess } from "./admin-compliance.helpers";

describe("admin compliance helpers", () => {
  it("keeps the expiry date after granting consent", () => {
    expect(buildConsentFormPatchAfterSuccess("grant")).toEqual({
      consentNote: "",
    });
  });

  it("clears the expiry date after revoking consent", () => {
    expect(buildConsentFormPatchAfterSuccess("revoke")).toEqual({
      consentExpiresAt: "",
      consentNote: "",
    });
  });
});
