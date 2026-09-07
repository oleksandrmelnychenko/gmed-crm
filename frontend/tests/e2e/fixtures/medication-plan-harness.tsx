import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { PatientClinicalTab } from "../../../src/pages/patients/ui/sections/patient-clinical-tab";
import { PatientOverviewCard } from "../../../src/pages/patients/ui/sections/patient-overview-card";
import { Toaster } from "../../../src/components/ui/toast";
import "../../../src/index.css";

const clinical = new URLSearchParams(location.search).get("view") === "clinical";
createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AdapterDayjs}>
    <main className="p-4">
      {clinical ? <PatientClinicalTab patientId="patient-medication-test" patientIdentity={{firstName:"Anna", lastName:"Beispiel"}}
        canManage={false} embedded documentImportOpen={false} onDocumentImportOpenChange={() => undefined} />
        : <PatientOverviewCard patientId="patient-medication-test" allergies={null} canViewClinical />}
    </main>
    <Toaster />
  </LocalizationProvider>,
);
