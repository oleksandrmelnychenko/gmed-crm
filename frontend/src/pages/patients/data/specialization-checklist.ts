/**
 * Checklist form of a specialization's anamnesis template.
 *
 * Staff write the template in the specialization directory as plain lines.
 * A line that ends with a bracket such as `(ja/nein + if ja: Note)` becomes a
 * yes/no question with follow-up fields; everything else stays a heading. The
 * answers are stored next to the readable text that is composed from them, so
 * the anamnesis prints and reads like hand-written text.
 */

export type ChecklistFieldKind = "text" | "number" | "bmi";

export type ChecklistField = {
  key: string;
  kind: ChecklistFieldKind;
  /** Empty for a plain note. */
  label: string;
  unit: string;
};

export type ChecklistItem = {
  /** Position of the line in the template; answers are keyed by it. */
  index: number;
  label: string;
  /** A line starting with a dash belongs to the group opened above it. */
  child: boolean;
  yesNo: boolean;
  options: string[];
  fields: ChecklistField[];
};

export type ChecklistAnswer = {
  value?: "ja" | "nein" | null;
  options?: string[];
  fields?: Record<string, string>;
};

/** Stored with the specialization of an anamnesis version. */
export type SpecializationChecklist = {
  version: 1;
  /** The template the answers were given against, so later edits of the directory do not shift them. */
  template: string;
  answers: Record<string, ChecklistAnswer>;
  /** Free text below the checklist. */
  notes: string;
};

const SPEC_RE = /ja\s*\/\s*nein|\b(?:if|wenn|falls)\s+ja\b/i;
const NOTE_RE = /^(?:note|notes|notiz|notizen|bemerkung|kommentar|text|freitext)$/i;
const NUMBER_MARK_RE = /\(\s*(?:number|zahl|nummer)\s*\)/i;
const UNIT_RE = /^(.*?)\s+in\s+([A-Za-zµ%/²]{1,8})$/;

/** The bracket that closes the line, with nested brackets inside it. */
function trailingBracket(line: string): { before: string; inside: string } | null {
  if (!line.endsWith(")")) return null;
  let depth = 0;
  for (let position = line.length - 1; position >= 0; position -= 1) {
    const character = line[position];
    if (character === ")") depth += 1;
    else if (character === "(") {
      depth -= 1;
      if (depth === 0) {
        return { before: line.slice(0, position), inside: line.slice(position + 1, -1) };
      }
    }
  }
  return null;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

function fieldFromToken(token: string, position: number): ChecklistField {
  if (NOTE_RE.test(token)) return { key: `note${position}`, kind: "text", label: "", unit: "" };
  if (/^bmi$/i.test(token)) return { key: "bmi", kind: "bmi", label: "BMI", unit: "" };
  const numeric = NUMBER_MARK_RE.test(token);
  // "Pack Years Note (Number)": the word "Note" only says that a value is noted.
  const cleaned = token.replace(NUMBER_MARK_RE, "").replace(/\s+(?:note|notiz)\s*$/i, "").trim();
  const withUnit = UNIT_RE.exec(cleaned);
  if (withUnit) {
    return { key: `field${position}`, kind: "number", label: withUnit[1].trim(), unit: withUnit[2] };
  }
  return { key: `field${position}`, kind: numeric ? "number" : "text", label: cleaned, unit: "" };
}

export function parseChecklistTemplate(template: string | null | undefined): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  (template ?? "").split(/\r?\n/).forEach((rawLine) => {
    let line = rawLine.trim();
    if (!line) return;
    const child = /^[-–—•*]\s*/.test(line);
    line = line.replace(/^[-–—•*]\s*/, "").replace(/[:\s]+$/, "");
    if (!line) return;
    const item: ChecklistItem = { index: items.length, label: line, child, yesNo: false, options: [], fields: [] };
    const bracket = trailingBracket(line);
    const single = bracket ? bracket.inside.trim() : "";
    if (bracket && bracket.before.trim() && (SPEC_RE.test(single) || NOTE_RE.test(single) || NUMBER_MARK_RE.test(`(${single})`))) {
      item.label = bracket.before.replace(/[:\s]+$/, "");
      if (/^(?:number|zahl|nummer)$/i.test(single)) {
        item.fields.push({ key: "field0", kind: "number", label: "", unit: "" });
      } else {
        item.yesNo = SPEC_RE.test(single);
        splitTopLevel(bracket.inside, "+").forEach((part, position) => {
          const token = part
            .replace(/^[\s:]+/, "")
            .replace(/^(?:if|wenn|falls)\s+ja\s*:?\s*/i, "")
            .replace(/[\s:]+$/, "");
          if (!token || /^ja\s*\/\s*nein$/i.test(token)) return;
          const alternatives = splitTopLevel(token, "/").map((value) => value.trim()).filter(Boolean);
          if (alternatives.length > 1 && !NUMBER_MARK_RE.test(token)) {
            item.options.push(...alternatives);
          } else {
            item.fields.push(fieldFromToken(token, position));
          }
        });
      }
    }
    items.push(item);
  });
  return items;
}

