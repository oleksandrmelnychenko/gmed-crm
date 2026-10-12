import { describe, expect, it } from "vitest";

import { debtRecheckCopy } from "./debt-recheck";

describe("debt line of the re-check (QA D2-08)", () => {
  it("never says 'no overdue debt' next to an overdue invoice", () => {
    const copy = debtRecheckCopy(
      1,
      [
        {
          invoice_number: "INV-20261012-0006",
          due_date: "2026-09-22",
          recipient_name: "Beispiel GmbH",
          billed_to_patient: false,
          balance_due: "214.2",
        },
      ],
      "ru",
    );
    expect(copy.overdue).toBe(true);
    expect(copy.label).toBe("Просрочено счетов: 1");
    expect(copy.summary).toContain("Есть просроченные счета: 1");
    expect(copy.summary).not.toContain("не найдено");
    expect(copy.badge).toBe("Не блокирует");
    expect(copy.invoices[0]).toContain("Beispiel GmbH (сторонний плательщик)");
    expect(copy.invoices[0]).toMatch(/214,20\s€/);
  });

  it("says there is none only when no invoice is overdue", () => {
    const copy = debtRecheckCopy(0, [], "de");
    expect(copy.overdue).toBe(false);
    expect(copy.summary).toBe("Keine überfälligen Forderungen erkannt.");
    expect(copy.invoices).toEqual([]);
  });
});
