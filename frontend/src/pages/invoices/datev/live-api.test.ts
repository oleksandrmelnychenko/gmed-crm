import { describe, expect, it } from "vitest";
import { safeAuthorizationUrl } from "./live-api";
describe("DATEV authorization navigation", () => {
  it("allows only the official authorization endpoints", () => {
    expect(safeAuthorizationUrl("https://login.datev.de/openidsandbox/authorize?state=test")).toContain("openidsandbox");
    for (const url of ["https://login.datev.de.evil.test/openid/authorize", "javascript:alert(1)", "https://evil.test", "https://user:secret@login.datev.de/openid/authorize"]) expect(() => safeAuthorizationUrl(url)).toThrow();
  });
});
