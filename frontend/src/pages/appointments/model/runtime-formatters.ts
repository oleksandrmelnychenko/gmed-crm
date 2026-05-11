import { getLang, t as translateCatalog } from "@/lib/i18n";

function appointmentRuntimeTranslations() {
  return translateCatalog(getLang());
}

export function appointmentRuntimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

const APPOINTMENT_DATE_FORMATTERS = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
} as const;

const APPOINTMENT_DATE_TIME_FORMATTERS = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
} as const;

export function formatAppointmentDateLabel(date: string) {
  try {
    return APPOINTMENT_DATE_FORMATTERS[appointmentRuntimeLocale()].format(
      new Date(`${date}T00:00:00`),
    );
  } catch {
    return date;
  }
}

export function formatAppointmentDateTimeLabel(
  dateTime: string | null | undefined,
) {
  if (!dateTime) return appointmentRuntimeTranslations().common_not_set;
  try {
    return APPOINTMENT_DATE_TIME_FORMATTERS[appointmentRuntimeLocale()].format(
      new Date(dateTime),
    );
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
    return numeric.toLocaleString(appointmentRuntimeLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}
