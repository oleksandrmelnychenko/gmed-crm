/**
 * "Плательщик" on the patient card: who pays, read from the payer declaration
 * of the most recently converted lead, the contracting party (an adult, or
 * the legal representatives of a minor) and the invoice recipient the
 * invoicing rules derive from them (owner request 2026-10-06). Everything is
 * computed by `GET /patients/{id}/payer-summary`; the card is read-only — the
 * declaration itself is edited in the lead wizard, the payer of an order or
 * an invoice there. No GwG answer (own account, beneficial owner, source of
 * funds, citizenships, date of birth) is part of the answer.
 */
import { countryNameForDisplay } from "@/components/ui/country-select";
import { ApiRequestError } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";

import {
  identificationPersons,
  normalizeLeadIdentificationStatus,
  ownAccountPaymentLabel,
  qualifiedSignatureLabel,
  type IdentificationLabel,
  type IdentificationSubject,
  type LeadIdentificationStatus,
} from "@/pages/leads/model/lead-identification";
import {
  PAYER_RELATIONSHIP_KINDS,
  PAYER_TYPES,
  payerRelationshipKindLabel,
  payerTypeLabel,
  type PayerKind,
  type PayerRelationshipKind,
  type PayerType,
  type Tx,
} from "@/pages/leads/model/lead-payer";

export type { Tx };

/** The lead whose declaration counts: the most recently converted one. */
export type PatientPayerSource = {
  lead_id: string;
  converted_at: string | null;
  declared_at: string | null;
};

/** The declaration as the server projects it: no GwG answers, no identity data. */
export type PatientPayerDeclaration = {
  payer_kind: PayerKind;
  /** `null` while the patient pays; a third party without a stored type is a person. */
  payer_type: PayerType | null;
  /** Display name: the organisation, else first and last name. */
  name: string | null;
  organisation_name: string | null;
  first_name: string | null;
  last_name: string | null;
  relationship_kind: PayerRelationshipKind | null;
  /** Free text beside `other`, or one typed before the kinds existed. */
  relationship: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  /** ISO code or, from older declarations, a country name. */
  country: string | null;
  email: string | null;
  phone: string | null;
  /** When the lead agreed that GMED contacts the payer. */
  contact_consent_at: string | null;
  /** When the payer was informed about the processing of their data (Art. 14 DSGVO). */
  payer_informed_at: string | null;
};

export type ContractingPartyRepresentative = {
  relation_id: string | null;
  related_patient_id: string | null;
  relation_type: string | null;
  name: string;
  email: string | null;
  /** "street, zip city, country" as the server joins it. */
  address: string | null;
  is_default_payer: boolean;
};

/** `patient`, `patient_represented` or `legal_representatives` (a minor's parents). */
export type PatientContractingParty = {
  kind: string;
  explicit: boolean;
  patient_id: string | null;
  patient_name: string | null;
  patient_is_minor: boolean;
  debtor_name: string | null;
  representatives: ContractingPartyRepresentative[];
};

export const INVOICE_RECIPIENT_SOURCES = [
  "head_order",
  "order",
  "default_payer",
  "payer_declaration",
  "contracting_party",
  "none",
] as const;

export type InvoiceRecipientSource = (typeof INVOICE_RECIPIENT_SOURCES)[number];

/** Who an invoice of the patient would be addressed to today. */
export type PatientInvoiceRecipient = {
  source: InvoiceRecipientSource;
  role: string | null;
  /** `patient`, `relation`, `payer_patient` or `contact`. */
  kind: string | null;
  name: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  payer_patient_relation_id: string | null;
  payer_patient_id: string | null;
  /** Postal address parts the release check would miss: `name`, `street`, `zip`, `city`, `country`. */
  missing: string[];
  /** A minor would receive the invoice: no parent or guardian is on file. */
  minor_without_payer: boolean;
};

/** An open, unconverted lead of the patient: the payer is being captured there. */
export type PatientPayerOpenRequest = {
  lead_id: string;
  has_declaration: boolean;
};

export type PatientPayerSummary = {
  patient_id: string;
  patient_is_minor: boolean;
  source: PatientPayerSource | null;
  declaration: PatientPayerDeclaration | null;
  contracting_party: PatientContractingParty | null;
  invoice_recipient: PatientInvoiceRecipient | null;
  /** The identification of the source lead; `null` for Billing and without a source. */
  identification: LeadIdentificationStatus | null;
  open_request: PatientPayerOpenRequest | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];

