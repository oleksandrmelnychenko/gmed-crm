type L = (key: string) => string;

// Known backend entity_type codes -> localized label.
const ENTITY_TYPE_MAP: Record<string, string> = {
  patient: "timeline_entity_patient",
  case: "timeline_entity_case",
  order: "timeline_entity_order",
  service: "timeline_entity_service",
  appointment: "timeline_entity_appointment",
  document: "timeline_entity_document",
  contract: "timeline_entity_contract",
  invoice: "timeline_entity_invoice",
  invoice_visibility: "timeline_entity_invoice_visibility",
  clinical: "timeline_entity_clinical",
  recommendation: "timeline_entity_recommendation",
  translation_request: "timeline_entity_translation_request",
  interpreter_preference: "timeline_entity_interpreter_preference",
  drug_verification: "timeline_entity_drug_verification",
  service_package: "timeline_entity_service_package",
  service_package_change: "timeline_entity_service_package_change",
  service_package_consumption: "timeline_entity_service_package_consumption",
  service_group: "timeline_entity_service_group",
  compliance: "timeline_entity_compliance",
  task: "timeline_entity_task",
  workflow_task: "timeline_entity_workflow_task",
  communication: "timeline_entity_communication",
  risk_score: "timeline_entity_risk_score",
  card_entry: "timeline_entity_card_entry",
  vital: "timeline_entity_vital",
  medical_order: "timeline_entity_medical_order",
  relation: "timeline_entity_relation",
  assignment: "timeline_entity_assignment",
  note: "timeline_entity_note",
  reminder: "timeline_entity_reminder",
  message: "timeline_entity_message",
  dunning: "timeline_entity_dunning",
  quote: "timeline_entity_quote",
};

// Timeline category codes commonly used by the backend.
const CATEGORY_MAP: Record<string, string> = {
  clinical: "timeline_category_clinical",
  diagnosis: "timeline_category_diagnosis",
  medication: "timeline_category_medication",
  examination: "timeline_category_examination",
  procedure: "timeline_category_procedure",
  allergy: "timeline_category_allergy",
  anamnesis: "timeline_category_anamnesis",
  course: "timeline_category_course",
  symptom: "timeline_category_symptom",
  administrative: "timeline_category_administrative",
  financial: "timeline_category_financial",
  billing: "timeline_category_billing",
  invoice_visibility: "timeline_category_invoice_visibility",
  interpreter_preference: "timeline_category_interpreter_preference",
  drug_verification: "timeline_category_drug_verification",
  service_package: "timeline_category_service_package",
  package_consumption: "timeline_category_package_consumption",
  service_group: "timeline_category_service_group",
  legal: "timeline_category_legal",
  compliance: "timeline_category_compliance",
  communication: "timeline_category_communication",
  care: "timeline_category_care",
  intake: "timeline_category_intake",
  followup: "timeline_category_followup",
  execution: "timeline_category_execution",
  discovery: "timeline_category_discovery",
  closure: "timeline_category_closure",
  scheduling: "timeline_category_scheduling",
  documents: "timeline_category_documents",
  contracts: "timeline_category_contracts",
  invoices: "timeline_category_invoices",
  appointments: "timeline_category_appointments",
  orders: "timeline_category_orders",
  cases: "timeline_category_cases",
  workflow: "timeline_category_workflow",
  // Compliance rows of the patient timeline (patients.rs timeline query).
  privacy_request: "timeline_category_privacy_request",
  consent: "timeline_category_consent",
  dsgvo_export: "timeline_category_dsgvo_export",
  dsgvo_anonymize: "timeline_category_dsgvo_anonymize",
  legal_status: "timeline_category_legal",
  feedback: "timeline_category_feedback",
  lifecycle: "timeline_category_lifecycle",
};

// Titles the server writes for compliance and file-status events.
const COMPLIANCE_TITLE_KEYS: Record<string, string> = {
  "DSGVO data export": "timeline_title_dsgvo_export",
  "Patient anonymized": "timeline_title_patient_anonymized",
  "Privacy erasure requested": "timeline_title_privacy_erasure_requested",
  "Processing restriction requested": "timeline_title_restriction_requested",
  "Third-party sharing revocation requested": "timeline_title_third_party_revoke_requested",
  "Privacy request created": "timeline_title_privacy_request_created",
  "Privacy request reviewed": "timeline_title_privacy_request_reviewed",
  "Privacy request approved": "timeline_title_privacy_request_approved",
  "Privacy request rejected": "timeline_title_privacy_request_rejected",
  "Privacy request put on retention hold": "timeline_title_privacy_request_hold",
  "Processing restriction applied": "timeline_title_restriction_applied",
  "Third-party sharing revoked": "timeline_title_third_party_revoked",
  "Privacy request executed": "timeline_title_privacy_request_executed",
  "Processing restriction lifted": "timeline_title_restriction_lifted",
  "Consent granted": "timeline_title_consent_granted",
  "Consent revoked": "timeline_title_consent_revoked",
  "Patient feedback submitted": "timeline_title_feedback_submitted",
  "Patient feedback reviewed": "timeline_title_feedback_reviewed",
  "Legal/compliance status updated": "timeline_title_legal_status_updated",
  "Patient file activated": "timeline_title_patient_activated",
  "Patient file deactivated": "timeline_title_patient_deactivated",
};

