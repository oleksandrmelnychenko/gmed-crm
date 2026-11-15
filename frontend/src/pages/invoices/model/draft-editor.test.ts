import { describe, expect, it } from "vitest";

import {
  advanceSplitPreview,
  advanceSplitProblem,
  defaultSplitForm,
  draftFormDirty,
  draftFormFrom,
  draftLinesProblem,
  draftLinesTotal,
  draftUpdatePayload,
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
