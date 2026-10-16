import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { ConsentFormChoicesSection } from "../../../src/pages/patient-lead/lead-request-consent-form";
import { NO_CONSENT_FORM_CHOICES, type LeadRequest } from "../../../src/pages/patient-lead/lead-request-api";

import { useRequestQueue } from "../../../src/pages/patient-lead/lead-request-parts";

const choices = { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: true };
function Fixture() {
  const enqueue = useRequestQueue();
  const [request, setRequest] = useState<LeadRequest>({ lead_id: "synthetic-lead", access_kind: "guardian", minor: true, disclosure: { allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en", chosen_at: "2026-10-14T08:00:00Z", chosen_by: "guardian-a", access_kind: "guardian", company_name: "Example Clinic" }, trusted_persons: [{ name: "First Recipient", relation: "other", contact: null, scope: "Invoices only" }], consent_form: { version: "2026-10-12", choices, chosen_at: "2026-10-12T08:00:00Z", chosen_by_me: true, recipients: [{ name: "First Recipient", relation: "other", contact: null, scope: "Invoices only" }] } } as LeadRequest);
  return <main className="p-4"><button onClick={() => setRequest(current => ({ ...current, trusted_persons: [{ name: "Second Recipient", relation: "other", contact: null, scope: "Invoices only" }], consent_form: { ...current.consent_form!, chosen_at: "2026-10-12T09:00:00Z", chosen_by_me: false, choices: { ...choices, channel_email: true }, recipients: [{ name: "Second Recipient", relation: "other", contact: null, scope: "Invoices only" }] } }))}>Refresh other parent</button><ConsentFormChoicesSection request={request} lang="en" enqueue={enqueue} onChange={setRequest} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
