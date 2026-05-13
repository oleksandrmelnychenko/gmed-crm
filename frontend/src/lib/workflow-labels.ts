type L = (key: string) => string;

// Maps backend workflow_checklist item_key → localized text.
// Keys must match crates/server/src/routes/workflow_checklists.rs templates.
const ITEM_TEXT_MAP: Record<string, string> = {
  // patient_intake
  profile_verification: "workflow_item_profile_verification",
  compliance_readiness: "workflow_item_compliance_readiness",
  document_pack_review: "workflow_item_document_pack_review",
  language_support_needs: "workflow_item_language_support_needs",
  // order_discovery
  scope_review: "workflow_item_scope_review",
  provider_shortlist: "workflow_item_provider_shortlist",
  // order_intake
  intake_prerequisites: "workflow_item_intake_prerequisites",
  supporting_documents: "workflow_item_supporting_documents",
  // order_execution
  leistungen_tracking: "workflow_item_leistungen_tracking",
  concierge_handoff: "workflow_item_concierge_handoff",
  // order_closure
  closure_readiness: "workflow_item_closure_readiness",
  closure_notes: "workflow_item_closure_notes",
  // order_followup
  followup_plan: "workflow_item_followup_plan",
  final_release: "workflow_item_final_release",
};

// Maps backend checklist_key → localized group label.
const CHECKLIST_GROUP_MAP: Record<string, string> = {
  patient_intake: "workflow_group_patient_intake",
  order_discovery: "workflow_group_order_discovery",
  order_intake: "workflow_group_order_intake",
  order_execution: "workflow_group_order_execution",
  order_closure: "workflow_group_order_closure",
  order_followup: "workflow_group_order_followup",
};

export function localizeWorkflowItemText(
  itemKey: string | null | undefined,
  fallbackText: string,
  l: L,
): string {
  if (!itemKey) return fallbackText;
  const entry = ITEM_TEXT_MAP[itemKey];
  if (entry) return l(entry);
  return fallbackText;
}

export function localizeWorkflowGroupLabel(
  checklistKey: string | null | undefined,
  fallbackLabel: string,
  l: L,
): string {
  if (!checklistKey) return fallbackLabel;
  const entry = CHECKLIST_GROUP_MAP[checklistKey];
  if (entry) return l(entry);
  return fallbackLabel;
}
