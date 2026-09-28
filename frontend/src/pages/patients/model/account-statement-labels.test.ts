import { describe, expect, it } from "vitest";

import {
  accountMovementKindLabel,
  accountStatementKindLabel,
  accountStatementStateLabel,
  localizeFinancialDescription,
} from "./account-statement-labels";

describe("accountStatementKindLabel", () => {
  it("labels credit notes and their reversals (a patient with a credit note crashed the tab)", () => {
    expect(accountStatementKindLabel("credit_note", "ru")).toBe("Кредит-нота");
    expect(accountStatementKindLabel("credit_note_reversal", "de")).toBe("Gutschriftstorno");
  });

  it("falls back to the raw kind instead of throwing", () => {
    expect(accountStatementKindLabel("something_new", "ru")).toBe("something_new");
  });
});

describe("accountStatementStateLabel", () => {
  it("labels a corrected invoice", () => {
    expect(accountStatementStateLabel("invoice_adjustment", "ru")).toBe("Счёт скорректирован");
  });
});

describe("credit transfers in the statement", () => {
  it("names both legs a credit transfer, not a refund or a cash payment", () => {
    expect(
      accountMovementKindLabel(
        { kind: "refund", description: "Credit applied to invoice INV-20260928-0010" },
        "ru",
      ),
    ).toBe("Перенос переплаты");
    expect(
      accountMovementKindLabel(
        { kind: "payment", description: "Credit from invoice INV-20260928-0009" },
        "de",
      ),
    ).toBe("Guthabenumbuchung");
    expect(accountMovementKindLabel({ kind: "refund", description: "Rückzahlung" }, "ru")).toBe(
      "Возврат пациенту",
    );
  });

  it("translates the server descriptions of both legs", () => {
    expect(
      localizeFinancialDescription("Credit applied to invoice INV-20260928-0010", "ru"),
    ).toBe("Переплата зачтена в счёт INV-20260928-0010");
    expect(localizeFinancialDescription("Credit from invoice INV-20260928-0009", "de")).toBe(
      "Guthaben aus Rechnung INV-20260928-0009",
    );
    expect(localizeFinancialDescription("Payment received", "ru")).toBe("Оплата получена");
  });

  it("does not show technical ledger descriptions", () => {
    expect(localizeFinancialDescription("invoice_payment payment INV-20260928-0009", "ru")).toBe(
      "Оплата по счёту INV-20260928-0009",
    );
    expect(localizeFinancialDescription("invoice_refund refund INV-20260928-0009", "de")).toBe(
      "Erstattung zu Rechnung INV-20260928-0009",
    );
  });
});
