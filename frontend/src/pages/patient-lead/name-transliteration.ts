/**
 * Passport spelling of a name typed in Cyrillic, offered to the lead as a
 * suggestion (never applied silently): the Ukrainian passport rules (Cabinet
 * of Ministers resolution No. 55, 2010) for the Ukrainian cabinet, ICAO 9303
 * (the Russian international passport) otherwise. The real passport may
 * differ, so the lead confirms the suggestion with a button.
 */

/** Latin letters (incl. accents such as ü, é, ł), spaces, hyphens, apostrophes and dots. */
const PASSPORT_NAME = /^[\p{Script=Latin}\p{M}\s'’.-]*$/u;

/** True when the name has a character a passport name cannot contain. */
export function nameNeedsLatinSpelling(value: string): boolean {
  return !PASSPORT_NAME.test(value.trim());
}

const RUSSIAN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "ie", ы: "y", ь: "", э: "e", ю: "iu", я: "ia",
  // Ukrainian letters typed in the Russian cabinet.
  і: "i", ї: "i", є: "ie", ґ: "g",
};

const UKRAINIAN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y",
  і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia",
  "'": "", "’": "", ʼ: "",
  // Russian letters typed in the Ukrainian cabinet.
  ё: "e", ъ: "", ы: "y", э: "e",
};

/** At the start of a word the Ukrainian iotated letters are spelled with Y. */
const UKRAINIAN_WORD_START: Record<string, string> = { є: "ye", ї: "yi", й: "y", ю: "yu", я: "ya" };

function capitalise(latin: string, source: string): string {
  if (!latin) return latin;
  return source === source.toUpperCase() && source !== source.toLowerCase()
    ? latin.charAt(0).toUpperCase() + latin.slice(1)
    : latin;
}

function transliterateWord(word: string, ukrainian: boolean): string {
  const chars = Array.from(word);
  const allUpper = word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
  let out = "";
  chars.forEach((char, index) => {
    const lower = char.toLowerCase();
    const atStart = index === 0;
    let latin: string | undefined;
    if (ukrainian) {
      // "зг" is spelled "zgh" so it is not read as "zh".
      if (lower === "г" && chars[index - 1]?.toLowerCase() === "з") latin = "gh";
      else latin = atStart && UKRAINIAN_WORD_START[lower] ? UKRAINIAN_WORD_START[lower] : UKRAINIAN[lower];
    } else {
      latin = RUSSIAN[lower];
    }
    out += latin === undefined ? char : capitalise(latin, char);
  });
  return allUpper ? out.toUpperCase() : out;
}

/**
 * The passport spelling of a Cyrillic name ("Іванна-Марія" → "Ivanna-Mariia"),
 * or null when there is nothing to transliterate or the result still has
 * characters a passport name cannot contain.
 */
export function suggestPassportSpelling(value: string, lang: string | null | undefined): string | null {
  const trimmed = value.trim();
  if (!/\p{Script=Cyrillic}/u.test(trimmed)) return null;
  const ukrainian = lang === "uk" || lang === "ua";
  const latin = trimmed
    .split(/(\s+|-)/)
    .map((part) => (/^(\s+|-)$/.test(part) ? part : transliterateWord(part, ukrainian)))
    .join("");
  return nameNeedsLatinSpelling(latin) ? null : latin;
}
