import { describe, expect, it } from "vitest";

import {
  advanceSplitPreview,
  amountsForGross,
  advanceSplitProblem,
  defaultSplitForm,
  draftFormDirty,
  draftFormFrom,
  draftLinesProblem,
  draftKeptServices,
  draftLinesTotal,
  draftOwnServicesTotal,
  draftUpdatePayload,
  draftFinalLineComparison,
  draftFinalSummary,
  isFinalDraft,
  linePartAmounts,
  type DraftEditorPayload,
} from "./draft-editor";

const positions: DraftEditorPayload = {
  invoice_id: "inv-1",
  invoice_type: "interim",
  due_date: null,
  notes: "Bitte überweisen",
  lines_mode: "quote_positions",
  lines_locked_reason: null,
  quote_lines: [
    {
      line_index: 0,
      description: "Quartalsbetreuung",
      unit: null,
      unit_price: "100",
      vat_rate: "19",
      is_cost_passthrough: false,
      quoted_quantity: "2",
      open_quantity: "2",
      selected_quantity: "1",
      comment: null,
    },
    {
      line_index: 1,
      description: "Terminorganisation",
      unit: null,
      unit_price: "50",
      vat_rate: "19",
      is_cost_passthrough: false,
      quoted_quantity: "1",
      open_quantity: "1",
      selected_quantity: null,
      comment: null,
    },
  ],
  advance: null,
};

const advance: DraftEditorPayload = {
  invoice_id: "inv-2",
  invoice_type: "advance",
  due_date: "2026-12-01",
  notes: null,
  lines_mode: "advance_split",
  lines_locked_reason: null,
  quote_lines: [],
  advance: {
    amount_gross: "200",
    allocation: "own_services_first",
    default_split: ["119", "81"],
    groups: [
      { is_cost_passthrough: false, vat_rate: "19", open_gross: "119", amount_gross: "119" },
      { is_cost_passthrough: true, vat_rate: "0", open_gross: "300", amount_gross: "81" },
    ],
  },
};

describe("draft invoice editor", () => {
  it("starts from the draft and sends only the header when the lines stay", () => {
    const form = draftFormFrom(positions);
    expect(form.lines[0]).toEqual({ selected: true, quantity: "1", comment: "" });
    expect(form.lines[1].selected).toBe(false);
    expect(draftFormDirty(positions, form)).toBe(false);
    expect(draftUpdatePayload(positions, { ...form, dueDate: "2026-12-24" })).toEqual({
      due_date: "2026-12-24",
      notes: "Bitte überweisen",
    });
  });

  it("sends the chosen lines with quantities within the open rest", () => {
    const form = draftFormFrom(positions);
    form.lines[0] = { selected: true, quantity: "2", comment: " 3. und 4. Quartal " };
    form.lines[1] = { ...form.lines[1], selected: true };
    expect(draftLinesProblem(positions, form)).toBeNull();
    expect(draftUpdatePayload(positions, form).line_items).toEqual([
      { line_index: 0, quantity: "2", comment: "3. und 4. Quartal" },
      { line_index: 1, quantity: "1", comment: null },
    ]);
    form.lines[0].quantity = "2,5";
    expect(draftLinesProblem(positions, form)).toBe("quantity_over_open");
    form.lines[0] = { ...form.lines[0], selected: false };
    form.lines[1] = { ...form.lines[1], selected: false };
    expect(draftLinesProblem(positions, form)).toBe("no_line");
  });

  it("shows net, VAT and gross of a manual advance split and checks its sum", () => {
    const form = draftFormFrom(advance);
    expect(form.split).toEqual(["119,00", "81,00"]);
    expect(advanceSplitProblem(advance, form.split)).toBeNull();
    expect(draftUpdatePayload(advance, form).advance_split).toBeUndefined();

    const split = ["50,00", "150,00"];
    const preview = advanceSplitPreview(advance, split);
    expect(preview.rows[0]).toEqual({ net: 42.02, vat: 7.98, gross: 50 });
    expect(preview.total).toEqual({ net: 192.02, vat: 7.98, gross: 200 });
    expect(advanceSplitProblem(advance, split)).toBeNull();
    expect(draftUpdatePayload(advance, { ...form, split }).advance_split).toEqual([
      { is_cost_passthrough: false, vat_rate: "19", amount_gross: "50.00" },
      { is_cost_passthrough: true, vat_rate: "0", amount_gross: "150.00" },
    ]);
    expect(advanceSplitProblem(advance, ["49,00", "150,00"])).toBe("sum_mismatch");
    expect(advanceSplitProblem(advance, ["150,00", "50,00"])).toBe("over_open");
    expect(defaultSplitForm(advance)).toEqual(["119,00", "81,00"]);
  });
});

