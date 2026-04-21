import type { SortDir, SortKey, SortStack } from "./types";

export type FieldAccessor<T> = (row: T) => unknown;

export type SortContext<T> = {
  accessors: Record<string, FieldAccessor<T>>;
  locale?: string;
};

const DEFAULT_LOCALE = undefined;

export const MAX_SORT_STACK = 3;

function isNullish(v: unknown): v is null | undefined {
  return v == null;
}

function compareNonNullValues(a: unknown, b: unknown, locale?: string): number {
  if (typeof a === "number" && typeof b === "number") {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  if (a instanceof Date || b instanceof Date) {
    const am = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const bm = b instanceof Date ? b.getTime() : Date.parse(String(b));
    if (Number.isFinite(am) && Number.isFinite(bm)) return am - bm;
  }
  return String(a).localeCompare(String(b), locale ?? DEFAULT_LOCALE, {
    numeric: true,
    sensitivity: "base",
  });
}

function applyDir(cmp: number, dir: SortDir): number {
  return dir === "desc" ? -cmp : cmp;
}

export function compareRows<T>(
  a: T,
  b: T,
  stack: readonly SortKey[],
  ctx: SortContext<T>,
): number {
  for (const { field, dir } of stack) {
    const accessor = ctx.accessors[field];
    if (!accessor) continue;
    const aval = accessor(a);
    const bval = accessor(b);
    const aNull = isNullish(aval);
    const bNull = isNullish(bval);
    if (aNull && bNull) continue;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = compareNonNullValues(aval, bval, ctx.locale);
    if (cmp !== 0) return applyDir(cmp, dir);
  }
  return 0;
}

export function applySort<T>(
  rows: readonly T[],
  stack: readonly SortKey[],
  ctx: SortContext<T>,
): T[] {
  if (stack.length === 0) return rows.slice();
  return rows.slice().sort((a, b) => compareRows(a, b, stack, ctx));
}

export function toggleSort(stack: SortStack, field: string, opts?: { multi?: boolean }): SortStack {
  const existingIdx = stack.findIndex((s) => s.field === field);

  if (!opts?.multi) {
    if (existingIdx === -1) return [{ field, dir: "asc" }];
    const existing = stack[existingIdx];
    if (existing.dir === "asc") return [{ field, dir: "desc" }];
    return [];
  }

  if (existingIdx === -1) {
    if (stack.length >= MAX_SORT_STACK) return stack;
    return [...stack, { field, dir: "asc" }];
  }

  const next = stack.slice();
  const existing = next[existingIdx];
  if (existing.dir === "asc") {
    next[existingIdx] = { field, dir: "desc" };
    return next;
  }
  next.splice(existingIdx, 1);
  return next;
}
