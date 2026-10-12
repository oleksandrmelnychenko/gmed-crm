import { describe, expect, it } from "vitest";

import { t as translateCatalog } from "@/lib/i18n";

import { patientTimelineItemLabels } from "./timeline-item-labels";

describe("patientTimelineItemLabels (QA 2026-10-12 B-26b)", () => {
  const ru = translateCatalog("ru").uiText;
  const l = (key: string) => ru[key] ?? key;
  const statusLabel = (status: string) => (status === "active" ? "Активно" : "Неизвестное значение");

  it("names the dosage form of a medication row, not its code", () => {
    const labels = patientTimelineItemLabels(
      {
        entity_type: "clinical",
        category: "medication",
        title: "Ramipril · 5 mg · TABL",
        status: "active",
        source_label: null,
      },
      l,
      statusLabel,
      "ru",
    );
    // One language: the Russian UI names the form in Russian (QA B3-03).
    expect(labels.title).toBe("Ramipril · 5 mg · Таблетки");
    expect(labels.status).toBe("Активно");
  });

  it("shows an allergy's severity, translated or as entered (QA round 3 B-26b)", () => {
    const allergy = (status: string) =>
      patientTimelineItemLabels(
        {
          entity_type: "clinical",
          category: "allergy",
          title: "Penicillin · Exanthem",
          status,
          source_label: "allergie",
        },
        l,
        statusLabel,
        "ru",
      ).status;
    expect(allergy("средняя")).toBe("Средняя");
    expect(allergy("severe")).toBe("Тяжёлая");
    expect(allergy("nur bei Hautkontakt")).toBe("nur bei Hautkontakt");
    expect(allergy("active")).toBe("Активно");
    expect(allergy("средняя")).not.toBe("Неизвестное значение");
  });

  it("names the workflow stage of a process task (QA round 3 B-26b)", () => {
    const task = patientTimelineItemLabels(
      {
        entity_type: "workflow_task",
        category: "order_discovery",
        title: "Подготовить шорт-лист клиник",
        status: "open",
        source_label: "PM Muster · patient_manager",
      },
      l,
      statusLabel,
      "ru",
    );
    expect(task.category).toBe(ru.timeline_source_order_discovery);
    expect(task.category).not.toMatch(/Order Discovery/);
    const de = translateCatalog("de").uiText;
    const german = patientTimelineItemLabels(
      {
        entity_type: "workflow_task",
        category: "order_discovery",
        title: "Shortlist",
        status: "open",
        source_label: null,
      },
      (key) => de[key] ?? key,
      statusLabel,
      "de",
    );
    expect(german.category).toBe(de.timeline_source_order_discovery);
  });

  it("reads a clinical summary row without an unknown status or a German title", () => {
    const labels = patientTimelineItemLabels(
      {
        entity_type: "clinical",
        category: "clinical",
        title: "Allergien/CAVE aktualisiert",
        status: "recorded",
        source_label: "CEO Muster",
      },
      l,
      statusLabel,
    );
    expect(labels.title).toBe("Аллергии/CAVE обновлены");
    expect(labels.status).toBe("Записано");
    expect(labels.source).toBe("CEO Muster");
  });

  it("names a relation by its type and an invoice by its kind", () => {
    const relation = patientTimelineItemLabels(
      {
        entity_type: "relation",
        category: "relation",
        title: "Beispiel GmbH",
        status: "active",
        source_label: "other",
      },
      l,
      statusLabel,
    );
    expect(relation.category).toBe("Связь");
    expect(relation.source).toBe("Другая связь");
    const invoice = patientTimelineItemLabels(
      {
        entity_type: "invoice",
        category: "advance",
        title: "INV-1",
        status: "sent",
        source_label: null,
      },
      l,
      statusLabel,
    );
    expect(invoice.category).toBe("Авансовый счёт");
  });
});
