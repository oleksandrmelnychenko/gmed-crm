type FieldAccessor<T> = (row: T) => unknown;

export type SearchContext<T> = {
  fields: readonly FieldAccessor<T>[];
};

/**
 * German-aware fold: lowercases and substitutes umlauts/eszett with their standard
 * digraphs (ä→ae, ö→oe, ü→ue, ß→ss) so a query typed without a German keyboard matches
 * stored umlauts. Mirrors the SQL `de_normalize()` used by the list endpoints, so
 * client-side filtering of server results stays consistent with server-side search.
 */
export function deNormalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

export function tokenize(query: string): string[] {
  return deNormalize(query.trim())
    .split(/\s+/u)
    .filter(Boolean);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

// Substring match against the (already de_normalize'd) blob, plus a digit-only fallback
// for phone format tolerance. `digitBlob` is the precomputed digit-only form of `blob`.
function blobContainsToken(blob: string, digitBlob: string, token: string) {
  const folded = deNormalize(token);
  if (blob.includes(folded)) return true;
  const tokenDigits = digitsOnly(token);
  return tokenDigits.length >= 3 && digitBlob.includes(tokenDigits);
}

function valueToSearchString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return deNormalize(value);
  if (Array.isArray(value)) return value.map(valueToSearchString).join(" ");
  if (typeof value === "number" || typeof value === "boolean") return deNormalize(String(value));
  return "";
}

function buildSearchBlob<T>(row: T, ctx: SearchContext<T>): string {
  return ctx.fields.map((accessor) => valueToSearchString(accessor(row))).join(" ");
}

export function matchesSearch<T>(row: T, tokens: readonly string[], ctx: SearchContext<T>): boolean {
  if (tokens.length === 0) return true;
  const blob = buildSearchBlob(row, ctx);
  const digitBlob = digitsOnly(blob);
  return tokens.every((token) => blobContainsToken(blob, digitBlob, token));
}

export function applySearch<T>(
  rows: readonly T[],
  query: string,
  ctx: SearchContext<T>,
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return rows.slice();
  return rows.filter((row) => matchesSearch(row, tokens, ctx));
}

export type SearchIndex<T> = Array<{ row: T; blob: string; digitBlob: string }>;

export function buildSearchIndex<T>(
  rows: readonly T[],
  ctx: SearchContext<T>,
): SearchIndex<T> {
  return rows.map((row) => {
    const blob = buildSearchBlob(row, ctx);
    return { row, blob, digitBlob: digitsOnly(blob) };
  });
}

export function searchWithIndex<T>(
  index: SearchIndex<T>,
  query: string,
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return index.map((entry) => entry.row);
  // Tokens from tokenize() are already de_normalize'd; precompute each token's digit form
  // once (not per row) so filtering stays cheap on large lists.
  const prepared = tokens.map((text) => {
    const digits = digitsOnly(text);
    return { text, digits: digits.length >= 3 ? digits : "" };
  });
  const rows: T[] = [];
  for (const entry of index) {
    if (
      prepared.every(
        (token) =>
          entry.blob.includes(token.text) ||
          (token.digits !== "" && entry.digitBlob.includes(token.digits)),
      )
    ) {
      rows.push(entry.row);
    }
  }
  return rows;
}
