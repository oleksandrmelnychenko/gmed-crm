import { ApiRequestError } from "@/lib/api";
import type { DocumentItem } from "@/pages/documents/model/types";

/**
 * The GwG identification sheet ("Dokumentationsbogen für natürliche
 * Personen") of a lead: one for the patient and one for a third-party payer.
 * A minor has no sheet of his own — each legal representative gets one. The
 * representative and the legal guardian an adult named in the cabinet get one
 * each beside the adult's own (owner decision 2026-10-10). The server fills
 * the sheet from the lead; the only choice is whose sheet it is. A payer
 * that is a company, an organisation or an insurer gets the sheet for legal
 * entities under the same subject `payer` (owner decision 2026-10-22).
 */
export const GWG_IDENTIFICATION_TEMPLATE = "gwg_identification";

/**
 * A person who acts for the lead — a legal representative of a minor, or an
 * adult's representative or legal guardian: `representative:<id of the trusted contact>`.
 */
export type GwgRepresentativeSubject = `representative:${string}`;

export type GwgSheetSubject = "contract_partner" | "payer" | GwgRepresentativeSubject;

type Tx = (ru: string, de: string) => string;

const REPRESENTATIVE_PREFIX = "representative:";

export function gwgRepresentativeSubject(representativeId: string): GwgRepresentativeSubject {
  return `${REPRESENTATIVE_PREFIX}${representativeId}`;
}

function isRepresentativeSubject(value: unknown): value is GwgRepresentativeSubject {
  return typeof value === "string" && value.startsWith(REPRESENTATIVE_PREFIX) && value.length > REPRESENTATIVE_PREFIX.length;
}

/** Whose sheet a stored document is; older or foreign documents count as the patient's. */
export function gwgSheetSubject(document: Pick<DocumentItem, "generated_bindings">): GwgSheetSubject {
  const binding = document.generated_bindings?.gwg_identification;
  const subject = binding && typeof binding === "object" ? (binding as { subject?: unknown }).subject : null;
  if (isRepresentativeSubject(subject)) return subject;
  return subject === "payer" ? "payer" : "contract_partner";
}

