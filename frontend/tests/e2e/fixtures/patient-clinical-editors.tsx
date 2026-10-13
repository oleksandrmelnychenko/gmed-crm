import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import "../../../src/index.css";
import { PatientSymptomsPainSections } from "../../../src/pages/patients/ui/sections/patient-symptoms-pain-sections";
import { PatientVitalsSheet } from "../../../src/pages/patients/ui/sheets/patient-vitals-sheet";

localStorage.setItem("gmed_lang", "ru");

function Fixture() {
  const [vitalsOpen, setVitalsOpen] = useState(false);
  return <main className="space-y-4 p-4">
    <h1>Clinical editor QA</h1>
    <button type="button" onClick={() => setVitalsOpen(true)}>Open vitals</button>
    <PatientSymptomsPainSections patientId="patient-modal-qa" canManage />
    <PatientVitalsSheet patientId="patient-modal-qa" open={vitalsOpen} onOpenChange={setVitalsOpen} onSaved={() => setVitalsOpen(false)} />
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AdapterDayjs}><Fixture /></LocalizationProvider>,
);