describe("running total of the draft lines (QA 2026-11-15, A-1/A-5)", () => {
  const hours = {
    line_index: 0,
    description: "Dolmetscher Stunde",
    unit: null,
    unit_price: "33.33",
    vat_rate: "19",
    is_cost_passthrough: false,
    quoted_quantity: "3",
    open_quantity: "0.5",
    billed_quantity: "2.5",
    billed_net: "83.33",
    billed_gross: "99.16",
    line_net: "99.99",
    line_gross: "118.99",
    selected_quantity: "0.5",
    comment: null,
  };

  it("bills the part completing the line with exactly its rest", () => {
    expect(linePartAmounts(hours, 0.5)).toEqual({ net: 16.66, vat: 3.17, gross: 19.83 });
    const first = { ...hours, open_quantity: "3", billed_quantity: "0", billed_net: "0", billed_gross: "0" };
    expect(linePartAmounts(first, 2.5)).toEqual({ net: 83.33, vat: 15.83, gross: 99.16 });
  });

  it("sums the chosen lines as net, VAT and gross", () => {
    const payload: DraftEditorPayload = { ...positions, quote_lines: [hours, positions.quote_lines[1]] };
    const form = draftFormFrom(payload);
    expect(draftLinesTotal(payload, form)).toEqual({ net: 16.66, vat: 3.17, gross: 19.83 });
    form.lines[1] = { selected: true, quantity: "1", comment: "" };
    expect(draftLinesTotal(payload, form)).toEqual({ net: 66.66, vat: 12.67, gross: 79.33 });
    form.lines[1] = { selected: true, quantity: "x", comment: "" };
    expect(draftLinesTotal(payload, form)).toBeNull();
  });
});

// Owner 2026-11-17: a final draft bills the delivered quantity and shows it against the estimate.
describe("final draft against the estimate", () => {
  const finalDraft: DraftEditorPayload = {
    ...positions,
    invoice_type: "final",
    quote_lines: [
      {
        ...positions.quote_lines[0],
        description: "Dolmetscherstunden",
        unit_price: "60",
        quoted_quantity: "3",
        open_quantity: "5",
        selected_quantity: "5",
        line_net: "180",
        line_gross: "214.2",
        billed_quantity: "0",
        billed_net: "0",
        billed_gross: "0",
        quantity_capped: false,
        delivery_basis: "actual",
      },
    ],
    order_service_lines: [
      { order_leistung_id: "svc-1", selected_quantity: "1", unit_price: "80", vat_rate: "19", quote_line_index: null },
    ],
  };

  it("lets the quantity pass the estimate and shows the difference", () => {
    const form = draftFormFrom(finalDraft);
    expect(isFinalDraft(finalDraft)).toBe(true);
    expect(draftLinesProblem(finalDraft, form)).toBeNull();
    expect(draftFinalLineComparison(finalDraft, finalDraft.quote_lines[0], form)).toMatchObject({
      estimate: 3, actual: 5, difference: 2, differenceGross: 142.8, aboveEstimate: true, recorded: true,
    });
    // 5 h = 357,00 and the kept service 95,20 against the estimate 214,20.
    expect(draftFinalSummary(finalDraft, form)).toEqual({ estimate: 214.2, actual: 452.2, difference: 238 });
  });

  // verify2-A S3-2/S3-9: the draft's own total, its rows and the budget count the services outside the estimate.
  it("counts the kept services outside the estimate in the total and the own-services budget", () => {
    const withPassthrough: DraftEditorPayload = {
      ...finalDraft,
      order_service_lines: [
        ...(finalDraft.order_service_lines ?? []),
        { order_leistung_id: "svc-2", selected_quantity: "1", unit_price: "2000", vat_rate: "0", is_cost_passthrough: true, quote_line_index: null },
        { order_leistung_id: "svc-3", selected_quantity: null, unit_price: "50", vat_rate: "19", quote_line_index: null },
      ],
    };
    const form = draftFormFrom(withPassthrough);
    expect(draftLinesTotal(withPassthrough, form)).toEqual({ net: 2380, vat: 72.2, gross: 2452.2 });
    expect(draftOwnServicesTotal(withPassthrough, form)?.gross).toBe(452.2);
    expect(draftKeptServices(withPassthrough).map((service) => [service.order_leistung_id, service.amounts.gross])).toEqual([
      ["svc-1", 95.2],
      ["svc-2", 2000],
    ]);
    expect(draftFinalSummary(withPassthrough, form).actual).toBe(2452.2);
  });

  it("sends a changed remark of a kept service with its quantity", () => {
    const form = draftFormFrom(finalDraft);
    expect(draftFormDirty(finalDraft, form)).toBe(false);
    form.serviceComments = { "svc-1": " Fahrt am 15.11. " };
    expect(draftFormDirty(finalDraft, form)).toBe(true);
    expect(draftUpdatePayload(finalDraft, form).order_services).toEqual([
      { order_leistung_id: "svc-1", quantity: "1", comment: "Fahrt am 15.11." },
    ]);
  });

  it("marks a line left out as not delivered", () => {
    const form = draftFormFrom(finalDraft);
    form.lines[0] = { ...form.lines[0], selected: false };
    expect(draftFinalLineComparison(finalDraft, finalDraft.quote_lines[0], form)).toMatchObject({ actual: 0, notDelivered: true, difference: -3 });
    expect(isFinalDraft(positions)).toBe(false);
  });
});

describe("advance split rounding like the server (QA2 A S3-6)", () => {
  it("takes the cent net whose VAT reaches the gross", () => {
    // 87,40 at 19 %: no cent net reaches it; the server keeps 73,45 + 13,95.
    expect(amountsForGross(87.4, 19)).toEqual({ net: 73.45, vat: 13.95, gross: 87.4 });
    // 101,75 at 19 %: 85,50 + 16,25 (plain division would give 85,50 too).
    expect(amountsForGross(101.75, 19)).toEqual({ net: 85.5, vat: 16.25, gross: 101.75 });
  });
});
