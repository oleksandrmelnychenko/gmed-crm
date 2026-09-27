import { describe, expect, it } from "vitest";

import {
  calculateInvoiceSelectionTotals,
  blankCreateForm,
  createInvoiceLineSelection,
  invoiceLineQuantityAvailable,
  isInvoiceSelectionValid,
  isQuoteAvailableForInvoice,
  isQuoteClosedForInvoicing,
  isCoveredByPrepaymentOnly,
  formatCurrency,
  formatDate,
  formatDateTime,
  canEditInvoiceDueDate,
  canPickInvoiceStatus,
  defaultReleaseDueDate,
  dunningLetterFileName,
  invoiceDisplayNumber,
  invoiceDocumentState,
  invoiceStatusFormProblem,
  isInvoiceReleased,
  invoiceRecipientAddressLines,
  payerFormToPayload,
  payerRelationOptionLabel,
  effectiveAdvanceBasis,
  netForGross,
  prepaymentAdvanceSplit,
  quoteRequiredPrepayment,
} from "./invoice-model";
import type { InvoiceLineItem, QuoteOption } from "./types";

it("calls an invoice covered by prepayment only when the credited advance settled it", () => {
  // 1,000 final invoice, 300 advance credited, 700 still open: not covered.
  expect(isCoveredByPrepaymentOnly({ paid_amount: "0", prepayment_applied_amount: "300", balance_due: "700" })).toBe(false);
  expect(isCoveredByPrepaymentOnly({ paid_amount: "0", prepayment_applied_amount: "1000", balance_due: "0" })).toBe(true);
  expect(isCoveredByPrepaymentOnly({ paid_amount: "0", prepayment_applied_amount: "0", balance_due: "0" })).toBe(false);
  expect(isCoveredByPrepaymentOnly({ paid_amount: "200", prepayment_applied_amount: "800", balance_due: "0" })).toBe(false);
});

it("formats both date-only values and timestamps as a date", () => {
  expect(formatDate("2026-10-01", "de-DE")).toBe(formatDate("2026-10-01T12:00:00", "de-DE"));
  expect(formatDate("2026-09-25T12:00:00+00:00", "de-DE")).not.toContain("T");
  expect(formatDate("2026-09-25T12:00:00+00:00", "de-DE")).toContain("2026");
  expect(formatDate(null, "de-DE", "—")).toBe("—");
});

it("formats dates and timestamps on their Berlin day", () => {
  expect(formatDate("2026-09-27", "de-DE")).toBe("27. Sept. 2026");
  // 23:30 in Berlin, already 28 Sep in Kyiv.
  expect(formatDate("2026-09-27T21:30:00Z", "de-DE")).toBe("27. Sept. 2026");
  // 00:30 in Berlin, still 27 Sep in UTC.
  expect(formatDate("2026-09-27T22:30:00Z", "de-DE")).toBe("28. Sept. 2026");
  expect(formatDateTime("2026-09-27T21:30:00Z", "de-DE")).toBe("27. Sept. 2026, 23:30");
});

