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
    expect(development.title.ru).toBe("Изменения в DEV-сборке");
    expect(development.notes[0]).toMatchObject({
      commit: "c20292f",
      title: { ru: "Роли и рабочие кабинеты" },
    });
    expect(production.channel).toBe("production");
    expect(production.build).toBe("prod-17");
    expect(production.builtAt).toBe("2026-08-11T11:30:00Z");
    expect(production.title.ru).toBe("Изменения в PROD-сборке");
    expect(production.notes[0]).toMatchObject({
      commit: "e47e5ab",
      title: { ru: "Рабочие панели" },
    });
  });
});
