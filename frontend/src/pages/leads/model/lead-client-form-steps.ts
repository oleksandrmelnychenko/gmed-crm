import type { StepId } from "@/pages/patient-lead/lead-request-steps";

/**
 * A block of the wizard that shows what the client answered in the cabinet
 * (read-only), as the «Изменить» button next to it names it.
 */
export type ClientFormSection =
  | "person"
  | "birth"
  | "representation"
  | "identity"
  | "economic_interest"
  | "enhanced_details"
  | "relationship_proof"
  | "follow_up"
  | "legal"
  | "billing"
  | "payer_organisation"
  | "services";

/**
 * The step of the client's form (`LeadRequestPage`) that answers a block
 * (owner decision 2026-10-29: staff fill in everything the client fills in,
 * from the wizard): the person with the representation on the first step, the
 * identity document on its own, the invoice recipient and a paying
 * organisation under insurance & invoice, the services on theirs; birth data
 * (block K), the legal questions and the own economic interest (L), the
 * enhanced details (A), the payer relationship (B) and stay / PEP / sanctions
 * details (F, H, J) are follow-up blocks.
 */
export function clientFormStepOf(section: ClientFormSection): StepId {
  switch (section) {
    case "person":
    case "representation":
      return "person";
    case "identity":
      return "identity";
    case "billing":
    case "payer_organisation":
      return "billing";
    case "services":
      return "services";
    case "birth":
    case "economic_interest":
    case "enhanced_details":
    case "relationship_proof":
    case "follow_up":
    case "legal":
      return "follow_up";
  }
}

/**
 * The draft fields of the wizard the client's form also writes: taken into an
 * untouched wizard draft when the dialog closes (`mergePatientUpdates`), so a
 * later autosave of the wizard does not write the old values back.
 */
export const CLIENT_FORM_SERVICE_DRAFT_KEYS = ["serviceNeeds", "serviceComments", "serviceNotes", "programDateFrom"] as const;
