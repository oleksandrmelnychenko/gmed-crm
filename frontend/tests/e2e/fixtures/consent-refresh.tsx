import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { ConsentFormChoicesSection } from "../../../src/pages/patient-lead/lead-request-consent-form";
import { NO_CONSENT_FORM_CHOICES, type LeadRequest } from "../../../src/pages/patient-lead/lead-request-api";

const choices = { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: true };
function Fixture() {
  const [request, setRequest] = useState<LeadRequest>({ lead_id: "synthetic-lead", access_kind: "guardian", minor: true, consent_form: { version: "2026-10-12", choices, chosen_at: "2026-10-12T08:00:00Z", chosen_by_me: true, recipients: [{ name: "First Recipient", relation: "other", contact: null }] } } as LeadRequest);
  return <main className="p-4"><button onClick={() => setRequest(current => ({ ...current, consent_form: { ...current.consent_form!, chosen_at: "2026-10-12T09:00:00Z", chosen_by_me: false, choices: { ...choices, channel_email: true }, recipients: [{ name: "Second Recipient", relation: "other", contact: null }] } }))}>Refresh other parent</button><ConsentFormChoicesSection request={request} lang="en" enqueue={task => task()} onChange={setRequest} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
