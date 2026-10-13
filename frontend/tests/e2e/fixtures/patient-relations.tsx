import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import "../../../src/index.css";
import { Tabs } from "../../../src/components/ui/tabs";
import { textareaClass } from "../../../src/components/ui-shell";
import { useLang } from "../../../src/lib/i18n";
import type { RelationItem } from "../../../src/pages/patients/model/detail-tab-types";
import { PatientRelationsTab } from "../../../src/pages/patients/ui/sections/patient-relations-tab";
import { MemoizedPatientRelationEditorSheet } from "../../../src/pages/patients/ui/sheets/patient-relation-editor-sheet";

const relation: RelationItem = {
  id: "relation-qa",
  related_patient_id: "linked-patient-qa",
  related_patient_pid: "P-TEST-002",
  related_name: "Alex Example",
  relation_type: "spouse",
  is_emergency_contact: true,
  phone: "+49000000001",
  email: "alex@example.org",
  address_street: "Teststrasse 1",
  address_city: "Berlin",
  address_zip: "10115",
  address_country: "DE",
  notes: "Synthetic relationship fixture",
  created_at: "2026-10-01T09:00:00Z",
};

function PatientRelationsFixture() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RelationItem | null>(null);
  const [lastAction, setLastAction] = useState("");
  const canManage = !new URLSearchParams(window.location.search).has("readonly");

  return (
    <main className="p-4">
      <Tabs value="relations">
        <PatientRelationsTab
          canManageRelations={canManage}
          formatDateTime={(value) => value ?? ""}
          l={(key) => t.uiText[key] ?? key}
          onCreateRelation={() => { setEditing(null); setOpen(true); }}
          onDeleteRelation={() => setLastAction("delete")}
          onEditRelation={(item) => { setEditing(item); setOpen(true); }}
          onOpenPatient={() => setLastAction("open-patient")}
          relationTypeLabel={() => "Супруг(а)"}
          relations={[relation]}
          tabLoading={false}
        />
      </Tabs>
      <p data-testid="relation-action">{lastAction}</p>
      <MemoizedPatientRelationEditorSheet
        open={open}
        patientId="patient-qa"
        selfPatientId="patient-qa"
        canManageRelations={canManage}
        editingRelation={editing}
        dictionary={t as unknown as Record<string, string>}
        textareaClassName={textareaClass}
        onOpenChange={setOpen}
        onSaved={() => setLastAction("saved")}
        onError={() => {}}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><PatientRelationsFixture /></MemoryRouter>,
);
