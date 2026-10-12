/**
 * Server error codes of appointments, appointment requests, reminders and
 * the order signature, mapped to translated texts (`uiText` keys in
 * `lib/i18n/catalogs/care-ui.ts`). `apiFetch` shows the translation instead
 * of the English server message (QA round 2, 2026-10-12: C2-11, C-11, C2-14).
 */
export const CARE_API_ERROR_KEYS: Record<string, string> = {
  // Patient portal appointment requests (crates/server/src/routes/appointments.rs)
  appointment_request_open_exists: "api_appointment_request_open_exists",
  appointment_request_date_or_reason_required: "api_appointment_request_date_or_reason_required",
  // Appointment reminders (appointments.rs `reminder_recipient_refusal`)
  reminder_target_inactive: "api_reminder_target_inactive",
  reminder_role_not_involved: "api_reminder_role_not_involved",
  reminder_interpreter_not_booked: "api_reminder_interpreter_not_booked",
  reminder_no_appointment_access: "api_reminder_no_appointment_access",
  // The client's signature of the single order needs its signed document (orders.rs).
  order_signature_evidence_required: "api_orders_signature_evidence_required",
};
