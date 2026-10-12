/**
 * Why a lead does not fit (QA 2026-10-11, A-39a): staff pick a reason when
 * they mark a lead «Не подходит» and when they archive or delete it. The
 * server stores the code — or, for «Другое», the free text — as the lead's
 * failure reason (`failed_outcome.reason`). Staff never see a raw code.
 */

type Tx = (ru: string, de: string) => string;

/** The reasons staff choose from, in the order of the list. */
export const LEAD_FAILURE_REASONS = [
  { code: "not_our_lead", ru: "Запрос не соответствует нашему профилю", de: "Anfrage passt nicht zu unserem Angebot" },
  { code: "no_response", ru: "Пациент не отвечает", de: "Keine Rückmeldung" },
  { code: "patient_declined", ru: "Пациент отказался", de: "Patient hat abgesagt" },
  { code: "other_provider", ru: "Выбрал другого поставщика", de: "Anderer Anbieter gewählt" },
  { code: "costs", ru: "Не устраивает стоимость", de: "Kosten passen nicht" },
  { code: "duplicate", ru: "Дубликат", de: "Dublette" },
] as const;

export type LeadFailureReasonCode = (typeof LEAD_FAILURE_REASONS)[number]["code"];

/** «Другое»: the reason is the free text staff write. */
export const LEAD_FAILURE_REASON_OTHER = "other";

/** The server keeps at most this many characters of a reason. */
export const LEAD_FAILURE_REASON_MAX_LENGTH = 500;

/** The reason as staff edit it: the chosen entry ("" while none) and the text of «Другое». */
export type LeadFailureReasonDraft = {
  choice: LeadFailureReasonCode | typeof LEAD_FAILURE_REASON_OTHER | "";
  text: string;
};

export function isLeadFailureReasonCode(value: string | null | undefined): value is LeadFailureReasonCode {
  return LEAD_FAILURE_REASONS.some((reason) => reason.code === value);
}

/** The label of «Другое» in the list. */
export function leadFailureReasonOtherLabel(tx: Tx): string {
  return tx("Другое", "Andere");
}

/**
 * A stored reason as staff read it: the label of a known code, any other
 * text as it is; null when there is none.
 */
export function leadFailureReasonLabel(reason: string | null | undefined, tx: Tx): string | null {
  const value = reason?.trim() ?? "";
  if (!value || value === LEAD_FAILURE_REASON_OTHER) return null;
  const known = LEAD_FAILURE_REASONS.find((item) => item.code === value);
  return known ? tx(known.ru, known.de) : value;
}

/** The lead history entries whose note is the failure reason (server `REASON_TRANSITIONS`). */
const REASON_TRANSITIONS = new Set(["status_change", "archived", "deleted"]);

/**
 * The note of a lead history entry («Процесс») as staff read it (QA 2026-10-12, A3-02): the reason
 * of a status change, an archiving or a deletion by its label — the anonymisation leaves only the
 * code there, «Другое» (`other`) included —, any other note as it is; null when there is none.
 */
export function leadLifecycleNoteLabel(
  transitionKind: string,
  note: string | null | undefined,
  tx: Tx,
): string | null {
  const value = note?.trim() ?? "";
  if (!value) return null;
  if (!REASON_TRANSITIONS.has(transitionKind)) return value;
  if (value === LEAD_FAILURE_REASON_OTHER) return leadFailureReasonOtherLabel(tx);
  return leadFailureReasonLabel(value, tx);
}

/** The reason choice prefilled from a stored reason. */
export function leadFailureReasonDraft(reason: string | null | undefined): LeadFailureReasonDraft {
  const value = reason?.trim() ?? "";
  if (!value) return { choice: "", text: "" };
  if (isLeadFailureReasonCode(value)) return { choice: value, text: "" };
  if (value === LEAD_FAILURE_REASON_OTHER) return { choice: LEAD_FAILURE_REASON_OTHER, text: "" };
  return { choice: LEAD_FAILURE_REASON_OTHER, text: value };
}

/** Why the chosen reason cannot be saved yet; null when it can. */
export function leadFailureReasonError(draft: LeadFailureReasonDraft, tx: Tx): string | null {
  if (!draft.choice) return tx("Выберите причину", "Grund auswählen");
  if (draft.choice !== LEAD_FAILURE_REASON_OTHER) return null;
  const text = draft.text.trim();
  if (!text) return tx("Опишите причину", "Grund beschreiben");
  if (text.length > LEAD_FAILURE_REASON_MAX_LENGTH) {
    return tx(
      `Не более ${LEAD_FAILURE_REASON_MAX_LENGTH} символов`,
      `Höchstens ${LEAD_FAILURE_REASON_MAX_LENGTH} Zeichen`,
    );
  }
  return null;
}

/** What is sent to the server: the code, or the free text of «Другое»; null while incomplete. */
export function leadFailureReasonValue(draft: LeadFailureReasonDraft): string | null {
  if (!draft.choice) return null;
  if (draft.choice !== LEAD_FAILURE_REASON_OTHER) return draft.choice;
  const text = draft.text.trim();
  return text && text.length <= LEAD_FAILURE_REASON_MAX_LENGTH ? text : null;
}
