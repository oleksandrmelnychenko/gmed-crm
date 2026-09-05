import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localizeTaskNote, localizeTaskTitle } from "./task-labels";
import { uiText } from "./i18n";

describe("generated workflow task labels", () => {
  // Exercise the actual server templates so new untranslated steps fail this check.
  const source = readFileSync(new URL("../../../crates/server/src/routes/workflow_checklists.rs", import.meta.url), "utf8");
  const templates = [...source.matchAll(/item_key: "([^"]+)",\s+item_text: "([^"]+)"/g)];

  it.each(["de", "ru"] as const)("localizes every generated order task in %s", (lang) => {
    expect(templates).toHaveLength(10);
    for (const [, key, text] of templates) {
      const expected = uiText(`workflow_item_${key}`, lang);
      expect(expected).not.toBe(`workflow_item_${key}`);
      expect(localizeTaskTitle(`Order checklist: ${text}`, lang)).toBe(expected);
      expect(localizeTaskTitle(`workflow_item_${key}`, lang)).toBe(expected);
    }
  });

  it("translates the screenshot title and note in both languages", () => {
    const title = "Order checklist: Review order scope and convert needs into service blocks";
    expect(localizeTaskTitle(title, "ru")).toBe("Проверить объём заказа и преобразовать в сервисные блоки");
    expect(localizeTaskTitle(title, "de")).toBe("Auftragsumfang prüfen und in Leistungsblöcke überführen");
    expect(localizeTaskNote("Auto-generated from order workflow checklist", "ru")).toBe("Создано автоматически из чек-листа заказа");
    expect(localizeTaskNote("Auto-generated from order workflow checklist.", "de")).toBe("Automatisch aus der Auftragscheckliste erstellt");
  });

  it("supports existing patient templates", () => {
    expect(localizeTaskTitle("Patient checklist: Verify contact, insurance and emergency data", "ru")).toBe("Проверить контактные, страховые и экстренные данные");
    expect(localizeTaskNote("Auto-generated from patient workflow checklist", "de")).toBe("Automatisch aus der Patientencheckliste erstellt");
  });

  it("preserves custom user text, including English, and empty notes", () => {
    for (const lang of ["de", "ru"] as const) {
      expect(localizeTaskTitle("Call the clinic", lang)).toBe("Call the clinic");
      expect(localizeTaskNote("Custom note in English", lang)).toBe("Custom note in English");
      expect(localizeTaskNote("Auto-generated from order workflow checklist — edited", lang)).toBe("Auto-generated from order workflow checklist — edited");
      expect(localizeTaskNote(null, lang)).toBe("");
    }
  });
});
