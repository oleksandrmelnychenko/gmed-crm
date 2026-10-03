import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription, type RealtimeEvent } from "@/lib/realtime";

import {
  fetchLeadPortalIntake,
  type LeadPortalIntake,
  type PatientFieldMarker,
  type Step1FillMode,
} from "../data/lead-portal-intake-api";

/**
 * Wizard step-1 keys and the lead columns the patient fills in the portal
 * (owner decision 2026-10-03). `registrationCountry` mirrors the first
 * citizenship.
 */
export const PORTAL_FIELD_BY_DRAFT_KEY: Record<string, string> = {
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  birthDate: "date_of_birth",
  legalSex: "legal_sex",
  citizenships: "citizenships",
  registrationCountry: "citizenships",
  street: "street_address",
  zip: "zip_code",
  city: "city",
  country: "country",
  phone: "phone",
  language: "primary_language",
};

/** Step-1 fields that become optional when the patient fills them in. */
export const PATIENT_FILLED_KEYS = ["birthDate", "legalSex", "phone", "street", "city", "zip"] as const;

/**
 * In "the patient fills it in" mode only first name, last name and e-mail
 * are required to create the lead. Other errors stay only where something is
 * entered (a format error, not "required").
 */
export function relaxMasterErrors<K extends string>(
  errors: Partial<Record<K, string>>,
  mode: Step1FillMode,
  filled: (key: K) => boolean,
): Partial<Record<K, string>> {
  if (mode !== "patient") return errors;
  const relaxed: Partial<Record<K, string>> = {};
  for (const [key, message] of Object.entries(errors) as Array<[K, string | undefined]>) {
    if ((PATIENT_FILLED_KEYS as readonly string[]).includes(key) && !filled(key)) continue;
    relaxed[key] = message;
  }
  return relaxed;
}

/** The prospect patient needs these; until then later steps wait for the patient. */
export function patientDataPending(
  mode: Step1FillMode,
  draft: { birthDate: string; legalSex: string } | null,
): boolean {
  return mode === "patient" && Boolean(draft) && (!draft?.birthDate || !draft?.legalSex);
}

function comparable(value: unknown): string {
  return Array.isArray(value) ? value.join(",") : String(value ?? "").trim();
}

/**
 * Takes the patient's new values into the open wizard draft: a field changes
 * only when staff have not edited it since the last load (current = base) and
 * the fresh lead has another value. Returns null when nothing changes.
 */
export function mergePatientUpdates<T extends Record<string, unknown>>(
  current: T,
  base: T,
  fresh: T,
  keys: readonly string[] = Object.keys(PORTAL_FIELD_BY_DRAFT_KEY),
): T | null {
  let next: T | null = null;
  for (const key of keys) {
    if (!(key in current) || !(key in fresh)) continue;
    if (comparable(current[key]) !== comparable(base[key])) continue;
    if (comparable(fresh[key]) === comparable(base[key])) continue;
    next = { ...(next ?? current), [key]: fresh[key] };
  }
  return next;
}

/** The marker of a wizard field, if its current value came from the patient. */
export function patientMarkerFor(
  intake: Pick<LeadPortalIntake, "patient_fields"> | null,
  draftKey: string,
): PatientFieldMarker | null {
  const column = PORTAL_FIELD_BY_DRAFT_KEY[draftKey];
  return (column && intake?.patient_fields[column]) || null;
}

type Tx = (ru: string, de: string) => string;

export function portalProgressText(
  progress: { filled: number; total: number; documents: number; submitted_at: string | null },
  tx: Tx,
  formatDateTime: (value: string) => string,
): string[] {
  const parts = [
    tx(`заполнено ${progress.filled} из ${progress.total} полей`, `${progress.filled} von ${progress.total} Feldern ausgefüllt`),
    tx(`${progress.documents} документов`, `${progress.documents} Dokumente`),
  ];
  if (progress.submitted_at) {
    parts.push(
      tx(
        `данные отправлены ${formatDateTime(progress.submitted_at)}`,
        `Daten gesendet ${formatDateTime(progress.submitted_at)}`,
      ),
    );
  }
  return parts;
}

/** A realtime event caused by the patient (or a parent) in the portal. */
export function isPatientPortalEvent(event: Pick<RealtimeEvent, "type" | "payload">): boolean {
  return event.type === "lead.portal_updated" && typeof event.payload?.access_kind === "string";
}

/**
 * Portal state of one lead for the wizard, refreshed on `lead.portal_updated`.
 * `onPatientEvent` runs for changes the patient made.
 */
export function useLeadPortalIntake(
  leadId: string | null | undefined,
  enabled: boolean,
  onPatientEvent?: (event: RealtimeEvent) => void,
) {
  const [intake, setIntake] = useState<LeadPortalIntake | null>(null);
  const onPatientEventRef = useRef(onPatientEvent);
  useEffect(() => {
    onPatientEventRef.current = onPatientEvent;
  }, [onPatientEvent]);

  const reload = useCallback(async () => {
    if (!leadId) {
      setIntake(null);
      return null;
    }
    try {
      const next = await fetchLeadPortalIntake(leadId);
      setIntake(next);
      return next;
    } catch {
      return null;
    }
  }, [leadId]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (!enabled || !leadId || event.entity_id !== leadId) return;
    void reload();
    if (isPatientPortalEvent(event)) onPatientEventRef.current?.(event);
  });

  return { intake, reload, setIntake };
}
