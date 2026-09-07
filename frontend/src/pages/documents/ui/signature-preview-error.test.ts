import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { signaturePreviewError, signaturePreviewErrorMessage } from "./signature-preview-error";

describe("signature PDF failure reasons", () => {
  it.each([
    [401, "session"], [403, "access"], [404, "missing"], [410, "missing"], [503, "load"],
  ] as const)("explains HTTP %s without exposing the server message", (status, expected) => {
    const kind = signaturePreviewError(new ApiRequestError("internal storage details", {status}), "load");
    expect(kind).toBe(expected);
    for (const lang of ["ru", "de"]) expect(signaturePreviewErrorMessage(kind, lang)).not.toContain("internal storage details");
  });
  it.each([
    ["PasswordException", "password"], ["InvalidPDFException", "invalid"],
  ] as const)("explains %s", (name, expected) => {
    expect(signaturePreviewError({name}, "load")).toBe(expected);
  });
  it("keeps rendering errors separate from download errors", () => {
    expect(signaturePreviewError(new Error("page failure"), "render")).toBe("render");
    expect(signaturePreviewError(null, "load")).toBe("load");
  });
});
