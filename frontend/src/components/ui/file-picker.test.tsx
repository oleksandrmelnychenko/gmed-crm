import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadOnlyScope } from "@/components/read-only-scope";
import { FilePicker, filePickerSummary } from "@/components/ui/file-picker";
import { t } from "@/lib/i18n";

const de = {
  choose: t("de").file_picker_choose,
  chooseMultiple: t("de").file_picker_choose_multiple,
  none: t("de").file_picker_none,
  count: t("de").file_picker_count,
};

function oneOf(markup: string, key: "file_picker_choose" | "file_picker_choose_multiple" | "file_picker_none") {
  return markup.includes(t("de")[key]) || markup.includes(t("ru")[key]);
}

describe("FilePicker", () => {
  it("names the chosen file, a count or none in the app language", () => {
    expect(filePickerSummary([], de)).toBe("Keine Datei ausgewählt");
    expect(filePickerSummary([new File(["x"], "Befund.pdf")], de)).toBe("Befund.pdf");
    expect(
      filePickerSummary([new File(["x"], "a.pdf"), new File(["y"], "b.pdf")], de),
    ).toBe("2 Dateien ausgewählt");
    expect(t("ru").file_picker_choose).toBe("Выбрать файл");
    expect(t("de").file_picker_choose).toBe("Datei auswählen");
  });

  it("keeps a focusable file input with the given id and an app button for it", () => {
    const markup = renderToStaticMarkup(
      <FilePicker id="portal-document-upload-file" accept=".pdf" onChange={() => undefined} />,
    );
    // The real input stays in the DOM (tests call setInputFiles on it), visually hidden but
    // focusable — not display:none — so Tab and Enter/Space reach it.
    expect(markup).toMatch(/<input[^>]*id="portal-document-upload-file"[^>]*>/);
    expect(markup).toMatch(/<input[^>]*type="file"/);
    expect(markup).toMatch(/<input[^>]*class="peer sr-only"/);
    expect(markup).toContain('accept=".pdf"');
    expect(markup).not.toMatch(/<input[^>]*\shidden[\s=/>]/);
    // The button is a label for that input: a click opens the browser's chooser, and it is no
    // second element with its own accessible name.
    expect(markup).toContain('for="portal-document-upload-file"');
    expect(markup).not.toContain("aria-label");
    expect(oneOf(markup, "file_picker_choose")).toBe(true);
    expect(oneOf(markup, "file_picker_none")).toBe(true);
  });

  it("shows what the page keeps as chosen, the plural for several files, and nothing when asked", () => {
    const chosen = renderToStaticMarkup(
      <FilePicker id="proof" selected={new File(["x"], "Überweisung.pdf")} />,
    );
    expect(chosen).toContain("Überweisung.pdf");
    const multiple = renderToStaticMarkup(<FilePicker id="many" multiple selected={[]} />);
    expect(oneOf(multiple, "file_picker_choose_multiple")).toBe(true);
    expect(multiple).toMatch(/<input[^>]*multiple=""/);
    const bare = renderToStaticMarkup(<FilePicker id="bare" showSelection={false} />);
    expect(oneOf(bare, "file_picker_none")).toBe(false);
  });

  it("is disabled inside a read-only scope and when disabled", () => {
    const readOnly = renderToStaticMarkup(
      <ReadOnlyScope>
        <FilePicker id="ro" />
      </ReadOnlyScope>,
    );
    expect(readOnly).toMatch(/<input[^>]*disabled=""/);
    expect(renderToStaticMarkup(<FilePicker id="off" disabled />)).toMatch(
      /<input[^>]*disabled=""/,
    );
    expect(renderToStaticMarkup(<FilePicker id="on" />)).not.toMatch(/<input[^>]*disabled=""/);
  });
});
