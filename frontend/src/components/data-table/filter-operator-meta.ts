import type {
  FilterFieldType,
  FilterOperator,
  FilterValue,
} from "./types";

export const OPERATORS_BY_FIELD_TYPE: Record<FilterFieldType, readonly FilterOperator[]> = {
  text: ["contains", "does_not_contain", "is", "is_not", "is_empty", "is_not_empty"],
  enum: ["is", "is_not", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_enum: ["is_any_of", "is_none_of", "has_any", "has_all", "has_none", "is_empty", "is_not_empty"],
  tag_array: ["has_any", "has_all", "has_none", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "between", "last_n_days", "is_empty", "is_not_empty"],
  boolean: ["is"],
  number: ["equals", "before", "after", "between"],
};

const EMPTY_OPS: ReadonlySet<FilterOperator> = new Set(["is_empty", "is_not_empty"]);
const ARRAY_OPS: ReadonlySet<FilterOperator> = new Set([
  "is_any_of",
  "is_none_of",
  "has_any",
  "has_all",
  "has_none",
]);
const DATE_SINGLE_OPS: ReadonlySet<FilterOperator> = new Set(["is", "before", "after"]);
const DATE_RANGE_OPS: ReadonlySet<FilterOperator> = new Set(["between"]);
const DAYS_OPS: ReadonlySet<FilterOperator> = new Set(["last_n_days"]);
const BOOL_OPS: ReadonlySet<FilterOperator> = new Set(["is", "is_not"]);

export function operatorTakesValue(operator: FilterOperator): boolean {
  return !EMPTY_OPS.has(operator);
}

export function operatorExpectsArray(operator: FilterOperator): boolean {
  return ARRAY_OPS.has(operator);
}

export function operatorExpectsDateRange(operator: FilterOperator): boolean {
  return DATE_RANGE_OPS.has(operator);
}

export function operatorExpectsSingleDate(operator: FilterOperator): boolean {
  return DATE_SINGLE_OPS.has(operator);
}

export function operatorExpectsDays(operator: FilterOperator): boolean {
  return DAYS_OPS.has(operator);
}

export function defaultOperatorForFieldType(type: FilterFieldType): FilterOperator {
  return OPERATORS_BY_FIELD_TYPE[type][0];
}

export function defaultValueForOperator(
  operator: FilterOperator,
  type: FilterFieldType,
): FilterValue {
  if (EMPTY_OPS.has(operator)) return null;
  if (ARRAY_OPS.has(operator)) return [];
  if (DATE_RANGE_OPS.has(operator)) return { from: undefined, to: undefined };
  if (DAYS_OPS.has(operator)) return { days: 7 };
  if (type === "boolean") return true;
  return "";
}

export type FilterOperatorLabels = Partial<Record<FilterOperator, string>>;

export const DEFAULT_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  does_not_contain: "does not contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  is: "is",
  is_not: "is not",
  is_any_of: "is any of",
  is_none_of: "is none of",
  has_any: "has any of",
  has_all: "has all of",
  has_none: "has none of",
  before: "before",
  after: "after",
  between: "between",
  last_n_days: "last N days",
  equals: "equals",
};

export function labelForOperator(
  operator: FilterOperator,
  overrides?: FilterOperatorLabels,
): string {
  return overrides?.[operator] ?? DEFAULT_OPERATOR_LABELS[operator];
}

export { ARRAY_OPS, BOOL_OPS };
