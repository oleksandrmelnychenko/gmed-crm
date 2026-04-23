export function greetingFor(name: string, tr: Record<string, string>) {
  const hour = new Date().getHours();
  const prefix =
    hour < 12
      ? tr.dash_greeting_morning ?? tr.dash_greeting ?? "Good morning"
      : hour < 18
        ? tr.dash_greeting_afternoon ?? tr.dash_greeting ?? "Good afternoon"
        : tr.dash_greeting_evening ?? tr.dash_greeting ?? "Good evening";
  return name ? `${prefix}, ${name.split(/\s+/)[0]}` : prefix;
}

export function numberOrDash(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString();
}

export function formatMonth(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(5, 7);
  }
}

export function formatDay(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(8, 10);
  }
}

export function formatShortDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
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
    { name: tr.gender_male ?? "Male", value: by.male ?? 0 },
    { name: tr.gender_female ?? "Female", value: by.female ?? 0 },
    { name: tr.gender_diverse ?? "Diverse", value: by.diverse ?? 0 },
  ];
}

export function insuranceToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.insurance_private ?? "Private", value: by.private ?? 0 },
    { name: tr.insurance_public ?? "Public", value: by.public ?? 0 },
    { name: tr.insurance_self_pay ?? "Self-pay", value: by.self_pay ?? 0 },
    { name: tr.insurance_foreign ?? "Foreign", value: by.foreign ?? 0 },
    { name: tr.common_unknown ?? "Unknown", value: by.unknown ?? 0 },
  ];
}

export function casesStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.cases_open ?? "Open", value: by.open ?? 0 },
    { name: tr.cases_in_progress ?? "In progress", value: by.in_progress ?? 0 },
    { name: tr.cases_closed ?? "Closed", value: by.closed ?? 0 },
  ];
}

export function apptStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.appt_planned ?? "Planned", value: by.planned ?? 0 },
    { name: tr.appt_confirmed ?? "Confirmed", value: by.confirmed ?? 0 },
    { name: tr.appt_in_progress ?? "In progress", value: by.in_progress ?? 0 },
    { name: tr.appt_completed ?? "Completed", value: by.completed ?? 0 },
    { name: tr.appt_cancelled ?? "Cancelled", value: by.cancelled ?? 0 },
  ];
}
