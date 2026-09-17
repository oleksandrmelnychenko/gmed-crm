import { describe, expect, it } from "vitest";
import { datevRedirects, defaultRedirect, redirectOptions, safeAuthorizationUrl, sameSite } from "./live-api";
describe("DATEV authorization navigation", () => {
  it("allows only the official authorization endpoints", () => {
    expect(safeAuthorizationUrl("https://login.datev.de/openidsandbox/authorize?state=test")).toContain("openidsandbox");
    for (const url of ["https://login.datev.de.evil.test/openid/authorize", "javascript:alert(1)", "https://evil.test", "https://user:secret@login.datev.de/openid/authorize"]) expect(() => safeAuthorizationUrl(url)).toThrow();
  });
});
describe("DATEV redirect URL", () => {
  it("defaults to the GMed consoles, never to localhost", () => {
    expect(defaultRedirect("http://localhost:5173", "sandbox")).toBe(datevRedirects.dev);
    expect(defaultRedirect("http://localhost:5173", "production")).toBe(datevRedirects.production);
    expect(defaultRedirect("https://console.gmed-health.com", "sandbox")).toBe(datevRedirects.production);
    expect(redirectOptions).toEqual([datevRedirects.dev, datevRedirects.production]);
  });
  it("allows sign-in only from the site DATEV returns to", () => {
    expect(sameSite(datevRedirects.dev, "https://console-dev.gmed-health.com")).toBe(true);
    expect(sameSite(datevRedirects.dev, "http://localhost:5173")).toBe(false);
    expect(sameSite(datevRedirects.production, "https://console.gmed-health.com.evil.test")).toBe(false);
  });
});
