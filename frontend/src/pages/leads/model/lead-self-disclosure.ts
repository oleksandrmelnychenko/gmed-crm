import { ApiRequestError } from "@/lib/api";

/**
 * The lead's patient form ("Patientenformular – Angaben und Erklärungen",
 * owner request 2026-10-08): the server fills it from what the lead sent
 * through the cabinet — never the reason of the request, nothing medical, no
 * risk assessment — and it is signed by the patient side inside the lead's
 * signature package. While the patient fills the cabinet it exists only once
 * the lead sent the request; when staff enter the data themselves ("Заполняю
 * сам", nothing sent through the cabinet) the server makes it from the lead's
 * data, marked "Angaben aufgenommen durch GMED" (owner decision 2026-10-23).
 */
export const LEAD_SELF_DISCLOSURE_TEMPLATE = "lead_self_disclosure";

type Tx = (ru: string, de: string) => string;

type CabinetIntake = {
  submitted_at: string | null;
  changed_since_submit?: boolean | null;
  /** Wizard step 1: staff fill the data in ("staff", the default) or the patient does ("patient"). */
  fill_mode?: string | null;
} | null | undefined;

/**
 * The form comes from the data GMED recorded: nothing was sent through the
 * cabinet and staff fill the data in themselves (the server's rule).
 */
export function leadSelfDisclosureRecordedByGmed(intake: CabinetIntake): boolean {
  return Boolean(intake) && !intake?.submitted_at && intake?.fill_mode !== "patient";
}

/** Whether the form can be generated: from the sent request, or from the data GMED recorded. */
export function leadSelfDisclosureAvailable(intake: CabinetIntake): boolean {
  if (intake?.submitted_at) return !intake.changed_since_submit;
  return leadSelfDisclosureRecordedByGmed(intake);
}

/** Where the form's data come from, for the wizard's note. */
export function leadSelfDisclosureSourceNote(intake: CabinetIntake, tx: Tx): string {
  if (leadSelfDisclosureRecordedByGmed(intake)) {
    return tx(
      "Пациент не отправлял заявку через кабинет: анкета создаётся из данных, внесённых сотрудником, с отметкой «Angaben aufgenommen durch GMED». Подписывает пациент или законные представители — на бумаге или КЭП, как другие документы. Если пациент позже отправит заявку через кабинет, создайте анкету заново: она заполнится данными кабинета.",
      "Der Patient hat keine Anfrage über das Kundenkabinett gesendet: Das Formular wird aus den von GMED erfassten Angaben erstellt, mit dem Vermerk „Angaben aufgenommen durch GMED“. Der Patient oder die gesetzlichen Vertreter unterschreiben – auf Papier oder per QES wie die anderen Dokumente. Sendet der Patient später eine Anfrage über das Kundenkabinett, erstellen Sie das Formular aus diesen Angaben neu.",
    );
  }
  return tx(
    "Ответы из кабинета. Подписывает пациент или законные представители вместе с договором, заказом и согласиями.",
    "Angaben aus dem Portal. Der Patient oder die gesetzlichen Vertreter unterschreiben zusammen mit Vertrag, Auftrag und Einwilligungen.",
  );
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
      "Das Formular wird aus den Angaben im Kundenkabinett erstellt. Der Patient hat die Anfrage geändert – das Formular kann nach dem erneuten Senden erstellt werden.",
    );
  }
  // The patient fills the cabinet ("Заполнит пациент") and has not sent it yet.
  return tx(
    "Анкета заполняется из данных кабинета. Пациент ещё не отправил заявку — после отправки можно создать анкету. Если данные вносите вы сами, выберите «Заполняю сам» на шаге 1: анкета создастся из ваших данных.",
    "Das Formular wird aus den Angaben im Kundenkabinett erstellt. Der Patient hat die Anfrage noch nicht gesendet – danach kann das Formular erstellt werden. Erfassen Sie die Angaben selbst, wählen Sie in Schritt 1 „Ich fülle aus“: Das Formular wird dann aus Ihren Angaben erstellt.",
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
      "Die Anfrage wurde nach dem Senden geändert. Das Patientenformular kann erstellt werden, sobald die Änderungen im Kundenkabinett erneut gesendet wurden.",
    );
  }
  if (codes.includes("lead_request_not_sent")) {
    return tx(
      "Анкету пациента можно создать только после того, как пациент отправил заявку в кабинете (или выберите «Заполняю сам» на шаге 1)",
      "Das Patientenformular kann erst erstellt werden, wenn der Patient die Anfrage im Kundenkabinett gesendet hat (oder wählen Sie in Schritt 1 „Ich fülle aus“)",
    );
  }
  return null;
}
