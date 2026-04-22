import type {
  DataTableState,
  DensityLevel,
  FilterOperator,
  FilterPredicate,
  FilterValue,
  SortDir,
  SortStack,
} from "./types";

const FILTER_SEP = ";";
const FIELD_SEP = ":";
const ARRAY_SEP = ",";
const RANGE_SEP = "~";

const VALID_OPERATORS: readonly FilterOperator[] = [
  "contains",
  "does_not_contain",
  "is_empty",
  "is_not_empty",
  "is",
  "is_not",
  "is_any_of",
  "is_none_of",
  "has_any",
  "has_all",
  "has_none",
  "before",
  "after",
  "between",
  "last_n_days",
  "equals",
];

const SCALAR_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "contains",
  "does_not_contain",
  "is",
  "is_not",
  "before",
  "after",
  "equals",
]);

const ARRAY_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "is_any_of",
  "is_none_of",
  "has_any",
  "has_all",
  "has_none",
]);

const EMPTY_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "is_empty",
  "is_not_empty",
]);

const VALID_DENSITIES: readonly DensityLevel[] = ["comfortable", "compact", "condensed"];

function encodeValue(raw: string): string {
  return encodeURIComponent(raw)
    .replace(/%2C/gi, "%2C")
    .replace(/%3A/gi, "%3A")
    .replace(/%3B/gi, "%3B")
    .replace(/%7E/gi, "%7E");
}

function decodeValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function serializeFilterValue(operator: FilterOperator, value: FilterValue): string {
  if (EMPTY_OPERATORS.has(operator)) return "";
  if (operator === "between") {
    const range = (value ?? {}) as { from?: string; to?: string };
    const from = range.from ?? "";
    const to = range.to ?? "";
    return `${encodeValue(from)}${RANGE_SEP}${encodeValue(to)}`;
  }
  if (operator === "last_n_days") {
    const days = typeof value === "object" && value && "days" in value
      ? (value as { days: number }).days
      : Number(value);
    return encodeValue(String(days ?? ""));
  }
  if (ARRAY_OPERATORS.has(operator)) {
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
    return list.map(encodeValue).join(ARRAY_SEP);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value == null) return "";
  return encodeValue(String(value));
}

function deserializeFilterValue(operator: FilterOperator, raw: string): FilterValue {
  if (EMPTY_OPERATORS.has(operator)) return null;
  if (operator === "between") {
    const [from, to] = raw.split(RANGE_SEP);
    return {
      from: from ? decodeValue(from) : undefined,
      to: to ? decodeValue(to) : undefined,
    };
  }
  if (operator === "last_n_days") {
    const n = Number(decodeValue(raw));
    return { days: Number.isFinite(n) ? n : 0 };
  }
  if (ARRAY_OPERATORS.has(operator)) {
    if (raw === "") return [];
    return raw.split(ARRAY_SEP).map(decodeValue);
  }
  if (operator === "is" || operator === "is_not") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return decodeValue(raw);
}

function serializeFilterPredicate(p: FilterPredicate): string {
  const value = serializeFilterValue(p.operator, p.value);
  return value
    ? `${p.field}${FIELD_SEP}${p.operator}${FIELD_SEP}${value}`
    : `${p.field}${FIELD_SEP}${p.operator}`;
}

function parseFilterPredicate(input: string, index: number): FilterPredicate | null {
  const firstSep = input.indexOf(FIELD_SEP);
  if (firstSep <= 0) return null;
  const field = input.slice(0, firstSep);
  const rest = input.slice(firstSep + 1);
  const secondSep = rest.indexOf(FIELD_SEP);
  const operatorRaw = secondSep === -1 ? rest : rest.slice(0, secondSep);
  const valueRaw = secondSep === -1 ? "" : rest.slice(secondSep + 1);
  if (!VALID_OPERATORS.includes(operatorRaw as FilterOperator)) return null;
  const operator = operatorRaw as FilterOperator;
  if (SCALAR_OPERATORS.has(operator) && valueRaw === "") return null;
  return {
    id: `${field}:${operator}:${index}`,
    field,
    operator,
    value: deserializeFilterValue(operator, valueRaw),
  };
}

