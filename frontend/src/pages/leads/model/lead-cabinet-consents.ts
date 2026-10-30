import { staffRecordedLabel } from "./lead-portal-consents";

type Tx = (ru: string, de: string) => string;

/** How the client gave a consent staff recorded in the client's form. */
export type CabinetConsentRecord = { how: string | null; note: string | null };

/**
 * The active consents of the client's form the wizard shows beside its own paper toggles (adult
 * lead or parent / guardian), with how the client gave a consent staff recorded (owner 2026-10-30).
 */
export type CabinetConsents = {
  privacy: boolean;
  healthcare: boolean;
  privacyRecorded?: CabinetConsentRecord | null;
  healthcareRecorded?: CabinetConsentRecord | null;
};

export const NO_CABINET_CONSENTS: CabinetConsents = { privacy: false, healthcare: false };

function record(value: unknown): CabinetConsentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.how !== "string" || !raw.how) return null;
  return { how: raw.how, note: typeof raw.note === "string" ? raw.note : null };
}

/** The server's view of the active consents of the client's form (`readiness.cabinet_consents`). */
export function cabinetConsentsOf(
  readiness: {
    cabinet_consents?: {
      privacy_practices: boolean;
      healthcare: boolean;
      privacy_practices_recorded?: unknown;
      healthcare_recorded?: unknown;
    };
  } | null | undefined,
): CabinetConsents {
  const consents = readiness?.cabinet_consents;
  return {
    privacy: consents?.privacy_practices === true,
    healthcare: consents?.healthcare === true,
    privacyRecorded: record(consents?.privacy_practices_recorded),
    healthcareRecorded: record(consents?.healthcare_recorded),
  };
}

/** «в кабинете» or «Записал сотрудник · лично · примечание» for a consent of the client's form. */
export function cabinetConsentWay(recorded: CabinetConsentRecord | null | undefined, tx: Tx): string {
  return staffRecordedLabel(
    recorded ? { recorded_how: recorded.how, recorded_note: recorded.note } : null,
    tx,
  ) ?? tx("в кабинете", "im Kundenkabinett");
}

/**
 * The label of the wizard's request-consent toggle: «получено на бумаге» records a paper consent;
 * a consent of the client's form shows how it came instead (owner 2026-10-30: staff recorded it
 * «лично», the wizard said «на бумаге»).
 */
export function privacyConsentToggleLabel(consents: CabinetConsents, tx: Tx): string {
  return consents.privacy
    ? `${tx("Согласие на обработку запроса получено", "Einwilligung zur Bearbeitung der Anfrage liegt vor")} · ${cabinetConsentWay(consents.privacyRecorded, tx)}`
    : tx("Согласие на обработку запроса получено на бумаге", "Einwilligung zur Bearbeitung der Anfrage auf Papier erhalten");
}

/** The label of the wizard's health-data toggle, with how a consent of the client's form came. */
export function healthcareConsentToggleLabel(consents: CabinetConsents, tx: Tx): string {
  const label = tx("Получено согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor");
  return consents.healthcare ? `${label} · ${cabinetConsentWay(consents.healthcareRecorded, tx)}` : label;
}

/**
 * The note under the toggles while the client's form holds a consent: it names the cabinet only for
 * the client's own consent, staff's record with its way (owner 2026-10-30). Null without one.
 */
export function cabinetConsentsNote(consents: CabinetConsents, tx: Tx): string | null {
  const staff = Boolean(consents.privacy && consents.privacyRecorded) || Boolean(consents.healthcare && consents.healthcareRecorded);
  if (consents.privacy && consents.healthcare) {
    return staff
      ? tx(
        `Оба согласия есть в анкете клиента (обработка запроса: ${cabinetConsentWay(consents.privacyRecorded, tx)}; медицинские данные: ${cabinetConsentWay(consents.healthcareRecorded, tx)}) — отдельная отметка не нужна.`,
        `Beide Einwilligungen liegen im Kundenformular vor (Bearbeitung der Anfrage: ${cabinetConsentWay(consents.privacyRecorded, tx)}; Gesundheitsdaten: ${cabinetConsentWay(consents.healthcareRecorded, tx)}) – keine gesonderte Bestätigung nötig.`,
      )
      : tx("Оба согласия даны в кабинете — отдельная отметка не нужна.", "Beide Einwilligungen wurden im Kundenkabinett erteilt – keine gesonderte Bestätigung nötig.");
  }
  if (consents.privacy) {
    return consents.privacyRecorded
      ? tx(
        `Согласие на обработку запроса: ${cabinetConsentWay(consents.privacyRecorded, tx)}. Согласие на медицинские данные отметьте, только если получили его иначе (например, на бумаге).`,
        `Einwilligung zur Bearbeitung der Anfrage: ${cabinetConsentWay(consents.privacyRecorded, tx)}. Die Einwilligung zu Gesundheitsdaten nur bestätigen, wenn sie anders (z. B. auf Papier) vorliegt.`,
      )
      : tx("Согласие на обработку запроса дано в кабинете. Согласие на медицинские данные отметьте, только если получили его иначе (например, на бумаге).", "Die Einwilligung zur Bearbeitung der Anfrage liegt aus dem Kundenkabinett vor. Die Einwilligung zu Gesundheitsdaten nur bestätigen, wenn sie anders (z. B. auf Papier) vorliegt.");
  }
  if (consents.healthcare) {
    return consents.healthcareRecorded
      ? tx(
        `Согласие на медицинские данные: ${cabinetConsentWay(consents.healthcareRecorded, tx)}. Согласие на обработку запроса отметьте, только если получили его на бумаге.`,
        `Einwilligung zu Gesundheitsdaten: ${cabinetConsentWay(consents.healthcareRecorded, tx)}. Die Einwilligung zur Bearbeitung der Anfrage nur bestätigen, wenn sie auf Papier vorliegt.`,
      )
      : tx("Согласие на медицинские данные дано в кабинете. Согласие на обработку запроса отметьте, только если получили его на бумаге.", "Die Einwilligung zu Gesundheitsdaten liegt aus dem Kundenkabinett vor. Die Einwilligung zur Bearbeitung der Anfrage nur bestätigen, wenn sie auf Papier vorliegt.");
  }
  return null;
}

/** «да (кабинет)» / «да (Записал сотрудник · лично)» in the wizard's summary of a consent of the client's form. */
export function cabinetConsentSummaryValue(recorded: CabinetConsentRecord | null | undefined, tx: Tx): string {
  return recorded ? `${tx("да", "ja")} (${cabinetConsentWay(recorded, tx)})` : tx("да (кабинет)", "ja (Kundenkabinett)");
}
