import { formatAppDate } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { hasCapability, type Actor } from "@/lib/permissions";

export function formatMoney(value?: string | null, _locale = "de-DE") {
  void _locale;
  return formatMoneyAmount(value);
}

export function formatMoneyMetric(value?: string | number | null, _locale = "de-DE") {
  void _locale;
  return formatMoneyAmount(value);
}

/** "DD.MM.YYYY" in every language. */
export function formatReportDate(
  value: string | null | undefined,
  _locale = "de-DE",
  emptyLabel = "-",
) {
  void _locale;
  if (!value) return emptyLabel;
  return formatAppDate(value) || emptyLabel;
}

export function formatRating(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}/5`;
}

export function formatPercent(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}%`;
}

function formatOneDecimal(value: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** "3,4 ч" / "3,4 Std." (QA E-25: no English unit, decimal comma). */
export function formatHours(value?: number | null, emptyLabel = "-", lang: Lang = "ru") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${formatOneDecimal(value, lang)} ${lang === "de" ? "Std." : "ч"}`;
}

/** "2,3 дн." / "2,3 Tage" (QA E-25: no English unit, decimal comma). */
export function formatDays(value?: number | null, emptyLabel = "-", lang: Lang = "ru") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${formatOneDecimal(value, lang)} ${lang === "de" ? "Tage" : "дн."}`;
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

export function roleCanOpenReports(actor?: Actor) {
  return hasCapability(actor, "reports.view");
}
