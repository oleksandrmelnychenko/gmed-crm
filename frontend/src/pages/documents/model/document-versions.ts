import { formatAppDate } from "@/lib/app-time-zone";

/**
 * Document versions in the lists (fix-98, owner 2026-11-16): one row per
 * document — its current version — with the earlier versions as subdued
 * sub-rows the row's toggle opens, and the signature state of the current
 * version («Не отправлено на подпись» / «Отправлено на подпись …» /
 * «Подписан …»).
 */
export type DocumentSignatureState = "not_sent" | "sent" | "signed";

export type VersionedDocument = {
  id: string;
  status?: string | null;
  version_number?: number | null;
  signed_at?: string | null;
  signature_state?: DocumentSignatureState | null;
  signature_sent_at?: string | null;
  is_latest_version?: boolean | null;
  previous_versions?: readonly VersionedDocument[] | null;
};

/** A sub-row: an earlier version shown under the document it belongs to. */
export type PreviousVersionRow<T> = T & { previous_version_of: string };

export function previousVersionsOf<T extends VersionedDocument>(document: T): T[] {
  return ((document.previous_versions ?? []) as T[]).filter((version) => version.id !== document.id);
}

export function isPreviousVersionRow<T extends object>(row: T): row is PreviousVersionRow<T> {
  return typeof (row as { previous_version_of?: unknown }).previous_version_of === "string";
}

/** The sub-rows of an expanded document, marked as earlier versions. */
export function previousVersionRows<T extends VersionedDocument>(document: T, expanded: ReadonlySet<string>): PreviousVersionRow<T>[] {
  if (!expanded.has(document.id)) return [];
  return previousVersionsOf(document).map((version) => ({ ...version, previous_version_of: document.id }));
}

/** Insert the expanded documents' earlier versions right after each document. */
export function withPreviousVersionRows<T extends VersionedDocument>(rows: readonly T[], expanded: ReadonlySet<string>): T[] {
  if (expanded.size === 0) return [...rows];
  return rows.flatMap((row) => (isPreviousVersionRow(row) ? [row] : [row, ...previousVersionRows(row, expanded)]));
}

export type DocumentChip = { label: string; tone: "amber" | "sky" | "emerald" | "muted"; testId: string };

const tx = (lang: string, ru: string, de: string) => (lang === "de" ? de : ru);

/** The signature chip of a current version; null for a document not made to be signed. */
export function signatureStateChip(document: VersionedDocument, lang: string): DocumentChip | null {
  switch (document.signature_state) {
    case "not_sent":
      return { label: tx(lang, "Не отправлено на подпись", "Nicht zur Unterschrift gesendet"), tone: "amber", testId: "signature-not-sent" };
    case "sent": {
      const date = formatAppDate(document.signature_sent_at ?? "");
      return { label: `${tx(lang, "Отправлено на подпись", "Zur Unterschrift gesendet")}${date ? ` ${date}` : ""}`, tone: "sky", testId: "signature-sent" };
    }
    case "signed": {
      const date = formatAppDate(document.signed_at ?? "");
      return { label: `${tx(lang, "Подписан", "Unterschrieben")}${date ? ` ${date}` : ""}`, tone: "emerald", testId: "signature-signed" };
    }
    default:
      return null;
  }
}

/** The state of an earlier version: signed on its date, else replaced by the next one. */
export function previousVersionChip(version: VersionedDocument, lang: string): DocumentChip {
  const signed = formatAppDate(version.signed_at ?? "");
  if (version.signed_at && signed) return { label: `${tx(lang, "Подписан", "Unterschrieben")} ${signed}`, tone: "emerald", testId: "version-signed" };
  // Every earlier version has a newer one, whatever status it is stored with.
  return { label: tx(lang, "Заменён", "Ersetzt"), tone: "muted", testId: "version-replaced" };
}

export function versionMarkerLabel(document: VersionedDocument): string {
  return `v${document.version_number ?? 1}`;
}

export function expandVersionsLabel(count: number, expanded: boolean, lang: string): string {
  return expanded
    ? tx(lang, "Скрыть прошлые версии", "Frühere Versionen ausblenden")
    : `${tx(lang, "Прошлые версии", "Frühere Versionen")}: ${count}`;
}

/** Current versions still to go out for signature («Ждут отправки на подпись: N»). */
export function countNotSentForSignature(documents: readonly VersionedDocument[]): number {
  return documents.filter((document) => document.signature_state === "not_sent").length;
}

export function notSentCountLabel(count: number, lang: string): string {
  return `${tx(lang, "Ждут отправки на подпись", "Warten auf Versand zur Unterschrift")}: ${count}`;
}

export const SIGNATURE_STATE_FILTER_VALUES = ["not_sent", "sent", "signed"] as const;

export function signatureStateFilterOptions(lang: string): { value: string; label: string }[] {
  return [
    { value: "", label: tx(lang, "Подпись: все", "Unterschrift: alle") },
    { value: "not_sent", label: tx(lang, "Не отправлено на подпись", "Nicht zur Unterschrift gesendet") },
    { value: "sent", label: tx(lang, "Отправлено на подпись", "Zur Unterschrift gesendet") },
    { value: "signed", label: tx(lang, "Подписан", "Unterschrieben") },
  ];
}

export function parseSignatureStateFilter(value: string | null | undefined): string {
  return SIGNATURE_STATE_FILTER_VALUES.includes(value as DocumentSignatureState) ? (value as string) : "";
}

/** The Einverständniserklärung templates whose row offers «Изменить согласия». */
const CONSENT_FORM_TEMPLATES = ["privacy_consents", "consent_data_release_child", "consent_data_release_single"];

export function isPatientConsentFormRow(
  document: { generated_template_id?: string | null; status?: string | null; is_latest_version?: boolean | null; lead_id?: string | null },
  patientId: string | null | undefined,
): boolean {
  return Boolean(patientId)
    && !document.lead_id
    && CONSENT_FORM_TEMPLATES.includes(document.generated_template_id ?? "")
    && document.is_latest_version !== false
    && document.status !== "archived"
    && !isPreviousVersionRow(document);
}
