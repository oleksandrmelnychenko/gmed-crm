import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";

import { PatientRelationsTab, localizeRelationNotes } from "./patient-relations-tab";

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

function renderRows(
  relations: ReturnType<typeof relation>[],
  onNewRequestForPerson?: () => void,
  onLinkRelation?: () => void,
) {
  return renderToStaticMarkup(
    <Tabs value="relations">
      <PatientRelationsTab
        canManageRelations
        formatDateTime={(value) => value ?? ""}
        l={(key) => key}
        onCreateRelation={noop}
        onDeleteRelation={noop}
        onEditRelation={noop}
        onLinkRelation={onLinkRelation}
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

describe("link suggestion (owner decision 2026-10-28)", () => {
  const suggested = relation({ link_suggestion: { patient_id: "patient-9", patient_pid: "P-20261028-0033", name: "Anna Muster" } });

  it("offers staff the patient with the same name and date of birth", () => {
    const html = renderRows([suggested], undefined, noop);
    expect(html).toContain("relation-link-suggestion");
    expect(html).toContain("P-20261028-0033 · Привязать");
  });

  it("offers nothing without the right to manage relations", () => {
    expect(renderRows([suggested])).not.toContain("relation-link-suggestion");
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

describe("localizeRelationNotes", () => {
  it("translates the conversion labels and prints dates as DD.MM.YYYY (QA 2026-10-25, M F-1)", () => {
    const notes = ["Email: m@example.test", "Geburtsdatum: 1985-05-02", "Adresse: Hauptstr. 1"].join(String.fromCharCode(10));
    expect(localizeRelationNotes(notes, "ru")).toBe(
      ["Электронная почта: m@example.test", "Дата рождения: 02.05.1985", "Адрес: Hauptstr. 1"].join(String.fromCharCode(10)),
    );
    expect(localizeRelationNotes(notes, "de")).toContain("Geburtsdatum: 02.05.1985");
    expect(localizeRelationNotes(null, "ru")).toBe("");
  });
});
