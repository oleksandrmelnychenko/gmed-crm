import { createContext, useContext } from "react";

/**
 * The few words of the pickers themselves (search field, no match, remove a
 * chip). They come from the portal language (DE / RU) unless a page speaks a
 * language of its own: the lead cabinet and the payer's page also speak UA
 * and EN (live check 2026-10-24: an English cabinet showed "Поиск...").
 */
export type ComboboxText = { search: string; empty: string; remove: string };

export const ComboboxTextContext = createContext<ComboboxText | null>(null);

export function useComboboxText(): ComboboxText | null {
  return useContext(ComboboxTextContext);
}

const TEXT: Record<"de" | "ru" | "uk" | "en", ComboboxText> = {
  de: { search: "Suchen...", empty: "Keine Ergebnisse", remove: "Entfernen" },
  ru: { search: "Поиск...", empty: "Нет результатов", remove: "Удалить" },
  uk: { search: "Пошук...", empty: "Немає результатів", remove: "Видалити" },
  en: { search: "Search...", empty: "No results", remove: "Remove" },
};

export function comboboxTextFor(lang: "de" | "ru" | "uk" | "en"): ComboboxText {
  return TEXT[lang];
}
