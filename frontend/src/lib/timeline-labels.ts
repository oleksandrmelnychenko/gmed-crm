import { knownDocumentCodeLabel } from "./required-document-labels";

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
  // A profile edit of the patient card (`changed_fields` of `update_patient`).
  profile: "timeline_category_profile",
  // Codes of the other timeline rows (patients.rs `get_patient_timeline`,
  // QA 2026-10-12 B-26b): order services, contracts, relations, invoice
  // types, appointment types, translation request sources, recommendation
  // types and the patient checklists.
  leistung: "timeline_category_service",
  framework_contract: "timeline_category_framework_contract",
  relation: "timeline_category_relation",
  advance: "timeline_category_invoice_advance",
  interim: "timeline_category_invoice_interim",
  final: "timeline_category_invoice_final",
  non_medical: "timeline_category_appointment_non_medical",
  staff: "timeline_category_request_staff",
  patient_portal: "timeline_category_request_patient_portal",
  follow_up: "timeline_category_recommendation_follow_up",
  consultation: "timeline_category_recommendation_consultation",
  lab_test: "timeline_category_recommendation_lab_test",
  medication_review: "timeline_category_recommendation_medication_review",
  patient_intake: "timeline_source_patient_intake",
  patient_custom: "timeline_source_patient_custom",
  other: "timeline_category_other",
};

/**
 * Category codes that mean different things for different rows ("medical" is
 * an appointment type and a document category): the row's entity type picks
 * the label.
 */
const ENTITY_CATEGORY_MAP: Record<string, Record<string, string>> = {
  appointment: {
    medical: "timeline_category_appointment_medical",
    non_medical: "timeline_category_appointment_non_medical",
    internal: "timeline_category_appointment_internal",
  },
  recommendation: {
    imaging: "timeline_category_recommendation_imaging",
    document: "timeline_category_recommendation_document",
  },
};

/**
 * Categories of clinical card rows (card entries, medical orders, risk
 * scores): their labels live under the keys of the card forms.
 */
const CLINICAL_CATEGORY_KEY_PREFIXES = [
  "patients_label_card_",
  "patients_label_order_",
  "patients_label_score_",
];

// Statuses of timeline rows that the general status labels of the card do
// not name; `localizeTimelineStatus` returns "" for the others.
const STATUS_MAP: Record<string, string> = {
  recorded: "timeline_status_recorded",
  logged: "timeline_status_logged",
  inactive: "timeline_status_inactive",
  superseded: "timeline_status_superseded",
  discontinued: "timeline_status_discontinued",
  abgesetzt: "timeline_status_discontinued",
  aktiv: "patients_detail_active",
  pausiert: "timeline_status_paused",
  geplant: "timeline_status_planned",
  accepted: "timeline_status_accepted",
  approved: "timeline_status_approved",
  delivered: "timeline_status_delivered",
  invoiced: "timeline_status_invoiced",
  hidden: "timeline_status_hidden",
  amounts_hidden: "timeline_status_amounts_hidden",
  visible: "timeline_status_visible",
  changed: "timeline_status_changed",
  verified: "timeline_status_verified",
  candidate: "timeline_status_candidate",
  curated: "timeline_status_curated",
  chronic: "timeline_status_chronic",
  resolved: "timeline_status_resolved",
  answered: "timeline_status_answered",
  done: "timeline_status_done",
  dismissed: "timeline_status_dismissed",
  declined: "timeline_status_declined",
  preferred: "timeline_status_preferred",
  avoid: "timeline_status_avoid",
  neutral: "timeline_status_neutral",
  external: "timeline_status_external",
  unknown: "timeline_status_unknown",
  requested: "timeline_status_requested",
  executed: "timeline_status_executed",
  reviewed: "timeline_status_reviewed",
  failed: "timeline_status_failed",
  no_show: "timeline_status_no_show",
  waived: "timeline_status_waived",
  ready: "timeline_status_ready",
  // Allergy severity (free text, usually one of these).
  low: "timeline_status_severity_low",
  medium: "timeline_status_severity_medium",
  high: "timeline_status_severity_high",
  critical: "timeline_status_severity_critical",
  mild: "timeline_status_severity_mild",
  leicht: "timeline_status_severity_mild",
  moderate: "timeline_status_severity_moderate",
  mittel: "timeline_status_severity_moderate",
  severe: "timeline_status_severity_severe",
  schwer: "timeline_status_severity_severe",
};