export function serializeFilters(filters: readonly FilterPredicate[]): string {
  return filters.map(serializeFilterPredicate).join(FILTER_SEP);
}

export function parseFilters(raw: string | null | undefined): FilterPredicate[] {
  if (!raw) return [];
  return raw
    .split(FILTER_SEP)
    .map((chunk, i) => parseFilterPredicate(chunk, i))
    .filter((p): p is FilterPredicate => p !== null);
}

export function serializeSort(stack: SortStack): string {
  return stack.map((s) => `${s.field}${FIELD_SEP}${s.dir}`).join(ARRAY_SEP);
}

export function parseSort(raw: string | null | undefined): SortStack {
  if (!raw) return [];
  return raw
    .split(ARRAY_SEP)
    .map((chunk) => {
      const [field, dir] = chunk.split(FIELD_SEP);
      if (!field || (dir !== "asc" && dir !== "desc")) return null;
      return { field, dir: dir as SortDir };
    })
    .filter((s): s is { field: string; dir: SortDir } => s !== null);
}

export function serializeHiddenColumns(hidden: readonly string[]): string {
  return hidden.join(ARRAY_SEP);
}

export function parseHiddenColumns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(ARRAY_SEP).filter(Boolean);
}

export function parseDensity(raw: string | null | undefined): DensityLevel | null {
  if (!raw) return null;
  return VALID_DENSITIES.includes(raw as DensityLevel) ? (raw as DensityLevel) : null;
}

export type DataTableQueryKeys = {
  filters: string;
  sort: string;
  search: string;
  density: string;
  hide: string;
};

export const DEFAULT_QUERY_KEYS: DataTableQueryKeys = {
  filters: "filters",
  sort: "sort",
  search: "q",
  density: "density",
  hide: "hide",
};

export function writeDataTableState(
  params: URLSearchParams,
  state: Partial<DataTableState>,
  keys: DataTableQueryKeys = DEFAULT_QUERY_KEYS,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (state.filters !== undefined) {
    const serialized = serializeFilters(state.filters);
    if (serialized) next.set(keys.filters, serialized);
    else next.delete(keys.filters);
  }
  if (state.sort !== undefined) {
    const serialized = serializeSort(state.sort);
    if (serialized) next.set(keys.sort, serialized);
    else next.delete(keys.sort);
  }
  if (state.search !== undefined) {
    if (state.search.trim()) next.set(keys.search, state.search);
    else next.delete(keys.search);
  }
  if (state.density !== undefined) {
    next.set(keys.density, state.density);
  }
  if (state.hiddenColumns !== undefined) {
    const serialized = serializeHiddenColumns(state.hiddenColumns);
    if (serialized) next.set(keys.hide, serialized);
    else next.delete(keys.hide);
  }
  return next;
}

export function readDataTableState(
  params: URLSearchParams,
  keys: DataTableQueryKeys = DEFAULT_QUERY_KEYS,
): Partial<DataTableState> {
  const out: Partial<DataTableState> = {};
  const filtersRaw = params.get(keys.filters);
  if (filtersRaw !== null) out.filters = parseFilters(filtersRaw);
  const sortRaw = params.get(keys.sort);
  if (sortRaw !== null) out.sort = parseSort(sortRaw);
  const searchRaw = params.get(keys.search);
  if (searchRaw !== null) out.search = searchRaw;
  const densityRaw = parseDensity(params.get(keys.density));
  if (densityRaw !== null) out.density = densityRaw;
  const hideRaw = params.get(keys.hide);
  if (hideRaw !== null) out.hiddenColumns = parseHiddenColumns(hideRaw);
  return out;
}
