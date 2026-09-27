const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// Lines that only carried a technical reference; the reference itself stays
// on the service line (source appointment / report, catalog link).
const TECHNICAL_LINE = /^(katalogschlüssel|catalog key|service key)\s*:/i;

/**
 * Notes of an automatically created order service line as readable text.
 * Lines written before the notes became readable carry raw IDs, catalog keys
 * and ISO dates ("Automatisch aus abgeschlossenem medizinischem Termin
 * 5f1c… erstellt", "Katalogschlüssel: treatment_organization"): IDs and
 * key-only lines are left out and dates read DD.MM.YYYY. Staff-written notes
 * pass through unchanged apart from that.
 */
export function readableServiceLineNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const lines = notes
    .split(/\r?\n/)
    .filter((line) => !TECHNICAL_LINE.test(line.trim()))
    .map((line) =>
      line
        .replace(UUID, "")
        .replace(ISO_DATE, (_match, year: string, month: string, day: string) => `${day}.${month}.${year}`)
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .trim(),
    )
    // A line that held only a reference ("Termin: <id>") is empty now.
    .filter((line) => line !== "" && !/^[^:]{1,40}:$/.test(line));
  return lines.length > 0 ? lines.join("\n") : null;
}
