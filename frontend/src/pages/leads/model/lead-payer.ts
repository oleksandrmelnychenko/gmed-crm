/**
 * "Кто платит" — the payer declaration of a lead (owner decision 2026-10-03).
 *
 * Part of the compliance step (GwG): whether the patient pays or a third party
 * does, the beneficial owner, the source of funds and, for a third-party
 * payer, identity, residence and citizenships. A third-party payer signs a
 * Kostenübernahmeerklärung (Schuldbeitritt); GMED countersigns the contract and
 * the order only after the client and the payer (server-side gate).
 *
 * A third-party payer is a private person or a company, an organisation or an
 * insurer: those have a name and a seat instead of a personal identity.
 */
import { ApiRequestError } from "@/lib/api";
import { normalizeCitizenships } from "@/components/ui/citizenship-multi-select";

export type Tx = (ru: string, de: string) => string;

export type PayerKind = "self" | "third_party";

/** What a third-party payer is; every type but `person` is an organisation. */
export const PAYER_TYPES = ["person", "company", "organisation", "insurance"] as const;

export type PayerType = (typeof PAYER_TYPES)[number];

/** How the payer is related to the patient; `other` is described in free text. */
export const PAYER_RELATIONSHIP_KINDS = [
  "spouse",
  "parent",
  "child",
  "relative",
  "employer",
  "friend",
  "business_partner",
  "other",
] as const;

export type PayerRelationshipKind = (typeof PAYER_RELATIONSHIP_KINDS)[number];

export const SOURCE_OF_FUNDS = [
  "employment",
  "business_income",
  "savings",
  "asset_sale",
  "inheritance_gift",
  "other",
] as const;

export type SourceOfFunds = (typeof SOURCE_OF_FUNDS)[number];

