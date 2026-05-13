import {
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";
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

const ALL_FILTER_OPERATORS: readonly FilterOperator[] = [
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

const FILTER_OPERATOR_LABEL_KEYS = {
  contains: "filter_op_contains",
  does_not_contain: "filter_op_does_not_contain",
  is_empty: "filter_op_is_empty",
  is_not_empty: "filter_op_is_not_empty",
  is: "filter_op_is",
  is_not: "filter_op_is_not",
  is_any_of: "filter_op_is_any_of",
  is_none_of: "filter_op_is_none_of",
  has_any: "filter_op_has_any",
  has_all: "filter_op_has_all",
  has_none: "filter_op_has_none",
  before: "filter_op_before",
  after: "filter_op_after",
  between: "filter_op_between",
  last_n_days: "filter_op_last_n_days",
  equals: "filter_op_equals",
} satisfies Record<FilterOperator, TranslationKey>;

function defaultOperatorLabel(operator: FilterOperator): string {
  const translations = translateCatalog(getLang());
  return translations[FILTER_OPERATOR_LABEL_KEYS[operator]];
}

export const DEFAULT_OPERATOR_LABELS = Object.fromEntries(
  ALL_FILTER_OPERATORS.map((operator) => [
    operator,
    defaultOperatorLabel(operator),
  ]),
) as Record<FilterOperator, string>;

export function labelForOperator(
  operator: FilterOperator,
  overrides?: FilterOperatorLabels,
): string {
  return overrides?.[operator] ?? defaultOperatorLabel(operator);
}
