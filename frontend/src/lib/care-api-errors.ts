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
  appointment_request_dates_inverted: "api_appointment_request_dates_inverted",
  appointment_request_date_in_past: "api_appointment_request_date_in_past",
  // Satisfaction survey (feedback.rs): only a visit that took place is rated.
  feedback_visit_not_held: "api_feedback_visit_not_held",
  // Patient's own service requests (concierge_services.rs)
  portal_service_period_inverted: "api_portal_service_period_inverted",
  // Patient's document upload (documents.rs `upload_my_document`)
  portal_upload_no_file: "api_portal_upload_no_file",
  portal_upload_type_not_allowed: "api_portal_upload_type_not_allowed",
  portal_upload_content_mismatch: "api_portal_upload_content_mismatch",
  // Recommendations (patient_recommendations.rs `validate_period`)
  recommendation_period_inverted: "api_recommendation_period_inverted",
  // Appointment reminders (appointments.rs `reminder_recipient_refusal`)
  reminder_target_inactive: "api_reminder_target_inactive",
  reminder_role_not_involved: "api_reminder_role_not_involved",
  reminder_interpreter_not_booked: "api_reminder_interpreter_not_booked",
  reminder_no_appointment_access: "api_reminder_no_appointment_access",
  // The client's signature of the single order needs its signed document (orders.rs).
  order_signature_evidence_required: "api_orders_signature_evidence_required",
};
