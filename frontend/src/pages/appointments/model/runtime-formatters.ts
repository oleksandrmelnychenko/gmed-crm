import { appDateTimeFormat, dateOrInstant, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { getLang, t as translateCatalog } from "@/lib/i18n";
import { formatMoneyAmount, formatMoneyLabel } from "@/lib/money";

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

/** Interpreter hours with a decimal comma ("1,5 ч"), like the order lines. */
export function formatInterpreterHours(value: string | number | null | undefined) {
  const numeric =
    typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(numeric)) {
    return String(value ?? "");
  }
  return numeric.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export function formatAppointmentMoneyLabel(
  value: string | null,
  currency = "EUR",
) {
  if (!value) return appointmentRuntimeTranslations().common_not_set;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return `${value} ${currency}`;
  // Owner money format in every UI language: "1.234,56 €".
  try {
    return formatMoneyAmount(numeric, currency || "EUR");
  } catch {
    return formatMoneyLabel(numeric, currency);
  }
}
