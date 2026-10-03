/**
 * "Кто платит" — the payer declaration of a lead (owner decision 2026-10-03).
 *
 * Part of the compliance step (GwG): whether the patient pays or a third party
 * does, the beneficial owner, the source of funds and, for a third-party
 * payer, identity, residence and citizenships. A third-party payer signs a
 * Kostenübernahmeerklärung (Schuldbeitritt); GMED countersigns the contract and
 * the order only after the client and the payer (server-side gate).
 */
import { ApiRequestError } from "@/lib/api";
import { normalizeCitizenships } from "@/components/ui/citizenship-multi-select";

export type Tx = (ru: string, de: string) => string;

export type PayerKind = "self" | "third_party";

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
  patient_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

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
};

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
};

function isSourceOfFunds(value: string | null | undefined): value is SourceOfFunds {
  return (SOURCE_OF_FUNDS as readonly string[]).includes(value ?? "");
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
  };
}

/**
 * Body of POST /leads/{id}/payer-declaration. Fields that do not apply are
 * sent empty; the server clears them as well (data minimization).
 */
export function payerDeclarationPayload(form: PayerDeclarationForm) {
  const text = (value: string) => value.trim() || null;
  const thirdParty = form.kind === "third_party";
  return {
    payer_kind: form.kind || "self",
    acts_on_own_account: form.actsOnOwnAccount,
    beneficial_owner_name: form.actsOnOwnAccount ? null : text(form.beneficialOwnerName),
    beneficial_owner_note: form.actsOnOwnAccount ? null : text(form.beneficialOwnerNote),
    source_of_funds: form.sourceOfFunds || null,
    source_of_funds_description: text(form.sourceOfFundsDescription),
    source_of_funds_document_id: form.sourceOfFundsDocumentId || null,
    first_name: thirdParty ? text(form.firstName) : null,
    last_name: thirdParty ? text(form.lastName) : null,
    date_of_birth: thirdParty ? form.birthDate || null : null,
    place_of_birth: thirdParty ? text(form.placeOfBirth) : null,
    street: thirdParty ? text(form.street) : null,
    zip: thirdParty ? text(form.zip) : null,
    city: thirdParty ? text(form.city) : null,
    country: thirdParty ? form.country || null : null,
    citizenships: thirdParty ? normalizeCitizenships(form.citizenships) : [],
    relationship: thirdParty ? text(form.relationship) : null,
    email: thirdParty ? text(form.email) : null,
    phone: thirdParty ? text(form.phone) : null,
    payer_informed: thirdParty && form.payerInformed,
  };
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

/** Localized text for a payer reason code of the server. */
export function payerReasonLabel(code: string, tx: Tx) {
  const labels: Record<string, string> = {
    payer_declaration_missing: tx("Заполните раздел «Кто платит»", "Angaben „Wer zahlt“ ausfüllen"),
    payer_beneficial_owner_missing: tx("Укажите, в чьих интересах действует клиент", "Wirtschaftlich Berechtigten angeben"),
    payer_source_of_funds_missing: tx("Укажите источник средств", "Herkunft der Mittel angeben"),
    payer_identity_incomplete: tx("Заполните данные плательщика: имя, дату рождения, адрес, гражданство", "Angaben zum Kostenübernehmer ergänzen: Name, Geburtsdatum, Anschrift, Staatsangehörigkeit"),
    payer_not_informed: tx("Подтвердите, что плательщик проинформирован об обработке его данных", "Bestätigen, dass der Kostenübernehmer über die Verarbeitung seiner Daten informiert wurde"),
    cost_assumption_missing: tx("Создайте согласие плательщика (Kostenübernahmeerklärung)", "Kostenübernahmeerklärung erstellen"),
    cost_assumption_outdated: tx("Плательщик изменён — создайте новое согласие плательщика", "Kostenübernehmer geändert – neue Kostenübernahmeerklärung erstellen"),
    cost_assumption_unsigned: tx("Получите подпись плательщика на согласии", "Unterschrift des Kostenübernehmers einholen"),
    client_order_signature_missing: tx("Сначала клиент подписывает заказ", "Zuerst unterschreibt der Kunde den Auftrag"),
  };
  return labels[code] ?? tx("Проверьте данные плательщика", "Angaben zum Zahler prüfen");
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
    const identity = [form.firstName, form.lastName, form.birthDate, form.street, form.zip, form.city, form.country];
    if (identity.some((value) => !value.trim()) || form.citizenships.length === 0) {
      missing.push("payer_identity_incomplete");
    }
    if (!form.payerInformed) missing.push("payer_not_informed");
  }
  return missing;
}
