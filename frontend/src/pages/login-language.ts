import type { Lang } from "@/lib/i18n";

export function resolveRequestedLoginLanguage(value: string | null): Lang | null {
  if (!value) return null;
  return value.trim().toLowerCase() === "ru" ? "ru" : "de";
}
