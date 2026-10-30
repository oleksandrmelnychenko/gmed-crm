import { describe, expect, it } from "vitest";

import { withoutOutdatedRows } from "./lead-wizard";

describe("the rows «Завершить приём» saves", () => {
  const allergy = (id: string | null, label: string) => ({ id, label });

  it("keep the record's version of a row changed or removed since the wizard read it", () => {
    const readByWizard = [allergy("a", "Penicillin"), allergy("b", "Latex"), allergy("c", "Nuts")];
    // Someone renamed "b" and deleted "c" on the patient card meanwhile.
    const latest = [allergy("a", "Penicillin"), allergy("b", "Latex (Handschuhe)")];
    // The wizard edited "a", kept stale copies of "b" and "c", and added a new row.
    const local = [allergy("a", "Penicillin, schwer"), allergy("b", "Latex"), allergy("c", "Nuts"), allergy(null, "Pollen")];
    expect(withoutOutdatedRows(local, readByWizard, latest)).toEqual([
      allergy("a", "Penicillin, schwer"),
      allergy(null, "Pollen"),
    ]);
  });

  it("keep a row the wizard read nowhere", () => {
    expect(withoutOutdatedRows([allergy("x", "Neu")], [], [])).toEqual([allergy("x", "Neu")]);
  });
});