/**
 * The label of a timeline status the card's general status labels do not
 * name (clinical "recorded", service "delivered", quote "accepted", …), or ""
 * so the caller falls back to them.
 */
export function localizeTimelineStatus(value: string | null | undefined, l: L): string {
  const code = value?.trim().toLowerCase() ?? "";
  const key = STATUS_MAP[code];
  if (!key) return "";
  const localized = l(key);
  return localized === key ? "" : localized;
}

/**
 * The fields a profile edit names (`changed_fields` of the `update_patient`
 * audit row): only field names, never values (QA B-26, 2026-10-11).
 */
const PROFILE_FIELD_KEYS: Record<string, string> = {
  title: "timeline_profile_field_title",
  first_name: "timeline_profile_field_first_name",
  last_name: "timeline_profile_field_last_name",
  birth_date: "timeline_profile_field_birth_date",
  gender: "timeline_profile_field_gender",
  phone_primary: "timeline_profile_field_phone_primary",
  phone_secondary: "timeline_profile_field_phone_secondary",
  email: "timeline_profile_field_email",
  contacts: "timeline_profile_field_contacts",
  nationality: "timeline_profile_field_nationality",
  citizenships: "timeline_profile_field_citizenships",
  residence_country: "timeline_profile_field_residence_country",
  languages: "timeline_profile_field_languages",
  functional_labels: "timeline_profile_field_functional_labels",
  address_street: "timeline_profile_field_address_street",
  address_city: "timeline_profile_field_address_city",
  address_zip: "timeline_profile_field_address_zip",
  address_country: "timeline_profile_field_address_country",
  insurance_provider: "timeline_profile_field_insurance_provider",
  insurance_number: "timeline_profile_field_insurance_number",
  insurance_type: "timeline_profile_field_insurance_type",
  emergency_contact_name: "timeline_profile_field_emergency_contact_name",
  emergency_contact_phone: "timeline_profile_field_emergency_contact_phone",
  emergency_contact_relation: "timeline_profile_field_emergency_contact_relation",
  passport_number: "timeline_profile_field_passport_number",
  passport_expiry: "timeline_profile_field_passport_expiry",
  notes: "timeline_profile_field_notes",
  clinical_warnings: "timeline_profile_field_clinical_warnings",
};