/** The current sheet of that person, which a new one replaces as the next version. */
export function currentGwgSheet(
  documents: readonly DocumentItem[],
  subject: GwgSheetSubject,
): DocumentItem | undefined {
  return documents
    .filter((document) =>
      document.generated_template_id === GWG_IDENTIFICATION_TEMPLATE
      && !document.file_deleted_at
      && document.is_latest_version !== false
      && gwgSheetSubject(document) === subject)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

/**
 * Request body of `POST /documents/generate` for the sheet of a lead. The
 * server names the document after the person on the sheet ("Dokumentations-
 * bogen natürliche Personen · <name> · <date>"), so no name is sent.
 */
export function gwgSheetRequest(input: {
  leadId: string;
  subject: GwgSheetSubject;
  orderId?: string | null;
  orderNumber?: string | null;
  /**
   * The current sheet the new one replaces. A replacement keeps the order
   * context of that sheet (the server refuses another one), whichever of the
   * wizard or the lead row made it.
   */
  replaceDocument?: Pick<DocumentItem, "id" | "order_id"> | null;
}): Record<string, unknown> {
  const replaced = input.replaceDocument ?? null;
  const orderId = replaced ? replaced.order_id : (input.orderId ?? null);
  const orderNumber = orderId && orderId === input.orderId ? input.orderNumber : undefined;
  return {
    template_id: GWG_IDENTIFICATION_TEMPLATE,
    lead_id: input.leadId,
    order_id: orderId ?? undefined,
    replace_document_id: replaced?.id ?? undefined,
    language: "de",
    document_language: "de",
    document_direction: "outgoing",
    document_variant: "original",
    access_category: "patient",
    status: "active",
    bindings: {
      order_number: orderNumber ?? undefined,
      gwg_identification: { subject: input.subject },
    },
  };
}

/**
 * Document types of the lead-cabinet uploads for a person who acts for the
 * lead: the identity document and the proof of authority of a representative.
 * They are deliberately not `identity`: a parent's passport is not the child's
 * identity document.
 */
const REPRESENTATIVE_UPLOAD_ARTS = new Set(["representative_identity", "representative_authority"]);

export function isRepresentativeUploadArt(art: string | null | undefined): boolean {
  return REPRESENTATIVE_UPLOAD_ARTS.has((art ?? "").trim().toLowerCase());
}

/**
 * Document types of the payer's own uploads on the payer link: the payer's
 * identity document and the proof of the source of funds. Filed with the
 * lead (category `identity`), they are never the patient's documents.
 */
const PAYER_UPLOAD_ARTS = new Set(["payer_identity", "payer_funds_proof"]);

/**
 * An upload about another person than the patient — a representative's or
 * the payer's — although its category or type says "identity": it is never
 * shown or confirmed as the patient's identity document.
 */
export function isOtherPersonUploadArt(art: string | null | undefined): boolean {
  const key = (art ?? "").trim().toLowerCase();
  return REPRESENTATIVE_UPLOAD_ARTS.has(key) || PAYER_UPLOAD_ARTS.has(key);
}

export type GwgSheetButton = {
  subject: GwgSheetSubject;
  /** The representative the sheet is for; "" for the patient and the payer. */
  personName: string;
  /**
   * The payer is a company, an organisation or an insurer: the server makes
   * the sheet for legal entities (owner decision 2026-10-22).
   */
  organisation?: true;
};

/** `generated_bindings.gwg_identification.form` of the sheet for legal entities. */
export const GWG_LEGAL_ENTITY_FORM = "legal_entity";

/** Whether a stored sheet is the one for legal entities (a paying organisation). */
export function isGwgLegalEntitySheet(document: Pick<DocumentItem, "generated_bindings">): boolean {
  const binding = document.generated_bindings?.gwg_identification;
  const form = binding && typeof binding === "object" ? (binding as { form?: unknown }).form : null;
  return form === GWG_LEGAL_ENTITY_FORM;
}

/**
 * The representative (slot `agent`) and the legal guardian (slot `guardian`)
 * an adult named in the cabinet: the cabinet gives these slots only while the
 * lead answered "yes" to the question. Each gets an own sheet.
 */
const ADULT_ACTING_SLOTS = new Set(["agent", "guardian"]);

export function adultActingPersons<T extends { slot: string | null }>(
  representatives: readonly T[] | null | undefined,
): T[] {
  return (representatives ?? []).filter((person) => person.slot !== null && ADULT_ACTING_SLOTS.has(person.slot));
}

/**
 * Which sheets the wizard offers. Adult: the patient's, one for each person
 * who acts for the adult (representative, legal guardian) and, for a
 * third-party payer, the payer's — for a company, an organisation or an
 * insurer the sheet for legal entities (owner decision 2026-10-22). Minor:
 * one per legal representative and none for the child; the payer's own sheet
 * is left out when the payer is one of the representatives (the same person
 * gets one sheet), with a note that says so.
 */
export type GwgSheetPlan = {
  buttons: GwgSheetButton[];
  /** A minor without a parent or guardian on file: no sheet can be made yet. */
  lacksRepresentative: boolean;
  /** The payer is a company, an organisation or an insurer: its button makes the sheet for legal entities. */
  payerIsOrganisation: boolean;
  /** The name of the representative the payer is the same person as; null otherwise. */
  payerSamePersonName: string | null;
};

export function gwgSheetPlan(input: {
  minor: boolean;
  /** The legal representatives of a minor; not read for an adult. */
  representatives: ReadonlyArray<{ id: string; name: string }>;
  /**
   * The representative and the legal guardian an adult named in the cabinet
   * ({@link adultActingPersons}); not read for a minor.
   */
  actingPersons?: ReadonlyArray<{ id: string; name: string }>;
  /** The payer declaration: who pays and, for a third party, what the payer is. */
  payer: { payer_kind?: string | null; payer_type?: string | null } | null | undefined;
  /** The name of the representative the payer is the same person as (identification status). */
  payerSamePersonName?: string | null;
  /**
   * The identification status has not answered yet, so it is not known whether
   * the payer of a minor is one of the representatives: the payer's sheet is
   * not offered until it is.
   */
  payerSamePersonUnknown?: boolean;
}): GwgSheetPlan {
  const representativeButton = (person: { id: string; name: string }): GwgSheetButton => ({
    subject: gwgRepresentativeSubject(person.id),
    personName: person.name.trim(),
  });
  const buttons: GwgSheetButton[] = input.minor
    ? input.representatives.map(representativeButton)
    : [
        { subject: "contract_partner", personName: "" },
        ...(input.actingPersons ?? []).map(representativeButton),
      ];
  const thirdParty = input.payer?.payer_kind === "third_party";
  // A declaration stored before the payer type existed is a private person.
  const payerIsOrganisation = thirdParty && (input.payer?.payer_type ?? "person") !== "person";
  const privatePayer = thirdParty && !payerIsOrganisation;
  const samePerson = privatePayer && input.minor ? input.payerSamePersonName ?? null : null;
  const undecided = input.minor && input.payerSamePersonUnknown === true;
  if (privatePayer && samePerson === null && !undecided) {
    buttons.push({ subject: "payer", personName: "" });
  }
  // An organisation is never one of the parents: nothing to wait for.
  if (payerIsOrganisation) {
    buttons.push({ subject: "payer", personName: "", organisation: true });
  }
  return {
    buttons,
    lacksRepresentative: input.minor && input.representatives.length === 0,
    payerIsOrganisation,
    payerSamePersonName: samePerson,
  };
}

/**
 * «Подтвердить подпись» of the sheet for legal entities is refused while the
 * organisation's data are incomplete (422 `payer_details_incomplete`, keys
 * `payer_<field>` in `missing`).
 */
export const PAYER_DETAILS_INCOMPLETE = "payer_details_incomplete";

/**
 * A refusal of the server to make a sheet — or to confirm the signature of
 * the sheet for legal entities —, as localized text; `null` for other
 * errors. The server names the reason in `error` and `code`.
 */
export function gwgSheetErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const codes = [error.body?.code, error.body?.error, error.code];
  if (codes.includes("minor_sheet_per_representative")) {
    return tx(
      "Пациент несовершеннолетний: лист формируется на каждого законного представителя, а не на ребёнка. Обновите страницу и выберите представителя",
      "Der Patient ist minderjährig: Der Bogen wird je gesetzlicher Vertreterin / gesetzlichem Vertreter erstellt, nicht für das Kind. Bitte die Seite aktualisieren und die Vertretung auswählen",
    );
  }
  if (codes.includes("representative_sheet_not_available")) {
    return tx(
      "Для этого человека лист сформировать нельзя: он не числится законным представителем несовершеннолетнего. Представителем или опекуном (Betreuer) взрослого пациента в кабинете он тоже не указан. Обновите страницу и проверьте данные о представителях",
      "Für diese Person kann kein Bogen erstellt werden: Sie ist nicht als gesetzliche Vertretung eines Minderjährigen erfasst. Als Vertreter/in oder Betreuer/in eines volljährigen Patienten ist sie im Kundenkabinett ebenfalls nicht angegeben. Bitte die Seite aktualisieren und die Angaben zur Vertretung prüfen",
    );
  }
  if (codes.includes("payer_is_representative")) {
    return tx(
      "Платит родитель / законный представитель ребёнка: он идентифицируется на листе представителя, отдельного листа плательщика нет",
      "Es zahlt ein Elternteil / gesetzlicher Vertreter des Kindes: Er wird auf seinem Vertreterbogen identifiziert, ein eigener Zahlerbogen entfällt",
    );
  }
  if (codes.includes("payer_is_not_a_natural_person")) {
    return tx(
      "Для организации лист для физических лиц не формируется",
      "Für Organisationen wird der Bogen für natürliche Personen nicht erstellt",
    );
  }
  if (codes.includes(PAYER_DETAILS_INCOMPLETE)) {
    return gwgPayerSheetMissingText(error.body?.missing, tx);
  }
  return null;
}

