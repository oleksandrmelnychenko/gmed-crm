import { hasFormChanges } from "@/lib/form-changes";

/** Refresh untouched fields while keeping edits made since the previous server snapshot. */
export function mergeOrderDraft<T extends object>(draft: T, previous: T, incoming: T): T {
  const result = { ...incoming };
  for (const key of Object.keys(incoming) as Array<keyof T>) {
    // Notes are trimmed when submitted. Accept the acknowledged server value.
    if (typeof draft[key] === "string" && typeof incoming[key] === "string"
      && draft[key].trim() === incoming[key].trim()) continue;
    if (hasFormChanges(draft[key], previous[key])) result[key] = draft[key];
  }
  return result;
}
