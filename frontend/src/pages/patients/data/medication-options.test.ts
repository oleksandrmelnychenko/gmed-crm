import { describe, expect, it } from "vitest";

import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
} from "./medication-options";

function optionLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label;
}

describe("medication option reference lists", () => {
  it("keeps the full Applikationsform reference list", () => {
    expect(EINNAHMEFORM_OPTIONS).toHaveLength(35);
    expect(optionLabel(EINNAHMEFORM_OPTIONS, "Intravenös")).toBe(
      "Intravenös (i.v.)",
    );
    expect(optionLabel(EINNAHMEFORM_OPTIONS, "Oral")).toBe(
      "Oral / Per os (p.o.)",
    );
    expect(optionLabel(EINNAHMEFORM_OPTIONS, "Subkutan")).toBe(
      "Subkutan (s.c.)",
    );
  });

  it("keeps the full Darreichungsform reference list with official codes", () => {
    expect(DARREICHUNGSFORM_OPTIONS).toHaveLength(74);
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "EDAT")).toBe(
      "EDAT — Augentropfen (Lösung im Einzeldosisbehältnis)",
    );
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "KAPR")).toBe(
      "KAPR — Retardkapseln, retardierte Hart-/Weichkapseln, Hartkapseln mit veränderter Wirkstofffreisetzung",
    );
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "PULV")).toBe(
      "PULV — Pulver / Pulver für ein Konzentrat / Pulver und Lösungsmittel zur Herstellung einer Injektionslösung / Pulver und Lösungsmittel zur Herstellung einer Injektions- / Infusionslösung",
    );
  });
});
