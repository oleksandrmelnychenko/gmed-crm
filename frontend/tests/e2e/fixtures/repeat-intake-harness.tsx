import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LeadWizard } from "../../../src/pages/leads/ui/lead-wizard";
import type { PatientDetail } from "../../../src/pages/patients/model/list-model";
import "../../../src/index.css";

const patient = {
  id: "00000000-0000-0000-0000-000000000111", patient_id: "P-REPEAT-001",
  first_name: "Anna", last_name: "Beispiel", birth_date: "1982-04-03", gender: "female",
  email: "anna@example.com", phone_primary: "+4915776543210", address_street: "Teststr. 2",
  address_city: "Berlin", address_zip: "10115", address_country: "DE", languages: ["de"],
  lifecycle_status: "active",
} as PatientDetail;

function Harness() {
  const [open, setOpen] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  return <>
    <button onClick={() => { setLeadId(null); setOpen(true); }}>Repeat intake</button>
    {open && <LeadWizard open createMode={!leadId} leadId={leadId} existingPatient={patient}
      onCreated={setLeadId} onOpenChange={setOpen} />}
  </>;
}

createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AdapterDayjs}><Harness /></LocalizationProvider>,
);
