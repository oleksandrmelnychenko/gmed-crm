import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readStoredLeadCabinetLang, storeLeadCabinetLang } from "./lead-cabinet-language";

/** The cabinet language is remembered per login, never for the next person in the browser (QA 2026-10-25, G F-G5). */
describe("the remembered cabinet language", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps one login's choice away from another login", () => {
    storeLeadCabinetLang("hans", "de");
    expect(readStoredLeadCabinetLang("hans")).toBe("de");
    expect(readStoredLeadCabinetLang("olena")).toBeNull();
    storeLeadCabinetLang("olena", "uk");
    expect(readStoredLeadCabinetLang("olena")).toBe("uk");
    expect(readStoredLeadCabinetLang("hans")).toBe("de");
  });

  it("no longer reads the browser-wide choice of the first version, and drops it", () => {
    store.set("gmed_lead_cabinet_lang", "de");
    expect(readStoredLeadCabinetLang("john")).toBeNull();
    storeLeadCabinetLang("john", "en");
    expect(store.has("gmed_lead_cabinet_lang")).toBe(false);
  });

  it("remembers nothing without a login", () => {
    storeLeadCabinetLang(null, "en");
    expect(store.size).toBe(0);
    expect(readStoredLeadCabinetLang(undefined)).toBeNull();
  });
});
