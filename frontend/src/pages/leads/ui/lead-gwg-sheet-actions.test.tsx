import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";

import { gwgRepresentativeSubject, gwgSheetPlan, type GwgSheetPlan } from "../model/gwg-identification";
import { LeadGwgSheetActions, gwgSheetBusyKey } from "./lead-gwg-sheet-actions";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";
const ANNA = gwgRepresentativeSubject(ANNA_ID);
const BEN = gwgRepresentativeSubject(BEN_ID);

const parents = [
  { id: ANNA_ID, name: "Anna Muster" },
  { id: BEN_ID, name: "Ben Muster" },
];
const privatePayer = { payer_kind: "third_party", payer_type: "person" };

function sheet(subject: string, id: string): DocumentItem {
  const document: Partial<DocumentItem> = {
    id,
    generated_template_id: "gwg_identification",
    generated_bindings: { gwg_identification: { subject } },
    file_deleted_at: null,
    is_latest_version: true,
    created_at: "2026-10-05T10:00:00Z",
  };
  return document as DocumentItem;
}

function render(
  plan: GwgSheetPlan,
  options: { documents?: DocumentItem[]; busy?: string | null; disabled?: boolean; lang?: "ru" | "de" } = {},
) {
  return renderToStaticMarkup(
    <LeadGwgSheetActions
      plan={plan}
      documents={options.documents ?? []}
      busy={options.busy ?? null}
      disabled={options.disabled ?? false}
      tx={options.lang === "de" ? de : ru}
      onGenerate={() => undefined}
    />,
  );
}

/** The markup of one button, found by the person it is for. */
function button(html: string, subject: string): string {
  const start = html.indexOf(`data-testid="gwg-identification-generate-${subject}"`);
  if (start < 0) return "";
  return html.slice(html.lastIndexOf("<button", start), html.indexOf("</button>", start));
}

const buttonCount = (html: string) => html.match(/<button\b/g)?.length ?? 0;

describe("LeadGwgSheetActions", () => {
  it("offers an adult the own sheet, as before", () => {
    const html = render(gwgSheetPlan({ minor: false, representatives: [], payer: null }));
    expect(html).toContain('data-testid="gwg-identification-actions"');
    expect(button(html, "contract_partner")).toContain("Сформировать для пациента");
    expect(buttonCount(html)).toBe(1);
    expect(html).not.toContain("gwg-identification-payer-organisation");
    expect(html).not.toContain("gwg-identification-payer-same-person");
    expect(html).not.toContain("gwg-identification-no-representative");
  });

  it("adds the sheet of a private third-party payer and says update once a sheet exists", () => {
    const plan = gwgSheetPlan({ minor: false, representatives: [], payer: privatePayer });
    const fresh = render(plan);
    expect(button(fresh, "payer")).toContain("Для плательщика");
    expect(buttonCount(fresh)).toBe(2);
    const existing = render(plan, { documents: [sheet("contract_partner", "doc-1"), sheet("payer", "doc-2")] });
    expect(button(existing, "contract_partner")).toContain("Обновить для пациента");
    expect(button(existing, "payer")).toContain("Обновить для плательщика");
    const german = render(plan, { lang: "de", documents: [sheet("payer", "doc-2")] });
    expect(button(german, "contract_partner")).toContain("Für Patient/in erstellen");
    expect(button(german, "payer")).toContain("Für Kostenübernehmer aktualisieren");
  });

  it("explains why an organisation gets no sheet for natural persons", () => {
    const html = render(
      gwgSheetPlan({ minor: false, representatives: [], payer: { payer_kind: "third_party", payer_type: "company" } }),
    );
    expect(buttonCount(html)).toBe(1);
    expect(html).toContain("Для организации лист для физических лиц не формируется");
  });

  it("offers a minor one sheet per legal representative, named after the person, and none for the child", () => {
    const plan = gwgSheetPlan({ minor: true, representatives: parents, payer: { payer_kind: "self" } });
    const html = render(plan, { documents: [sheet(BEN, "doc-ben"), sheet("contract_partner", "doc-child")] });
    expect(button(html, "contract_partner")).toBe("");
    expect(button(html, ANNA)).toContain("Сформировать для Anna Muster");
    // The father has a sheet already; the child's older one does not count for anybody.
    expect(button(html, BEN)).toContain("Обновить для Ben Muster");
    expect(buttonCount(html)).toBe(2);
    const german = render(plan, { lang: "de", documents: [sheet(BEN, "doc-ben")] });
    expect(button(german, ANNA)).toContain("Für Anna Muster erstellen");
    expect(button(german, BEN)).toContain("Für Ben Muster aktualisieren");
  });

  it("makes no second sheet for a parent who also pays, and says so", () => {
    const plan = gwgSheetPlan({
      minor: true,
      representatives: parents,
      payer: privatePayer,
      payerSamePersonName: "Anna Muster",
    });
    const html = render(plan);
    expect(button(html, "payer")).toBe("");
    expect(buttonCount(html)).toBe(2);
    expect(html).toContain("отдельный лист не нужен: плательщик — представитель Anna Muster");
    expect(render(plan, { lang: "de" })).toContain("kein eigener Bogen nötig: Kostenträger ist Vertreter/in Anna Muster");
    // Somebody else pays: the payer keeps the own button.
    const other = render(gwgSheetPlan({ minor: true, representatives: parents, payer: privatePayer }));
    expect(button(other, "payer")).toContain("Для плательщика");
    expect(other).not.toContain("gwg-identification-payer-same-person");
  });

  it("asks for a parent or guardian instead of offering a sheet for a minor without one", () => {
    const html = render(gwgSheetPlan({ minor: true, representatives: [], payer: null }));
    expect(buttonCount(html)).toBe(0);
    expect(html).toContain("Добавьте родителя или законного представителя");
  });

  it("shows which sheet is being made and locks the buttons meanwhile", () => {
    const plan = gwgSheetPlan({ minor: true, representatives: parents, payer: null });
    expect(gwgSheetBusyKey(ANNA)).toBe(`generate-gwg_identification-representative:${ANNA_ID}`);
    const html = render(plan, { busy: gwgSheetBusyKey(ANNA), disabled: true });
    expect(button(html, ANNA)).toContain("animate-spin");
    expect(button(html, BEN)).not.toContain("animate-spin");
    expect(html.match(/<button[^>]*\bdisabled\b/g)?.length).toBe(2);
  });
});
