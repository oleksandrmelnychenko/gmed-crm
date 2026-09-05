import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { ClinicalDocumentImportSheet } from "../../../src/pages/patients/ui/sections/clinical-document-import-sheet";
import "../../../src/index.css";
import type { PatientIdentityReference } from "../../../src/pages/patients/data/clinical-document-subject";

declare global { interface Window { __clinicalTestIdentity?: PatientIdentityReference; __clinicalTestRoot?: Root } }

function Harness() {
  const [open, setOpen] = useState(true);
  return <ClinicalDocumentImportSheet open={open} onOpenChange={setOpen}
    patientId="00000000-0000-0000-0000-000000000101" lang="de"
    patientIdentity={window.__clinicalTestIdentity ?? { firstName: "Anna", lastName: "Beispiel", birthDate: "1980-01-01" }}
    existingItems={{ diagnosis: [], anamnesis: [], examination: [], medication: [], recommendation: [], vital: [], lab_result: [] }}
    onApply={async (_record, candidates, _country, payloads) => {
      document.dispatchEvent(new CustomEvent("clinical-test-apply", { detail: { candidates, payloads } }));
      return { records: candidates.length };
    }} />;
}

window.__clinicalTestRoot ??= createRoot(document.getElementById("root")!);
window.__clinicalTestRoot.render(<LocalizationProvider dateAdapter={AdapterDayjs}><Harness /></LocalizationProvider>);
