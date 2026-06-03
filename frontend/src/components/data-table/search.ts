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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blobContainsToken(blob: string, token: string) {
  return new RegExp(escapeRegExp(deNormalize(token))).test(blob);
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
  return tokens.every((token) => blobContainsToken(blob, token));
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

export type SearchIndex<T> = Array<{ row: T; blob: string }>;

export function buildSearchIndex<T>(
  rows: readonly T[],
  ctx: SearchContext<T>,
): SearchIndex<T> {
  return rows.map((row) => ({ row, blob: buildSearchBlob(row, ctx) }));
}

export function searchWithIndex<T>(
  index: SearchIndex<T>,
  query: string,
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return index.map((entry) => entry.row);
  const rows: T[] = [];
  for (const entry of index) {
    if (tokens.every((token) => blobContainsToken(entry.blob, token))) {
      rows.push(entry.row);
    }
  }
  return rows;
}
