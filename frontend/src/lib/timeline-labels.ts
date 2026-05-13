type L = (key: string) => string;

// Known backend entity_type codes -> localized label.
const ENTITY_TYPE_MAP: Record<string, string> = {
  patient: "timeline_entity_patient",
  case: "timeline_entity_case",
  order: "timeline_entity_order",
  appointment: "timeline_entity_appointment",
  document: "timeline_entity_document",
  contract: "timeline_entity_contract",
  invoice: "timeline_entity_invoice",
  invoice_visibility: "timeline_entity_invoice_visibility",
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
  note: "timeline_entity_note",
  reminder: "timeline_entity_reminder",
  message: "timeline_entity_message",
  dunning: "timeline_entity_dunning",
  quote: "timeline_entity_quote",
};

// Timeline category codes commonly used by the backend.
const CATEGORY_MAP: Record<string, string> = {
  clinical: "timeline_category_clinical",
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
  const trimmed = value.trim();
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
  return lookupOrHumanize(SOURCE_MAP, value, l);
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
