import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { PatientMedicationSection } from "../../../src/pages/patients/ui/sections/patient-clinical-entry-sections";
import { type ClinicalMedication, savePatientMedications } from "../../../src/pages/patients/data/patient-clinical";
import { Toaster } from "../../../src/components/ui/toast";
import "../../../src/index.css";

function Harness() {
  const lang = localStorage.getItem("gmed_lang") === "ru" ? "ru" : "de";
  const [items, setItems] = useState<ClinicalMedication[]>([]);
  return <LocalizationProvider dateAdapter={AdapterDayjs}>
    <main className="p-4"><PatientMedicationSection items={items} providers={[]} canManage lang={lang}
      onSave={async (next) => { await savePatientMedications("name-test", next); setItems(next); }} /></main>
    <Toaster />
  </LocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
