import { ApiRequestError } from "@/lib/api";

import type { LeadPortalBilling, LeadRepresentative } from "../data/lead-portal-intake-api";
import type { PayerDeclaration } from "./lead-payer";

/**
 * Who a minor's parent is for the request's invoices (owner 2026-11-02): the
 * staff dialog of a parent asks it. No field of its own — it reads and writes
 * the lead's one invoice recipient (`invoice_recipient` `self` naming the
 * parent) and payer (`payer_kind` `representative`). Every parent is
 * screened against the sanctions lists; one with a role also counts for the
 * risk triggers as recipient or payer.
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

/**
 * The role of the parent `contactId` as stored; null while the lead's data are
 * not loaded, or while nobody answered who receives the invoice or pays (the
 * dialog says «Не указано», QA 2026-11-03, F6).
 */
export function parentBillingRole(
  contactId: string,
  billing: LeadPortalBilling | null | undefined,
  payer: PayerParty | null | undefined,
  person?: ParentPerson | null,
): ParentBillingRole | null {
  if (billing === undefined || payer === undefined) return null;
  if (!billing?.invoice_recipient && !payer) return null;
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

/**
 * Why the server refused a parent's role, as one localized sentence; `null`
 * for other errors (QA 2026-11-03, F3: the payer's own answers showed the
 * generic "data changed" text).
 */
export function parentBillingRoleErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const code = error.body?.error ?? error.body?.code ?? error.code;
  if (code === "payer_not_changed") {
    return tx(
      "Плательщик уже ответил по своей ссылке. Изменить плательщика можно только на шаге плательщика.",
      "Der Zahler hat bereits über seinen eigenen Link geantwortet. Der Zahler lässt sich nur im Zahlerschritt ändern.",
    );
  }
  if (code === "recipient_not_contracting") {
    return tx(
      "Счёт получает родитель, который платит: он сторона договора. Выберите «Получает счёт и платит» для платящего родителя.",
      "Die Rechnung erhält der zahlende Elternteil als Vertragspartner. Wählen Sie für ihn „Erhält die Rechnung und zahlt“.",
    );
  }
  if (code === "payer_still_this_parent") {
    return tx(
      "Этот родитель сейчас плательщик. Сначала назначьте плательщиком другого родителя или третье лицо.",
      "Dieser Elternteil ist derzeit Zahler. Bitte zuerst den anderen Elternteil oder eine dritte Person als Zahler festlegen.",
    );
  }
  return null;
}
