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
 *
 * With a UI language the system lines are also shown in it (QA C3-10): the
 * server writes them in German, because the notes travel to the German order
 * documents; the Russian UI reads them in Russian, and hours read with a
 * decimal comma ("Stunden: 1.5" → "1,5") in both languages.
 */
export function readableServiceLineNotes(
  notes: string | null | undefined,
  lang?: "de" | "ru",
): string | null {
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
    .filter((line) => line !== "" && !/^[^:]{1,40}:$/.test(line))
    .map((line) => (lang ? localizeSystemNoteLine(line, lang) : line));
  return lines.length > 0 ? lines.join("\n") : null;
}

/** A number written with a decimal point as the UI writes it ("1.5" → "1,5"). */
function decimalComma(value: string): string {
  return value.replace(/^(\d+)\.(\d+)$/, "$1,$2");
}

type NoteRule = {
  pattern: RegExp;
  de?: (match: RegExpMatchArray) => string;
  ru: (match: RegExpMatchArray) => string;
};

// System lines written by the server (appointments.rs, orders.rs,
// order_service_groups.rs), the current and the older wording.
const HEADLINE_RULES: NoteRule[] = [
  {
    pattern: /^Automatisch aus (dem )?abgeschlossene[mn] medizinische[mn] Termin erstellt$/,
    ru: () => "Автоматически начислено по завершённому медицинскому приёму",
  },
  {
    pattern: /^Geplante Leistung durch den abgeschlossenen medizinischen Termin erbracht$/,
    ru: () => "Запланированная услуга оказана на завершённом медицинском приёме",
  },
  {
    pattern: /^Automatisch aus (dem )?freigegebene[mn] Dolmetscherbericht erstellt$/,
    ru: () => "Автоматически начислено по утверждённому отчёту переводчика",
  },
  {
    pattern: /^Geplante Leistung \(([\d.,]+) Std\.\) durch den freigegebenen Dolmetscherbericht mit den tatsächlichen Stunden ersetzt$/,
    de: (match) =>
      `Geplante Leistung (${decimalComma(match[1])} Std.) durch den freigegebenen Dolmetscherbericht mit den tatsächlichen Stunden ersetzt`,
    ru: (match) =>
      `Запланированная услуга (${decimalComma(match[1])} ч) заменена фактическими часами из утверждённого отчёта переводчика`,
  },
  { pattern: /^Genehmigte Betragsänderung$/, ru: () => "Одобренное изменение суммы" },
  {
    pattern: /^Nachträglich abgerechnete genehmigte Betragsänderung$/,
    ru: () => "Одобренное изменение суммы, начисленное позже",
  },
  {
    pattern: /^(Generated from multi-doctor service group|Aus der Leistungsgruppe mit mehreren Ärzten erstellt)$/,
    de: () => "Aus der Leistungsgruppe mit mehreren Ärzten erstellt",
    ru: () => "Создано из группы услуг нескольких врачей",
  },
];

const LABELS_RU: Record<string, string> = {
  Termin: "Приём",
  Datum: "Дата",
  Anbieter: "Провайдер",
  Arzt: "Врач",
  Dolmetscher: "Переводчик",
  Stunden: "Часы",
  Bericht: "Отчёт",
  Report: "Отчёт",
};

function localizeSystemNoteLine(line: string, lang: "de" | "ru"): string {
  for (const rule of HEADLINE_RULES) {
    const match = line.match(rule.pattern);
    if (match) return lang === "ru" ? rule.ru(match) : rule.de ? rule.de(match) : line;
  }
  const hours = line.match(/^Stunden:\s*([\d.,]+)$/);
  if (hours) return `${lang === "ru" ? "Часы" : "Stunden"}: ${decimalComma(hours[1])}`;
  if (lang === "de") return line;
  const visit = line.match(/^Termin:\s*(.+) am (\d{2}\.\d{2}\.\d{4})$/);
  if (visit) return `Приём: ${visit[1]}, ${visit[2]}`;
  const labelled = line.match(/^([A-Za-zÄÖÜäöüß]+):\s*(.*)$/);
  if (labelled && LABELS_RU[labelled[1]]) return `${LABELS_RU[labelled[1]]}: ${labelled[2]}`;
  return line;
}
