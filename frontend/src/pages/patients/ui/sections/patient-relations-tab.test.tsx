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