const PROFILE_UPDATED_PREFIX = "Profile updated:";

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
  "Privacy request held until open business is closed": "timeline_title_privacy_request_open_business_hold",
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
  // The visibility of a document row: the document card's own wording, so a
  // draft reads "may be released to the patient", not "seen by the patient"
  // (QA 2026-10-12 B-26b).
  "patient visible": "patients_patient_visible",
  // Relation types (`patient_relations.relation_type`).
  spouse: "timeline_source_relation_spouse",
  child: "timeline_source_relation_child",
  sibling: "timeline_source_relation_sibling",
  relative: "timeline_source_relation_relative",
  guardian: "timeline_source_relation_guardian",
  caregiver: "timeline_source_relation_caregiver",
  friend: "timeline_source_relation_friend",
  other: "timeline_source_relation_other",
  // Privacy requests: type and review action of the compliance rows.
  erasure: "timeline_source_privacy_erasure",
  restriction: "timeline_source_privacy_restriction",
  "third party revoke": "timeline_source_privacy_third_party_revoke",
  access: "timeline_source_privacy_access",
  export: "timeline_source_privacy_export",
  portability: "timeline_source_privacy_export",
  rectification: "timeline_source_privacy_rectification",
  objection: "timeline_source_privacy_objection",
  approve: "timeline_source_review_approve",
  reject: "timeline_source_review_reject",
  hold: "timeline_source_review_hold",
  // Recommendation priorities.
  low: "timeline_source_priority_low",
  normal: "timeline_source_priority_normal",
  high: "timeline_source_priority_high",
  urgent: "timeline_source_priority_urgent",
  // Staff roles of checklist owners and assignments.
  "ceo assistant": "timeline_source_role_ceo_assistant",
  "teamlead interpreter": "timeline_source_role_teamlead_interpreter",
  sales: "timeline_source_role_sales",
  cave: "timeline_source_cave",
  // Document visibility codes (`documents.visibility`) the document rows send.
  "released internal": "timeline_source_released_internal",
  "released external": "timeline_source_released_external",
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
  // The maps are keyed in either form: "patient_visible" and "patient visible".
  const entry = map[key] ?? map[key.replace(/[_-]+/g, " ")] ?? map[key.replace(/[\s-]+/g, "_")];
  if (entry) {
    const localized = l(entry);
    if (localized !== entry) return localized;
  }
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
  const code = value?.trim().toLowerCase() ?? "";
  // A document row carries its category or type code ("provider_template",
  // "finance_cost_coverage", "visa_invitation_letter"): the document labels
  // of the catalogs name them (QA B-26).
  if (code && !CATEGORY_MAP[code]) {
    const documentLabel = knownDocumentCodeLabel(code, l);
    // An untranslated catalog key comes back as the key itself.
    if (documentLabel && !/^[a-z0-9_]+$/.test(documentLabel)) return documentLabel;
    for (const prefix of CLINICAL_CATEGORY_KEY_PREFIXES) {
      const key = `${prefix}${code}`;
      const label = l(key);
      if (label !== key) return label;
    }
  }
  return lookupOrHumanize(CATEGORY_MAP, value, l);
}

/** The category of one timeline row, read with the row's entity type. */
export function localizeTimelineItemCategory(
  entityType: string | null | undefined,
  value: string | null | undefined,
  l: L,
): string {
  const code = value?.trim().toLowerCase() ?? "";
  const key = ENTITY_CATEGORY_MAP[entityType?.trim().toLowerCase() ?? ""]?.[code];
  if (key) {
    const localized = l(key);
    if (localized !== key) return localized;
  }
  return localizeTimelineCategory(value, l);
}

/** The field names of a profile edit, in the UI language. */
export function localizeProfileFieldList(fields: string, l: L): string {
  return fields
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => {
      const key = PROFILE_FIELD_KEYS[field];
      const localized = key ? l(key) : key;
      return key && localized !== key ? localized : humanizeFallback(field);
    })
    .join(", ");
}

export function localizeTimelineSource(
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";
  return value
    .split("·")
    .map((part) => {
      // A consent row names its consent type (`dsgvo_data_transfer`, …).
      const code = part.trim().toLowerCase();
      if (/^[a-z0-9_]+$/.test(code) && !SOURCE_MAP[code] && !SOURCE_MAP[code.replace(/_/g, " ")]) {
        const consentKey = `consents_type_${code}`;
        const consentLabel = l(consentKey);
        if (consentLabel !== consentKey) return consentLabel;
      }
      return lookupOrHumanize(SOURCE_MAP, part, l);
    })
    .filter(Boolean)
    .join(" · ");
}

/**
 * Fixed titles the server writes for timeline rows: the clinical record
 * activity in German, placeholders in English (QA 2026-10-12 B-26b).
 */