export type PayerDeclaration = {
  payer_kind: PayerKind;
  acts_on_own_account: boolean;
  /** False until the lead cabinet or staff gave the answer; absent on an older server. */
  own_account_answered?: boolean;
  beneficial_owner_name: string | null;
  beneficial_owner_note: string | null;
  source_of_funds: SourceOfFunds | null;
  source_of_funds_description: string | null;
  source_of_funds_document_id: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  citizenships: string[];
  relationship: string | null;
  email: string | null;
  phone: string | null;
  payer_informed_at: string | null;
  payer_informed_by: string | null;
  /** Absent on an older server; a third party without a type is a person. */
  payer_type?: PayerType | null;
  /** Name of the company, organisation or insurer. */
  organisation_name?: string | null;
  relationship_kind?: PayerRelationshipKind | null;
  /** When the lead agreed that GMED contacts the payer; only the lead gives it. */
  contact_consent_at?: string | null;
  /**
   * Section 7 of the form (invoice recipient), answered by the lead in the
   * cabinet; absent on an older server. Staff do not edit it: the recipient
   * of an order or an invoice is changed there.
   */
  invoice_to?: InvoiceTo | null;
  invoice_name?: string | null;
  invoice_street?: string | null;
  invoice_zip?: string | null;
  invoice_city?: string | null;
  invoice_country?: string | null;
  invoice_email?: string | null;
  /** The two staff fields of section 7; absent on an older server. */
  invoice_vat_id?: string | null;
  invoice_tax_number?: string | null;
  /** Section 8 (payment route), answered by the payer; read in "Данные от пациента". */
  payment_method?: PaymentMethod | null;
  payment_method_details?: string | null;
  account_country?: string | null;
  account_holder?: string | null;
  bank_name?: string | null;
  via_third_party?: boolean | null;
  via_third_party_details?: string | null;
  patient_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Where the invoice goes: to the patient, to the third-party payer, or to another address. */
export const INVOICE_TO_VALUES = ["self", "payer", "other"] as const;

export type InvoiceTo = (typeof INVOICE_TO_VALUES)[number];

export const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "crypto", "other"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PayerDeclarationStatus = {
  complete: boolean;
  missing: string[];
  cost_assumption: {
    required: boolean;
    document_id: string | null;
    current: boolean;
    signed: boolean;
    signed_at: string | null;
  };
  order_id: string | null;
  order_number: string | null;
  client_signed_order: boolean;
  agency_signed_order: boolean;
  agency_may_sign: boolean;
  agency_blocking: string[];
  aml_countries: string[];
  /**
   * Whether the lead's consent to pass the contact on to the payer is needed:
   * false when the payer is a representative with an own cabinet login (a
   * parent who pays). Null on an older server (the consent line stays as before).
   */
  contact_consent_required?: boolean | null;
};

export type PayerDeclarationResponse = {
  declaration: PayerDeclaration | null;
  status: PayerDeclarationStatus;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * The server response with every status field present; `null` for anything
 * that is not a payer declaration response (e.g. an unexpected proxy reply).
 */
export function normalizePayerDeclarationResponse(value: unknown): PayerDeclarationResponse | null {
  const record = asRecord(value);
  const status = asRecord(record?.status);
  if (!record || !status) return null;
  const costAssumption = asRecord(status.cost_assumption) ?? {};
  const declaration = asRecord(record.declaration);
  return {
    declaration: declaration
      ? {
          ...(declaration as unknown as PayerDeclaration),
          citizenships: stringList(declaration.citizenships),
        }
      : null,
    status: {
      complete: status.complete === true,
      missing: stringList(status.missing),
      cost_assumption: {
        required: costAssumption.required === true,
        document_id: typeof costAssumption.document_id === "string" ? costAssumption.document_id : null,
        current: costAssumption.current === true,
        signed: costAssumption.signed === true,
        signed_at: typeof costAssumption.signed_at === "string" ? costAssumption.signed_at : null,
      },
      order_id: typeof status.order_id === "string" ? status.order_id : null,
      order_number: typeof status.order_number === "string" ? status.order_number : null,
      client_signed_order: status.client_signed_order === true,
      agency_signed_order: status.agency_signed_order === true,
      agency_may_sign: status.agency_may_sign === true,
      agency_blocking: stringList(status.agency_blocking),
      aml_countries: stringList(status.aml_countries),
      // The server sends it with the status and, when there is one, with the declaration.
      contact_consent_required:
        typeof status.contact_consent_required === "boolean"
          ? status.contact_consent_required
          : typeof declaration?.contact_consent_required === "boolean"
            ? declaration.contact_consent_required
            : null,
    },
  };
}

export type PayerDeclarationForm = {
  kind: PayerKind | "";
  actsOnOwnAccount: boolean;
  beneficialOwnerName: string;
  beneficialOwnerNote: string;
  sourceOfFunds: SourceOfFunds | "";
  sourceOfFundsDescription: string;
  sourceOfFundsDocumentId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  placeOfBirth: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  citizenships: string[];
  relationship: string;
  email: string;
  phone: string;
  payerInformed: boolean;
  /** Only meaningful for a third party; a person unless stated otherwise. */
  payerType: PayerType;
  /** Name of the company, organisation or insurer. */
  organisationName: string;
  relationshipKind: PayerRelationshipKind | "";
  payerTypeSupport: PayerTypeSupport;
  /** USt-IdNr. and Steuernummer of the invoice recipient: the staff fields of section 7. */
  invoiceVatId: string;
  invoiceTaxNumber: string;
  /**
   * Whether the server stores the two fields: a loaded declaration carries
   * `invoice_vat_id` or, on an older server, does not — that server rejects
   * the unknown keys, so they are neither offered nor sent.
   */
  invoiceTaxSupport: PayerTypeSupport;
};

/**
 * Whether the server stores the payer type, the organisation name and the
 * relationship kind. A loaded declaration tells: it carries `payer_type` or,
 * on an older server, does not — that server rejects the unknown keys, so
 * they are neither offered nor sent. Without a declaration it is unknown.
 */
export type PayerTypeSupport = "supported" | "unsupported" | "unknown";

export const EMPTY_PAYER_DECLARATION_FORM: PayerDeclarationForm = {
  kind: "",
  actsOnOwnAccount: true,
  beneficialOwnerName: "",
  beneficialOwnerNote: "",
  sourceOfFunds: "",
  sourceOfFundsDescription: "",
  sourceOfFundsDocumentId: "",
  firstName: "",
  lastName: "",
  birthDate: "",
  placeOfBirth: "",
  street: "",
  zip: "",
  city: "",
  country: "",
  citizenships: [],
  relationship: "",
  email: "",
  phone: "",
  payerInformed: false,
  payerType: "person",
  organisationName: "",
  relationshipKind: "",
  payerTypeSupport: "unknown",
  invoiceVatId: "",
  invoiceTaxNumber: "",
  invoiceTaxSupport: "unknown",
};

function isSourceOfFunds(value: string | null | undefined): value is SourceOfFunds {
  return (SOURCE_OF_FUNDS as readonly string[]).includes(value ?? "");
}

function isPayerType(value: unknown): value is PayerType {
  return (PAYER_TYPES as readonly unknown[]).includes(value);
}

function isRelationshipKind(value: unknown): value is PayerRelationshipKind {
  return (PAYER_RELATIONSHIP_KINDS as readonly unknown[]).includes(value);
}

/**
 * What the third-party payer of a declaration is: `null` when the patient
 * pays (or nothing is declared), a person when no type is stored.
 */
export function declaredPayerType(
  declaration: Pick<PayerDeclaration, "payer_kind" | "payer_type"> | null | undefined,
): PayerType | null {
  if (declaration?.payer_kind !== "third_party") return null;
  return isPayerType(declaration.payer_type) ? declaration.payer_type : "person";
}

/** Whether the form describes a company, an organisation or an insurer. */
export function isOrganisationPayerForm(
  form: Pick<PayerDeclarationForm, "kind" | "payerType" | "payerTypeSupport">,
): boolean {
  return form.kind === "third_party"
    && form.payerTypeSupport !== "unsupported"
    && form.payerType !== "person";
}

/**
 * Whether the free-text relationship is asked beside the kind: for "other",
 * and without a kind as long as there is a text — one staff typed before the
 * kinds existed stays visible (also while it is being cleared).
 */
export function payerRelationshipTextShown(
  form: Pick<PayerDeclarationForm, "relationship" | "relationshipKind" | "payerTypeSupport">,
  declaration?: Pick<PayerDeclaration, "relationship" | "relationship_kind"> | null,
): boolean {
  if (form.payerTypeSupport === "unsupported" || form.relationshipKind === "other") return true;
  if (form.relationshipKind !== "") return false;
  const storedWithoutKind = !declaration?.relationship_kind && Boolean(declaration?.relationship?.trim());
  return storedWithoutKind || form.relationship.trim() !== "";
}

/** The stored declaration as form values; an empty form when none exists. */
export function payerDeclarationToForm(
  declaration: PayerDeclaration | null | undefined,
): PayerDeclarationForm {
  if (!declaration) return { ...EMPTY_PAYER_DECLARATION_FORM };
  return {
    kind: declaration.payer_kind,
    actsOnOwnAccount: declaration.acts_on_own_account,
    beneficialOwnerName: declaration.beneficial_owner_name ?? "",
    beneficialOwnerNote: declaration.beneficial_owner_note ?? "",
    sourceOfFunds: isSourceOfFunds(declaration.source_of_funds) ? declaration.source_of_funds : "",
    sourceOfFundsDescription: declaration.source_of_funds_description ?? "",
    sourceOfFundsDocumentId: declaration.source_of_funds_document_id ?? "",
    firstName: declaration.first_name ?? "",
    lastName: declaration.last_name ?? "",
    birthDate: declaration.date_of_birth ?? "",
    placeOfBirth: declaration.place_of_birth ?? "",
    street: declaration.street ?? "",
    zip: declaration.zip ?? "",
    city: declaration.city ?? "",
    country: declaration.country ?? "",
    citizenships: normalizeCitizenships(declaration.citizenships ?? []),
    relationship: declaration.relationship ?? "",
    email: declaration.email ?? "",
    phone: declaration.phone ?? "",
    payerInformed: Boolean(declaration.payer_informed_at),
    payerType: declaredPayerType(declaration) ?? "person",
    organisationName: declaration.organisation_name ?? "",
    relationshipKind: isRelationshipKind(declaration.relationship_kind) ? declaration.relationship_kind : "",
    payerTypeSupport: Object.hasOwn(declaration, "payer_type") ? "supported" : "unsupported",
    invoiceVatId: declaration.invoice_vat_id ?? "",
    invoiceTaxNumber: declaration.invoice_tax_number ?? "",
    invoiceTaxSupport: Object.hasOwn(declaration, "invoice_vat_id") ? "supported" : "unsupported",
  };
}

/**
 * Whether the inputs USt-IdNr. / Steuernummer are offered: not on a server
 * known to reject them.
 */
export function invoiceTaxFieldsShown(form: Pick<PayerDeclarationForm, "invoiceTaxSupport">): boolean {
  return form.invoiceTaxSupport !== "unsupported";
}

/**
 * Whether the save body carries USt-IdNr. / Steuernummer: always for a server
 * known to store them, never for an older one. Before the first save the
 * server is unknown, so they go out only when staff entered one of them.
 */
function sendsInvoiceTax(form: Pick<PayerDeclarationForm, "invoiceTaxSupport" | "invoiceVatId" | "invoiceTaxNumber">): boolean {
  if (form.invoiceTaxSupport !== "unknown") return form.invoiceTaxSupport === "supported";
  return form.invoiceVatId.trim() !== "" || form.invoiceTaxNumber.trim() !== "";
}

/** The keys of the save body for section 7 that staff may set; an older server does not know them. */
export type InvoiceTaxPayload = {
  invoice_vat_id: string | null;
  invoice_tax_number: string | null;
};

/** The keys of the save body an older server does not know. */
export type PayerTypePayload = {
  payer_type: PayerType | null;
  organisation_name: string | null;
  relationship_kind: PayerRelationshipKind | null;
};

/**
 * Whether the save body carries the payer type keys: always for a server
 * known to store them, never for an older one. Before the first save the
 * server is unknown, so they go out only when staff stated something an
 * older server could not keep (an organisation or a relationship kind).
 */
function sendsPayerType(form: PayerDeclarationForm): boolean {
  if (form.payerTypeSupport !== "unknown") return form.payerTypeSupport === "supported";
  return form.kind === "third_party" && (form.payerType !== "person" || form.relationshipKind !== "");
}

/**
 * Body of POST /leads/{id}/payer-declaration. Fields that do not apply are
 * sent empty; the server clears them as well (data minimization): no personal
 * identity for an organisation, no free-text relationship beside a kind that
 * says it all. The lead's contact consent and the lead's answers of sections
 * 7–8 (invoice recipient, payment route) are never part of it: of those the
 * body carries only the two staff fields USt-IdNr. / Steuernummer, and only
 * for a server that knows them (an absent key keeps the stored value).
 */
export function payerDeclarationPayload(form: PayerDeclarationForm) {
  const text = (value: string) => value.trim() || null;
  const thirdParty = form.kind === "third_party";
  const organisation = isOrganisationPayerForm(form);
  const person = thirdParty && !organisation;
  const relationshipText = form.payerTypeSupport === "unsupported"
    || form.relationshipKind === ""
    || form.relationshipKind === "other";
  const typed: Partial<PayerTypePayload> = sendsPayerType(form)
    ? {
        payer_type: thirdParty ? form.payerType : null,
        organisation_name: organisation ? text(form.organisationName) : null,
        relationship_kind: thirdParty ? form.relationshipKind || null : null,
      }
    : {};
  const invoiceTax: Partial<InvoiceTaxPayload> = sendsInvoiceTax(form)
    ? {
        invoice_vat_id: text(form.invoiceVatId),
        invoice_tax_number: text(form.invoiceTaxNumber),
      }
    : {};
  return {
    payer_kind: form.kind || "self",
    acts_on_own_account: form.actsOnOwnAccount,
    beneficial_owner_name: form.actsOnOwnAccount ? null : text(form.beneficialOwnerName),
    beneficial_owner_note: form.actsOnOwnAccount ? null : text(form.beneficialOwnerNote),
    source_of_funds: form.sourceOfFunds || null,
    source_of_funds_description: text(form.sourceOfFundsDescription),
    source_of_funds_document_id: form.sourceOfFundsDocumentId || null,
    first_name: person ? text(form.firstName) : null,
    last_name: person ? text(form.lastName) : null,
    date_of_birth: person ? form.birthDate || null : null,
    place_of_birth: person ? text(form.placeOfBirth) : null,
    street: thirdParty ? text(form.street) : null,
    zip: thirdParty ? text(form.zip) : null,
    city: thirdParty ? text(form.city) : null,
    country: thirdParty ? form.country || null : null,
    citizenships: person ? normalizeCitizenships(form.citizenships) : [],
    relationship: thirdParty && relationshipText ? text(form.relationship) : null,
    email: thirdParty ? text(form.email) : null,
    phone: thirdParty ? text(form.phone) : null,
    payer_informed: thirdParty && form.payerInformed,
    ...typed,
    ...invoiceTax,
  };
}

/**
 * Where the invoice goes, as the lead chose it in the cabinet: "пациенту",
 * "плательщику", "по другому адресу"; "не указано" while unanswered. The
 * same words stand in the wizard and on the patient card.
 */
export function invoiceToLabel(value: InvoiceTo | string | null | undefined, tx: Tx): string {
  switch (value) {
    case "self":
      return tx("пациенту", "an die Patientin / den Patienten");
    case "payer":
      return tx("плательщику", "an die zahlende Person / Organisation");
    case "other":
      return tx("по другому адресу", "an eine andere Adresse");
    default:
      return value ? value : tx("не указано", "nicht angegeben");
  }
}

/**
 * "USt-IdNr. DE123456789 · Steuernummer 12/345/67890": the staff fields of
 * section 7 that are set; "" without either.
 */
export function invoiceTaxLine(
  declaration: Pick<PayerDeclaration, "invoice_vat_id" | "invoice_tax_number"> | null | undefined,
): string {
  const vatId = declaration?.invoice_vat_id?.trim();
  const taxNumber = declaration?.invoice_tax_number?.trim();
  return [vatId ? `USt-IdNr. ${vatId}` : "", taxNumber ? `Steuernummer ${taxNumber}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function payerTypeLabel(value: PayerType, tx: Tx) {
  const labels: Record<PayerType, string> = {
    person: tx("Частное лицо", "Privatperson"),
    company: tx("Компания", "Unternehmen"),
    organisation: tx("Организация", "Organisation"),
    insurance: tx("Страховая", "Versicherung"),
  };
  return labels[value];
}

export function payerRelationshipKindLabel(value: PayerRelationshipKind, tx: Tx) {
  const labels: Record<PayerRelationshipKind, string> = {
    spouse: tx("Супруг / супруга", "Ehepartner/in"),
    parent: tx("Родитель", "Elternteil"),
    child: tx("Сын / дочь", "Kind"),
    relative: tx("Другой родственник", "Andere/r Verwandte/r"),
    employer: tx("Работодатель", "Arbeitgeber"),
    friend: tx("Друг / подруга", "Freund/in"),
    business_partner: tx("Деловой партнёр", "Geschäftspartner/in"),
    other: tx("Другое (уточните)", "Sonstiges (bitte angeben)"),
  };
  return labels[value];
}

export function sourceOfFundsLabel(value: SourceOfFunds, tx: Tx) {
  const labels: Record<SourceOfFunds, string> = {
    employment: tx("Заработная плата / работа по найму", "Gehalt / nichtselbständige Arbeit"),
    business_income: tx("Доход от предпринимательской деятельности", "Einkünfte aus Unternehmen / selbständiger Tätigkeit"),
    savings: tx("Сбережения", "Ersparnisse"),
    asset_sale: tx("Продажа имущества", "Verkauf von Vermögenswerten"),
    inheritance_gift: tx("Наследство / дарение", "Erbschaft / Schenkung"),
    other: tx("Другое (опишите)", "Sonstiges (bitte beschreiben)"),
  };
  return labels[value];
}

/**
 * What "the payer's details are incomplete" asks for: the personal identity
 * of a person, the name and the seat of an organisation. Where the payer type
 * is not at hand (readiness list, signature gate) the text names both.
 */
function payerIdentityIncompleteLabel(tx: Tx, payerType?: PayerType | null) {
  if (payerType === "person") {
    return tx(
      "Заполните данные плательщика: имя, дату рождения, адрес, гражданство",
      "Angaben zum Kostenübernehmer ergänzen: Name, Geburtsdatum, Anschrift, Staatsangehörigkeit",
    );
  }
  if (payerType) {
    return tx(
      "Заполните данные плательщика: название и юридический адрес",
      "Angaben zum Kostenübernehmer ergänzen: Name und Sitz (Anschrift)",
    );
  }
  return tx(
    "Заполните данные плательщика: имя, дату рождения, адрес, гражданство (для организации — название и юридический адрес)",
    "Angaben zum Kostenübernehmer ergänzen: Name, Geburtsdatum, Anschrift, Staatsangehörigkeit (bei Organisationen: Name und Sitz)",
  );
}

/**
 * Localized text for a payer reason code of the server. With the payer type
 * the incomplete identity is worded for that type.
 */
export function payerReasonLabel(code: string, tx: Tx, payerType?: PayerType | null) {
  const labels: Record<string, string> = {
    payer_declaration_missing: tx("Заполните раздел «Кто платит»", "Angaben „Wer zahlt“ ausfüllen"),
    payer_beneficial_owner_missing: tx("Укажите, в чьих интересах действует клиент", "Wirtschaftlich Berechtigten angeben"),
    payer_source_of_funds_missing: tx("Укажите источник средств", "Herkunft der Mittel angeben"),
    payer_identity_incomplete: payerIdentityIncompleteLabel(tx, payerType),
    payer_not_informed: tx("Подтвердите, что плательщик проинформирован об обработке его данных", "Bestätigen, dass der Kostenübernehmer über die Verarbeitung seiner Daten informiert wurde"),
    cost_assumption_missing: tx("Создайте согласие плательщика (Kostenübernahmeerklärung)", "Kostenübernahmeerklärung erstellen"),
    cost_assumption_outdated: tx("Плательщик изменён — создайте новое согласие плательщика", "Kostenübernehmer geändert – neue Kostenübernahmeerklärung erstellen"),
    cost_assumption_unsigned: tx("Получите подпись плательщика на согласии", "Unterschrift des Kostenübernehmers einholen"),
    client_order_signature_missing: tx("Сначала клиент подписывает заказ", "Zuerst unterschreibt der Kunde den Auftrag"),
  };
  return labels[code] ?? tx("Проверьте данные плательщика", "Angaben zum Zahler prüfen");
}

/**
 * The badge beside "Кто платит": complete, or waiting only for the
 * Kostenübernahmeerklärung (created later, in the contract step, once the
 * order exists), or still incomplete.
 */
export function payerStatusBadge(
  status: Pick<PayerDeclarationStatus, "complete" | "missing"> | null | undefined,
  tx: Tx,
): { tone: "success" | "info" | "warning"; label: string } {
  if (status?.complete) return { tone: "success", label: tx("Заполнено", "Vollständig") };
  if (status && status.missing.length > 0 && status.missing.every((code) => code === "cost_assumption_missing")) {
    return { tone: "info", label: tx("ждёт Kostenübernahmeerklärung", "wartet auf Kostenübernahmeerklärung") };
  }
  return { tone: "warning", label: tx("Не заполнено", "Unvollständig") };
}

/** English readiness reasons of the server (lead readiness) → reason code. */
export const PAYER_READINESS_REASON_CODES: Record<string, string> = {
  "Payer declaration is missing": "payer_declaration_missing",
  "Beneficial owner is not named": "payer_beneficial_owner_missing",
  "Source of funds is missing": "payer_source_of_funds_missing",
  "Third-party payer details are incomplete": "payer_identity_incomplete",
  "Payer is not informed about the processing of their data": "payer_not_informed",
  "Cost assumption declaration is missing": "cost_assumption_missing",
  "Cost assumption declaration names another payer": "cost_assumption_outdated",
  "Cost assumption declaration is not signed": "cost_assumption_unsigned",
};

/** Labels for the wizard's readiness list (keyed by the server reason). */
export function payerReadinessReasonLabels(tx: Tx): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PAYER_READINESS_REASON_CODES).map(([reason, code]) => [
      reason,
      payerReasonLabel(code, tx),
    ]),
  );
}

/** Every payer readiness reason belongs to the documents step. */
export function payerReadinessReasonSteps(): Record<string, "documents"> {
  return Object.fromEntries(
    Object.keys(PAYER_READINESS_REASON_CODES).map((reason) => [reason, "documents" as const]),
  );
}

/** Field the wizard focuses for a payer readiness reason. */
export const PAYER_SECTION_ID = "lead-wizard-payer-declaration";

/** Every payer readiness reason focuses the payer section. */
export function payerReadinessReasonFields(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(PAYER_READINESS_REASON_CODES).map((reason) => [reason, PAYER_SECTION_ID]),
  );
}

/**
 * The 409 `payer_gate_blocked` of the server (GMED tried to countersign too
 * early), as one localized sentence; `null` for other errors.
 */
export function payerGateErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError) || error.body?.error !== "payer_gate_blocked") {
    return null;
  }
  const reasons = Array.isArray(error.body.reasons)
    ? error.body.reasons.filter((value): value is string => typeof value === "string")
    : [];
  const prefix = tx(
    "GMED подписывает только после клиента и плательщика: ",
    "GMED unterschreibt erst nach dem Kunden und dem Kostenübernehmer: ",
  );
  return prefix + (reasons.length > 0
    ? reasons.map((code) => payerReasonLabel(code, tx)).join("; ")
    : tx("проверьте раздел «Кто платит»", "Angaben „Wer zahlt“ prüfen"));
}

/** Countries of a third-party payer for the AML country risk. */
export function payerAmlCountries(response: PayerDeclarationResponse | null | undefined): string[] {
  const declaration = response?.declaration;
  if (!declaration || declaration.payer_kind !== "third_party") return [];
  return normalizeCitizenships([
    ...(declaration.country ? [declaration.country] : []),
    ...(declaration.citizenships ?? []),
  ]);
}

export type SignatureStepState = "done" | "pending" | "not_required";

/**
 * The signing order shown in the commercial step:
 * client → payer (third party only) → GMED.
 */
export function payerSignatureSequence(status: PayerDeclarationStatus | null | undefined): {
  client: SignatureStepState;
  payer: SignatureStepState;
  agency: SignatureStepState;
} {
  if (!status) return { client: "pending", payer: "pending", agency: "pending" };
  return {
    client: status.client_signed_order ? "done" : "pending",
    payer: status.cost_assumption.required
      ? (status.cost_assumption.signed ? "done" : "pending")
      : "not_required",
    agency: status.agency_signed_order ? "done" : "pending",
  };
}

/** What the form still lacks before it can be saved as complete (UI hint). */
export function payerFormMissing(form: PayerDeclarationForm): string[] {
  const missing: string[] = [];
  if (!form.kind) return ["payer_declaration_missing"];
  if (!form.actsOnOwnAccount && !form.beneficialOwnerName.trim()) {
    missing.push("payer_beneficial_owner_missing");
  }
  if (!form.sourceOfFunds || (form.sourceOfFunds === "other" && !form.sourceOfFundsDescription.trim())) {
    missing.push("payer_source_of_funds_missing");
  }
  if (form.kind === "third_party") {
    // A person is identified personally, an organisation by its name; both
    // need the address (for an organisation the seat).
    const organisation = isOrganisationPayerForm(form);
    const identity = organisation
      ? [form.organisationName]
      : [form.firstName, form.lastName, form.birthDate];
    const address = [form.street, form.zip, form.city, form.country];
    if (
      [...identity, ...address].some((value) => !value.trim())
      || (!organisation && form.citizenships.length === 0)
    ) {
      missing.push("payer_identity_incomplete");
    }
    if (!form.payerInformed) missing.push("payer_not_informed");
  }
  return missing;
}
