/**
 * Conversion between the translation markup the PDF renderer understands and
 * the HTML of the visual editor.
 *
 * The markup is line based, exactly like `render_translation_markup` on the
 * server: every line is one block, `## ` is a heading, `- ` a bullet, `1. ` a
 * numbered item, an empty line a paragraph gap, and `**bold**` works inside a
 * single line only. Bold is therefore closed and reopened at every line break
 * when serialising, which the old textarea left to the user.
 */

export type MarkupNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MarkupNode>;
  style?: { fontWeight?: string };
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
// Browsers insert no-break spaces while editing; they are ordinary spaces here.
const NBSP = new RegExp(String.fromCharCode(160), "g");

type Run = { text: string; bold: boolean };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Same rule as the server: an opening `**` without a closing one stays literal. */
function parseBoldRuns(text: string): Run[] {
  const runs: Run[] = [];
  let rest = text;
  let bold = false;
  for (;;) {
    const index = rest.indexOf("**");
    if (index < 0) break;
    const head = rest.slice(0, index);
    const after = rest.slice(index + 2);
    if (head) runs.push({ text: head, bold });
    if (!bold && !after.includes("**")) {
      runs.push({ text: rest.slice(index), bold: false });
      return runs;
    }
    bold = !bold;
    rest = after;
  }
  if (rest) runs.push({ text: rest, bold });
  return runs;
}

function inlineHtml(text: string) {
  return parseBoldRuns(text)
    .map((run) => (run.bold ? `<strong>${escapeHtml(run.text)}</strong>` : escapeHtml(run.text)))
    .join("");
}

type LineKind = "heading" | "bullet" | "numbered" | "blank" | "paragraph";

function classifyLine(raw: string): { kind: LineKind; body: string } {
  const line = raw.replace(/\s+$/, "").replace(/^\s+/, "");
  if (!line) return { kind: "blank", body: "" };
  const heading = /^#{1,2} (.*)$/.exec(line);
  if (heading) return { kind: "heading", body: heading[1].replace(/\*\*/g, "") };
  const bullet = /^[-*•] (.*)$/.exec(line);
  if (bullet) return { kind: "bullet", body: bullet[1] };
  const numbered = /^\d{1,3}\. (.*)$/.exec(line);
  if (numbered) return { kind: "numbered", body: numbered[1] };
  return { kind: "paragraph", body: line };
}

export function markupToHtml(markup: string): string {
  const lines = markup.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const { kind, body } = classifyLine(raw);
    if (kind === "bullet" || kind === "numbered") {
      const tag = kind === "bullet" ? "ul" : "ol";
      if (list !== tag) {
        closeList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inlineHtml(body) || "<br>"}</li>`);
      continue;
    }
    closeList();
    if (kind === "heading") out.push(`<h3>${escapeHtml(body) || "<br>"}</h3>`);
    else if (kind === "blank") out.push("<p><br></p>");
    else out.push(`<p>${inlineHtml(body)}</p>`);
  }
  closeList();
  // A trailing empty paragraph is what the editor itself adds after Enter;
  // keep at least one block so the caret has somewhere to go.
  return out.join("") || "<p><br></p>";
}

function isBoldElement(node: MarkupNode) {
  if (node.nodeName === "B" || node.nodeName === "STRONG") return true;
  const weight = node.style?.fontWeight ?? "";
  return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

/** Flattens inline content into runs; `<br>` becomes a line break run. */
function collectRuns(node: MarkupNode, bold: boolean, runs: Run[]) {
  if (node.nodeType === TEXT_NODE) {
    const text = (node.textContent ?? "").replace(NBSP, " ").replace(/\n/g, " ");
    if (text) runs.push({ text, bold });
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  if (node.nodeName === "BR") {
    runs.push({ text: "\n", bold: false });
    return;
  }
  const nextBold = bold || isBoldElement(node);
  for (const child of Array.from(node.childNodes)) collectRuns(child, nextBold, runs);
}

/** Runs to markup lines, closing `**` at every line break. */
function runsToLines(runs: Run[]): string[] {
  const lines: string[] = [];
  let current = "";
  let open = false;
  // Spaces after bold text are held back so they land outside the markers
  // ("**text** next", never "**text **next").
  let held = "";
  const close = () => {
    if (open) current += "**";
    open = false;
  };
  const flush = () => {
    close();
    lines.push(current);
    current = "";
    held = "";
  };
  for (const run of runs) {
    run.text.split("\n").forEach((part, index) => {
      if (index > 0) flush();
      if (!part) return;
      const core = part.trim();
      if (run.bold && core) {
        const lead = part.slice(0, part.length - part.trimStart().length);
        const trail = part.slice(part.trimEnd().length);
        if (open) {
          current += held + lead + core;
        } else {
          current += held + lead + "**" + core;
          open = true;
        }
        held = trail;
      } else {
        close();
        current += held + part;
        held = "";
      }
    });
  }
  if (current || open) flush();
  return lines;
}

function inlineLines(node: MarkupNode): string[] {
  const runs: Run[] = [];
  collectRuns(node, false, runs);
  const lines = runsToLines(runs);
  return lines.length ? lines : [""];
}

function plainText(node: MarkupNode) {
  return (node.textContent ?? "").replace(NBSP, " ").replace(/\s+/g, " ").trim();
}

/** Serialises the editor's DOM back into markup. */
export function htmlToMarkup(root: MarkupNode): string {
  const lines: string[] = [];
  const pushInline = (node: MarkupNode, prefix: string) => {
    for (const line of inlineLines(node)) {
      const text = line.trim();
      lines.push(text ? `${prefix}${text}` : "");
    }
  };
  let pending: MarkupNode[] = [];
  const flushInline = () => {
    if (!pending.length) return;
    pushInline({ nodeType: ELEMENT_NODE, nodeName: "SPAN", textContent: null, childNodes: pending }, "");
    pending = [];
  };
  for (const node of Array.from(root.childNodes)) {
    const name = node.nodeName;
    if (node.nodeType === TEXT_NODE || (node.nodeType === ELEMENT_NODE && /^(B|STRONG|SPAN|I|EM|U|A|FONT)$/.test(name))) {
      pending.push(node);
      continue;
    }
    flushInline();
    if (node.nodeType !== ELEMENT_NODE) continue;
    if (name === "BR") {
      lines.push("");
    } else if (/^H[1-6]$/.test(name)) {
      const text = plainText(node);
      lines.push(text ? `## ${text}` : "");
    } else if (name === "UL" || name === "OL") {
      let number = 1;
      for (const item of Array.from(node.childNodes)) {
        if (item.nodeType !== ELEMENT_NODE || item.nodeName !== "LI") continue;
        const prefix = name === "UL" ? "- " : `${number}. `;
        const text = inlineLines(item).map((line) => line.trim()).filter(Boolean).join(" ");
        if (text) {
          lines.push(`${prefix}${text}`);
          number += 1;
        }
      }
    } else {
      pushInline(node, "");
    }
  }
  flushInline();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
