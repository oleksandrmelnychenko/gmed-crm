import type { ReactNode } from "react";

export type FilterFieldType =
  | "text"
  | "enum"
  | "multi_enum"
  | "tag_array"
  | "date"
  | "boolean"
  | "number";

export type FilterOperator =
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty"
  | "is"
  | "is_not"
  | "is_any_of"
  | "is_none_of"
  | "has_any"
  | "has_all"
  | "has_none"
  | "before"
  | "after"
  | "between"
  | "last_n_days"
  | "equals";

export type FilterValue =
  | string
  | string[]
  | { from?: string; to?: string }
  | { days: number }
  | boolean
  | number
  | null;

export type FilterPredicate = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: FilterValue;
};

type FilterState = FilterPredicate[];

export type SortDir = "asc" | "desc";

export type SortKey = {
  field: string;
  dir: SortDir;
};

export type SortStack = SortKey[];

export type DensityLevel = "comfortable" | "compact" | "condensed";

export type ViewMode = "split" | "overlay";

export type FilterOption = {
  value: string;
  label: string;
};

export type ColumnDef<T> = {
  id: string;
  label: string;
  accessor: (row: T) => unknown;
  filterType?: FilterFieldType;
  filterOptions?: FilterOption[] | ((rows: readonly T[]) => FilterOption[]);
  sortable?: boolean;
  searchable?: boolean;
  defaultVisible?: boolean;
  required?: boolean;
  pinned?: "left" | "right";
  width?: number;
  group?: string;
  render?: (row: T) => ReactNode;
  headerRender?: () => ReactNode;
  ariaLabel?: string;
};

export type DataTableState = {
  filters: FilterState;
  sort: SortStack;
  search: string;
  hiddenColumns: string[];
  density: DensityLevel;
  selectedIds: string[];
};
