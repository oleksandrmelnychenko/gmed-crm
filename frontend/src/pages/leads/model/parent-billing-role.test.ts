import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import type { LeadPortalBilling } from "../data/lead-portal-intake-api";
import {
  PARENT_BILLING_ROLES,
  parentBillingRole,
  parentBillingRoleBody,
  parentBillingRoleChip,
  parentBillingRoleErrorText,
  parentBillingRoleOf,
  representativeCountsForRisk,
} from "./parent-billing-role";

const tx = (ru: string) => ru;
const MOTHER = "5d0c1f0e-0000-4000-8000-000000000001";
const FATHER = "5d0c1f0e-0000-4000-8000-000000000002";

function billing(recipient: "self" | "third_party" | null, representativeId?: string): LeadPortalBilling {
  return {
    invoice_recipient: recipient,
    recipient: representativeId ? { representative_id: representativeId } : null,
  } as LeadPortalBilling;
}

describe("parent billing role", () => {
  it("reads the lead's one recipient and payer", () => {
    const motherPays = { payer_kind: "representative" as const, payer_representative_id: MOTHER };
    expect(parentBillingRole(MOTHER, billing("self", MOTHER), motherPays)).toBe("recipient_and_payer");
    expect(parentBillingRole(FATHER, billing("self", MOTHER), motherPays)).toBe("none");
    expect(parentBillingRole(FATHER, billing("self", FATHER), motherPays)).toBe("recipient");
    expect(parentBillingRole(MOTHER, billing("self", FATHER), motherPays)).toBe("payer");
    // A third party receives the invoice; nobody declared as payer yet.
    expect(parentBillingRole(MOTHER, billing("third_party"), null)).toBe("none");
  });

  it("counts a parent recorded as a third-party person payer, as the server does", () => {
    const anna = { slot: "rep1", first_name: "Anna", last_name: "Muster", date_of_birth: "1985-03-02", email: "Anna@example.org" };
    const byEmail = { payer_kind: "third_party" as const, payer_type: "person" as const, email: "anna@example.org " };
    expect(parentBillingRole(MOTHER, billing(null), byEmail, anna)).toBe("payer");
    const byName = { payer_kind: "third_party" as const, first_name: "anna", last_name: "Muster", date_of_birth: "1985-03-02" };
    expect(parentBillingRole(MOTHER, billing(null), byName, { ...anna, email: null })).toBe("payer");
    // Another person, an organisation, or a parent without a place in the form.
    expect(parentBillingRole(MOTHER, billing(null), { ...byName, date_of_birth: "1990-01-01" }, { ...anna, email: null })).toBe("none");
    expect(parentBillingRole(MOTHER, billing(null), { ...byEmail, payer_type: "company" as const }, anna)).toBe("none");
    expect(parentBillingRole(MOTHER, billing(null), byEmail, { ...anna, slot: null })).toBe("none");
  });

  it("is unknown while the lead's data are not loaded", () => {
    expect(parentBillingRole(MOTHER, undefined, null)).toBeNull();
    expect(parentBillingRole(MOTHER, null, undefined)).toBeNull();
    // Nobody answered yet: not "no role" (QA 2026-11-03, F6).
    expect(parentBillingRole(MOTHER, billing(null), null)).toBeNull();
    expect(parentBillingRole(MOTHER, null, null)).toBeNull();
  });

  it("round-trips through the request body", () => {
    for (const role of PARENT_BILLING_ROLES) {
      expect(parentBillingRoleOf(parentBillingRoleBody(role))).toBe(role);
    }
    expect(parentBillingRoleBody("payer")).toEqual({ receives_invoice: false, pays: true });
  });

  it("shows a chip only for a parent with a role", () => {
    expect(parentBillingRoleChip("recipient_and_payer", tx)).toBe("Получает счёт и платит");
    expect(parentBillingRoleChip("none", tx)).toBeNull();
    expect(parentBillingRoleChip(null, tx)).toBeNull();
  });

  it("names why the server refused a role", () => {
    const refusal = (error: string) => new ApiRequestError("refused", { status: 409, body: { error } });
    expect(parentBillingRoleErrorText(refusal("payer_not_changed"), tx)).toContain("по своей ссылке");
    expect(parentBillingRoleErrorText(refusal("payer_still_this_parent"), tx)).toContain("сейчас плательщик");
    expect(parentBillingRoleErrorText(refusal("recipient_not_contracting"), tx)).toContain("сторона договора");
    expect(parentBillingRoleErrorText(refusal("lead_converted"), tx)).toBeNull();
    expect(parentBillingRoleErrorText(new Error("x"), tx)).toBeNull();
  });
});

describe("representativeCountsForRisk", () => {
  const motherPays = { payer_kind: "representative" as const, payer_representative_id: MOTHER };
  it("counts a minor's parent only with a role, an adult's representative always (owner 2026-11-02)", () => {
    expect(representativeCountsForRisk(MOTHER, true, billing("self", FATHER), motherPays)).toBe(true);
    expect(representativeCountsForRisk(FATHER, true, billing("self", FATHER), motherPays)).toBe(true);
    expect(representativeCountsForRisk(FATHER, true, billing("self", MOTHER), motherPays)).toBe(false);
    // Nobody answered yet: no role, like the server.
    expect(representativeCountsForRisk(FATHER, true, null, null)).toBe(false);
    // Not loaded: unknown.
    expect(representativeCountsForRisk(FATHER, true, undefined, motherPays)).toBeNull();
    expect(representativeCountsForRisk(FATHER, false, undefined, undefined)).toBe(true);
  });
});
