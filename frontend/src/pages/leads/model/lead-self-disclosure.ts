import { ApiRequestError } from "@/lib/api";

/**
 * The lead's patient form ("Patientenformular – Angaben und Erklärungen",
 * owner request 2026-10-08): the server fills it from what the lead sent
 * through the cabinet — never the reason of the request, nothing medical, no
 * risk assessment — and it is signed by the patient side inside the lead's
 * signature package. It exists only once the lead sent the request.
 */
export const LEAD_SELF_DISCLOSURE_TEMPLATE = "lead_self_disclosure";

type Tx = (ru: string, de: string) => string;

/** Whether the lead sent the request: only then can the form be generated. */
export function leadSelfDisclosureAvailable(intake: { submitted_at: string | null; changed_since_submit?: boolean | null } | null | undefined): boolean {
  return Boolean(intake?.submitted_at) && !intake?.changed_since_submit;
}

/**
 * A refusal of the server to make the patient form, as one localized
 * sentence; `null` for other errors.
 */
export function leadSelfDisclosureErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const codes = [error.body?.code, error.body?.error, error.code];
  if (codes.includes("lead_request_changed_since_submit")) {
    return tx(
      "Пациент изменил заявку после отправки. Анкету можно создать после повторной отправки изменений из кабинета.",
      "Die Anfrage wurde nach dem Senden geändert. Das Patientenformular kann erstellt werden, sobald die Änderungen im Kabinett erneut gesendet wurden.",
    );
  }
  if (codes.includes("lead_request_not_sent")) {
    return tx(
      "Анкету пациента можно создать только после того, как пациент отправил заявку в кабинете",
      "Das Patientenformular kann erst erstellt werden, wenn der Patient die Anfrage im Kabinett gesendet hat",
    );
  }
  return null;
}
