import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import "dayjs/locale/de";
import "dayjs/locale/ru";
import "../../../src/index.css";
import { apiFetch } from "../../../src/lib/api";
import { formatAppDate } from "../../../src/lib/app-time-zone";
import { AuthProvider } from "../../../src/lib/auth";
import { useLang } from "../../../src/lib/i18n";
import {
  getPatientLegalStatusChecklist,
  getPatientLegalStatusCompletion,
  normalizePatientLegalStatus,
} from "../../../src/pages/patients/model/legal-status";
import type { PatientDetail } from "../../../src/pages/patients/model/list-model";
import { PatientProfileTab } from "../../../src/pages/patients/ui/sections/patient-profile-section";

// The profile tab of the patient card as the workspace mounts it, for a CEO
// who may edit the card and manage its documents. The patient comes from the
// mocked `GET /patients/{id}`; "reload" fetches it again like the page does.
const patientId = "00000000-0000-4000-8000-000000000101";

function PatientLegalStatusFixture() {
  const { t, lang } = useLang();
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [legalSheetOpen, setLegalSheetOpen] = useState(false);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => {
    void apiFetch<PatientDetail>(`/patients/${patientId}`, { cache: "no-store", forceFresh: true })
      .then((next) => {
        setDetail(next);
        setReloads((value) => value + 1);
      });
  }, []);
  useEffect(reload, [reload]);
  const legalStatus = useMemo(() => normalizePatientLegalStatus(detail?.legal_status), [detail?.legal_status]);
  const checklist = useMemo(() => getPatientLegalStatusChecklist(legalStatus, lang), [legalStatus, lang]);
  const completion = useMemo(() => getPatientLegalStatusCompletion(legalStatus), [legalStatus]);
  if (!detail) return <p>…</p>;
  const tr = t as unknown as Record<string, string>;
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang}>
    <div className="mx-auto max-w-5xl p-4" data-testid="patient-legal-status-harness" data-reloads={reloads}>
      <PatientProfileTab
        profileControls={{
          canCreateTasks: false,
          canEditPatientProfile: true,
          canExportPatientCompliance: false,
          canOpenComplianceWorkspace: false,
          canViewContracts: false,
          canViewDocuments: false,
          canViewInvoices: false,
          canViewLeads: false,
          canManageDocuments: true,
        }}
        complianceExportBusy={false}
        detail={detail}
        fieldValue={(value, fallback) => (Array.isArray(value) ? value.join(", ") : value) || fallback}
        formatDate={(value, fallback) => formatAppDate(value) || fallback || ""}
        genderLabel={(value) => value ?? ""}
        handleExportPatientCompliance={() => {}}
        id={patientId}
        insuranceLabel={(value) => value ?? ""}
        l={(key) => t.uiText[key] ?? key}
        legalStatus={legalStatus}
        legalStatusChecklist={checklist}
        legalStatusCompletion={completion}
        legalStatusSheetOpen={legalSheetOpen}
        notesSheetOpen={false}
        onLegalStatusSheetOpenChange={setLegalSheetOpen}
        onNotesSheetOpenChange={() => {}}
        onOpenTab={() => {}}
        openProfileEditor={() => {}}
        patientDetailStatusLabel={(status) => status}
        reload={reload}
        staffGo={() => {}}
        t={t}
        tr={tr}
      />
    </div>
    </LocalizationProvider>
  );
}

// The app root never scrolls itself (index.css); the harness lets the page
// scroll so the legal status section is reachable on a phone.
for (const node of [document.documentElement, document.body, document.getElementById("root")!]) {
  node.style.height = "auto";
  node.style.overflow = "visible";
}

const fixtureWindow = window as Window & { patientLegalStatusRoot?: Root };
fixtureWindow.patientLegalStatusRoot ??= createRoot(document.getElementById("root")!);
fixtureWindow.patientLegalStatusRoot.render(
  <MemoryRouter><AuthProvider><PatientLegalStatusFixture /></AuthProvider></MemoryRouter>,
);
