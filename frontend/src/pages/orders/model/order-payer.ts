/**
 * The payer of an order (and of its family group): a relative of the head
 * patient, another patient record (by patient number) or a free-text contact,
 * with the postal address invoices are sent to. New invoices of the order
 * inherit it as one whole record.
 */

import { isValidEmailAddress } from "@/lib/contact-validation";
import { relationNameSuggestsOrganisation } from "@/pages/patients/model/sheet-forms";

/**
 * How the payer relates to the contracting party: the party itself, a
 * Kostenübernehmer, or the party at another invoice address (no
 * Kostenübernahme; e.g. the lead's "invoice to another address").
 */
export type OrderPayerRole = "contracting_party" | "cost_bearer" | "invoice_address";

const ORDER_PAYER_ROLES: readonly OrderPayerRole[] = [
  "contracting_party",
  "cost_bearer",
  "invoice_address",
];

export type OrderPayerForm = {
  relationId: string;
  patientPid: string;
  role: OrderPayerRole | "";
  name: string;
  relationship: string;
  email: string;
  phone: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  notes: string;
  /**
   * The free-text contact is an organisation (company, foundation, insurer): the sanctions
   * screening compares it with the listed entities by its whole name.
   */
  isOrganisation: boolean;
  /** Staff set the box themselves (or it was stored); a typed name no longer changes it. */
  organisationTouched: boolean;
};

export type OrderPayerSource = {
  payer_patient_relation_id: string | null;
  payer_patient_pid?: string | null;
  payer_role?: string | null;
  payer_contact_name: string | null;
  payer_contact_relationship: string | null;
  payer_contact_email: string | null;
  payer_contact_phone: string | null;
  payer_address_street?: string | null;
  payer_address_zip?: string | null;
  payer_address_city?: string | null;
  payer_address_country?: string | null;
  payer_notes: string | null;
  /**
   * The organisation box of the contact: the stored answer, or for an older row how the server
   * screens the name (legal form); null without a contact name.
   */
  payer_contact_is_organisation?: boolean | null;
};

export const EMPTY_ORDER_PAYER: OrderPayerForm = {
  relationId: "",
  patientPid: "",
  role: "",
  name: "",
  relationship: "",
  email: "",
  phone: "",
  street: "",
  zip: "",
  city: "",
  country: "",
  notes: "",
  isOrganisation: false,
  organisationTouched: false,
};

/** The stored payer as form values (the relation and the role are kept, not dropped). */
export function orderPayerToForm(source: OrderPayerSource): OrderPayerForm {
  const role = ORDER_PAYER_ROLES.find((known) => known === source.payer_role) ?? "";
  const name = source.payer_contact_name ?? "";
  return {
    relationId: source.payer_patient_relation_id ?? "",
    patientPid: source.payer_patient_pid ?? "",
    role,
    name,
    relationship: source.payer_contact_relationship ?? "",
    email: source.payer_contact_email ?? "",
    phone: source.payer_contact_phone ?? "",
    street: source.payer_address_street ?? "",
    zip: source.payer_address_zip ?? "",
    city: source.payer_address_city ?? "",
    country: source.payer_address_country ?? "",
    notes: source.payer_notes ?? "",
    isOrganisation: Boolean(name.trim()) && source.payer_contact_is_organisation === true,
    // A saved contact keeps its answer; an empty one follows the name staff type.
    organisationTouched: Boolean(name.trim()),
  };
}

/**
 * The organisation box after staff typed a contact name: until they tick or untick the box
 * themselves, a legal form in the name ("Beispiel GmbH", "ООО Полартек") ticks it.
 */
export function organisationAfterTypedName(
  form: { isOrganisation: boolean; organisationTouched: boolean },
  name: string,
): boolean {
  return form.organisationTouched ? form.isOrganisation : relationNameSuggestsOrganisation(name);
}

/**
 * Body of POST /orders/{id}/payer. Every field is sent, so saving the form
 * never silently drops a relation chosen earlier; a relative wins over a
 * patient number when both are filled.
 */
export function orderPayerPayload(form: OrderPayerForm) {
  const text = (value: string) => value.trim() || null;
  const relationId = form.relationId || null;
  const patientPid = relationId ? null : text(form.patientPid);
  const hasPayer = Boolean(relationId || patientPid || text(form.name));
  return {
    payer_patient_relation_id: relationId,
    payer_patient_pid: patientPid,
    payer_role: hasPayer ? form.role || null : null,
    payer_contact_name: text(form.name),
    payer_contact_relationship: text(form.relationship),
    payer_contact_email: text(form.email),
    payer_contact_phone: text(form.phone),
    payer_address_street: text(form.street),
    payer_address_zip: text(form.zip),
    payer_address_city: text(form.city),
    payer_address_country: text(form.country),
    payer_notes: text(form.notes),
    // Only a contact name carries the answer; the server stores none without one.
    payer_contact_is_organisation: text(form.name) ? form.isOrganisation : null,
  };
}

/** An e-mail the server will accept; an empty field is allowed. */
export function isPlausiblePayerEmail(value: string) {
  return !value.trim() || isValidEmailAddress(value);
}
