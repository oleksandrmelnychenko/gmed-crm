import { describe, expect, it } from "vitest";

import {
  appendSnippetToNarrative,
  renderCaseTextSnippet,
} from "./cases.snippets";

describe("cases snippets helpers", () => {
  it("renders supported placeholders from case context", () => {
    const rendered = renderCaseTextSnippet(
      "Patient {patient_name} ({patient_pid}) case {case_id} / {case_uuid} on {today}.",
      {
        patientName: "Max Mustermann",
        patientPid: "P-20260414-0001",
        caseId: "C-20260414-0001",
        caseUuid: "2c2d4faa-6f2e-4d7c-a948-b9e6df45a456",
        hauptanfragegrund: "Kolonoskopie Vorbereitung",
        zuweiser: "Dr. Sommer",
        today: "2026-04-14",
      },
    );

    expect(rendered).toContain("Max Mustermann");
    expect(rendered).toContain("P-20260414-0001");
    expect(rendered).toContain("C-20260414-0001");
    expect(rendered).toContain("2026-04-14");
    expect(rendered).not.toContain("{patient_name}");
  });

  it("appends rendered snippet with spacing", () => {
    expect(appendSnippetToNarrative("", "Neue strukturierte Notiz"))
      .toBe("Neue strukturierte Notiz");
    expect(appendSnippetToNarrative("Bestehender Verlauf", "Neue strukturierte Notiz"))
      .toBe("Bestehender Verlauf\n\nNeue strukturierte Notiz");
  });
});
