import { formatUnknownValue, type Translations } from "@/lib/i18n";
import type { PortalNextActionItem } from "@/pages/patients/model/portal-shared";

/**
 * Kinds `GET /me/next-actions` returns (see `patient_next_actions.rs`). The
 * server sends English fallback labels and hints; the portal shows its own.
 */
const NEXT_ACTION_KIND_LABEL_KEYS = {
  upcoming_appointment: "portal_dashboard_next_action_upcoming_appointment",
  recommendation: "portal_dashboard_next_action_recommendation_decision",
  invoice_payment: "portal_dashboard_next_action_invoice_payment",
  package_approval: "portal_dashboard_next_action_package_approval",
  document_confirmation: "portal_dashboard_next_action_document_confirmation",
  recommendation_decision: "portal_dashboard_next_action_recommendation_decision",
  appointment_request: "portal_dashboard_next_action_appointment_request",
  privacy_request: "portal_dashboard_next_action_privacy_request",
  feedback_request: "portal_dashboard_next_action_feedback_request",
  concierge_service: "portal_dashboard_next_action_concierge_service",
} satisfies Partial<Record<string, keyof Translations>>;

const NEXT_ACTION_BUTTON_LABEL_KEYS = {
  upcoming_appointment: "portal_dashboard_open_appointments",
  recommendation: "portal_dashboard_open_recommendations",
  invoice_payment: "portal_dashboard_open_invoices",
  document_confirmation: "portal_dashboard_open_documents",
  package_approval: "portal_dashboard_contact_care_team",
} satisfies Partial<Record<string, keyof Translations>>;

/** Kinds whose server description is a fixed English hint, not patient data. */
const NEXT_ACTION_HINT_KEYS = {
  invoice_payment: "portal_dashboard_next_action_invoice_payment_hint",
  document_confirmation: "portal_dashboard_next_action_document_confirmation_hint",
} satisfies Partial<Record<string, keyof Translations>>;

export function formatNextActionKind(kind: string, translations: Translations) {
  const labelKey =
    NEXT_ACTION_KIND_LABEL_KEYS[kind as keyof typeof NEXT_ACTION_KIND_LABEL_KEYS];
  return labelKey ? translations[labelKey] : formatUnknownValue(kind, translations);
}

export function nextActionButtonLabel(
  item: Pick<PortalNextActionItem, "kind" | "action_label">,
  translations: Translations,
) {
  const labelKey =
    NEXT_ACTION_BUTTON_LABEL_KEYS[item.kind as keyof typeof NEXT_ACTION_BUTTON_LABEL_KEYS];
  return labelKey ? translations[labelKey] : item.action_label;
}

export function nextActionDescription(
  item: Pick<PortalNextActionItem, "kind" | "description">,
  translations: Translations,
) {
  const hintKey = NEXT_ACTION_HINT_KEYS[item.kind as keyof typeof NEXT_ACTION_HINT_KEYS];
  return hintKey ? translations[hintKey] : item.description;
}
