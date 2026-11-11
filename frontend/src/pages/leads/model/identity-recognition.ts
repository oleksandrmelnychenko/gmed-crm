/**
 * The reading of an identity scan (`POST /documents/{id}/identity-recognition`):
 * the server reads the machine readable zone of a passport, an ID card or a
 * residence permit and verifies its check digits. What it reads is a
 * PROPOSAL: staff see each value next to the one in the form, tick what to
 * take, and only then the form's own save stores it. An empty field is
 * ticked when the check digits hold; a field that already holds another
 * value is never ticked by itself; nothing is ticked when a check digit
 * fails.
 *
 * The zone holds no issuing authority, no date of issue and no place of
 * birth, so those stay with staff. Names are Latin transliterations.
 */
import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate } from "@/lib/app-time-zone";

import { idDocumentTypeLabel } from "./lead-gwg-statements";
import type { IdentityRecognition } from "./identity-recognition-result";
import { normalizeDocumentNumber, type IdentityDocumentDraft } from "./lead-identity-document-data";
import type { Tx } from "./lead-payer";

export {
  normalizeIdentityRecognition,
  type IdentityRecognition,
  type IdentityRecognitionChecks,
  type IdentityRecognitionHolder,
  type IdentityRecognitionStatus,
} from "./identity-recognition-result";

/** The fields of the document form the zone can fill. */
export type RecognizedDocumentField = "type" | "number" | "country" | "validUntil";
export const RECOGNIZED_DOCUMENT_FIELDS: readonly RecognizedDocumentField[] = ["type", "number", "country", "validUntil"];

/**
 * `fill`: the form's field is empty. `same`: it already holds this value.
 * `differs`: it holds another value (taking the read one replaces it).
 */
export type RecognitionRowState = "fill" | "same" | "differs";

export type RecognitionRow<Field extends string> = {
  field: Field;
  label: string;
  /** What the form holds now, as shown; empty when nothing. */
  current: string;
  /** What the scan says, as shown. */
  proposed: string;
  /** The value to put into the form. */
  value: string;
  state: RecognitionRowState;
  /** Whether a check digit of the zone covers this value and holds. */
  verified: boolean;
};

const rowState = (current: string, proposed: string): RecognitionRowState =>
  !current ? "fill" : current === proposed ? "same" : "differs";

/** One row per document field the scan gave a value for. */
export function recognitionDocumentRows(
  result: IdentityRecognition,
  draft: IdentityDocumentDraft,
  tx: Tx,
  lang: string,
): RecognitionRow<RecognizedDocumentField>[] {
  const all = result.status === "verified";
  const show: Record<RecognizedDocumentField, (value: string) => string> = {
    type: (value) => idDocumentTypeLabel(value, tx),
    number: (value) => value,
    country: (value) => countryLabel(value, lang) || value,
    validUntil: (value) => formatAppDate(value),
  };
  const labels: Record<RecognizedDocumentField, string> = {
    type: tx("Вид документа", "Art des Dokuments"),
    number: tx("Номер документа", "Dokumentnummer"),
    country: tx("Страна выдачи", "Ausstellungsland"),
    validUntil: tx("Действителен до", "Gültig bis"),
  };
  const verified: Record<RecognizedDocumentField, boolean> = {
    // Type and country are covered by no check digit: they count as read
    // right only when the whole zone holds.
    type: all,
    country: all,
    number: result.checks.document_number,
    validUntil: result.checks.valid_until,
  };
  const current: Record<RecognizedDocumentField, string> = {
    type: draft.type,
    number: normalizeDocumentNumber(draft.number),
    country: draft.country.trim().toUpperCase(),
    validUntil: draft.validUntil,
  };
  return RECOGNIZED_DOCUMENT_FIELDS.flatMap((field) => {
    const value = result.document[field];
    if (!value) return [];
    return [
      {
        field,
        label: labels[field],
        current: current[field] ? show[field](current[field]) : "",
        proposed: show[field](value),
        value,
        state: rowState(current[field], value),
        verified: verified[field],
      },
    ];
  });
}

/**
 * The rows ticked when the proposal opens: empty fields whose value a check
 * digit confirms. A field that holds another value is left to staff.
 */
export function defaultRecognitionSelection<Field extends string>(rows: readonly RecognitionRow<Field>[]): Field[] {
  return rows.filter((row) => row.state === "fill" && row.verified).map((row) => row.field);
}

/** The patch of the form for the ticked rows; rows that change nothing are left out. */
export function recognitionDocumentPatch(
  rows: readonly RecognitionRow<RecognizedDocumentField>[],
  selected: ReadonlySet<RecognizedDocumentField>,
): Partial<IdentityDocumentDraft> {
  const patch: Partial<IdentityDocumentDraft> = {};
  for (const row of rows) {
    if (row.state === "same" || !selected.has(row.field)) continue;
    patch[row.field] = row.value;
  }
  return patch;
}

/** What the form knows about the person the document belongs to. */
export type RecognitionHolderCurrent = {
  lastName?: string | null;
  firstName?: string | null;
  birthDate?: string | null;
  legalSex?: string | null;
  citizenships?: readonly string[] | null;
};

export type RecognizedHolderField = "lastName" | "firstName" | "birthDate" | "legalSex" | "citizenship";

