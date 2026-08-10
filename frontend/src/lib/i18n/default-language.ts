import type { Lang } from "@/lib/i18n";

export function resolveDefaultLanguage(value: string | undefined): Lang {
  return value === "de" ? "de" : "ru";
}
