import { getLang, t as translateCatalog } from "@/lib/i18n";

export function appointmentRuntimeTranslations() {
  return translateCatalog(getLang());
}

export function appointmentRuntimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

export function formatAppointmentDateLabel(date: string) {
  try {
    return new Intl.DateTimeFormat(appointmentRuntimeLocale(), {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`));
  } catch {
    return date;
  }
}

export function formatAppointmentDateTimeLabel(
  dateTime: string | null | undefined,
) {
  if (!dateTime) return appointmentRuntimeTranslations().common_not_set;
  try {
    return new Intl.DateTimeFormat(appointmentRuntimeLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateTime));
  } catch {
    return dateTime;
  }
}

export function formatAppointmentSlotLabel(item: {
  date: string;
  time_start: string | null;
  time_end: string | null;
}) {
  return item.time_start
    ? `${formatAppointmentDateLabel(item.date)} · ${item.time_start}${item.time_end ? ` - ${item.time_end}` : ""}`
    : formatAppointmentDateLabel(item.date);
}

export function formatAppointmentMoneyLabel(
  value: string | null,
  currency = "EUR",
) {
  if (!value) return appointmentRuntimeTranslations().common_not_set;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat(appointmentRuntimeLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}
