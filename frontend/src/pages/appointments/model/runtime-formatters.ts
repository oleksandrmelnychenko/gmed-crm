import { appDateTimeFormat, dateOrInstant, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { getLang, t as translateCatalog } from "@/lib/i18n";

function appointmentRuntimeTranslations() {
  return translateCatalog(getLang());
}

export function appointmentRuntimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

/** The weekday and "DD.MM.YYYY" of an appointment day ("Mo., 13.04.2026"). */
export function formatAppointmentDateLabel(date: string) {
  const day = formatAppDate(date);
  if (!day) return date;
  const weekday = appDateTimeFormat(appointmentRuntimeLocale(), { weekday: "short" }).format(
    dateOrInstant(date),
  );
  return `${weekday}, ${day}`;
}

/** "DD.MM.YYYY HH:mm" in Berlin time. */
export function formatAppointmentDateTimeLabel(
  dateTime: string | null | undefined,
) {
  if (!dateTime) return appointmentRuntimeTranslations().common_not_set;
  return formatAppDateTime(dateTime) || dateTime;
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
    return numeric.toLocaleString(appointmentRuntimeLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}
