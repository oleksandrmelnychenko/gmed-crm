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
    );
    expect(labels.title).toBe("Ramipril · 5 mg · Tabletten");
    expect(labels.status).toBe("Активно");
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