const PAYER_SHEET_FIELD_LABELS: Record<string, [string, string]> = {
  statement_not_submitted: ["плательщик ещё не отправил ответы по своей ссылке", "Angaben des Kostenübernehmers über den eigenen Zugang fehlen"],
  not_an_organisation: ["плательщик больше не организация — сформируйте лист заново", "der Zahler ist keine Organisation mehr – Bogen neu erstellen"],
  organisation_name: ["название", "Firma / Name"],
  legal_form: ["правовая форма", "Rechtsform"],
  seat_address: ["юридический адрес", "Sitz / Anschrift"],
  representative_name: ["представитель организации", "vertretungsberechtigte Person"],
  id_document_type: ["вид документа представителя", "Ausweisart der vertretungsberechtigten Person"],
  id_document_number: ["номер документа", "Ausweisnummer"],
  id_issuing_authority: ["кем выдан документ", "ausstellende Behörde"],
  id_issuing_country: ["страна выдачи документа", "Ausstellungsland"],
  id_valid_until: ["срок действия документа", "gültig bis"],
  id_document_expired: ["документ просрочен — нужен действующий", "Ausweis abgelaufen – ein gültiger ist nötig"],
  id_document_unreadable: ["документ нечитаем — нужен новый скан", "Ausweis unleserlich – neuer Scan nötig"],
  id_document_number_invalid: ["номер документа в неверном формате", "Ausweisnummer im falschen Format"],
  id_issuing_country_invalid: ["страна выдачи не из списка", "Ausstellungsland nicht aus der Liste"],
  id_dates_invalid: ["даты документа не сходятся", "Ausweisdaten passen nicht zusammen"],
  id_upload: ["скан документа представителя", "Ausweiskopie der vertretungsberechtigten Person"],
  beneficial_owners: ["бенефициары (или ответ «нет лиц с долей более 25 %»)", "wirtschaftlich Berechtigte (oder „keine Person über 25 %“)"],
  payment_reason: ["причина оплаты", "Zweck der Zahlung"],
  pep: ["ответы о PEP", "Angaben zu PEP"],
  sanctions_links: ["ответ о связях с санкциями", "Angabe zu Sanktionsverbindungen"],
  funds: ["источник средств", "Herkunft der Mittel"],
};

