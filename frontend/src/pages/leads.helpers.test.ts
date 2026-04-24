import { describe, expect, it } from "vitest";

import { computeLeadConversionGate, filterLeadsByContact } from "./leads.helpers";
import type { Lead } from "@/lib/api/types";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    first_name: "Alice",
    last_name: "Example",
    email: null,
    phone: null,
    source: null,
    country: null,
    intake_source: null,
    flow: null,
    qualification_status: "qualified",
    compliance_status: "signed",
    conversion_ready: true,
    failed_outcome: undefined,
    submitted_at: null,
    created_at: new Date().toISOString(),
    attachment_count: 0,
    ...overrides,
  };
}

describe("computeLeadConversionGate", () => {
  it("renders and enables the button for a PM on a fully-ready qualified lead", () => {
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "qualified", conversion_ready: true }),
      { canConvert: true },
    );
    expect(gate).toEqual({
      canConvertRole: true,
      canConvert: true,
      disabledReason: null,
    });
  });

  it("does not render the button for a user without the canConvert permission", () => {
    const gate = computeLeadConversionGate(lead(), { canConvert: false });
    expect(gate.canConvertRole).toBe(false);
    expect(gate.canConvert).toBe(false);
    expect(gate.disabledReason).toBeNull();
  });

  it("does not render the button on a new lead even for a PM", () => {
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "new" }),
      { canConvert: true },
    );
    expect(gate.canConvertRole).toBe(false);
    expect(gate.canConvert).toBe(false);
  });

  it("does not render the button on an archived lead", () => {
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "archived" }),
      { canConvert: true },
    );
    expect(gate.canConvertRole).toBe(false);
  });

  it("does not render the button on an already-converted lead", () => {
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "converted" }),
      { canConvert: true },
    );
    expect(gate.canConvertRole).toBe(false);
  });

  it("renders but disables the button when readiness is false", () => {
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "qualified", conversion_ready: false }),
      { canConvert: true },
    );
    expect(gate.canConvertRole).toBe(true);
    expect(gate.canConvert).toBe(false);
    expect(gate.disabledReason).toContain("Missing required data");
  });

  it("falls back to enabled when the server does not ship conversion_ready", () => {
    // Older server build — field is undefined. The UI must not silently
    // disable conversion, because that would break a rolling deploy
    // where the frontend has shipped but the backend has not.
    const base = lead({ qualification_status: "qualified" });
    delete (base as { conversion_ready?: boolean }).conversion_ready;
    const gate = computeLeadConversionGate(base, { canConvert: true });
    expect(gate.canConvertRole).toBe(true);
    expect(gate.canConvert).toBe(true);
    expect(gate.disabledReason).toBeNull();
  });

  it("clears the tooltip when the role gate itself is false", () => {
    // Guard rail: the disabledReason is a card-level tooltip, and it
    // should never confuse a non-PM user by suggesting the lead is just
    // "missing data" when the actual block is permissions.
    const gate = computeLeadConversionGate(
      lead({ qualification_status: "qualified", conversion_ready: false }),
      { canConvert: false },
    );
    expect(gate.canConvertRole).toBe(false);
    expect(gate.disabledReason).toBeNull();
  });
});

describe("filterLeadsByContact", () => {
  const rows = [
    lead({
      id: "lead-1",
      first_name: "Anna",
      email: "anna@example.com",
      phone: "+49 155 101",
    }),
    lead({
      id: "lead-2",
      first_name: "Bob",
      email: "bob@sample.com",
      phone: "+49 155 202",
    }),
    lead({
      id: "lead-3",
      first_name: "Cara",
      email: null,
      phone: null,
    }),
  ];

  it("returns all leads when both filters are empty", () => {
    const out = filterLeadsByContact(rows, { email: "", phone: "" });
    expect(out).toHaveLength(3);
    expect(out.map((row) => row.id)).toEqual(["lead-1", "lead-2", "lead-3"]);
  });

  it("filters by email case-insensitively and trims input", () => {
    const out = filterLeadsByContact(rows, { email: "  ANNA@EXAMPLE  ", phone: "" });
    expect(out.map((row) => row.id)).toEqual(["lead-1"]);
  });

  it("filters by phone case-insensitively and trims input", () => {
    const out = filterLeadsByContact(rows, { email: "", phone: " 155 202 " });
    expect(out.map((row) => row.id)).toEqual(["lead-2"]);
  });

  it("applies email and phone filters together (AND semantics)", () => {
    const out = filterLeadsByContact(rows, {
      email: "sample.com",
      phone: "155 202",
    });
    expect(out.map((row) => row.id)).toEqual(["lead-2"]);
  });

  it("handles leads with null contact values safely", () => {
    const out = filterLeadsByContact(rows, { email: "none@none", phone: "000" });
    expect(out).toHaveLength(0);
  });
});