function isPayerType(value: unknown): value is PayerType {
  return (PAYER_TYPES as readonly unknown[]).includes(value);
}

function isRelationshipKind(value: unknown): value is PayerRelationshipKind {
  return (PAYER_RELATIONSHIP_KINDS as readonly unknown[]).includes(value);
}

function isRecipientSource(value: unknown): value is InvoiceRecipientSource {
  return (INVOICE_RECIPIENT_SOURCES as readonly unknown[]).includes(value);
}

function normalizeSource(value: unknown): PatientPayerSource | null {
  const record = asRecord(value);
  const leadId = text(record?.lead_id);
  if (!record || !leadId) return null;
  return {
    lead_id: leadId,
    converted_at: text(record.converted_at),
    declared_at: text(record.declared_at),
  };
}

function normalizeDeclaration(value: unknown): PatientPayerDeclaration | null {
  const record = asRecord(value);
  if (!record) return null;
  const thirdParty = record.payer_kind === "third_party";
  const organisationName = thirdParty ? text(record.organisation_name) : null;
  const firstName = thirdParty ? text(record.first_name) : null;
  const lastName = thirdParty ? text(record.last_name) : null;
  const personName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    payer_kind: thirdParty ? "third_party" : "self",
    payer_type: thirdParty ? (isPayerType(record.payer_type) ? record.payer_type : "person") : null,
    name: thirdParty ? text(record.name) ?? organisationName ?? (personName || null) : null,
    organisation_name: organisationName,
    first_name: firstName,
    last_name: lastName,
    relationship_kind: thirdParty && isRelationshipKind(record.relationship_kind) ? record.relationship_kind : null,
    relationship: thirdParty ? text(record.relationship) : null,
    street: thirdParty ? text(record.street) : null,
    zip: thirdParty ? text(record.zip) : null,
    city: thirdParty ? text(record.city) : null,
    country: thirdParty ? text(record.country) : null,
    email: thirdParty ? text(record.email) : null,
    phone: thirdParty ? text(record.phone) : null,
    contact_consent_at: thirdParty ? text(record.contact_consent_at) : null,
    payer_informed_at: thirdParty ? text(record.payer_informed_at) : null,
  };
}

function normalizeRepresentatives(value: unknown): ContractingPartyRepresentative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const name = text(record.name) ?? "";
    const relationId = text(record.relation_id);
    if (!name && !relationId) return [];
    return [
      {
        relation_id: relationId,
        related_patient_id: text(record.related_patient_id),
        relation_type: text(record.relation_type),
        name,
        email: text(record.email),
        address: text(record.address),
        is_default_payer: record.is_default_payer === true,
      },
    ];
  });
}

function normalizeContractingParty(value: unknown): PatientContractingParty | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    kind: text(record.kind) ?? "patient",
    explicit: record.explicit === true,
    patient_id: text(record.patient_id),
    patient_name: text(record.patient_name),
    patient_is_minor: record.patient_is_minor === true,
    debtor_name: text(record.debtor_name),
    representatives: normalizeRepresentatives(record.representatives),
  };
}

function normalizeInvoiceRecipient(value: unknown): PatientInvoiceRecipient | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    source: isRecipientSource(record.source) ? record.source : "none",
    role: text(record.role),
    kind: text(record.kind),
    name: text(record.name),
    street: text(record.street),
    zip: text(record.zip),
    city: text(record.city),
    country: text(record.country),
    email: text(record.email),
    payer_patient_relation_id: text(record.payer_patient_relation_id),
    payer_patient_id: text(record.payer_patient_id),
    missing: stringList(record.missing),
    minor_without_payer: record.minor_without_payer === true,
  };
}

function normalizeOpenRequest(value: unknown): PatientPayerOpenRequest | null {
  const record = asRecord(value);
  const leadId = text(record?.lead_id);
  if (!record || !leadId) return null;
  return { lead_id: leadId, has_declaration: record.has_declaration === true };
}

/**
 * The server answer with every block present or `null`; `null` for anything
 * that is not a summary (an unexpected proxy reply), so the card reports a
 * failed load instead of an empty declaration. Missing keys read as "not
 * known": an older server without `identification` or `open_request` shows
 * the card without those parts.
 */
