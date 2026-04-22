import type {
  LinkedPreviewPayload,
  LinkedPreviewRecord,
} from "@/pages/appointments/model/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeLinkedPreviewPayload(
  payload: unknown,
): LinkedPreviewPayload | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }
  return payload;
}

export function linkedPreviewText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => linkedPreviewText(item)).join(", ");
  }
  return JSON.stringify(value);
}

export function readLinkedPreviewValue(
  record: LinkedPreviewRecord,
  keys: string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return linkedPreviewText(value);
    }
  }
  return "—";
}
