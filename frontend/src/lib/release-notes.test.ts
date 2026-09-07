import { describe, expect, it } from "vitest";

import {
  CURRENT_CUSTOMER_RELEASE,
  localizeReleaseText,
  resolveCustomerRelease,
} from "./release-notes";

describe("customer release notes", () => {
  it("defines a complete customer-facing release in both languages", () => {
    expect(CURRENT_CUSTOMER_RELEASE.build).not.toBe("");
    expect(Number.isNaN(new Date(CURRENT_CUSTOMER_RELEASE.builtAt).getTime())).toBe(false);
    expect(CURRENT_CUSTOMER_RELEASE.notes.length).toBeGreaterThan(0);

    for (const lang of ["ru", "de"] as const) {
      expect(localizeReleaseText(CURRENT_CUSTOMER_RELEASE.title, lang)).not.toBe("");
      for (const note of CURRENT_CUSTOMER_RELEASE.notes) {
        expect(note.commit).toMatch(/^[0-9a-f]{7}$/);
        expect(localizeReleaseText(note.title, lang)).not.toBe("");
        expect(localizeReleaseText(note.description, lang)).not.toBe("");
      }
    }
  });

  it("keeps development and production releases distinct", () => {
    const development = resolveCustomerRelease({
      mode: "development",
      buildNumber: "dev-42",
      buildTimestamp: "2026-08-10T10:15:00Z",
    });
    const production = resolveCustomerRelease({
      mode: "production",
      buildNumber: "prod-17",
      buildTimestamp: "2026-08-11T11:30:00Z",
    });

    expect(development.channel).toBe("development");
    expect(development.build).toBe("dev-42");
    expect(development.builtAt).toBe("2026-08-10T10:15:00Z");
    expect(development.title.ru).toBe("Обновления за 10 августа 2026");
    expect(development.title.de).toBe("Aktualisierungen vom 10. August 2026");
    expect(development.notes[0]).toMatchObject({
      commit: "e3f7a96",
      title: { ru: "Распознавание и проверка инвойсов" },
    });
    expect(production.channel).toBe("production");
    expect(production.build).toBe("prod-17");
    expect(production.builtAt).toBe("2026-08-11T11:30:00Z");
    expect(production.title.ru).toBe("Релиз от 11 августа 2026");
    expect(production.title.de).toBe("Release vom 11. August 2026");
    expect(production.notes[0]).toMatchObject({
      commit: "e3f7a96",
      title: { ru: "Распознавание и проверка инвойсов" },
    });
  });

  it("uses a stable UTC build date and avoids invalid-date labels", () => {
    expect(resolveCustomerRelease({ mode: "production", buildTimestamp: "2026-09-08T01:00:00+03:00" }).title.ru)
      .toBe("Релиз от 7 сентября 2026");
    expect(resolveCustomerRelease({ mode: "production", buildTimestamp: "invalid" }).title)
      .toEqual({ ru: "Релиз", de: "Release" });
  });
});
