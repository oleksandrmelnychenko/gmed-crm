/**
 * Identity document data entered by staff from the uploaded scan (trigger
 * flow 2026-10-07: the lead only uploads the document). One source on the
 * server (`lead_gwg_declarations` / `lead_representatives`): the GwG sheet,
 * the portal state and the conversion read it. A past "valid until" is
 * stored (it counts as trigger T12, like "Ausweis unleserlich"), but such a
 * document never identifies: confirming the GwG sheet is refused.
 *
 * The rules are the server's (`services/identity_document.rs`), so a field
 * error shows at the field before the save and the same 422 never comes back.
 */
import { ApiRequestError } from "@/lib/api";
import { appDateKeyOf, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { COUNTRY_CODES, countryCodeFromStoredValue } from "@/components/ui/country-select";

import type { IdentityDocumentDataInput } from "../data/lead-risk-api";
import type { Tx } from "./lead-payer";
import type { LeadStaffIdDataMarks } from "./lead-risk-intake";

export const ID_DOCUMENT_TYPES = ["passport", "id_card", "residence_permit"] as const;

/** The stored values the form starts from (the portal state's identification or a representative). */
export type IdentityDocumentSource = {
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
} & LeadStaffIdDataMarks;

export type IdentityDocumentDraft = {
  type: string;
  number: string;
  authority: string;
  country: string;
  issuedOn: string;
  validUntil: string;
  unreadable: boolean;
};

export type IdentityDocumentField = "type" | "number" | "authority" | "country" | "issuedOn" | "validUntil";

/** What a complete document needs (the server's `REQUIRED_FIELDS`, in form order). */
export const ID_DOCUMENT_REQUIRED: readonly IdentityDocumentField[] = ["type", "number", "authority", "country", "validUntil"];

/** The server's key of a form field and back. */
const SERVER_FIELD: Record<IdentityDocumentField, keyof IdentityDocumentDataInput> = {
  type: "id_document_type",
  number: "id_document_number",
  authority: "id_issuing_authority",
  country: "id_issuing_country",
  issuedOn: "id_issued_on",
  validUntil: "id_valid_until",
};

export function identityDocumentFieldOf(serverField: unknown): IdentityDocumentField | null {
  const entry = Object.entries(SERVER_FIELD).find(([, key]) => key === serverField);
  return entry ? (entry[0] as IdentityDocumentField) : null;
}

export const ID_NUMBER_MIN_ALPHANUMERICS = 5;
export const ID_NUMBER_MAX_CHARS = 30;

const dateKey = (value: string | null | undefined) => appDateKeyOf(value);

/**
 * The form values of a stored document; `fallbackValidUntil` is the wizard's
 * old "passport valid until", read only while staff never entered document
 * data in the new place (`id_data_entered_at` unset; it is never written
 * again). A date staff cleared and stored stays empty (DEV 2026-10-24: the
 * old date came back after the save). A stored country name becomes its code.
 */
export function identityDocumentDraft(
  source: IdentityDocumentSource | null | undefined,
  fallbackValidUntil = "",
): IdentityDocumentDraft {
  const fallback = source?.id_data_entered_at ? "" : dateKey(fallbackValidUntil);
  return {
    type: source?.id_document_type ?? "",
    number: source?.id_document_number ?? "",
    authority: source?.id_issuing_authority ?? "",
    country: countryCodeFromStoredValue(source?.id_issuing_country) || (source?.id_issuing_country ?? "").trim().toUpperCase(),
    issuedOn: dateKey(source?.id_issued_on),
    validUntil: dateKey(source?.id_valid_until) || fallback,
    unreadable: source?.id_document_unreadable === true,
  };
}

/** A document number as stored: spaces collapsed, upper case. */
export function normalizeDocumentNumber(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ").toUpperCase();
}

const orNull = (value: string) => (value.trim() ? value.trim().split(/\s+/).join(" ") : null);

/** The PUT body: empty fields are null, the number normalised. */
export function identityDocumentInput(draft: IdentityDocumentDraft): IdentityDocumentDataInput {
  return {
    id_document_type: orNull(draft.type),
    id_document_number: orNull(normalizeDocumentNumber(draft.number)),
    id_issuing_authority: orNull(draft.authority),
    id_issuing_country: orNull(draft.country)?.toUpperCase() ?? null,
    id_issued_on: orNull(draft.issuedOn),
    id_valid_until: orNull(draft.validUntil),
    id_document_unreadable: draft.unreadable,
  };
}

export function identityDocumentDraftChanged(current: IdentityDocumentDraft, saved: IdentityDocumentDraft): boolean {
  return JSON.stringify(identityDocumentInput(current)) !== JSON.stringify(identityDocumentInput(saved));
}

/** Whether the document has expired on `today` (Berlin date key); the last day still counts. */
export function identityDocumentExpired(draft: IdentityDocumentDraft, today: string): boolean {
  return Boolean(draft.validUntil) && draft.validUntil < today;
}

/** An issue date on or after the expiry date is a typing error. */
export function identityDocumentDatesInvalid(draft: IdentityDocumentDraft): boolean {
  return Boolean(draft.issuedOn && draft.validUntil) && draft.issuedOn >= draft.validUntil;
}

/** Codes of a field that breaks a rule (the server's 422 codes). */
export type IdentityDocumentErrorCode =
  | "id_document_number_invalid"
  | "id_document_number_too_short"
  | "id_document_number_too_long"
  | "id_issuing_country_invalid"
  | "id_issued_on_future"
  | "id_issued_on_too_early"
  | "id_issued_on_before_birth"
  | "id_valid_until_before_issue"
  | "id_document_type_invalid";

export type IdentityDocumentErrors = Partial<Record<IdentityDocumentField, IdentityDocumentErrorCode>>;

/** The rules of each filled field, the same as the server's; empty fields are no error. */
export function identityDocumentFieldErrors(
  draft: IdentityDocumentDraft,
  { today, birthDate }: { today: string; birthDate?: string | null },
): IdentityDocumentErrors {
  const errors: IdentityDocumentErrors = {};
  if (draft.type && !(ID_DOCUMENT_TYPES as readonly string[]).includes(draft.type)) errors.type = "id_document_type_invalid";
  const number = normalizeDocumentNumber(draft.number);
  if (number) {
    if (!/^[A-Z0-9 <-]+$/.test(number)) errors.number = "id_document_number_invalid";
    else if (number.length > ID_NUMBER_MAX_CHARS) errors.number = "id_document_number_too_long";
    else if ((number.match(/[A-Z0-9]/g) ?? []).length < ID_NUMBER_MIN_ALPHANUMERICS) errors.number = "id_document_number_too_short";
  }
  if (draft.country && !COUNTRY_CODES.includes(draft.country.toUpperCase())) errors.country = "id_issuing_country_invalid";
  const birth = dateKey(birthDate);
  if (draft.issuedOn) {
    if (draft.issuedOn > today) errors.issuedOn = "id_issued_on_future";
    else if (draft.issuedOn < "1900-01-01") errors.issuedOn = "id_issued_on_too_early";
    else if (birth && draft.issuedOn < birth) errors.issuedOn = "id_issued_on_before_birth";
  }
  if (identityDocumentDatesInvalid(draft)) errors.validUntil = "id_valid_until_before_issue";
  return errors;
}

/**
 * What a save may send: the typed values, except a field that breaks a rule,
 * which keeps its stored value (it stays typed in the form with its error).
 * One wrong field never holds back the others (DEV 2026-10-22: the number,
 * the authority and the country never reached the server). `null` when even
 * the stored values do not fit together with the typed ones.
 */
export function identityDocumentSavableDraft(
  draft: IdentityDocumentDraft,
  stored: IdentityDocumentDraft,
  rules: { today: string; birthDate?: string | null },
): IdentityDocumentDraft | null {
  let candidate = draft;
  // A replaced date can make the other date wrong: a few rounds settle it.
  for (let round = 0; round < 3; round += 1) {
    const fields = Object.keys(identityDocumentFieldErrors(candidate, rules)) as IdentityDocumentField[];
    if (fields.length === 0) return candidate;
    const next = { ...candidate };
    for (const field of fields) next[field] = stored[field];
    candidate = next;
  }
  return Object.keys(identityDocumentFieldErrors(candidate, rules)).length === 0 ? candidate : null;
}

/** The required fields still empty, in form order. */
export function identityDocumentMissing(draft: IdentityDocumentDraft): IdentityDocumentField[] {
  return ID_DOCUMENT_REQUIRED.filter((field) => !draft[field].trim());
}

export function identityFieldLabel(field: IdentityDocumentField, tx: Tx): string {
  switch (field) {
    case "type":
      return tx("вид документа", "Art des Dokuments");
    case "number":
      return tx("номер", "Nummer");
    case "authority":
      return tx("кем выдан", "ausstellende Behörde");
    case "country":
      return tx("страна выдачи", "Ausstellungsland");
    case "issuedOn":
      return tx("дата выдачи", "Ausstellungsdatum");
    case "validUntil":
      return tx("действителен до", "gültig bis");
  }
}

/** The sentence under a field that breaks a rule. */
export function identityFieldErrorText(code: string, tx: Tx): string {
  switch (code) {
    case "id_document_number_invalid":
      return tx("Только латинские буквы A–Z, цифры, пробел, «-» и «<»", "Nur lateinische Buchstaben A–Z, Ziffern, Leerzeichen, „-“ und „<“");
    case "id_document_number_too_short":
      return tx(`Номер слишком короткий: минимум ${ID_NUMBER_MIN_ALPHANUMERICS} букв или цифр`, `Nummer zu kurz: mindestens ${ID_NUMBER_MIN_ALPHANUMERICS} Buchstaben oder Ziffern`);
    case "id_document_number_too_long":
      return tx(`Номер слишком длинный: максимум ${ID_NUMBER_MAX_CHARS} знаков`, `Nummer zu lang: höchstens ${ID_NUMBER_MAX_CHARS} Zeichen`);
    case "id_issuing_country_invalid":
      return tx("Выберите страну из списка", "Bitte ein Land aus der Liste wählen");
    case "id_issued_on_future":
      return tx("Дата выдачи не может быть в будущем", "Das Ausstellungsdatum darf nicht in der Zukunft liegen");
    case "id_issued_on_too_early":
      return tx("Дата выдачи слишком ранняя", "Das Ausstellungsdatum ist zu früh");
    case "id_issued_on_before_birth":
      return tx("Дата выдачи раньше даты рождения", "Das Ausstellungsdatum liegt vor dem Geburtsdatum");
    case "id_valid_until_before_issue":
      return tx("«Действителен до» должен быть позже даты выдачи", "„Gültig bis“ muss nach dem Ausstellungsdatum liegen");
    case "id_document_type_invalid":
      return tx("Выберите вид документа из списка", "Bitte eine Dokumentart aus der Liste wählen");
    default:
      return tx("Значение не подходит", "Ungültiger Wert");
  }
}

/** A 422 of the save as a field error (`field` and `code` of the server), else `null`. */
export function identityDocumentServerError(error: unknown): { field: IdentityDocumentField | null; code: string } | null {
  if (!(error instanceof ApiRequestError) || error.status !== 422) return null;
  const body = error.body as { field?: unknown; code?: unknown; error?: unknown } | null | undefined;
  const code = typeof body?.code === "string" ? body.code : typeof body?.error === "string" ? body.error : "invalid_field";
  return { field: identityDocumentFieldOf(body?.field), code };
}

/** Where the person's document stands: one status per card, and the next step. */
export type IdentityDocumentStatus =
  | { kind: "no_scan" }
  | { kind: "unreadable" }
  | { kind: "incomplete"; missing: IdentityDocumentField[] }
  | { kind: "invalid" }
  | { kind: "expired"; validUntil: string }
  | { kind: "complete"; validUntil: string };

export function identityDocumentStatus(
  draft: IdentityDocumentDraft,
  { today, scans, errors }: { today: string; scans: number | null; errors: IdentityDocumentErrors },
): IdentityDocumentStatus {
  if (scans === 0) return { kind: "no_scan" };
  if (draft.unreadable) return { kind: "unreadable" };
  if (identityDocumentExpired(draft, today)) return { kind: "expired", validUntil: draft.validUntil };
  if (Object.keys(errors).length > 0) return { kind: "invalid" };
  const missing = identityDocumentMissing(draft);
  if (missing.length > 0) return { kind: "incomplete", missing };
  return { kind: "complete", validUntil: draft.validUntil };
}

/** "Данные не заполнены: номер, кем выдан", "Документ действителен до 31.01.2031", … */
export function identityDocumentStatusText(status: IdentityDocumentStatus, tx: Tx): string {
  switch (status.kind) {
    case "no_scan":
      return tx("Скан не загружен: сначала загрузите документ", "Kein Scan: zuerst das Dokument hochladen");
    case "unreadable":
      return tx("Документ нечитаем: запросите новый скан", "Ausweis unleserlich: neuen Scan anfordern");
    case "incomplete":
      return `${tx("Заполните по скану", "Aus dem Scan ergänzen")}: ${status.missing.map((field) => identityFieldLabel(field, tx)).join(", ")}`;
    case "invalid":
      return tx("Исправьте поля, отмеченные красным", "Rot markierte Felder korrigieren");
    case "expired":
      return `${tx("Документ просрочен с", "Ausweis abgelaufen seit")} ${formatAppDate(status.validUntil)}: ${tx("идентификация по нему невозможна, нужен действующий документ", "keine Identifizierung möglich, ein gültiges Dokument ist nötig")}`;
    case "complete":
      return `${tx("Данные заполнены · действителен до", "Daten vollständig · gültig bis")} ${formatAppDate(status.validUntil)}`;
  }
}

/**
 * Which source is newer: `true` when `candidate` is older than `known` (a
 * late reload). A source without an entry time after a known one is no late
 * reload but a reset («Убрать данные GwG» cleared the document): it is taken
 * (DEV 2026-10-24: the form kept the old data and the next keystroke stored
 * the whole document again).
 */
export function identityDocumentSourceIsStale(candidate: string | null | undefined, known: string | null | undefined): boolean {
  if (!known || !candidate) return false;
  const candidateTime = Date.parse(candidate);
  const knownTime = Date.parse(known);
  return Number.isFinite(candidateTime) && Number.isFinite(knownTime) && candidateTime < knownTime;
}

/** The server cleared the document (no entry time) after one was known here: the form starts over. */
export function identityDocumentSourceIsReset(candidate: string | null | undefined, known: string | null | undefined): boolean {
  return Boolean(known) && !candidate;
}

/** "Внесено сотрудником: Ben Muster · 07.10.2026 12:00"; "" while staff entered nothing. */
export function identityDocumentEnteredLine(marks: LeadStaffIdDataMarks | null | undefined, tx: Tx): string {
  if (!marks?.id_data_entered_by_name && !marks?.id_data_entered_at) return "";
  const parts = [marks.id_data_entered_by_name, formatAppDateTime(marks.id_data_entered_at ?? null)].filter(Boolean);
  return `${tx("Внесено сотрудником", "Erfasst von")}: ${parts.join(" · ")}`;
}