describe("invoice release and numbering", () => {
  const today = new Date("2026-09-27T10:00:00Z");

  it("never offers a way back to draft once an invoice is released", () => {
    expect(canPickInvoiceStatus("draft", "sent")).toBe(true);
    expect(canPickInvoiceStatus("draft", "cancelled")).toBe(true);
    expect(canPickInvoiceStatus("sent", "draft")).toBe(false);
    expect(canPickInvoiceStatus("overdue", "draft")).toBe(false);
    expect(canPickInvoiceStatus("sent", "cancelled")).toBe(true);
  });

  it("labels drafts without a number and tells released invoices apart", () => {
    expect(invoiceDisplayNumber({ invoice_number: null }, "Entwurf")).toBe("Entwurf");
    expect(invoiceDisplayNumber({ invoice_number: "INV-20260927-0042" }, "Entwurf")).toBe(
      "INV-20260927-0042",
    );
    expect(isInvoiceReleased({ status: "cancelled", released_at: null })).toBe(false);
    expect(isInvoiceReleased({ status: "cancelled", released_at: "2026-09-27T10:00:00Z" })).toBe(true);
    expect(isInvoiceReleased({ status: "sent" })).toBe(true);
  });

  it("requires a due date on or after the invoice date when releasing", () => {
    const draft = { status: "draft", released_at: null, due_date: null };
    expect(invoiceStatusFormProblem(draft, { status: "sent", dueDate: "2026-09-26" }, today)).toBe(
      "due_date_before_invoice_date",
    );
    expect(invoiceStatusFormProblem(draft, { status: "sent", dueDate: "2026-09-27" }, today)).toBeNull();
    expect(invoiceStatusFormProblem(draft, { status: "sent", dueDate: "" }, today)).toBeNull();
    // Only the release checks the date; a draft may keep an old one until then.
    expect(invoiceStatusFormProblem(draft, { status: "draft", dueDate: "2026-09-01" }, today)).toBeNull();
    expect(defaultReleaseDueDate(today)).toBe("2026-10-11");
  });

  it("takes the invoice date from the Berlin calendar", () => {
    const draft = { status: "draft", released_at: null, due_date: null };
    // 00:30 on 28 Sep in Berlin while UTC still shows 27 Sep.
    const afterBerlinMidnight = new Date("2026-09-27T22:30:00Z");
    expect(
      invoiceStatusFormProblem(draft, { status: "sent", dueDate: "2026-09-27" }, afterBerlinMidnight),
    ).toBe("due_date_before_invoice_date");
    expect(defaultReleaseDueDate(afterBerlinMidnight)).toBe("2026-10-12");
    // 23:30 on 27 Sep in Berlin while Kyiv already shows 28 Sep.
    const beforeBerlinMidnight = new Date("2026-09-27T21:30:00Z");
    expect(
      invoiceStatusFormProblem(draft, { status: "sent", dueDate: "2026-09-27" }, beforeBerlinMidnight),
    ).toBeNull();
    expect(defaultReleaseDueDate(beforeBerlinMidnight)).toBe("2026-10-11");
  });

  it("tells a draft preview from the archived document", () => {
    expect(invoiceDocumentState({ status: "draft", released_at: null })).toBe("draft_preview");
    expect(
      invoiceDocumentState({
        status: "sent",
        released_at: "2026-09-27T10:00:00Z",
        stored_document: {
          file_name: "RECHNUNG-INV-1.pdf",
          sha256: "0".repeat(64),
          generation_trigger: "release",
          generated_at: "2026-09-27T10:00:00Z",
        },
      }),
    ).toBe("archived");
    expect(
      invoiceDocumentState({ status: "paid", released_at: "2026-01-02T10:00:00Z", stored_document: null }),
    ).toBe("archived_on_first_download");
  });

  it("keeps the due date of a released invoice", () => {
    const released = { status: "sent", released_at: "2026-09-20T10:00:00Z", due_date: "2026-10-04" };
    expect(invoiceStatusFormProblem(released, { status: "sent", dueDate: "2026-10-30" }, today)).toBe(
      "due_date_locked",
    );
    expect(invoiceStatusFormProblem(released, { status: "overdue", dueDate: "2026-10-04" }, today)).toBeNull();
    expect(canEditInvoiceDueDate(released)).toBe(false);
    expect(canEditInvoiceDueDate({ ...released, due_date: null })).toBe(true);
    expect(canEditInvoiceDueDate({ status: "draft", released_at: null, due_date: "2026-10-04" })).toBe(true);
  });
});

