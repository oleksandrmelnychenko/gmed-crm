import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { PatientClinicalTab } from "../../../src/pages/patients/ui/sections/patient-clinical-tab";
import { PatientOverviewCard } from "../../../src/pages/patients/ui/sections/patient-overview-card";
import { MedicationPlanPdfAction } from "../../../src/pages/patients/ui/sections/medication-plan-pdf-action";
import { LabResultsPdfAction } from "../../../src/pages/patients/ui/sections/lab-results-pdf-action";
import { getLang } from "../../../src/lib/i18n";
import { Toaster } from "../../../src/components/ui/toast";
import "../../../src/index.css";

const clinical = new URLSearchParams(location.search).get("view") === "clinical";
const laboratoryHeader = new URLSearchParams(location.search).get("view") === "lab-header";
const editable = new URLSearchParams(location.search).get("edit") === "true";
createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AdapterDayjs}>
    <main className="p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        {laboratoryHeader
          ? <LabResultsPdfAction patientId="patient-medication-test" className="h-9 px-3.5" />
          : <MedicationPlanPdfAction patientId="patient-medication-test" lang={getLang()} className="h-9 px-3.5" />}
      </header>
      {laboratoryHeader ? null : clinical ? <PatientClinicalTab patientId="patient-medication-test" patientIdentity={{firstName:"Anna", lastName:"Beispiel"}}
        canManage={editable} embedded documentImportOpen={false} onDocumentImportOpenChange={() => undefined} />
        : <PatientOverviewCard patientId="patient-medication-test" allergies={null} canViewClinical />}
    </main>
    <Toaster />
  </LocalizationProvider>,
);
