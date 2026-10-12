import { describe, expect, it } from "vitest";

import { readableServiceLineNotes } from "./service-line-notes";

describe("readableServiceLineNotes", () => {
  it("drops raw IDs and catalog keys from automatically created notes", () => {
    expect(
      readableServiceLineNotes(
        [
          "Automatisch aus abgeschlossenem medizinischem Termin 5f1c2d3e-0a1b-4c2d-8e3f-123456789abc erstellt",
          "Termin: Konsultation Kardiologie",
          "Datum: 2026-09-26",
          "Katalogschlüssel: treatment_organization",
          "Anbieter: Klinik Nord",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Automatisch aus abgeschlossenem medizinischem Termin erstellt",
        "Termin: Konsultation Kardiologie",
        "Datum: 26.09.2026",
        "Anbieter: Klinik Nord",
      ].join("\n"),
    );
  });

  it("removes lines that only held a reference", () => {
    expect(
      readableServiceLineNotes(
        "Automatisch aus freigegebenem Dolmetscherbericht 5f1c2d3e-0a1b-4c2d-8e3f-123456789abc erstellt\nTermin: 5f1c2d3e-0a1b-4c2d-8e3f-123456789abd\nStunden: 2.5",
      ),
    ).toBe("Automatisch aus freigegebenem Dolmetscherbericht erstellt\nStunden: 2.5");
  });

  it("shows the German system notes in Russian with a decimal comma (QA C3-10)", () => {
    const notes = [
      "Geplante Leistung (3 Std.) durch den freigegebenen Dolmetscherbericht mit den tatsächlichen Stunden ersetzt",
      "Dolmetscher: Ben Muster",
      "Stunden: 1.5",
      "Termin: Kardiologie am 12.10.2026",
      "Bericht: 6b37536f-f492-40a8-ba01-7405d8629e92",
    ].join("\n");
    expect(readableServiceLineNotes(notes, "ru")).toBe(
      [
        "Запланированная услуга (3 ч) заменена фактическими часами из утверждённого отчёта переводчика",
        "Переводчик: Ben Muster",
        "Часы: 1,5",
        "Приём: Kardiologie, 12.10.2026",
      ].join("\n"),
    );
    expect(readableServiceLineNotes(notes, "de")).toBe(
      [
        "Geplante Leistung (3 Std.) durch den freigegebenen Dolmetscherbericht mit den tatsächlichen Stunden ersetzt",
        "Dolmetscher: Ben Muster",
        "Stunden: 1,5",
        "Termin: Kardiologie am 12.10.2026",
      ].join("\n"),
    );
    expect(
      readableServiceLineNotes(
        "Automatisch aus dem abgeschlossenen medizinischen Termin erstellt\nDatum: 12.10.2026\nAnbieter: Herzklinik Beispiel",
        "ru",
      ),
    ).toBe("Автоматически начислено по завершённому медицинскому приёму\nДата: 12.10.2026\nПровайдер: Herzklinik Beispiel");
    expect(
      readableServiceLineNotes("Automatisch aus abgeschlossenem medizinischem Termin erstellt", "ru"),
    ).toBe("Автоматически начислено по завершённому медицинскому приёму");
    expect(readableServiceLineNotes("Generated from multi-doctor service group", "de")).toBe(
      "Aus der Leistungsgruppe mit mehreren Ärzten erstellt",
    );
    // Staff-written notes stay as typed in every language.
    expect(readableServiceLineNotes("Patient wünscht Einzelzimmer", "ru")).toBe("Patient wünscht Einzelzimmer");
  });

  it("keeps staff notes and treats empty notes as none", () => {
    expect(readableServiceLineNotes("Patient wünscht Einzelzimmer")).toBe("Patient wünscht Einzelzimmer");
    expect(readableServiceLineNotes("")).toBeNull();
    expect(readableServiceLineNotes("Katalogschlüssel: x")).toBeNull();
  });
});
