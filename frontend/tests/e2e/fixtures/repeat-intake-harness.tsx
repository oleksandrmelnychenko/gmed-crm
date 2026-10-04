import { RepeatIntakePicker } from "../../../src/pages/patients/ui/workspace/repeat-intake-picker";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { AuthProvider } from "../../../src/lib/auth";
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
  const [repeat, setRepeat] = useState(true);
  const [picker, setPicker] = useState(false);
  const [creationKey, setCreationKey] = useState<string>();
  const [open, setOpen] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const pick = useCallback((id: string | null, key?: string) => {
    setPicker(false); setRepeat(true); setLeadId(id); setCreationKey(key); setOpen(true);
  }, []);
  return <>
    <button onClick={() => { setPicker(true); }}>Repeat intake</button>
    <button onClick={() => { setRepeat(false); setLeadId("00000000-0000-0000-0000-000000000222"); setOpen(true); }}>Lead intake</button>
    {picker && <RepeatIntakePicker patientId={patient.id} lang={localStorage.getItem("gmed_lang") ?? "ru"} onPick={pick} onClose={() => setPicker(false)} />}
    {open && <LeadWizard creationKey={creationKey} open entryPoint={repeat ? "repeat-patient" : "lead"} createMode={!leadId} leadId={leadId} existingPatient={repeat ? patient : undefined}
      onCreated={setLeadId} onOpenChange={setOpen} />}
  </>;
}

// The wizard runs inside the signed-in staff app (its signature actions read
// the user). Vite can re-import this entry with a timestamp after a dependency
// update; reuse its root so the previous dialog portal unmounts normally.
const host = window as typeof window & { repeatIntakeRoot?: ReturnType<typeof createRoot> };
host.repeatIntakeRoot ??= createRoot(document.getElementById("root")!);
host.repeatIntakeRoot.render(
  <AuthProvider><LocalizationProvider dateAdapter={AdapterDayjs}><Harness /></LocalizationProvider></AuthProvider>,
);
