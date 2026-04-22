export type FieldAccessor<T> = (row: T) => unknown;

export type SearchContext<T> = {
  fields: readonly FieldAccessor<T>[];
};

export function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function valueToSearchString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map(valueToSearchString).join(" ");
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase();
  return "";
}

export function buildSearchBlob<T>(row: T, ctx: SearchContext<T>): string {
  return ctx.fields.map((accessor) => valueToSearchString(accessor(row))).join(" ");
}

export function matchesSearch<T>(row: T, tokens: readonly string[], ctx: SearchContext<T>): boolean {
  if (tokens.length === 0) return true;
  const blob = buildSearchBlob(row, ctx);
  return tokens.every((token) => blob.includes(token.toLowerCase()));
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
  return index
    .filter((entry) => tokens.every((token) => entry.blob.includes(token.toLowerCase())))
    .map((entry) => entry.row);
}