export function normalizePatientPayerSummary(value: unknown): PatientPayerSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    patient_id: text(record.patient_id) ?? "",
    patient_is_minor: record.patient_is_minor === true,
    source: normalizeSource(record.source),
    declaration: normalizeDeclaration(record.declaration),
    contracting_party: normalizeContractingParty(record.contracting_party),
    invoice_recipient: normalizeInvoiceRecipient(record.invoice_recipient),
    identification: normalizeLeadIdentificationStatus(record.identification),
    open_request: normalizeOpenRequest(record.open_request),
  };
}

/**
 * How a failed load is shown: a 403 (the role may not see the patient's
 * finances, or the patient manager is not assigned) hides the card; anything
 * else is an error with a retry.
 */
export function payerSummaryLoadFailure(error: unknown): "forbidden" | "error" {
  return error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "error";
}

/** Whether the declaration names a third party (a person or an organisation). */
export function isThirdPartyPayer(
  declaration: PatientPayerDeclaration | null | undefined,
): declaration is PatientPayerDeclaration & { payer_kind: "third_party" } {
  return declaration?.payer_kind === "third_party";
}

/** Line 1 of the card: "Patient selbst", "Dritte/r — Privatperson", or that nothing was declared. */
export function whoPaysLabel(declaration: PatientPayerDeclaration | null, tx: Tx): string {
  if (!declaration) {
    return tx(
      "Декларация плательщика отсутствует (пациент создан без обращения)",
      "Keine Zahlererklärung (Patient ohne Anfrage angelegt)",
    );
  }
  if (!isThirdPartyPayer(declaration)) return tx("Пациент сам", "Patient selbst");
  // A third party without a stored type is a person (as in the lead wizard).
  return `${tx("Третье лицо", "Dritte/r")} — ${payerTypeLabel(declaration.payer_type ?? "person", tx)}`;
}

/** The payer's name: the organisation, else first and last name; "—" without one. */
export function payerDisplayName(declaration: PatientPayerDeclaration): string {
  return declaration.name
    ?? declaration.organisation_name
    ?? ([declaration.first_name, declaration.last_name].filter(Boolean).join(" ") || "—");
}

/**
 * The relationship to the patient: the kind's label, the free text beside
 * `other` (or one typed before the kinds existed), else "—".
 */
export function payerRelationshipLabel(declaration: PatientPayerDeclaration, tx: Tx): string {
  const kind = declaration.relationship_kind;
  if (kind && kind !== "other") return payerRelationshipKindLabel(kind, tx);
  if (declaration.relationship) return declaration.relationship;
  return kind ? payerRelationshipKindLabel(kind, tx) : "—";
}

export type PostalAddressParts = {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
};

/** "street, zip city, country name" from the parts at hand; "—" without any. */
export function postalAddressLine(parts: PostalAddressParts, lang: string): string {
  const locality = [parts.zip, parts.city].filter(Boolean).join(" ");
  const country = parts.country ? countryNameForDisplay(parts.country, lang) || parts.country : "";
  return [parts.street, locality, country].filter(Boolean).join(", ") || "—";
}

/** "e-mail · phone"; "—" without either. */
export function contactLine(contact: { email: string | null; phone: string | null }): string {
  return [contact.email, contact.phone].filter(Boolean).join(" · ") || "—";
}

/** The lead's consent to contact the payer: "given DD.MM.YYYY" or "not given". */
export function contactConsentLabel(declaration: PatientPayerDeclaration, tx: Tx): string {
  const day = declaration.contact_consent_at ? formatAppDate(declaration.contact_consent_at) : "";
  return day ? `${tx("дано", "erteilt am")} ${day}` : tx("не дано", "nicht erteilt");
}

/** Whether the payer was informed about the processing of their data (Art. 14 DSGVO). */
export function payerInformedLabel(declaration: PatientPayerDeclaration, tx: Tx): string {
  const day = declaration.payer_informed_at ? formatAppDate(declaration.payer_informed_at) : "";
  return day ? `${tx("да", "ja")}, ${day}` : tx("нет", "nein");
}

/** Whether the contracting party is the legal representatives of a minor. */
export function contractingPartyIsRepresentatives(party: PatientContractingParty): boolean {
  return party.kind === "legal_representatives";
}

/**
 * Line 3: "Patient" for an adult, "Gesetzliche Vertreter: Anna Muster und
 * Ben Muster" for a minor. Without a parent or guardian on file the server's
 * debtor name falls back to the child, which the line does not repeat.
 */
