import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

const LETTER = "A-Za-zÀ-ÿА-Яа-яЁёІіЇїЄєҐґ";
// A "?" glued to a letter is an umlaut, ß or Cyrillic letter lost in a broken
// encoding round trip ("Schl?sse", "?bersetzungen"); a question ends a word.
const LOST_LETTER = new RegExp(`[${LETTER}]\\?[${LETTER}]|(^|[\\s"'(/-])\\?[${LETTER}]`);

function collectStrings(value: unknown, path: string, out: Array<[string, string]>) {
  if (typeof value === "string") {
    out.push([path, value]);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectStrings(nested, path ? `${path}.${key}` : key, out);
    }
  }
}

describe.each(["de", "ru"] as const)("%s catalog", (lang) => {
  const strings: Array<[string, string]> = [];
  collectStrings(t(lang), "", strings);

  it("has no letters replaced by question marks or U+FFFD", () => {
    const broken = strings
      .filter(([, text]) => {
        // URL query strings and "{placeholder}?" stay allowed.
        const cleaned = text.replace(/\?[A-Za-z_][\w-]*=/g, "");
        return cleaned.includes("�") || LOST_LETTER.test(cleaned);
      })
      .map(([path, text]) => `${path}: ${text}`);
    expect(broken).toEqual([]);
  });
});