describe("dunning letters", () => {
  it("names the letter by its level unless the stored name is known", () => {
    expect(dunningLetterFileName({ level: "first", letter: null }, "INV-20260927-0042")).toBe(
      "ZAHLUNGSERINNERUNG-INV-20260927-0042.pdf",
    );
    expect(dunningLetterFileName({ level: "second" }, "INV/1")).toBe("1-MAHNUNG-INV-1.pdf");
    expect(dunningLetterFileName({ level: "collections" }, null)).toBe("2-MAHNUNG-RECHNUNG.pdf");
    expect(
      dunningLetterFileName(
        { level: "first", letter: { file_name: "stored.pdf", generated_at: null } },
        "INV-1",
      ),
    ).toBe("stored.pdf");
  });
});

describe("invoice payer and recipient", () => {
  it("sends the payer relation and address with blank fields cleared", () => {
    expect(
      payerFormToPayload({
        payerPatientRelationId: "",
        contactName: "  Ivan Payer ",
        contactEmail: "",
        contactPhone: " ",
        contactRelationship: "father",
        addressStreet: "Kyivska 5",
        addressZip: "01001",
        addressCity: " Kyiv ",
        addressCountry: "",
        notes: "",
      }),
    ).toEqual({
      payer_patient_relation_id: null,
      payer_contact_name: "Ivan Payer",
      payer_contact_email: null,
      payer_contact_phone: null,
      payer_contact_relationship: "father",
      payer_address_street: "Kyivska 5",
      payer_address_zip: "01001",
      payer_address_city: "Kyiv",
      payer_address_country: null,
      payer_notes: null,
    });
  });

  it("labels a relative offered as payer by name, relation and patient number", () => {
    const relationLabel = (value: string) => (value === "parent" ? "Parent" : value);
    expect(
      payerRelationOptionLabel(
        {
          id: "r1",
          related_name: "Dad",
          relation_type: "parent",
          related_patient_name: "Otto Muster",
          related_patient_pid: "PT-7",
          has_address: true,
        },
        relationLabel,
      ),
    ).toBe("Otto Muster (Parent, PT-7)");
    expect(
      payerRelationOptionLabel(
        { id: "r2", related_name: "Aunt", relation_type: "relative", has_address: false },
        relationLabel,
      ),
    ).toBe("Aunt (relative)");
  });

  it("prints the recipient address as street, postcode with city and country", () => {
    expect(
      invoiceRecipientAddressLines({
        name: "Ivan Payer",
        street: "Kyivska 5",
        zip: "01001",
        city: "Kyiv",
        country: "Ukraine",
        is_payer: true,
        has_postal_address: true,
      }),
    ).toEqual(["Kyivska 5", "01001 Kyiv", "Ukraine"]);
    expect(
      invoiceRecipientAddressLines({
        name: "X",
        city: "Kyiv",
        is_payer: false,
        has_postal_address: false,
      }),
    ).toEqual(["Kyiv"]);
  });
});

it("formats the invoice currency without converting or relabelling the amount", () => {
  expect(formatCurrency("1234.56", "de-DE", "USD")).toBe("1.234,56 $");
  expect(formatCurrency("1234.56", "ru-RU", "EUR")).toBe("1.234,56 €");
});

function line(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    description: "Service",
    quantity: "2",
    unit_price: "100",
    vat_rate: "19",
    is_cost_passthrough: false,
    line_net: "200",
    line_vat: "38",
    line_gross: "238",
    ...overrides,
  };
}

