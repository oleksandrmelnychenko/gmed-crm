import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClientVisibleNote, ServicesInternalNoteField, StaffOnlyLabel } from "./lead-wizard-visibility";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("what the client sees of the wizard's fields (owner 2026-11-02)", () => {
  it("marks a field the client sees in the cabinet, with an eye", () => {
    const markup = renderToStaticMarkup(<ClientVisibleNote tx={ru} />);
    expect(markup).toContain("Видно клиенту в кабинете");
    expect(markup).toContain('data-testid="client-visible-note"');
    expect(markup).toContain("lucide-eye");
    expect(renderToStaticMarkup(<ClientVisibleNote tx={de} />)).toContain("Für den Kunden im Portal sichtbar");
  });

  it("labels the staff-only comment with a lock", () => {
    const markup = renderToStaticMarkup(<StaffOnlyLabel tx={ru} />);
    expect(markup).toContain("Внутренний комментарий (клиент не видит)");
    expect(markup).toContain("lucide-lock");
    expect(renderToStaticMarkup(<StaffOnlyLabel tx={de} />)).toContain("Interner Kommentar (für den Kunden nicht sichtbar)");
  });

  it("names the internal comment's textarea by its locked label, without the client marker", () => {
    const markup = renderToStaticMarkup(
      <ServicesInternalNoteField id="internal-note" value="Rückruf am Dienstag" onChange={() => {}} tx={de} />,
    );
    expect(markup).toContain('<label for="internal-note"');
    expect(markup).toMatch(/<textarea id="internal-note"[^>]*maxLength="4000"/);
    expect(markup).toContain("Rückruf am Dienstag");
    expect(markup).toContain("Interner Kommentar (für den Kunden nicht sichtbar)");
    expect(markup).not.toContain("client-visible-note");
  });
});
