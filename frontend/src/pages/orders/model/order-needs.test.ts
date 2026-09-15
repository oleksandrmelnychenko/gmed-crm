import { describe, expect, it } from "vitest";

import { summarizeOrderNeeds } from "./order-needs";

describe("summarizeOrderNeeds", () => {
  it("separates the concern, requested services, comments and interpreter need", () => {
    expect(summarizeOrderNeeds([
      "Причина обращения",
      "Запрошенные услуги: Услуги водителя и трансфер, Поддержка переводчика",
      "Комментарии к услугам:",
      "- Услуги водителя и трансфер: Встреча в аэропорту",
      "- Поддержка переводчика: Немецкий язык",
      "Нужен переводчик",
      "Желаемый срок: В течение месяца",
    ].join("\n"))).toEqual({
      primaryNeed: "Причина обращения",
      services: [
        { name: "Услуги водителя и трансфер", note: "Встреча в аэропорту" },
        { name: "Поддержка переводчика", note: "Немецкий язык" },
      ],
      facts: [{ label: "Желаемый срок", value: "В течение месяца" }],
      interpreterRequired: true,
      additionalNotes: [],
    });
  });

  it("keeps ordinary extra lines visible", () => {
    expect(summarizeOrderNeeds("Primary need\nAdditional context")).toMatchObject({
      primaryNeed: "Primary need",
      additionalNotes: ["Additional context"],
    });
  });
});
