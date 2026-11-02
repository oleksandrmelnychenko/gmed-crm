import type { LeadPortalBilling, LeadRepresentative } from "../data/lead-portal-intake-api";
import type { PayerDeclaration } from "./lead-payer";

/**
 * Who a minor's parent is for the request's invoices (owner 2026-11-02): the
 * staff dialog of a parent asks it. No field of its own — it reads and writes
 * the lead's one invoice recipient (`invoice_recipient` `self` naming the
 * parent) and payer (`payer_kind` `representative`). Only parents with a
 * role are screened against the sanctions lists once the roles are named.
 */
export const PARENT_BILLING_ROLES = ["recipient_and_payer", "recipient", "payer", "none"] as const;

export type ParentBillingRole = (typeof PARENT_BILLING_ROLES)[number];

export function isParentBillingRole(value: string): value is ParentBillingRole {
  return (PARENT_BILLING_ROLES as readonly string[]).includes(value);
}

type PayerParty = Pick<PayerDeclaration, "payer_kind" | "payer_representative_id">
  & Partial<Pick<PayerDeclaration, "payer_type" | "first_name" | "last_name" | "date_of_birth" | "email">>;

/** The parent as the representation has it (`representatives[]` of the portal state). */
type ParentPerson = Pick<LeadRepresentative, "slot" | "first_name" | "last_name" | "date_of_birth" | "email">;

const normalized = (value: string | null | undefined) => (value ?? "").trim().split(/\s+/).join(" ").toLowerCase();

/**
 * Whether the declared payer is this parent, as the server reads it
 * (`lead_representatives::payer_same_person`): named as the paying
 * representative, or a third-party person with the parent's e-mail — or,
 * when either has none, the parent's name and date of birth.
 */
function payerIsParent(contactId: string, payer: PayerParty | null, person: ParentPerson | null | undefined) {
  if (!payer) return false;
  if (payer.payer_kind === "representative") return payer.payer_representative_id === contactId;
  if (payer.payer_kind !== "third_party" || !person?.slot) return false;
  if (payer.payer_type && payer.payer_type !== "person") return false;
  const payerEmail = normalized(payer.email);
  const parentEmail = normalized(person.email);
  if (payerEmail && parentEmail) return payerEmail === parentEmail;
  return Boolean(normalized(payer.first_name))
    && normalized(payer.first_name) === normalized(person.first_name)
    && normalized(payer.last_name) === normalized(person.last_name)
    && Boolean(payer.date_of_birth)
    && payer.date_of_birth === person.date_of_birth;
}

/** The role of the parent `contactId` as stored; null while the lead's data are not loaded. */
export function parentBillingRole(
  contactId: string,
  billing: LeadPortalBilling | null | undefined,
  payer: PayerParty | null | undefined,
  person?: ParentPerson | null,
): ParentBillingRole | null {
  if (billing === undefined || payer === undefined) return null;
  const receives = billing?.invoice_recipient === "self" && billing.recipient?.representative_id === contactId;
  return parentBillingRoleOf({ receives_invoice: receives, pays: payerIsParent(contactId, payer, person) });
}

export type ParentBillingRoleBody = { receives_invoice: boolean; pays: boolean };

export function parentBillingRoleOf(body: ParentBillingRoleBody): ParentBillingRole {
  if (body.receives_invoice && body.pays) return "recipient_and_payer";
  if (body.receives_invoice) return "recipient";
  if (body.pays) return "payer";
  return "none";
}

export function parentBillingRoleBody(role: ParentBillingRole): ParentBillingRoleBody {
  return {
    receives_invoice: role === "recipient_and_payer" || role === "recipient",
    pays: role === "recipient_and_payer" || role === "payer",
  };
}

type Tx = (ru: string, de: string) => string;

export function parentBillingRoleLabel(role: ParentBillingRole, tx: Tx): string {
  switch (role) {
    case "recipient_and_payer":
      return tx("Получатель счёта и плательщик", "Rechnungsempfänger und Zahler");
    case "recipient":
      return tx("Только получатель счёта", "Nur Rechnungsempfänger");
    case "payer":
      return tx("Только плательщик", "Nur Zahler");
    case "none":
      return tx("Не получает счёт и не платит", "Weder Rechnungsempfänger noch Zahler");
  }
}

/** The short chip of the parent's row; nothing for a parent without a role. */
export function parentBillingRoleChip(role: ParentBillingRole | null, tx: Tx): string | null {
  switch (role) {
    case "recipient_and_payer":
      return tx("Получает счёт и платит", "Erhält die Rechnung und zahlt");
    case "recipient":
      return tx("Получает счёт", "Erhält die Rechnung");
    case "payer":
      return tx("Платит", "Zahlt");
    default:
      return null;
  }
}
