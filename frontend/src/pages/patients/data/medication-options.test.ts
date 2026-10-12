import { describe, expect, it } from "vitest";

import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
  darreichungsformLabel,
  darreichungsformOptions,
  einnahmeformLabel,
  einnahmeformOptions,
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

  it("keeps the full Darreichungsform reference list with code values and name labels", () => {
    expect(DARREICHUNGSFORM_OPTIONS).toHaveLength(74);
    expect(DARREICHUNGSFORM_OPTIONS.slice(0, 15).map((option) => option.value)).toEqual([
      "AMP",
      "ANSLB",
      "AUGG",
      "AUGS",
      "AUGT",
      "BTL",
      "CREM",
      "FTBL",
      "FTBM",
      "GEL",
      "GELE",
      "IFIJ",
      "IFLG",
      "IJLG",
      "IJSU",
    ]);
    expect(DARREICHUNGSFORM_OPTIONS.slice(0, 15).map((option) => option.label)).toEqual([
      "Ampullen",
      "Augen- und Nasensalbe",
      "Augengel",
      "Augensalbe",
      "Augentropfen",
      "Beutel",
      "Creme",
      "Filmtabletten",
      "magensaftresistente Filmtabletten",
      "Gel",
      "Gel zum Einnehmen",
      "Injektions-/Infusionslösung, Konzentrat und Lösungsmittel zur Herstellung einer Injektions-/Infusionslösung, Konzentrat zur Herstellung einer Injektions-/Infusionslösung",
      "Infusionslösung, Konzentrat zur Herstellung einer Infusionslösung / Infusionsdispersion",
      "Injektionslösung",
      "Injektionssuspension",
    ]);
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "EDAT")).toBe(
      "Augentropfen (Lösung im Einzeldosisbehältnis)",
    );
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "KAPR")).toBe(
      "Retardkapseln, retardierte Hart-/Weichkapseln, Hartkapseln mit veränderter Wirkstofffreisetzung",
    );
    expect(optionLabel(DARREICHUNGSFORM_OPTIONS, "PULV")).toBe(
      "Pulver / Pulver für ein Konzentrat / Pulver und Lösungsmittel zur Herstellung einer Injektionslösung / Pulver und Lösungsmittel zur Herstellung einer Injektions- / Infusionslösung",
    );
    expect(darreichungsformLabel("AMP")).toBe("Ampullen");
    expect(darreichungsformLabel("Filmtabl.")).toBe("Filmtabl.");
  });

  it("names forms and routes in Russian in the Russian UI, keeping the stored values (QA B3-03)", () => {
    const forms = darreichungsformOptions("ru");
    expect(forms.map((option) => option.value)).toEqual(DARREICHUNGSFORM_OPTIONS.map((option) => option.value));
    // Every code has its Russian name: no German name is left in the Russian picker.
    for (const option of forms) {
      expect(option.label, option.value).toMatch(/[А-Яа-яЁё]/);
    }
    expect(optionLabel(forms, "TABL")).toBe("Таблетки");
    expect(darreichungsformOptions("de")).toBe(DARREICHUNGSFORM_OPTIONS);

    const routes = einnahmeformOptions("ru");
    expect(routes.map((option) => option.value)).toEqual(EINNAHMEFORM_OPTIONS.map((option) => option.value));
    for (const option of routes) {
      expect(option.label, option.value).toMatch(/[А-Яа-яЁё]/);
    }
    expect(optionLabel(routes, "Oral")).toBe("Перорально (p.o.)");
    expect(optionLabel(routes, "Aural")).toBe("В ухо");

    expect(darreichungsformLabel("TABL", "ru")).toBe("Таблетки");
    expect(darreichungsformLabel("TABL", "de")).toBe("Tabletten");
    expect(einnahmeformLabel("Oral", "ru")).toBe("Перорально");
    expect(einnahmeformLabel("oral", "de")).toBe("Oral");
    expect(einnahmeformLabel("per Sonde", "ru")).toBeNull();
  });
});
