import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import { accessCellText } from "./admin-access";

describe("accessCellText", () => {
  const ru = t("ru");
  const de = t("de");

  it("shows the CEO Assistant's access as read-only, never as editing", () => {
    expect(accessCellText(ru, "ceo_assistant", "full", true)).toBe("Только чтение · Системное правило");
    expect(accessCellText(de, "ceo_assistant", "full", false)).toBe("Nur Lesen");
    expect(accessCellText(ru, "patient_manager", "full", false)).toBe("Полный доступ");
  });

  it("names the access a system rule fixes instead of hiding it", () => {
    expect(accessCellText(ru, "interpreter", "hidden", true)).toBe("Скрыто · Системное правило");
    expect(accessCellText(de, "it_admin", "hidden", true)).toBe("Ausgeblendet · Systemregel");
    expect(accessCellText(ru, "patient", "conditional", false)).toBe("Условный");
  });
});
