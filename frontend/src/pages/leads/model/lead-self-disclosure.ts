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

type CabinetIntake = { submitted_at: string | null; changed_since_submit?: boolean | null } | null | undefined;

/** Whether the lead sent the request: only then can the form be generated. */
export function leadSelfDisclosureAvailable(intake: CabinetIntake): boolean {
  return Boolean(intake?.submitted_at) && !intake?.changed_since_submit;
}

/**
 * Why the form cannot be generated yet: it is filled from the data the
 * patient sends through the cabinet. `null` once it can be generated.
 */
export function leadSelfDisclosureUnavailableHint(intake: CabinetIntake, tx: Tx): string | null {
  if (leadSelfDisclosureAvailable(intake)) return null;
  if (intake?.changed_since_submit) {
    return tx(
      "Анкета заполняется из данных кабинета. Пациент изменил заявку — анкету можно создать после повторной отправки изменений.",
      "Das Formular wird aus den Angaben im Kabinett erstellt. Der Patient hat die Anfrage geändert – das Formular kann nach dem erneuten Senden erstellt werden.",
    );
  }
  return tx(
    "Анкета заполняется из данных кабинета. Пациент ещё не отправил заявку — после отправки можно создать анкету.",
    "Das Formular wird aus den Angaben im Kabinett erstellt. Der Patient hat die Anfrage noch nicht gesendet – danach kann das Formular erstellt werden.",
  );
}

/**
 * Whether the patient form is required, from the server's readiness check
 * `self_disclosure_signed` (owner decision 2026-10-23, one rule on the
 * server: required in a new patient's first onboarding, optional for a
 * repeat order). `null` when the server did not say.
 */
export function leadSelfDisclosureRequirement(
  checks: readonly { key: string; required?: boolean }[] | null | undefined,
): "required" | "optional" | null {
  const required = checks?.find((check) => check.key === "self_disclosure_signed")?.required;
  if (required === undefined) return null;
  return required ? "required" : "optional";
}

/** The label of the patient form's requirement in the wizard. */
export function leadSelfDisclosureRequirementLabel(requirement: "required" | "optional", tx: Tx): string {
  return requirement === "required"
    ? tx("Обязательно: первичное оформление нового пациента", "Pflicht: Erstaufnahme eines neuen Patienten")
    : tx("Необязательно: повторный заказ", "Optional: Folgeauftrag");
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
