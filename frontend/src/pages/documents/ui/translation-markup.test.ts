import { describe, expect, it } from "vitest";

import { htmlToMarkup, markupToHtml, type MarkupNode } from "./translation-markup";

const text = (value: string): MarkupNode => ({ nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] });
const el = (name: string, ...children: MarkupNode[]): MarkupNode => ({
  nodeType: 1,
  nodeName: name,
  textContent: children.map((child) => child.textContent ?? "").join(""),
  childNodes: children,
});

describe("translation markup", () => {
  it("renders headings, lists, bold runs and paragraph gaps as editor HTML", () => {
    expect(markupToHtml("## Titel\nDas ist **fett** und <x>\n\n- eins\n- **zwei**\n1. erstens")).toBe(
      "<h3>Titel</h3><p>Das ist <strong>fett</strong> und &lt;x&gt;</p><p><br></p>"
        + "<ul><li>eins</li><li><strong>zwei</strong></li></ul><ol><li>erstens</li></ol>",
    );
  });

  it("keeps an unmatched marker literal, like the PDF renderer", () => {
    expect(markupToHtml("Preis **nur heute")).toBe("<p>Preis **nur heute</p>");
  });

  it("serialises editor HTML back into the same markup", () => {
    const root = el(
      "DIV",
      el("H3", text("Titel")),
      el("P", text("Das ist "), el("STRONG", text("fett")), text(" und normal")),
      el("P", el("BR")),
      el("UL", el("LI", text("eins")), el("LI", el("B", text("zwei")))),
      el("OL", el("LI", text("erstens")), el("LI", text("zweitens"))),
    );
    expect(htmlToMarkup(root)).toBe(
      "## Titel\nDas ist **fett** und normal\n\n- eins\n- **zwei**\n1. erstens\n2. zweitens",
    );
  });

  it("closes bold at every line break and keeps spaces outside the markers", () => {
    const root = el("DIV", el("P", el("STRONG", text("erste Zeile "), el("BR"), text("zweite")), text(" danach")));
    expect(htmlToMarkup(root)).toBe("**erste Zeile**\n**zweite** danach");
  });

  it("merges adjacent bold pieces and treats a bold font-weight span as bold", () => {
    const span: MarkupNode = { ...el("SPAN", text("Wort")), style: { fontWeight: "700" } };
    const root = el("DIV", el("P", el("B", text("Ein ")), el("STRONG", text("ganzes")), text(" – "), span));
    expect(htmlToMarkup(root)).toBe("**Ein ganzes** – **Wort**");
  });

  it("round-trips the markup produced by DeepL drafts", () => {
    const markup = "Приложение 1\n**Согласие на передачу данных**\n\n[x] с тем, что GMED";
    const html = markupToHtml(markup);
    expect(html).toContain("<strong>Согласие на передачу данных</strong>");
  });
});
