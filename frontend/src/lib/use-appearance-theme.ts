import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { appearanceStorageKey, BUILTIN_THEMES, DEFAULT_THEME, parseAppearancePreferences, type AppearancePreferences } from "./appearance-theme";

type Update = (current: AppearancePreferences) => AppearancePreferences;
const Context = createContext<{ preferences: AppearancePreferences; save: (update: Update) => Promise<void> } | null>(null);

function cached(key: string | null) {
  try { return key ? localStorage.getItem(key) : null; } catch { return null; }
}

// Mounted with the account id as the React key, above the patient-specific shell.
export function AppearanceProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const key = userId ? appearanceStorageKey(userId) : null;
  const [preferences, setPreferences] = useState(() => parseAppearancePreferences(cached(key)));
  const writer = useRef<((update: Update) => Promise<void>) | null>(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const { signal } = controller;
    let current = parseAppearancePreferences(cached(key));
    let initialized = false;
    const publish = (value: AppearancePreferences | null) => {
      signal.throwIfAborted();
      current = parseAppearancePreferences(JSON.stringify(value));
      setPreferences(current);
      try { if (value !== null) localStorage.setItem(key, JSON.stringify(current)); } catch { /* Cache is optional. */ }
    };
    const load = async () => {
      let value = await apiFetch<AppearancePreferences | null>("/me/appearance", { signal, cache: "no-store" });
      const legacy = cached(key);
      if (value === null && legacy) {
        signal.throwIfAborted();
        value = await apiFetch<AppearancePreferences>("/me/appearance?initialize=true", {
          method: "PUT", body: JSON.stringify(parseAppearancePreferences(legacy)), signal,
        });
      }
      publish(value);
      initialized = true;
    };
    let queue = load().catch(() => { /* Keep the cached palette; retry on the next edit. */ });
    writer.current = (update) => {
      const write = queue.then(async () => {
        signal.throwIfAborted();
        if (!initialized) await load();
        const next = update(current);
        publish(await apiFetch<AppearancePreferences>("/me/appearance", {
          method: "PUT", signal, body: JSON.stringify(next),
        }));
      });
      queue = write.catch(() => {});
      return write;
    };
    const sync = (event: StorageEvent) => {
      if (event.key === key && event.newValue) {
        current = parseAppearancePreferences(event.newValue);
        setPreferences(current);
      }
    };
    window.addEventListener("storage", sync);
    return () => { controller.abort(); writer.current = null; window.removeEventListener("storage", sync); };
  }, [key]);
  const save = useCallback((update: Update) => writer.current?.(update) ?? Promise.reject(new Error("Account required")), []);
  return createElement(Context.Provider, { value: { preferences, save } }, children);
}

export function useAppearanceTheme() {
  const context = useContext(Context);
  if (!context) throw new Error("AppearanceProvider required");
  const { preferences, save } = context;
  const themes = useMemo(() => [...BUILTIN_THEMES, ...preferences.themes], [preferences.themes]);
  const theme = themes.find((item) => item.id === preferences.selectedId) ?? DEFAULT_THEME;
  return { theme, themes, preferences, contrast: preferences.contrast ?? "standard", controls: preferences.controls, save };
}