/**
 * "Подтвердить подпись нельзя: не хватает данных организации-плательщика: …"
 * from the keys of the refusal; unknown keys are shown as they are.
 */
export function gwgPayerSheetMissingText(missing: unknown, tx: Tx): string {
  const labels = gwgPayerSheetMissingLabels(missing, tx);
  const base = tx(
    "Подтвердить подпись нельзя: не хватает данных организации-плательщика",
    "Die Unterschrift kann nicht bestätigt werden: Es fehlen Angaben der zahlenden Organisation",
  );
  const hint = gwgPayerSheetHint(tx);
  return labels.length > 0 ? `${base}: ${labels.join(", ")}. ${hint}` : `${base}. ${hint}`;
}

/** The paying organisation's missing data in words (keys of the refusal; unknown keys as they are). */
export function gwgPayerSheetMissingLabels(missing: unknown, tx: Tx): string[] {
  const labels: string[] = [];
  for (const key of Array.isArray(missing) ? missing : []) {
    if (typeof key !== "string") continue;
    const field = key.startsWith("payer_") ? key.slice("payer_".length) : key;
    const pair = PAYER_SHEET_FIELD_LABELS[field];
    const label = pair ? tx(...pair) : field.replaceAll("_", " ");
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** Who enters the paying organisation's data, and that the sheet is made again afterwards. */
export function gwgPayerSheetHint(tx: Tx): string {
  return tx(
    "Данные вносит плательщик по своей ссылке или сотрудники в разделе «Кто платит»; затем сформируйте лист заново.",
    "Die Angaben macht der Kostenübernehmer über den eigenen Zugang oder das Team unter „Wer zahlt“; danach den Bogen neu erstellen.",
  );
}

/** The refusal names the paying organisation's data: the wizard offers the way to the payer section. */
export function isGwgPayerSheetIncomplete(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return [error.body?.code, error.body?.error, error.code].includes(PAYER_DETAILS_INCOMPLETE);
}
