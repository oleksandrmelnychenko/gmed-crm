import { describe, expect, it } from "vitest";

import { billingSourceLabel } from "./billing-source";

const reportId = "6b37536f-f492-40a8-ba01-7405d8629e92";
const visitId = "12d3e355-d43f-4189-9c6e-d9cb249d8c48";

describe("billing source of an order line (QA C3-11)", () => {
  it("names the interpreter report by hours and visit, never by id", () => {
    const label = billingSourceLabel({
      source_interpreter_report_id: reportId,
      source_report_hours: "1.5",
      source_appointment_title: "Kardiologie",
      source_appointment_date: "2026-10-12",
    }, "ru");
    expect(label).toBe("Отчёт переводчика · 1,5 ч · Kardiologie · 12.10.2026");
    expect(label).not.toContain(reportId);
    expect(billingSourceLabel({ source_interpreter_report_id: reportId, source_report_hours: "2" }, "de"))
      .toBe("Dolmetscherbericht · 2 Std.");
  });

  it("names the completed visit by title and date, the date alone without medical access", () => {
    expect(billingSourceLabel({
      source_medical_appointment_id: visitId,
      source_appointment_title: "Kardiologie",
      source_appointment_date: "2026-10-12",
    }, "ru")).toBe("Завершённый приём · Kardiologie · 12.10.2026");
    const withoutTitle = billingSourceLabel({
      source_medical_appointment_id: visitId,
      source_appointment_date: "2026-10-12",
    }, "de");
    expect(withoutTitle).toBe("Abgeschlossener Termin · 12.10.2026");
    expect(withoutTitle).not.toContain(visitId);
  });

  it("names amendments and manual lines", () => {
    expect(billingSourceLabel({ source_order_amendment_id: "a-1" }, "ru")).toBe("Одобренное изменение суммы");
    expect(billingSourceLabel({}, "ru")).toBe("Вручную или через провайдера");
  });
});
