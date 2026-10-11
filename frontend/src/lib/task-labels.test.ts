import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  followUpReminderStoredNote,
  followUpReminderStoredTitle,
  localizeTaskNote,
  localizeTaskTitle,
} from "./task-labels";
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

  it.each(["de", "ru"] as const)("localizes the appointment's generated concierge work in %s", (lang) => {
    // Exercise the actual server constants so new untranslated texts fail here.
    const appointments = readFileSync(new URL("../../../crates/server/src/routes/appointments.rs", import.meta.url), "utf8");
    const checklistBlock = appointments.match(/const CONCIERGE_CHECKLIST_ITEMS[^=]*= \[([\s\S]*?)\];/)?.[1] ?? "";
    const checklistTexts = [...checklistBlock.matchAll(/"(?:preparation|execution|followup)",\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(checklistTexts).toHaveLength(4);
    for (const text of checklistTexts) {
      expect(localizeTaskTitle(text, lang)).not.toBe(text);
    }
    const prefixes = [...appointments.matchAll(/const CONCIERGE_(?:COORDINATE_TASK|RECEIPTS_TASK|REMINDER)_PREFIX: &str = "([^"]+)";/g)].map((match) => match[1]);
    expect(prefixes).toHaveLength(3);
    for (const prefix of prefixes) {
      const localized = localizeTaskTitle(`${prefix} Restaurant Vabene`, lang);
      expect(localized).not.toContain(prefix);
      expect(localized).toContain("Restaurant Vabene");
    }
    expect(localizeTaskNote("Confirm provider details, logistics and patient-facing service delivery", lang)).not.toMatch(/Confirm provider/);
    expect(localizeTaskNote("Gather confirmations and receipts after the non-medical service", lang)).not.toMatch(/Gather/);
    expect(localizeTaskNote("Prepare non-medical support for appointment on 2026-10-05", lang)).toContain("05.10.2026");
  });

  it("shows follow-up reminders 1W/1M/6M in the reader's language", () => {
    const title = followUpReminderStoredTitle("post_1m");
    expect(title).toBe("1-month follow-up check-in");
    expect(localizeTaskTitle(title ?? "", "ru")).toBe("Контроль через 1 месяц");
    expect(localizeTaskTitle(title ?? "", "de")).toBe("Nachsorge nach 1 Monat");
    expect(followUpReminderStoredTitle("post_2y")).toBeNull();

    const note = followUpReminderStoredNote("completion", "P-20261011-0003", "Kardiologie · Kontrolle");
    expect(localizeTaskNote(note, "de")).toBe(
      "Automatisch beim Terminabschluss für P-20261011-0003 · Kardiologie · Kontrolle geplant.",
    );
    expect(localizeTaskNote(note, "ru")).toBe(
      "Автоматически запланировано при завершении приёма для P-20261011-0003 · Kardiologie · Kontrolle.",
    );
    const fromAppointment = followUpReminderStoredNote("appointment", "PT-1", "Check-up");
    expect(localizeTaskNote(fromAppointment, "de")).toBe("Automatisch aus Termin PT-1 · Check-up geplant.");
  });

  it("stores titles the order follow-up gate counts", () => {
    // orders.rs counts reminders by these title patterns (ILIKE '1-week follow-up check-in%' …).
    const orders = readFileSync(new URL("../../../crates/server/src/routes/orders.rs", import.meta.url), "utf8");
    for (const preset of ["post_1w", "post_1m", "post_6m"]) {
      const title = followUpReminderStoredTitle(preset) ?? "";
      expect(orders).toContain(`r.title ILIKE '${title}%'`);
    }
  });

  it("keeps follow-up reminders stored in Russian or German before readable in the other language", () => {
    expect(localizeTaskTitle("Контроль через 1 неделю", "de")).toBe("Nachsorge nach 1 Woche");
    expect(localizeTaskTitle("Контрольный контакт через 6 месяцев", "de")).toBe("Nachsorge nach 6 Monaten");
    expect(localizeTaskTitle("Nachsorge nach 1 Monat", "ru")).toBe("Контроль через 1 месяц");
    expect(
      localizeTaskNote("Автоматически запланировано при завершении приёма для PT-5 · Herz-Check.", "de"),
    ).toBe("Automatisch beim Terminabschluss für PT-5 · Herz-Check geplant.");
    expect(localizeTaskNote("Automatisch aus Termin PT-5 · Herz-Check geplant.", "ru")).toBe(
      "Автоматически запланировано из приёма PT-5 · Herz-Check.",
    );
  });

  it("translates the note of the service created for a non-medical appointment", () => {
    expect(localizeTaskNote("Automatisch aus nichtmedizinischem Termin erstellt", "ru")).toBe(
      "Создано автоматически из немедицинского приёма",
    );
    expect(localizeTaskNote("Automatisch aus nichtmedizinischem Termin erstellt", "de")).toBe(
      "Automatisch aus nichtmedizinischem Termin erstellt",
    );
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
