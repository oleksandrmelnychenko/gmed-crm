import { describe, expect, it } from "vitest";

import { ApiRequestError, isLocalizedApiError } from "./api";
import { t } from "./i18n";
import { ORDER_API_ERROR_KEYS } from "./order-api-errors";

describe("order, contract, quote and catalogue error codes", () => {
  it("have a German and a Russian text for every code", () => {
    for (const [code, key] of Object.entries(ORDER_API_ERROR_KEYS)) {
      expect(t("de").uiText[key], `${code} (de)`).toBeTruthy();
      expect(t("ru").uiText[key], `${code} (ru)`).toBeTruthy();
    }
  });

  it("names the order total of a refused prepayment", () => {
    expect(t("ru").uiText.api_orders_prepayment_exceeds_order_total).toContain("{order_total_label}");
    expect(t("de").uiText.api_orders_prepayment_exceeds_order_total).toContain("{order_total_label}");
  });

  it("recognises an error whose message is already translated", () => {
    const coded = new ApiRequestError("Предоплата не может превышать текущую сумму заказа (889,15 €).", {
      status: 422,
      code: "prepayment_exceeds_order_total",
      body: { error: "prepayment_exceeds_order_total" },
    });
    expect(isLocalizedApiError(coded)).toBe(true);
    const raw = new ApiRequestError("Insufficient permissions", {
      status: 403,
      code: "Forbidden",
      body: { error: "Forbidden", message: "Insufficient permissions" },
    });
    expect(isLocalizedApiError(raw)).toBe(false);
  });
});