/** A template is a checklist once it asks at least one question. */
export function isChecklistTemplate(template: string | null | undefined): boolean {
  return parseChecklistTemplate(template).some((item) => item.yesNo || item.fields.length > 0);
}

export function emptySpecializationChecklist(template: string, notes = ""): SpecializationChecklist {
  return { version: 1, template, answers: {}, notes };
}

/** Accepts only a stored value of the known shape; anything else is ignored. */
export function readSpecializationChecklist(value: unknown): SpecializationChecklist | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.template !== "string" || !record.answers || typeof record.answers !== "object") return null;
  return {
    version: 1,
    template: record.template,
    answers: record.answers as Record<string, ChecklistAnswer>,
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

function germanNumber(value: string | undefined): number | null {
  const compact = value?.trim().replace(/\s/g, "").replace(",", ".");
  if (!compact) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

/** BMI from the weight (kg) and height (cm) fields of the same question. */
export function checklistBmi(item: ChecklistItem, answer: ChecklistAnswer | undefined): string {
  const byUnit = (unit: string) =>
    germanNumber(answer?.fields?.[item.fields.find((field) => field.unit.toLowerCase() === unit)?.key ?? ""]);
  const weight = byUnit("kg");
  const height = byUnit("cm");
  if (!weight || !height) return "";
  return (weight / (height / 100) ** 2).toFixed(1).replace(".", ",");
}

/** Whether the group a child line belongs to was answered with "nein". */
export function checklistGroupDeclined(
  items: ChecklistItem[],
  item: ChecklistItem,
  answers: Record<string, ChecklistAnswer>,
): boolean {
  if (!item.child) return false;
  for (let index = item.index - 1; index >= 0; index -= 1) {
    if (!items[index].child) return answers[String(index)]?.value === "nein";
  }
  return false;
}

function answerDetails(item: ChecklistItem, answer: ChecklistAnswer): string {
  const parts: string[] = [];
  const options = (answer.options ?? []).filter((option) => item.options.includes(option));
  if (options.length > 0) parts.push(options.join(", "));
  for (const field of item.fields) {
    const value = field.kind === "bmi" ? checklistBmi(item, answer) : answer.fields?.[field.key]?.trim() ?? "";
    if (!value) continue;
    const withUnit = field.unit ? `${value} ${field.unit}` : value;
    parts.push(field.label ? `${field.label}: ${withUnit}` : withUnit);
  }
  return parts.join("; ");
}

/** The readable text of the answered questions followed by the free text. */
export function composeChecklistText(checklist: SpecializationChecklist): string {
  const items = parseChecklistTemplate(checklist.template);
  const lines: string[] = [];
  let pendingHeading: string | null = null;
  for (const item of items) {
    const answer = checklist.answers[String(item.index)] ?? {};
    const interactive = item.yesNo || item.fields.length > 0;
    if (!item.child) pendingHeading = null;
    if (!interactive) {
      if (!item.child) pendingHeading = item.label;
      continue;
    }
    if (checklistGroupDeclined(items, item, checklist.answers)) continue;
    const details = !item.yesNo || answer.value === "ja" ? answerDetails(item, answer) : "";
    if (item.yesNo ? !answer.value : !details) continue;
    if (pendingHeading !== null) {
      lines.push(`${pendingHeading}:`);
      pendingHeading = null;
    }
    const value = item.yesNo ? `${answer.value}${details ? ` (${details})` : ""}` : details;
    lines.push(`${item.child ? "- " : ""}${item.label}: ${value}`);
  }
  return [lines.join("\n"), checklist.notes.trim()].filter(Boolean).join("\n\n");
}
