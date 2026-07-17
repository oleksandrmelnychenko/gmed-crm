import { ApiRequestError } from "@/lib/api";

const LOCALIZED_TRANSPORT_CODES = new Set(["aborted", "network", "timeout"]);

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
    return localizedFallback;
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : localizedFallback;
}
