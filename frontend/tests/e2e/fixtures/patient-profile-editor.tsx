import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import "dayjs/locale/de";
import "dayjs/locale/ru";
import "../../../src/index.css";
import { useLang } from "../../../src/lib/i18n";
import { MemoizedPatientProfileEditorSheet } from "../../../src/pages/patients/ui/sheets/patient-profile-editor-sheet";
import type { PatientDetail } from "../../../src/pages/patients/model/list-model";

const patient: PatientDetail = {
  id: "patient-profile-qa", patient_id: "P-TEST-2", first_name: "Alex", last_name: "Beispiel",
  birth_date: "1976-07-06", gender: "male", is_active: true, created_at: "2026-09-07T10:00:00Z",
  nationality: "UA", residence_country: "DE", languages: ["de", "uk", "en"], functional_labels: ["high_risk"],
  insurance_type: "self_pay", phone_primary: "+49000000001", email: "alex@example.org",
  contacts: [
    { id: "phone-1", contact_kind: "phone", contact_type: "private", value: "+49000000001", is_primary: true, notes: null },
    { id: "email-1", contact_kind: "email", contact_type: "private", value: "alex@example.org", is_primary: true, notes: null },
  ],
};

function PatientProfileEditorFixture() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  return <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang}>
    <button onClick={() => setOpen(true)}>Open profile editor</button>
    {saved ? <p role="status">Profile saved</p> : null}
    <MemoizedPatientProfileEditorSheet
      open={open} patientId={patient.id} detail={patient}
      dictionary={t as unknown as Record<string, string>} lang={lang} statusLabel={status => status}
      onOpenChange={setOpen} onSaved={() => setSaved(true)} onError={() => {}}
    />
  </LocalizationProvider>;
}

const fixtureWindow = window as Window & { patientProfileEditorRoot?: Root };
fixtureWindow.patientProfileEditorRoot ??= createRoot(document.getElementById("root")!);
fixtureWindow.patientProfileEditorRoot.render(<MemoryRouter><PatientProfileEditorFixture /></MemoryRouter>);
