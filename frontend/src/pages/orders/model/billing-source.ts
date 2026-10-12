import { formatAppDate } from "@/lib/app-time-zone";
import { t as translationsFor, type Lang } from "@/lib/i18n";

import type { Leistung } from "./types";

type BillingSourceLine = Pick<
  Leistung,
  | "source_interpreter_report_id"
  | "source_medical_appointment_id"
  | "source_order_amendment_id"
  | "source_appointment_title"
  | "source_appointment_date"
  | "source_report_hours"
>;

function hoursLabel(hours: string, lang: Lang): string {
  const value = hours.replace(/^(\d+)\.(\d+)$/, "$1,$2");
  return lang === "de" ? `${value} Std.` : `${value} ч`;
}

/**
 * "Источник начисления" of an order line as people read it (QA C3-11):
 * the completed visit or the interpreter report with its hours, the visit
 * title (for readers of medical data) and date — never the raw ids the line
 * stores.
 */
export function billingSourceLabel(line: BillingSourceLine, lang: Lang): string {
  const tr = translationsFor(lang);
  const visit = [
    line.source_appointment_title?.trim() || null,
    line.source_appointment_date ? formatAppDate(line.source_appointment_date) : null,
  ].filter((part): part is string => Boolean(part));
  if (line.source_interpreter_report_id) {
    return [
      tr.orders_billing_source_interpreter_report,
      line.source_report_hours ? hoursLabel(line.source_report_hours, lang) : null,
      ...visit,
    ].filter(Boolean).join(" · ");
  }
  if (line.source_medical_appointment_id) {
    return [tr.orders_billing_source_completed_appointment, ...visit].join(" · ");
  }
  if (line.source_order_amendment_id) {
    return lang === "de" ? "Genehmigte Betragsänderung" : "Одобренное изменение суммы";
  }
  return tr.orders_billing_source_manual;
}