describe("quotes available for invoicing", () => {
  const quote: QuoteOption = { id: "quote", order_id: "order", order_number: "A-1", patient_id: "patient", patient_name: "Test", patient_pid: "P-1", quote_number: "KV-1", total_gross: "238", status: "accepted", line_items: [line()] };

  it("hides fully billed scope, including paid final invoices, for every invoice type", () => {
    for (const type of ["advance", "interim", "final"] as const) {
      expect(isQuoteAvailableForInvoice({ ...quote, line_items: [line({ remaining_quantity: "0" })] }, type)).toBe(false);
      expect(isQuoteAvailableForInvoice({ ...quote, active_invoice_types: ["final"] }, type)).toBe(false);
    }
  });

  it("keeps a settlement after a paid advance but prevents a second advance", () => {
    const prepaid = { ...quote, active_invoice_types: ["advance"] };
    expect(isQuoteAvailableForInvoice(prepaid, "final")).toBe(true);
    expect(isQuoteAvailableForInvoice(prepaid, "interim")).toBe(true);
    expect(isQuoteAvailableForInvoice(prepaid, "advance")).toBe(false);
  });

  it("keeps remaining interim quantities and reopened scope after cancellation", () => {
    expect(isQuoteAvailableForInvoice({ ...quote, active_invoice_types: ["interim"], line_items: [line({ remaining_quantity: "0.5" })] }, "final")).toBe(true);
    expect(isQuoteAvailableForInvoice({ ...quote, active_invoice_types: [] }, "final")).toBe(true);
  });

  it("excludes rejected, expired and lead-only quotes", () => {
    for (const status of ["rejected", "expired"]) expect(isQuoteAvailableForInvoice({ ...quote, status }, "final")).toBe(false);
    expect(isQuoteAvailableForInvoice({ ...quote, patient_id: "" }, "final")).toBe(false);
  });

  it("excludes a quote superseded by a newer quote of the order for every invoice type", () => {
    // Even with remaining quantity and only an advance issued, nothing more is
    // invoiced from it; the advance is credited on the newer quote's invoice.
    const superseded = { ...quote, status: "superseded", active_invoice_types: ["advance"] };
    for (const type of ["advance", "interim", "final"] as const) {
      expect(isQuoteAvailableForInvoice(superseded, type)).toBe(false);
    }
    expect(isQuoteClosedForInvoicing("superseded")).toBe(true);
    for (const status of ["draft", "sent", "accepted", undefined]) {
      expect(isQuoteClosedForInvoicing(status)).toBe(false);
    }
  });
});

describe("invoice creation totals", () => {
  it("shows net, VAT and gross for the actually selected quantities", () => {
    expect(
      calculateInvoiceSelectionTotals(
        [line(), line({ unit_price: "50", vat_rate: "7" })],
        [0, 1],
        { "0": "0.5", "1": "1" },
      ),
    ).toEqual({
      net: 100,
      vat: 13,
      gross: 113,
      lineGrossByIndex: { 0: 59.5, 1: 53.5 },
    });
  });

  it("rounds VAT midpoints half up like the server invoice (2.5 h x 95 EUR = 282.63)", () => {
    expect(
      calculateInvoiceSelectionTotals(
        [line({ quantity: "2.5", unit_price: "95" })],
        [0],
        { "0": "2.5" },
      ),
    ).toEqual({
      net: 237.5,
      vat: 45.13,
      gross: 282.63,
      lineGrossByIndex: { 0: 282.63 },
    });
  });

  it("uses the full quoted scope for an advance and the remaining scope for settlements", () => {
    const quoteLine = line({ quantity: "3", remaining_quantity: "1" });
    expect(invoiceLineQuantityAvailable(quoteLine, "advance")).toBe(3);
    expect(invoiceLineQuantityAvailable(quoteLine, "interim")).toBe(1);
    expect(invoiceLineQuantityAvailable(quoteLine, "final")).toBe(1);
  });
});