export function contractingPartyLabel(party: PatientContractingParty, tx: Tx): string {
  if (!contractingPartyIsRepresentatives(party)) return tx("Пациент", "Patient");
  const names = party.representatives.length > 0
    ? party.debtor_name ?? "—"
    : tx("не указаны", "nicht erfasst");
  return `${tx("Законные представители: ", "Gesetzliche Vertreter: ")}${names}`;
}

/** The muted note under the invoice recipient: where the recipient comes from. */
export function invoiceRecipientSourceNote(source: InvoiceRecipientSource, tx: Tx): string {
  switch (source) {
    case "payer_declaration":
      return tx("по декларации плательщика", "laut Zahlererklärung");
    case "default_payer":
      return tx("плательщик по умолчанию", "Standardzahler");
    case "contracting_party":
      return tx("сторона договора", "Vertragspartei");
    case "order":
    case "head_order":
      return tx("из заказа", "aus dem Auftrag");
    case "none":
      return tx("пациент", "Patient");
  }
}

/** The postal address part names of the release check, in the words of the card. */
export function missingAddressPartLabel(part: string, tx: Tx): string {
  switch (part) {
    case "name":
      return tx("имя", "Name");
    case "street":
      return tx("улица", "Straße");
    case "zip":
      return tx("индекс", "PLZ");
    case "city":
      return tx("город", "Ort");
    case "country":
      return tx("страна", "Land");
    default:
      return part;
  }
}

/** "Address incomplete: street, zip" when the release check would miss parts; `null` otherwise. */
export function missingAddressWarning(recipient: PatientInvoiceRecipient, tx: Tx): string | null {
  if (recipient.missing.length === 0) return null;
  const parts = recipient.missing.map((part) => missingAddressPartLabel(part, tx)).join(", ");
  return `${tx("Адрес неполный: ", "Adresse unvollständig: ")}${parts}`;
}

/** A minor would receive the invoice. */
export function minorWithoutPayerWarning(tx: Tx): string {
  return tx(
    "Несовершеннолетний получит счёт — укажите плательщика",
    "Minderjährige/r als Empfänger – Zahler angeben",
  );
}

/** The badge of the representative staff marked as the default payer. */
export function defaultPayerBadgeLabel(tx: Tx): string {
  return tx("плательщик по умолчанию", "Standardzahler");
}

/**
 * The footer: when the declaration was fixed by the conversion of the
 * request. Without a conversion time the declaration day stands in; without
 * either the sentence has no day.
 */
export function conversionNote(source: PatientPayerSource, tx: Tx): string {
  const day = formatAppDate(source.converted_at ?? source.declared_at ?? "");
  if (!day) {
    return tx("Зафиксировано при конвертации обращения", "Bei der Umwandlung der Anfrage festgehalten");
  }
  return tx(
    `Зафиксировано при конвертации обращения ${day}`,
    `Bei der Umwandlung der Anfrage am ${day} festgehalten`,
  );
}

export function openRequestNote(tx: Tx): string {
  return tx(
    "Открыто новое обращение — плательщик уточняется в нём",
    "Eine neue Anfrage ist offen – der Zahler wird dort erfasst",
  );
}

export function payerChangedElsewhereNote(tx: Tx): string {
  return tx(
    "Плательщика заказа или счёта меняют в заказе и в счёте",
    "Der Zahler eines Auftrags oder einer Rechnung wird dort geändert",
  );
}

export function openLeadLabel(tx: Tx): string {
  return tx("Открыть обращение", "Anfrage öffnen");
}

/** The lead wizard, opened on the request. */
export function leadPath(leadId: string): string {
  return `/leads?lead=${encodeURIComponent(leadId)}`;
}

export type IdentificationLine = {
  subject: IdentificationSubject;
  /** The person: the role of the patient or the payer, the name of a representative. */
  name: string;
  /** A representative's relation, "" otherwise. */
  detail: string;
  signature: IdentificationLabel;
  payment: IdentificationLabel;
  /** What stands in the way of the identification; "" when nothing. */
  note: string;
};

/**
 * One line per identified person, with the same words as the wizard: the
 * patient and a third-party payer, or — for a minor — each legal
 * representative and the payer when he is not one of them.
 */
export function identificationLines(status: LeadIdentificationStatus, tx: Tx): IdentificationLine[] {
  return identificationPersons(status, tx).map((person) => ({
    subject: person.subject,
    name: person.role,
    detail: person.detail,
    signature: qualifiedSignatureLabel(person.person, tx),
    payment: ownAccountPaymentLabel(person.person, tx),
    note: person.note,
  }));
}
