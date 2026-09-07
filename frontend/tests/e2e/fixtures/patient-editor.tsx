import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { useLang } from "../../../src/lib/i18n";
import { MemoizedPatientDetailSheet } from "../../../src/pages/patients/ui/sheets/patient-list-detail-sheet";
import type { PatientDetail, PatientsDictionary } from "../../../src/pages/patients/model/list-model";

const patient: PatientDetail = {
  id: "patient-editor-qa", patient_id: "P-TEST-1", first_name: "Alex", last_name: "Beispiel",
  birth_date: "1999-11-11", gender: "male", is_active: true, created_at: "2026-09-07T10:00:00Z",
  nationality: "DE", residence_country: "DE", languages: ["de", "ru"], functional_labels: ["vip"],
  insurance_type: "self_pay", phone_primary: "+49000000001", email: "alex@example.org",
  contacts: [
    { id: "phone-1", contact_kind: "phone", contact_type: "private", value: "+49000000001", is_primary: true, notes: null },
    { id: "phone-2", contact_kind: "phone", contact_type: "work", value: "+49000000002", is_primary: false, notes: null },
    { id: "email-1", contact_kind: "email", contact_type: "private", value: "alex@example.org", is_primary: true, notes: null },
  ],
};
const noop = () => {};

function PatientEditorFixture() {
  const { t } = useLang();
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen(true)}>Open editor</button>
    <MemoizedPatientDetailSheet
      open={open} detail={patient} detailBusy={false} detailError=""
      dictionary={t as unknown as PatientsDictionary}
      detailControls={{ canCreateEdit: true, canViewAssignments: false, canManageAssignments: false, hideWorkspaceActions: true }}
      assignments={[]} assignableStaff={[]} selectedAssignee="" assignmentBusy={false} assignmentError=""
      onAssigneeChange={noop} onAssign={noop} onOpenChange={setOpen} onRefresh={noop}
      onOpenOrders={noop} onOpenAppointments={noop} onOpenContracts={noop} onOpenDocuments={noop}
    />
  </>;
}

// Vite can re-evaluate this standalone entry while optimizing its imports.
const fixtureWindow = window as Window & { patientEditorRoot?: Root };
fixtureWindow.patientEditorRoot ??= createRoot(document.getElementById("root")!);
fixtureWindow.patientEditorRoot.render(<MemoryRouter><PatientEditorFixture /></MemoryRouter>);
