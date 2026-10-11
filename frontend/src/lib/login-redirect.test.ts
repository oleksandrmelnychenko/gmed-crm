import { describe, expect, it } from "vitest";

import { loginRedirectState, resolveLoginRedirect, signOutReasonOf } from "@/lib/login-redirect";

const at = { pathname: "/patients/p-1", search: "?tab=clinical", hash: "" };

describe("login redirect (QA E-24 / E-37)", () => {
  it("returns a deep link opened without a session to its page", () => {
    const state = loginRedirectState(null, at);
    expect(resolveLoginRedirect(state, "anna")).toBe("/patients/p-1?tab=clinical");
    expect(signOutReasonOf(state)).toBeNull();
  });

  it("forgets the page after an explicit sign-out", () => {
    const state = loginRedirectState({ reason: "explicit", userId: "anna" }, at);
    expect(resolveLoginRedirect(state, "anna")).toBe("/");
    expect(resolveLoginRedirect(state, "ben")).toBe("/");
    expect(signOutReasonOf(state)).toBe("explicit");
  });

  it("keeps the page after idle or expiry only for the same account", () => {
    for (const reason of ["idle", "expired"] as const) {
      const state = loginRedirectState({ reason, userId: "anna" }, at);
      expect(resolveLoginRedirect(state, "anna")).toBe("/patients/p-1?tab=clinical");
      expect(resolveLoginRedirect(state, "ben")).toBe("/");
      expect(signOutReasonOf(state)).toBe(reason);
    }
  });

  it("ignores foreign or malformed targets", () => {
    expect(resolveLoginRedirect({ from: "https://evil.example.com" }, "anna")).toBe("/");
    expect(resolveLoginRedirect({ from: "//evil.example.com" }, "anna")).toBe("/");
    expect(resolveLoginRedirect(null, "anna")).toBe("/");
  });
});
