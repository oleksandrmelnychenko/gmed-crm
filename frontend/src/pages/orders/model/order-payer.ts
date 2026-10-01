/**
 * The payer of an order (and of its family group): a relative of the head
 * patient, another patient record (by patient number) or a free-text contact,
 * with the postal address invoices are sent to. New invoices of the order
 * inherit it as one whole record.
 */

export type OrderPayerRole = "contracting_party" | "cost_bearer";

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
};

/** The stored payer as form values (the relation is kept, not dropped). */
export function orderPayerToForm(source: OrderPayerSource): OrderPayerForm {
  const role = source.payer_role === "contracting_party" || source.payer_role === "cost_bearer"
    ? source.payer_role
    : "";
  return {
    relationId: source.payer_patient_relation_id ?? "",
    patientPid: source.payer_patient_pid ?? "",
    role,
    name: source.payer_contact_name ?? "",
    relationship: source.payer_contact_relationship ?? "",
    email: source.payer_contact_email ?? "",
    phone: source.payer_contact_phone ?? "",
    street: source.payer_address_street ?? "",
    zip: source.payer_address_zip ?? "",
    city: source.payer_address_city ?? "",
    country: source.payer_address_country ?? "",
    notes: source.payer_notes ?? "",
  };
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
  };
}

/** An e-mail the server will accept: one `@`, a dotted domain, no spaces. */
export function isPlausiblePayerEmail(value: string) {
  const email = value.trim();
  if (!email) return true;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}
