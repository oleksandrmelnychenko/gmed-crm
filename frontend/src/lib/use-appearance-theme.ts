import { useCallback, useMemo, useSyncExternalStore } from "react";
import { appearanceStorageKey, BUILTIN_THEMES, DEFAULT_THEME, parseAppearancePreferences, type AppearancePreferences } from "./appearance-theme";

const CHANGE_EVENT = "gmed-appearance-change";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
const serverSnapshot = () => null;

export function useAppearanceTheme(userId: string | null) {
  const key = userId ? appearanceStorageKey(userId) : null;
  const snapshot = useCallback(() => {
    try { return key ? window.localStorage.getItem(key) : null; } catch { return null; }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const preferences = useMemo(() => parseAppearancePreferences(raw), [raw]);
  const themes = useMemo(() => [...BUILTIN_THEMES, ...preferences.themes], [preferences]);
  const theme = themes.find((item) => item.id === preferences.selectedId) ?? DEFAULT_THEME;
  const save = useCallback((next: AppearancePreferences) => {
    if (!key) throw new Error("Account required");
    // Do not pretend to save when the browser denies storage or reaches its quota.
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [key]);
  const contrast = preferences.contrast ?? "standard";
  const controls = preferences.controls;
  return { theme, themes, preferences, contrast, controls, save };
}
