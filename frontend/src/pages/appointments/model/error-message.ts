import { ApiRequestError } from "@/lib/api";
import {
  APPOINTMENT_CANCEL_BILLED_REPORT_CODE,
  APPOINTMENT_COMPLETION_BEFORE_DATE_CODE,
  APPOINTMENT_REPORT_BEFORE_DATE_CODE,
  APPOINTMENT_REPORT_STATUS_NOT_OPEN_CODE,
  APPOINTMENT_REPORTED_FUTURE_DATE_CODE,
  INTERPRETER_REPORT_SELF_REVIEW_CODE,
} from "@/pages/appointments/model/completion-rules";
import { appointmentText } from "@/pages/appointments/model/labels";

const LOCALIZED_TRANSPORT_CODES = new Set(["aborted", "network", "timeout"]);

/** Server rejections whose reason the staff can act on get a localized text. */
const LOCALIZED_BODY_CODE_KEYS = new Map<string, string>([
  [
    APPOINTMENT_COMPLETION_BEFORE_DATE_CODE,
    "appointments_status_completion_not_before_date",
  ],
  [APPOINTMENT_REPORT_BEFORE_DATE_CODE, "appointments_report_not_before_date"],
  [
    APPOINTMENT_REPORT_STATUS_NOT_OPEN_CODE,
    "appointments_report_requires_confirmed_appointment",
  ],
  [
    APPOINTMENT_REPORTED_FUTURE_DATE_CODE,
    "appointments_reported_not_to_future_date",
  ],
  [INTERPRETER_REPORT_SELF_REVIEW_CODE, "appointments_report_self_review"],
]);

function bodyText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * Cancelling a visit whose approved interpreter report is billed: the answer
 * names the report and the order line whose billing has to be reversed.
 */
export function billedReportCancelMessage(body: Record<string, unknown>) {
  const hours = Number(bodyText(body, "hours"));
  return appointmentText(
    body.order_leistung_id
      ? "appointments_cancel_billed_report_line"
      : "appointments_cancel_billed_report_pending",
    {
      interpreter: bodyText(body, "interpreter_name") || "—",
      hours: Number.isFinite(hours) ? String(hours).replace(".", ",") : bodyText(body, "hours"),
      line: bodyText(body, "order_leistung_description") || bodyText(body, "order_leistung_id"),
      order: bodyText(body, "order_number") || "—",
    },
  );
}

export function appointmentActionErrorMessage(
  error: unknown,
  localizedFallback: string,
) {
  if (error instanceof ApiRequestError) {
    if (
      error.code &&
      LOCALIZED_TRANSPORT_CODES.has(error.code) &&
      error.message.trim()
    ) {
      return error.message;
    }
    const bodyCode = error.body?.code;
    if (bodyCode === APPOINTMENT_CANCEL_BILLED_REPORT_CODE && error.body) {
      return billedReportCancelMessage(error.body as Record<string, unknown>);
    }
    const bodyCodeKey =
      typeof bodyCode === "string"
        ? LOCALIZED_BODY_CODE_KEYS.get(bodyCode)
        : undefined;
    if (bodyCodeKey) {
      return appointmentText(bodyCodeKey);
    }
    return localizedFallback;
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : localizedFallback;
}
