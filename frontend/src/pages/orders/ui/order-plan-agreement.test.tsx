import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPlanAgreement, PlanAgreementSteps } from "./order-plan-agreement";
import { OutsideQuoteWarning } from "./order-planned-appointments";

describe("plan agreement controls", () => {
  it("offers the patient's answer once the plan was sent", () => {
    const ru = renderToStaticMarkup(
      <PlanAgreementSteps status="sent" lang="ru" busy={false} onStep={() => {}} />,
    );
    expect(ru).toContain("Пациент согласовал");
    expect(ru).toContain("Нужна корректировка");
    expect(ru).not.toContain("Зафиксировать план");

    const de = renderToStaticMarkup(
      <PlanAgreementSteps status="draft" lang="de" busy onStep={() => {}} />,
    );
    expect(de).toContain("Als an Patienten gesendet markieren");
    expect(de).toContain('disabled=""');
  });

  it("names who set the status and warns about visits added after it", () => {
    const html = renderToStaticMarkup(
      <OrderPlanAgreement
        orderId="o-1"
        patientId="p-1"
        lang="ru"
        status="finalized"
        note={null}
        statusUpdatedAt="2026-11-02T13:49:00Z"
        statusUpdatedByName="Petra Planer"
        appointmentsLastAddedAt="2026-11-02T15:00:00Z"
        canEdit={false}
        reloadNonce={0}
        onChanged={() => {}}
      />,
    );
    expect(html).toContain("Статус установил Petra Planer 02.11.2026 14:49");
    expect(html).toContain("После статуса «Финализировано» в план добавлены приёмы");
    // Without a PDF there is nothing stale to refresh.
    expect(html).not.toContain("обновите PDF");

    const draft = renderToStaticMarkup(
      <OrderPlanAgreement
        orderId="o-1"
        patientId="p-1"
        lang="ru"
        status="draft"
        note={null}
        statusUpdatedAt="2026-11-02T13:49:00Z"
        appointmentsLastAddedAt="2026-11-02T15:00:00Z"
        canEdit={false}
        reloadNonce={0}
        onChanged={() => {}}
      />,
    );
    expect(draft).not.toContain("Статус установил");
    expect(draft).not.toContain('data-testid="order-plan-changed"');
  });

  it("warns about a doctor outside the signed quote", () => {
    expect(renderToStaticMarkup(<OutsideQuoteWarning lang="ru" />)).toContain(
      "Врача нет в подписанном КВ — при завершении приёма появится новая строка счёта",
    );
    expect(renderToStaticMarkup(<OutsideQuoteWarning lang="de" />)).toContain(
      "Arzt nicht im unterschriebenen KV",
    );
  });
});
