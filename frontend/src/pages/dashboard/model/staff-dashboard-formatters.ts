import { getLang } from "@/lib/i18n";

export function greetingFor(name: string, tr: Record<string, string>) {
  const hour = new Date().getHours();
  const prefix =
    hour < 12
      ? tr.dash_greeting_morning ?? tr.dash_greeting ?? tr.common_unknown
      : hour < 18
        ? tr.dash_greeting_afternoon ?? tr.dash_greeting ?? tr.common_unknown
        : tr.dash_greeting_evening ?? tr.dash_greeting ?? tr.common_unknown;
  return name ? `${prefix}, ${name.split(/\s+/)[0]}` : prefix;
}

export function numberOrDash(value: number | null | undefined) {
  return value == null ? "-" : value.toLocaleString();
}

export function formatMonth(iso: string) {
  try {
    return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "ru-RU", {
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(5, 7);
  }
}

export function formatDay(iso: string) {
  try {
    return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "ru-RU", {
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(8, 10);
  }
}

export function formatShortDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function genderToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.gender_male ?? tr.common_unknown, value: by.male ?? 0 },
    { name: tr.gender_female ?? tr.common_unknown, value: by.female ?? 0 },
    { name: tr.gender_diverse ?? tr.common_unknown, value: by.diverse ?? 0 },
  ];
}

export function insuranceToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.insurance_private ?? tr.common_unknown, value: by.private ?? 0 },
    { name: tr.insurance_public ?? tr.common_unknown, value: by.public ?? 0 },
    { name: tr.insurance_self_pay ?? tr.common_unknown, value: by.self_pay ?? 0 },
    { name: tr.insurance_foreign ?? tr.common_unknown, value: by.foreign ?? 0 },
    { name: tr.common_unknown, value: by.unknown ?? 0 },
  ];
}

export function casesStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.cases_open ?? tr.common_unknown, value: by.open ?? 0 },
    { name: tr.cases_in_progress ?? tr.common_unknown, value: by.in_progress ?? 0 },
    { name: tr.cases_closed ?? tr.common_unknown, value: by.closed ?? 0 },
  ];
}

export function apptStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.appt_planned ?? tr.common_unknown, value: by.planned ?? 0 },
    { name: tr.appt_confirmed ?? tr.common_unknown, value: by.confirmed ?? 0 },
    { name: tr.appt_in_progress ?? tr.common_unknown, value: by.in_progress ?? 0 },
    { name: tr.appt_completed ?? tr.common_unknown, value: by.completed ?? 0 },
    { name: tr.appt_cancelled ?? tr.common_unknown, value: by.cancelled ?? 0 },
  ];
}
