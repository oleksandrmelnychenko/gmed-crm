import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";

import { PatientRelationsTab } from "./patient-relations-tab";

const noop = () => undefined;

function renderEmpty(canManageRelations: boolean) {
  return renderToStaticMarkup(
    <Tabs value="relations">
      <PatientRelationsTab
        canManageRelations={canManageRelations}
        formatDateTime={(value) => value ?? ""}
        l={(key) => key}
        onCreateRelation={noop}
        onDeleteRelation={noop}
        onEditRelation={noop}
        onOpenPatient={noop}
        relationTypeLabel={(value) => value}
        relations={[]}
        tabLoading={false}
      />
    </Tabs>,
  );
}

const relation = (overrides: Partial<Parameters<typeof PatientRelationsTab>[0]["relations"][number]> = {}) => ({
  id: "relation-1",
  related_patient_id: null,
  related_name: "Anna Muster",
  relation_type: "mother",
  is_emergency_contact: false,
  created_at: "2026-10-01T08:00:00Z",
  ...overrides,
});

function renderRows(relations: ReturnType<typeof relation>[], onNewRequestForPerson?: () => void) {
  return renderToStaticMarkup(
    <Tabs value="relations">
      <PatientRelationsTab
        canManageRelations
        formatDateTime={(value) => value ?? ""}
        l={(key) => key}
        onCreateRelation={noop}
        onDeleteRelation={noop}
        onEditRelation={noop}
        onNewRequestForPerson={onNewRequestForPerson}
        onOpenPatient={noop}
        relationTypeLabel={(value) => value}
        relations={relations}
        tabLoading={false}
      />
    </Tabs>,
  );
}

describe("new request for a relation", () => {
  it("offers the new request for a relation without an own record, and the patient for a linked one", () => {
    const html = renderRows([relation(), relation({ id: "relation-2", related_name: "Ben Muster", related_patient_id: "patient-2" })], noop);
    expect(html).toContain("Новая заявка для этого человека: Anna Muster");
    expect(html).not.toContain("Новая заявка для этого человека: Ben Muster");
    expect(html).toContain("patients_open_patient");
  });

  it("stays silent without the right to create leads", () => {
    const html = renderRows([relation()]);
    expect(html).not.toContain("Новая заявка для этого человека");
  });
});

describe("PatientRelationsTab", () => {
  it("offers the first relation from the empty state", () => {
    const html = renderEmpty(true);
    expect(html).toContain("patients_not_recorded_yet");
    expect(html).toMatch(/<button[^>]*>.*patients_new_relation<\/button>/);
  });

  it("keeps the empty state read-only without the manage permission", () => {
    const html = renderEmpty(false);
    expect(html).toContain("patients_not_recorded_yet");
    expect(html).not.toContain("patients_new_relation");
  });
});