const EXACT_TITLE_KEYS: Record<string, string> = {
  "Diagnosen aktualisiert": "timeline_title_clinical_diagnoses_updated",
  "Medikation aktualisiert": "timeline_title_clinical_medications_updated",
  "Befunde aktualisiert": "timeline_title_clinical_examinations_updated",
  "Therapie aktualisiert": "timeline_title_clinical_procedures_updated",
  "Allergien/CAVE aktualisiert": "timeline_title_clinical_warnings_updated",
  "Anamnese aktualisiert": "timeline_title_clinical_anamnesis_updated",
  "Anamnese gelöscht": "timeline_title_clinical_anamnesis_deleted",
  "Verlauf aktualisiert": "timeline_title_clinical_course_updated",
  "Klinisches Profil aktualisiert": "timeline_title_clinical_profile_updated",
  Anamnese: "timeline_title_anamnesis",
  "Blocked medical slot": "appointments_blocked_slot",
  Communication: "timeline_title_communication",
  "Related person": "timeline_title_related_person",
  Document: "timeline_title_document",
  "Package consumption": "timeline_title_package_consumption",
  Medication: "timeline_title_medication",
};

/** "Prefix: rest" titles; the rest is a number or a name and stays. */
const TITLE_PREFIX_KEYS: Array<[string, string]> = [
  ["Invoice visibility:", "timeline_title_invoice_visibility"],
  ["Translation request:", "timeline_title_translation_request"],
  ["Package change:", "timeline_title_package_change"],
  ["Dunning collections:", "timeline_title_dunning_collections"],
];

function localizedOrNull(key: string, l: L): string | null {
  const localized = l(key);
  return localized === key ? null : localized;
}

/** "Interpreter preference: <name> -> <preference>". */
function localizeInterpreterPreferenceTitle(value: string, l: L): string | null {
  const match = /^Interpreter preference:\s*(.*?)\s*->\s*([a-z_]+)$/.exec(value);
  if (!match) return null;
  const prefix = localizedOrNull("timeline_title_interpreter_preference", l);
  if (!prefix) return null;
  const name = match[1] === "Interpreter" ? (localizedOrNull("timeline_title_interpreter", l) ?? match[1]) : match[1];
  const preference = localizeTimelineStatus(match[2], l) || humanizeFallback(match[2]);
  return `${prefix}: ${name} → ${preference}`;
}

/** "Drug match <status>: <medication>". */
function localizeDrugMatchTitle(value: string, l: L): string | null {
  const match = /^Drug match ([a-z_]+):\s*(.*)$/.exec(value);
  if (!match) return null;
  const prefix = localizedOrNull("timeline_title_drug_match", l);
  if (!prefix) return null;
  const status = localizeTimelineStatus(match[1], l) || humanizeFallback(match[1]);
  const medication = match[2] === "medication" ? (localizedOrNull("timeline_title_medication", l) ?? match[2]) : match[2];
  return `${prefix} (${status}): ${medication}`;
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

  // "Profile updated: phone_primary, email" — a profile edit names the
  // changed fields (never their values).
  if (value.startsWith(PROFILE_UPDATED_PREFIX)) {
    const prefix = l("timeline_title_profile_updated");
    const fields = localizeProfileFieldList(value.slice(PROFILE_UPDATED_PREFIX.length), l);
    const title = prefix === "timeline_title_profile_updated" ? "Profile updated" : prefix;
    return fields ? `${title}: ${fields}` : title;
  }

  const complianceKey = COMPLIANCE_TITLE_KEYS[value];
  if (complianceKey) {
    const localized = l(complianceKey);
    if (localized !== complianceKey) return localized;
  }

  const exactTitleKey = EXACT_TITLE_KEYS[value];
  if (exactTitleKey) {
    const localized = localizedOrNull(exactTitleKey, l);
    if (localized) return localized;
  }
  for (const [prefix, key] of TITLE_PREFIX_KEYS) {
    if (value.startsWith(prefix)) {
      const localized = localizedOrNull(key, l);
      if (localized) return `${localized}: ${value.slice(prefix.length).trim()}`;
    }
  }
  const preferenceTitle = localizeInterpreterPreferenceTitle(value, l);
  if (preferenceTitle) return preferenceTitle;
  const drugMatchTitle = localizeDrugMatchTitle(value, l);
  if (drugMatchTitle) return drugMatchTitle;

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
