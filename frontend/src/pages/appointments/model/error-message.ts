import { ApiRequestError } from "@/lib/api";
import { APPOINTMENT_COMPLETION_BEFORE_DATE_CODE } from "@/pages/appointments/model/completion-rules";
import { appointmentText } from "@/pages/appointments/model/labels";

const LOCALIZED_TRANSPORT_CODES = new Set(["aborted", "network", "timeout"]);

/** Server rejections whose reason the staff can act on get a localized text. */
const LOCALIZED_BODY_CODE_KEYS = new Map<string, string>([
  [
    APPOINTMENT_COMPLETION_BEFORE_DATE_CODE,
    "appointments_status_completion_not_before_date",
  ],
]);

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