describe("invoice creation selection", () => {
  const lines = [line({ quantity: "3", remaining_quantity: "1" }), line({ remaining_quantity: "0" })];

  it("initializes final invoices with only the remaining quantities", () => {
    expect(createInvoiceLineSelection(lines, "final")).toEqual({
      selectedLineIndexes: [0], lineQuantities: { "0": "1", "1": "0" },
    });
    expect(createInvoiceLineSelection(lines, "advance")).toEqual({
      selectedLineIndexes: [0, 1], lineQuantities: { "0": "3", "1": "2" },
    });
  });

  it.each(["", "0", "-1", "1.01", "NaN", "Infinity"])("rejects an invalid selected quantity: %s", (quantity) => {
    expect(isInvoiceSelectionValid(lines, {
      ...blankCreateForm("quote"), invoiceType: "interim", selectedLineIndexes: [0], lineQuantities: { "0": quantity },
    })).toBe(false);
  });

  it("allows partial interim quantities but requires the full remainder for final invoices", () => {
    const form = { ...blankCreateForm("quote"), selectedLineIndexes: [0], lineQuantities: { "0": "0.5" } };
    expect(isInvoiceSelectionValid(lines, { ...form, invoiceType: "interim" })).toBe(true);
    expect(isInvoiceSelectionValid(lines, form)).toBe(false);
    expect(isInvoiceSelectionValid(lines, { ...form, lineQuantities: { "0": "1" } })).toBe(true);
  });

  it("rejects a final invoice missing a remaining line", () => {
    expect(isInvoiceSelectionValid([line(), line()], {
      ...blankCreateForm("quote"), selectedLineIndexes: [0], lineQuantities: { "0": "2" },
    })).toBe(false);
  });

  it("rejects unavailable, duplicate and nonexistent selections", () => {
    for (const selectedLineIndexes of [[], [1], [0, 0], [5]]) {
      expect(isInvoiceSelectionValid(lines, {
        ...blankCreateForm("quote"), invoiceType: "interim", selectedLineIndexes,
        lineQuantities: { "0": "1", "1": "1", "5": "1" },
      })).toBe(false);
    }
  });
});

describe("prepayment advance invoices", () => {
  const quoteLine = (lineGross: string, vatRate: string, isCostPassthrough = false) => ({
    description: "Service",
    quantity: "1",
    unit_price: lineGross,
    vat_rate: vatRate,
    is_cost_passthrough: isCostPassthrough,
    line_net: lineGross,
    line_vat: "0",
    line_gross: lineGross,
  }) as InvoiceLineItem;
  const quote = (orderPrepaymentAmount: string | null) => ({
    id: "quote",
    order_id: "order",
    order_number: "A-1",
    patient_id: "patient",
    patient_name: "Patient",
    patient_pid: "P-1",
    quote_number: "Q-1",
    total_gross: "669",
    order_prepayment_amount: orderPrepaymentAmount,
    line_items: [quoteLine("550", "0"), quoteLine("119", "19")],
  }) as QuoteOption;

  it("offers the order's required prepayment and falls back to positions without one", () => {
    expect(quoteRequiredPrepayment(quote("500"))).toBe(500);
    expect(quoteRequiredPrepayment(quote(null))).toBeNull();
    const form = { ...blankCreateForm("quote"), invoiceType: "advance" as const };
    expect(effectiveAdvanceBasis(form, quote("500"))).toBe("prepayment");
    expect(effectiveAdvanceBasis({ ...form, advanceBasis: "positions" }, quote("500"))).toBe("positions");
    expect(effectiveAdvanceBasis(form, quote(null))).toBe("positions");
    expect(effectiveAdvanceBasis({ ...form, invoiceType: "final" }, quote("500"))).toBeNull();
  });

  it("splits the prepayment over the quote's VAT groups like the server", () => {
    const split = prepaymentAdvanceSplit(quote("500").line_items, 500);
    expect(split.lines).toEqual([
      { vatRate: 0, isCostPassthrough: false, net: 411.06, vat: 0, gross: 411.06 },
      { vatRate: 19, isCostPassthrough: false, net: 74.74, vat: 14.2, gross: 88.94 },
    ]);
    expect(split.gross).toBe(500);
    expect(split.exceedsQuote).toBe(false);
    expect(prepaymentAdvanceSplit(quote("500").line_items, 1000).exceedsQuote).toBe(true);
  });

  it("hits the agreed gross with a cent-exact net", () => {
    expect(netForGross(150, 19)).toBe(126.05);
    expect(netForGross(550, 0)).toBe(550);
  });
});
