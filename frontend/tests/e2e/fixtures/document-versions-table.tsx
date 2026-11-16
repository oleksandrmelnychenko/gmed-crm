import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";

import "../../../src/index.css";
import "../../../src/components/app-shell/staff-portal-theme.css";
import { DocumentsGrid } from "../../../src/components/documents-grid";
import { AppAdapterDayjs } from "../../../src/lib/app-date-adapter";
import { isPatientConsentFormRow } from "../../../src/pages/documents/model/document-versions";
import {
  PatientConsentChangeHost,
  PatientConsentChangeRowButton,
} from "../../../src/pages/patients/ui/sections/patient-consent-choices";

// The document table of fix-98: an Einverständniserklärung whose new version
// waits for the signature, its earlier versions, and «Изменить согласия».
const base = {
  original_filename: null, patient_name: "Erika Muster", patient_pid: "P-20261114-0002", art: "privacy_consents",
  category: "consent", visibility: "internal", data_sensitivity: "standard", file_size: 1000, uploaded_by_name: "PM",
  needs_categorization: false, patient_id: "patient-qa", lead_id: null, generated_template_id: "privacy_consents",
};
const documents = [
  {
    ...base, id: "ew-3", auto_name: "Einverständniserklärung zur Datenübermittlung", version_number: 3,
    is_latest_version: true, status: "active", signature_state: "not_sent", signed_at: null, updated_at: "2026-11-16T10:00:00Z",
    previous_versions: [
      { ...base, id: "ew-2", auto_name: "Einverständniserklärung zur Datenübermittlung", version_number: 2, is_latest_version: false,
        status: "archived", signature_state: "signed", signed_at: "2026-11-14T09:00:00Z", updated_at: "2026-11-14T09:00:00Z" },
      { ...base, id: "ew-1", auto_name: "Einverständniserklärung zur Datenübermittlung", version_number: 1, is_latest_version: false,
        status: "archived", signature_state: null, signed_at: null, updated_at: "2026-11-14T08:00:00Z" },
    ],
  },
  {
    ...base, id: "scan-1", auto_name: "Reisepass", art: "passport", category: "identity", generated_template_id: null,
    version_number: 1, is_latest_version: true, status: "active", signature_state: null, signed_at: null, updated_at: "2026-11-13T10:00:00Z",
  },
];

function Fixture() {
  const [patientId, setPatientId] = useState<string | null>(null);
  return (
    <>
      <DocumentsGrid
        documents={documents}
        paginated
        showSelection={false}
        rowActions={(item) =>
          isPatientConsentFormRow(item, item.patient_id) ? (
            <PatientConsentChangeRowButton title={item.auto_name} onOpen={() => setPatientId(item.patient_id ?? null)} />
          ) : null
        }
        rowActionsWidth={40}
        selectedDocumentIds={[]}
        selectedId={null}
        labels={{
          selectBulkShare: "", filename: "Документ", patient: "Пациент", category: "Тип", status: "Статус",
          visibility: "Видимость", uploadedBy: "Загрузил", unclassified: "—", current: "текущая", pidFallback: "",
          notSet: "—", unknownUploader: "—", needsCategorization: "",
        }}
        localizeCode={(value) => value}
        onSelectionChange={() => undefined}
        onToggleSelection={() => undefined}
        onOpenDocument={() => undefined}
        statusBadge={() => ""}
        visibilityBadge={() => ""}
        sensitivityBadge={() => ""}
        formatStatusLabel={(value) => value}
        formatVisibilityLabel={(value) => value}
        formatSensitivityLabel={(value) => value}
        formatDateTime={(value) => value ?? ""}
      />
      <PatientConsentChangeHost patientId={patientId} onClose={() => setPatientId(null)} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AppAdapterDayjs} adapterLocale="ru">
    <MemoryRouter>
      <main className="staff-portal-theme min-h-dvh bg-background p-4 text-foreground">
        <Fixture />
      </main>
    </MemoryRouter>
  </LocalizationProvider>,
);