/** A name as compared: case, diacritics, hyphens and spacing do not count (the zone has none). */
export function comparableName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const sexLabel = (value: string, tx: Tx) =>
  value === "female" ? tx("Женский", "Weiblich") : value === "male" ? tx("Мужской", "Männlich") : value;

/**
 * The holder's data of the scan next to the person's data in the form. A
 * name in another script (Cyrillic) cannot be compared with the zone's Latin
 * one: it shows as `differs` and staff decide.
 */
export function recognitionHolderRows(
  result: IdentityRecognition,
  current: RecognitionHolderCurrent,
  tx: Tx,
  lang: string,
): RecognitionRow<RecognizedHolderField>[] {
  const all = result.status === "verified";
  const holder = result.holder;
  const rows: RecognitionRow<RecognizedHolderField>[] = [];
  const name = (field: "lastName" | "firstName", label: string, proposed: string | null, stored: string | null | undefined) => {
    if (!proposed) return;
    const now = (stored ?? "").trim();
    rows.push({
      field,
      label,
      current: now,
      proposed,
      value: proposed,
      state: !now ? "fill" : comparableName(now) === comparableName(proposed) ? "same" : "differs",
      verified: all,
    });
  };
  name("lastName", tx("Фамилия", "Nachname"), holder.last_name, current.lastName);
  name("firstName", tx("Имя", "Vorname"), holder.first_name, current.firstName);
  if (holder.date_of_birth) {
    const now = (current.birthDate ?? "").slice(0, 10);
    rows.push({
      field: "birthDate",
      label: tx("Дата рождения", "Geburtsdatum"),
      current: now ? formatAppDate(now) : "",
      proposed: formatAppDate(holder.date_of_birth),
      value: holder.date_of_birth,
      state: rowState(now, holder.date_of_birth),
      verified: result.checks.birth_date,
    });
  }
  // A person without a sex in the form (a representative) gets no row: nothing could take it.
  if (holder.legal_sex && current.legalSex !== undefined) {
    const now = (current.legalSex ?? "").trim();
    rows.push({
      field: "legalSex",
      label: tx("Пол", "Geschlecht"),
      current: now ? sexLabel(now, tx) : "",
      proposed: sexLabel(holder.legal_sex, tx),
      value: holder.legal_sex,
      state: rowState(now, holder.legal_sex),
      verified: all,
    });
  }
  if (holder.citizenship) {
    // Several citizenships: the document's one is added, never a replacement.
    const codes = (current.citizenships ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean);
    rows.push({
      field: "citizenship",
      label: tx("Гражданство", "Staatsangehörigkeit"),
      current: codes.map((code) => countryLabel(code, lang) || code).join(", "),
      proposed: countryLabel(holder.citizenship, lang) || holder.citizenship,
      value: holder.citizenship,
      state: codes.length === 0 ? "fill" : codes.includes(holder.citizenship) ? "same" : "differs",
      verified: all,
    });
  }
  return rows;
}

/** The person's data to take over, by the ticked rows. */
export type RecognitionHolderPatch = {
  lastName?: string;
  firstName?: string;
  birthDate?: string;
  legalSex?: string;
  /** A citizenship to ADD to the person's list. */
  citizenship?: string;
};

export function recognitionHolderPatch(
  rows: readonly RecognitionRow<RecognizedHolderField>[],
  selected: ReadonlySet<RecognizedHolderField>,
): RecognitionHolderPatch {
  const patch: RecognitionHolderPatch = {};
  for (const row of rows) {
    if (row.state === "same" || !selected.has(row.field)) continue;
    patch[row.field] = row.value;
  }
  return patch;
}

/** The check digits that failed, in words. */
export function recognitionFailedChecks(result: IdentityRecognition, tx: Tx): string[] {
  const failed: string[] = [];
  if (!result.checks.document_number) failed.push(tx("номер документа", "Dokumentnummer"));
  if (!result.checks.birth_date) failed.push(tx("дата рождения", "Geburtsdatum"));
  if (!result.checks.valid_until) failed.push(tx("срок действия", "Gültigkeitsdatum"));
  if (failed.length === 0 && !result.checks.composite) failed.push(tx("общая контрольная цифра", "Gesamtprüfziffer"));
  return failed;
}

/** The message of a reading that failed, by the server's code. */
export function recognitionErrorText(code: string | null | undefined, tx: Tx): string {
  switch (code) {
    case "unsupported_file":
      // The server looks at the content, not the name: a file called «….pdf»
      // whose content is no PDF or image (damaged, or another format renamed)
      // lands here (QA 2026-11-11, B-11).
      return tx(
        "Содержимое файла не читается как PDF или изображение (возможно, файл повреждён). Введите данные вручную или загрузите скан заново.",
        "Der Inhalt der Datei ist kein lesbares PDF oder Bild (die Datei ist möglicherweise beschädigt). Bitte manuell eingeben oder den Scan neu hochladen.",
      );
    case "not_an_identity_document":
      return tx("Распознаются только документы, удостоверяющие личность.", "Nur Ausweisdokumente werden gelesen.");
    case "recognition_unavailable":
      return tx("Распознавание на этом сервере недоступно. Введите данные вручную.", "Die Erkennung ist auf diesem Server nicht verfügbar. Bitte manuell eingeben.");
    default:
      return tx("Не удалось распознать документ. Введите данные вручную.", "Das Dokument konnte nicht gelesen werden. Bitte manuell eingeben.");
  }
}
