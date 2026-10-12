import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api";
import { sectionLoadErrorText } from "./section-load-error";

describe("sectionLoadErrorText (QA 2026-10-12 E2-02)", () => {
  it("never shows the raw 'ApiRequestError: Insufficient permissions'", () => {
    const refused = new ApiRequestError("Insufficient permissions", {
      status: 403,
      code: "Forbidden",
      body: { error: "Forbidden", message: "Insufficient permissions" },
    });
    expect(sectionLoadErrorText(refused, "ru")).toBe("Для вашей роли этот раздел не открыт.");
    expect(sectionLoadErrorText(refused, "de")).toBe(
      "Für Ihre Rolle ist dieser Bereich nicht freigegeben.",
    );
    const failed = new ApiRequestError("Failed", { status: 500 });
    for (const lang of ["ru", "de"] as const) {
      const text = sectionLoadErrorText(failed, lang);
      expect(text).not.toContain("ApiRequestError");
      expect(text).not.toContain("Failed");
    }
    expect(sectionLoadErrorText(new TypeError("fetch failed"), "ru")).toBe(
      "Не удалось загрузить раздел. Повторите попытку позже.",
    );
  });
});
