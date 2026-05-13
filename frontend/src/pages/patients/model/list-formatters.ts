import { getLang, t as translateCatalog } from "@/lib/i18n";

import type {
  PatientDetail,
  PatientsDictionary,
  PatientSummary,
} from "./list-model";

type DictionaryLike = PatientsDictionary | Record<string, string>;

const PATIENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const PATIENT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function localizedNotSetFallback() {
  return translateCatalog(getLang()).common_not_set;
}

export function formatPatientDate(value?: string | null, fallback?: string) {
  if (!value) return fallback ?? localizedNotSetFallback();
  try {
    return PATIENT_DATE_FORMATTER.format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

export function formatPatientDateTime(value?: string | null, fallback?: string) {
  if (!value) return fallback ?? localizedNotSetFallback();
  try {
    return PATIENT_DATE_TIME_FORMATTER.format(new Date(value));
  } catch {
    return value;
  }
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
