import { getLang, t as translateCatalog } from "@/lib/i18n";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";

import type {
  PatientDetail,
  PatientsDictionary,
  PatientSummary,
} from "./list-model";

type DictionaryLike = PatientsDictionary | Record<string, string>;

function localizedNotSetFallback() {
  return translateCatalog(getLang()).common_not_set;
}

/** "DD.MM.YYYY"; calendar dates are never shifted. */
export function formatPatientDate(value?: string | null, fallback?: string) {
  if (!value) return fallback ?? localizedNotSetFallback();
  return formatAppDate(value) || value;
}

/** "DD.MM.YYYY HH:mm" in Berlin time. */
export function formatPatientDateTime(value?: string | null, fallback?: string) {
  if (!value) return fallback ?? localizedNotSetFallback();
  return formatAppDateTime(value) || value;
}

export function getPatientGenderLabel(
  value: string | null | undefined,
  dictionary: DictionaryLike,
) {
  switch (value) {
    case "male":
      return dictionary.gender_male;
    case "female":
      return dictionary.gender_female;
    case "diverse":
      return dictionary.gender_diverse;
    default:
      return dictionary.common_not_set;
  }
}

export function getPatientInsuranceLabel(
  value: string | null | undefined,
  dictionary: DictionaryLike,
) {
  switch (value) {
    case "private":
      return dictionary.insurance_private;
    case "public":
      return dictionary.insurance_public;
    case "self_pay":
      return dictionary.insurance_self_pay;
    case "foreign":
      return dictionary.insurance_foreign;
    default:
      return dictionary.common_not_set;
  }
}

export function getPatientRoleLabel(
  value: string | null | undefined,
  dictionary: DictionaryLike,
) {
  return value
    ? dictionary[`roles_${value}`] ?? dictionary.common_unknown_value ?? dictionary.common_unknown
    : dictionary.common_unknown;
}

export function getPatientDisplayName(patient: PatientSummary | PatientDetail) {
  const title = patient.title ? `${patient.title} ` : "";
  const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${title}${fullName || patient.patient_id}`.trim();
}

export function getPatientFieldValue(
  value: string | string[] | null | undefined,
  fallback?: string,
) {
  const nextFallback = fallback ?? localizedNotSetFallback();
  if (Array.isArray(value)) return value.length ? value.join(", ") : nextFallback;
  return value && value.trim() ? value : nextFallback;
}
