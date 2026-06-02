import type { FilterPredicate, FilterValue } from "./types";

type FieldAccessor<T> = (row: T) => unknown;

export type FilterContext<T> = {
  accessors: Record<string, FieldAccessor<T>>;
  now?: Date;
};

function toLower(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map(toLower).join(" ");
  return String(value).toLowerCase();
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function parseDate(raw: unknown): number | null {
  if (raw == null) return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function asStringArray(value: FilterValue): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

function fieldAsArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [String(value)];
}

export function evaluatePredicate<T>(
  row: T,
  predicate: FilterPredicate,
  ctx: FilterContext<T>,
): boolean {
  const accessor = ctx.accessors[predicate.field];
  if (!accessor) return true;
  const fieldValue = accessor(row);
  const { operator, value: operand } = predicate;

  switch (operator) {
    case "is_empty":
      return isEmpty(fieldValue);
    case "is_not_empty":
      return !isEmpty(fieldValue);

    case "contains": {
      if (typeof operand !== "string" || operand === "") return true;
      return toLower(fieldValue).includes(operand.toLowerCase());
    }
    case "does_not_contain": {
      if (typeof operand !== "string" || operand === "") return true;
      return !toLower(fieldValue).includes(operand.toLowerCase());
    }

    case "is":
    case "equals": {
      // An empty text operand is a no-op (match all), like "contains". Without this
      // the default "equals" filter on number fields wipes the table the instant it is
      // added. Guard only the empty string so boolean "is" comparisons still work.
      if (operand === "") return true;
      if (isEmpty(fieldValue)) return false;
      if (operand == null) return false;
      if (typeof operand === "boolean") return Boolean(fieldValue) === operand;
      return String(fieldValue) === String(operand);
    }
    case "is_not": {
      if (operand == null) return true;
      if (typeof operand === "boolean") return Boolean(fieldValue) !== operand;
      return String(fieldValue) !== String(operand);
    }

    case "is_any_of": {
      const list = asStringArray(operand);
      if (list.length === 0) return true;
      if (isEmpty(fieldValue)) return false;
      return list.includes(String(fieldValue));
    }
    case "is_none_of": {
      const list = asStringArray(operand);
      if (list.length === 0) return true;
      if (isEmpty(fieldValue)) return true;
      return !list.includes(String(fieldValue));
    }

    case "has_any": {
      const list = asStringArray(operand);
      if (list.length === 0) return true;
      const arr = fieldAsArray(fieldValue);
      return arr.some((v) => list.includes(v));
    }
    case "has_all": {
      const list = asStringArray(operand);
      if (list.length === 0) return true;
      const arr = fieldAsArray(fieldValue);
      return list.every((v) => arr.includes(v));
    }
    case "has_none": {
      const list = asStringArray(operand);
      if (list.length === 0) return true;
      const arr = fieldAsArray(fieldValue);
      return arr.every((v) => !list.includes(v));
    }

    case "before": {
      const fieldMs = parseDate(fieldValue);
      const operandMs = parseDate(operand as string);
      if (fieldMs == null || operandMs == null) return false;
      return fieldMs < operandMs;
    }
    case "after": {
      const fieldMs = parseDate(fieldValue);
      const operandMs = parseDate(operand as string);
      if (fieldMs == null || operandMs == null) return false;
      return fieldMs > operandMs;
    }
    case "between": {
      const fieldMs = parseDate(fieldValue);
      if (fieldMs == null) return false;
      const range = (operand ?? {}) as { from?: string; to?: string };
      const fromMs = range.from ? parseDate(range.from) : null;
      const toMs = range.to ? parseDate(range.to) : null;
      if (fromMs != null && fieldMs < fromMs) return false;
      if (toMs != null && fieldMs > toMs) return false;
      return fromMs != null || toMs != null;
    }
    case "last_n_days": {
      const fieldMs = parseDate(fieldValue);
      if (fieldMs == null) return false;
      const days = typeof operand === "object" && operand && "days" in operand
        ? Number((operand as { days: number }).days)
        : Number(operand);
      if (!Number.isFinite(days) || days <= 0) return true;
      const now = (ctx.now ?? new Date()).getTime();
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      return fieldMs >= cutoff && fieldMs <= now;
    }

    default:
      return true;
  }
}

export function applyFilters<T>(
  rows: readonly T[],
  predicates: readonly FilterPredicate[],
  ctx: FilterContext<T>,
): T[] {
  if (predicates.length === 0) return rows.slice();
  return rows.filter((row) =>
    predicates.every((predicate) => evaluatePredicate(row, predicate, ctx)),
  );
}
