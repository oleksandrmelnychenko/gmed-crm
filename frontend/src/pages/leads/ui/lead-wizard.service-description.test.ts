import { describe, expect, it } from "vitest";

import { resolveServiceDescriptionTemplate } from "./lead-wizard";

describe("lead wizard service document descriptions", () => {
  it("keeps catalog paragraphs for the Leistungsumfang list", () => {
    expect(resolveServiceDescriptionTemplate(
      "Erster Leistungsumfang.\n\nZweiter Leistungsumfang für [Fachrichtung 1] im Zeitraum [Datum Beginn] bis [Datum Ende].",
      {
        dateFrom: "2026-09-10",
        dateTo: "2026-09-17",
        specialties: ["Dermatologie", "Orthopädie"],
      },
    )).toBe(
      "Erster Leistungsumfang.\n\nZweiter Leistungsumfang für Dermatologie und Orthopädie im Zeitraum 10.09.2026 bis 17.09.2026.",
    );
  });

  it("keeps numbered catalog items on separate lines", () => {
    expect(resolveServiceDescriptionTemplate(
      "1) Dining support\n2) Transport coordination\n\nNOT INCLUDED\n- Security services",
      { dateFrom: "", dateTo: "", specialties: [] },
    )).toBe(
      "1) Dining support\n2) Transport coordination\n\nNOT INCLUDED\n- Security services",
    );
  });
});
