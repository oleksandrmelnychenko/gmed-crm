import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { companyFinanceErrorCode, localizeCompanyFinanceError } from "./errors";

function apiError(
  status: number,
  body: { error?: string; message?: string; [key: string]: unknown },
) {
  // apiFetch puts `message` (else `error`) into the Error text.
  return new ApiRequestError(body.message ?? body.error ?? "", {
    status,
    code: body.error ?? "http_error",
    body,
  });
}

describe("localizeCompanyFinanceError", () => {
  it("translates the read-only refusal instead of showing 'Insufficient permissions'", () => {
    const error = apiError(403, { error: "Insufficient permissions" });
    expect(localizeCompanyFinanceError(error, "ru", "x")).toBe(
      "Недостаточно прав: ваша роль может только просматривать «Баланс компании».",
    );
    expect(localizeCompanyFinanceError(error, "de", "x")).toContain("Keine Berechtigung");
  });

  it("names the available cash when a cash box would go below zero", () => {
    const error = apiError(422, {
      error: "cash_account_insufficient_balance",
      message: "A cash account cannot go below zero",
      available_balance: "50",
    });
    expect(companyFinanceErrorCode(error)).toBe("cash_account_insufficient_balance");
    expect(localizeCompanyFinanceError(error, "ru", "x")).toBe(
      "Касса не может уйти в минус. Доступно: 50,00 €.",
    );
    expect(localizeCompanyFinanceError(error, "de", "x")).toBe(
      "Eine Kasse kann nicht ins Minus gehen. Verfügbar: 50,00 €.",
    );
  });

  it("asks to confirm a bank transfer into the red with the balance after it", () => {
    const error = apiError(409, {
      error: "account_negative_balance_confirmation_required",
      message: "The transfer takes the source account below zero; confirm to record it",
      available_balance: "150",
      balance_after: "-50",
    });
    expect(localizeCompanyFinanceError(error, "ru", "x")).toBe(
      "После перевода счёт уйдёт в минус (-50,00 €). Подтвердите перевод.",
    );
  });

  it("translates known server texts and keeps unknown ones", () => {
    expect(
      localizeCompanyFinanceError(new Error("Transfer date cannot be in the future"), "de", "x"),
    ).toBe("Das Datum der Umbuchung darf nicht in der Zukunft liegen.");
    expect(localizeCompanyFinanceError(new Error("Something new"), "ru", "x")).toBe("Something new");
    expect(localizeCompanyFinanceError(null, "ru", "Ошибка")).toBe("Ошибка");
  });
});
