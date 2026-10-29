import { useParams } from "react-router-dom";

import { LeadRequestPage } from "@/pages/patient-lead/lead-request-page";

/**
 * `/leads/{id}/client-form`: the client's cabinet form, filled in by staff
 * from the wizard (owner decision 2026-10-29).
 */
export function LeadClientFormPage() {
  const { leadId } = useParams<{ leadId: string }>();
  return leadId ? <LeadRequestPage staffLeadId={leadId} /> : null;
}
