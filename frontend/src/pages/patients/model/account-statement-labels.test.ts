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

  it("labels a supplier invoice that an order service bills as a GMED cost", () => {
    expect(accountStatementStateLabel("order_service_cost", "ru")).toBe(
      "Расход GMED — пациенту выставляется услуга заказа",
    );
  });

  it("labels a supplier cost GMED bears instead of re-billing it", () => {
    expect(accountStatementStateLabel("rebilling_waived", "ru")).toBe(
      "За счёт GMED — не перевыставляется",
    );
    expect(accountStatementStateLabel("rebilling_waived", "de")).toBe(
      "Trägt GMED – nicht weiterberechnet",
    );
    expect(
      accountMovementKindLabel({ kind: "external_rebilling_waived", description: "Kulanz" }, "ru"),
    ).toBe("Расход за счёт GMED");
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

  it("shows allocations, reversals and German correction texts in the UI language (QA D2-05)", () => {
    expect(localizeFinancialDescription("External provider -> INV-20261012-0010", "ru")).toBe(
      "Внешний поставщик → INV-20261012-0010",
    );
    expect(localizeFinancialDescription("Muster Labor GmbH -> INV-20261012-0010", "de")).toBe(
      "Muster Labor GmbH → INV-20261012-0010",
    );
    expect(
      localizeFinancialDescription("Rechnungskorrektur (Gutschrift) zu INV-20261012-0010", "ru"),
    ).toBe("Кредит-нота к счёту INV-20261012-0010");
    expect(
      localizeFinancialDescription("Rechnungskorrektur (Gutschrift) zu INV-20261012-0010", "de"),
    ).toBe("Rechnungskorrektur (Gutschrift) zu INV-20261012-0010");
    expect(localizeFinancialDescription("Cancellation of invoice INV-1", "ru")).toBe("Отмена счёта INV-1");
    expect(
      localizeFinancialDescription(
        "Restbetrag der Anzahlungsrechnung INV-3 – abgerechnet mit der Schlussrechnung INV-4",
        "ru",
      ),
    ).toBe("Остаток авансового счёта INV-3 — закрыт финальным счётом INV-4");
    expect(localizeFinancialDescription("External receivable allocation reversed", "ru")).toBe(
      "Распределение внешнего долга сторнировано",
    );
    // A waiver's reason is staff text: shown as written.
    expect(localizeFinancialDescription("Kulanz, Labor trägt GMED", "ru")).toBe("Kulanz, Labor trägt GMED");
  });
});
