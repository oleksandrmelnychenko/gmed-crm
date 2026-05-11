const EUR_MONEY_FORMATTERS = {
  "de-DE": new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }),
  "ru-RU": new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }),
} as const;

const DATE_FORMATTERS = {
  "de-DE": new Intl.DateTimeFormat("de-DE"),
  "ru-RU": new Intl.DateTimeFormat("ru-RU"),
} as const;

function reportLocale(locale: string) {
  return locale === "ru-RU" ? "ru-RU" : "de-DE";
}

export function formatMoney(value?: string | null, locale = "de-DE") {
  const numeric = Number(value ?? 0);
  return EUR_MONEY_FORMATTERS[reportLocale(locale)].format(
    Number.isFinite(numeric) ? numeric : 0,
  );
}

export function formatMoneyMetric(value?: string | number | null, locale = "de-DE") {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return EUR_MONEY_FORMATTERS[reportLocale(locale)].format(
    Number.isFinite(numeric) ? numeric : 0,
  );
}

export function formatReportDate(
  value: string | null | undefined,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return emptyLabel;
  return DATE_FORMATTERS[reportLocale(locale)].format(timestamp);
}

export function formatRating(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}/5`;
}

export function formatPercent(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}%`;
}

export function formatHours(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)} h`;
}

export function formatDays(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)} d`;
}

export function formatChange(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

export function serviceTypeLabel(value: string, labels: Record<string, string> | undefined, unknownLabel: string) {
  if (labels?.[value]) return labels[value];
  return unknownLabel;
}

export function roleCanOpenReports(role?: string) {
  return (
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "billing" ||
    role === "sales"
  );
}