// Source labels (who created the event).
const SOURCE_MAP: Record<string, string> = {
  system: "timeline_source_system",
  patient_manager: "timeline_source_patient_manager",
  interpreter: "timeline_source_interpreter",
  concierge: "timeline_source_concierge",
  billing: "timeline_source_billing",
  ceo: "timeline_source_ceo",
  patient: "timeline_source_patient",
  staff: "timeline_source_staff",
  automated: "timeline_source_automated",
  portal: "timeline_source_portal",
  clinic: "timeline_source_clinic",
  doctor: "timeline_source_doctor",
  internal: "timeline_source_internal",
  medical: "timeline_source_medical",
  payment: "timeline_source_payment",
  "medical report": "timeline_source_medical_report",
  "patient visible": "timeline_source_patient_visible",
  "finance cost estimate": "timeline_source_finance_cost_estimate",
  "patient intake": "timeline_source_patient_intake",
  "patient custom": "timeline_source_patient_custom",
  "order discovery": "timeline_source_order_discovery",
  contract: "timeline_entity_contract",
  care: "timeline_category_care",
  allergie: "timeline_source_allergy",
  parent: "timeline_source_parent",
  self: "timeline_source_self",
};

function humanizeFallback(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lookupOrHumanize(
  map: Record<string, string>,
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";
  const trimmed = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase();
  const entry = map[key];
  if (entry) return l(entry);
  // snake_case code → humanize; already-human text → leave alone
  if (/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) return humanizeFallback(trimmed);
  return trimmed;
}

export function localizeTimelineEntityType(
  value: string | null | undefined,
  l: L,
): string {
  return lookupOrHumanize(ENTITY_TYPE_MAP, value, l);
}

export function localizeTimelineCategory(
  value: string | null | undefined,
  l: L,
): string {
  return lookupOrHumanize(CATEGORY_MAP, value, l);
}

export function localizeTimelineSource(
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";
  return value
    .split("·")
    .map((part) => lookupOrHumanize(SOURCE_MAP, part, l))
    .filter(Boolean)
    .join(" · ");
}

export function localizeTimelineTitle(
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";

  if (/^workflow_item_[a-z0-9_]+$/.test(value)) {
    const localized = l(value);
    return localized === value ? humanizeFallback(value.replace(/^workflow_item_/, "")) : localized;
  }

  const complianceKey = COMPLIANCE_TITLE_KEYS[value];
  if (complianceKey) {
    const localized = l(complianceKey);
    if (localized !== complianceKey) return localized;
  }

  // "Consent: <type>" — the consent type is a key such as dsgvo_data_transfer.
  const consentMatch = /^Consent:\s*([a-z0-9_]+)$/.exec(value);
  if (consentMatch) {
    const typeKey = `consents_type_${consentMatch[1]}`;
    const typeLabel = l(typeKey);
    const prefix = l("timeline_title_consent");
    return `${prefix === "timeline_title_consent" ? "Consent" : prefix}: ${
      typeLabel === typeKey ? humanizeFallback(consentMatch[1]) : typeLabel
    }`;
  }

  const workflowTitle = value
    .replace(/^(?:Order|Patient) checklist:\s*/i, "")
    .trim();
  const exactKey = {
    "Verify contact, insurance and emergency data": "workflow_item_profile_verification",
    "Review DSGVO, contract readiness and legal status": "workflow_item_compliance_readiness",
    "Audit required patient documents and current upload gaps": "workflow_item_document_pack_review",
    "Confirm language, travel and concierge support needs": "workflow_item_language_support_needs",
    "Prepare provider and doctor shortlist for execution":
      "workflow_item_provider_shortlist",
    "Review order scope and convert needs into service blocks":
      "workflow_item_scope_review",
    "Confirm intake prerequisites and appointment dependencies":
      "workflow_item_intake_prerequisites",
    "Check supporting documents for linked clinics or doctors":
      "workflow_item_supporting_documents",
    "Track delivered Leistungen and pending approvals":
      "workflow_item_leistungen_tracking",
    "Coordinate travel, accommodation or external support handoff":
      "workflow_item_concierge_handoff",
    "Validate order closure and billing handoff readiness":
      "workflow_item_closure_readiness",
    "Capture medical and operational closure notes":
      "workflow_item_closure_notes",
    "Plan follow-up visits and post-treatment outreach":
      "workflow_item_followup_plan",
    "Confirm final document release and patient communication":
      "workflow_item_final_release",
    // Checklist items of the automatic concierge workflow of an appointment.
    "Confirm travel / service booking details":
      "generated_concierge_checklist_confirm_booking",
    "Coordinate provider, transfer, hotel or VIP service":
      "generated_concierge_checklist_coordinate_provider",
    "Support patient during the concierge service window":
      "generated_concierge_checklist_support_patient",
    "Collect confirmations, receipts and handoff notes":
      "generated_concierge_checklist_collect_confirmations",
    // Checklist events of the patient timeline.
    "Workflow checklist item created": "timeline_title_workflow_item_created",
    "Workflow checklist item completed": "timeline_title_workflow_item_completed",
    "Workflow checklist item marked not required":
      "timeline_title_workflow_item_not_required",
    "Workflow checklist item reopened": "timeline_title_workflow_item_reopened",
  }[workflowTitle];
  if (exactKey) return l(exactKey);

  const prefixes: Array<[string, string]> = [
    ["Dunning first:", "timeline_title_dunning_first"],
    ["Dunning second:", "timeline_title_dunning_second"],
    ["Dunning final:", "timeline_title_dunning_final"],
    ["Anamnese:", "timeline_title_anamnesis"],
    // Tasks and reminders the appointment creates for its concierge.
    ["Coordinate concierge service:", "generated_task_coordinate_concierge_service"],
    ["Collect concierge receipts:", "generated_task_collect_concierge_receipts"],
    ["Upcoming concierge service:", "generated_reminder_upcoming_concierge_service"],
  ];
  for (const [prefix, key] of prefixes) {
    if (value.startsWith(prefix)) {
      return `${l(key)}: ${value.slice(prefix.length).trim()}`;
    }
  }

  return value;
}

const ENTITY_TYPE_BADGE_CLASS: Record<string, string> = {
  patient: "border-slate-200 bg-slate-50 text-slate-700",
  case: "border-violet-200 bg-violet-50 text-violet-700",
  order: "border-indigo-200 bg-indigo-50 text-indigo-700",
  appointment: "border-sky-200 bg-sky-50 text-sky-700",
  document: "border-teal-200 bg-teal-50 text-teal-700",
  contract: "border-amber-200 bg-amber-50 text-amber-700",
  invoice: "border-rose-200 bg-rose-50 text-rose-700",
  invoice_visibility: "border-rose-200 bg-rose-50 text-rose-700",
  clinical: "border-emerald-200 bg-emerald-50 text-emerald-700",
  recommendation: "border-blue-200 bg-blue-50 text-blue-700",
  translation_request: "border-cyan-200 bg-cyan-50 text-cyan-700",
  interpreter_preference: "border-sky-200 bg-sky-50 text-sky-700",
  drug_verification: "border-emerald-200 bg-emerald-50 text-emerald-700",
  service_package: "border-amber-200 bg-amber-50 text-amber-700",
  service_package_change: "border-amber-200 bg-amber-50 text-amber-700",
  service_package_consumption: "border-orange-200 bg-orange-50 text-orange-700",
  service_group: "border-indigo-200 bg-indigo-50 text-indigo-700",
  compliance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  task: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  workflow_task: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  communication: "border-cyan-200 bg-cyan-50 text-cyan-700",
  risk_score: "border-orange-200 bg-orange-50 text-orange-700",
  card_entry: "border-lime-200 bg-lime-50 text-lime-700",
  vital: "border-pink-200 bg-pink-50 text-pink-700",
  medical_order: "border-blue-200 bg-blue-50 text-blue-700",
  relation: "border-purple-200 bg-purple-50 text-purple-700",
  assignment: "border-sky-200 bg-sky-50 text-sky-700",
  note: "border-neutral-200 bg-neutral-50 text-neutral-700",
  reminder: "border-yellow-200 bg-yellow-50 text-yellow-700",
  message: "border-cyan-200 bg-cyan-50 text-cyan-700",
  dunning: "border-red-200 bg-red-50 text-red-700",
  quote: "border-green-200 bg-green-50 text-green-700",
};

export function timelineEntityTypeBadgeClass(
  value: string | null | undefined,
): string {
  if (!value) return "border-border/60 bg-muted/25 text-muted-foreground";
  const key = value.trim().toLowerCase();
  return (
    ENTITY_TYPE_BADGE_CLASS[key] ??
    "border-border/60 bg-muted/25 text-muted-foreground"
  );
}
