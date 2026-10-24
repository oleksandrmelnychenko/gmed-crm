import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CitizenshipMultiSelect } from "./citizenship-multi-select";
import { ComboboxTextContext, comboboxTextFor } from "./combobox-text";

// Live check 2026-10-24: an English lead cabinet showed the picker's words in
// the portal language ("Удалить: Germany", "Поиск...", "Нет результатов").
describe("picker words follow the page language", () => {
  function chipLabel(lang?: "de" | "ru" | "uk" | "en") {
    const select = (
      <CitizenshipMultiSelect value={["DE"]} onChange={() => undefined} placeholder="Add country" lang={lang ?? "en"} />
    );
    const html = renderToStaticMarkup(
      lang ? <ComboboxTextContext.Provider value={comboboxTextFor(lang)}>{select}</ComboboxTextContext.Provider> : select,
    );
    return html.match(/aria-label="([^":]*): [^"]*"/)?.[1];
  }

  it("names the chip removal in the cabinet language", () => {
    expect(chipLabel("en")).toBe("Remove");
    expect(chipLabel("uk")).toBe("Видалити");
  });

  it("keeps the portal language without a page language", () => {
    expect(["Entfernen", "Удалить"]).toContain(chipLabel());
  });

  it("has the search and no-match words of all four languages", () => {
    expect(comboboxTextFor("en")).toEqual({ search: "Search...", empty: "No results", remove: "Remove" });
    expect(comboboxTextFor("uk").search).toBe("Пошук...");
    expect(comboboxTextFor("de").empty).toBe("Keine Ergebnisse");
    expect(comboboxTextFor("ru").remove).toBe("Удалить");
  });
});
