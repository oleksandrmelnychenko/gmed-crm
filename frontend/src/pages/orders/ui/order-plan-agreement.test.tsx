import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanAgreementSteps } from "./order-plan-agreement";
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

  it("warns about a doctor outside the signed quote", () => {
    expect(renderToStaticMarkup(<OutsideQuoteWarning lang="ru" />)).toContain(
      "Врача нет в подписанном КВ — при завершении приёма появится новая строка счёта",
    );
    expect(renderToStaticMarkup(<OutsideQuoteWarning lang="de" />)).toContain(
      "Arzt nicht im unterschriebenen KV",
    );
  });
});
