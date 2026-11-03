import { describe, expect, it } from "vitest";
import {
  addAppearanceTheme, appearanceStorageKey, BUILTIN_THEMES, contrastRatio, DEFAULT_THEME, DEFAULT_THEME_COLORS, withContrast, withControls,
  EMPTY_APPEARANCE, MAX_CUSTOM_THEMES, MAX_THEME_JSON_LENGTH, parseAppearancePreferences,
  parseAppearanceTheme, themeCssVariables,
} from "./appearance-theme";

const custom = { version: 1, id: "my-blue", name: "My Blue", colors: { headingMarker: "#2563EB" } };

describe("portable appearance themes", () => {
  it.each(BUILTIN_THEMES)("validates the built-in $name palette", (theme) => {
    expect(parseAppearanceTheme(JSON.stringify(theme))).toEqual(theme);
  });

  it.each(BUILTIN_THEMES.filter((theme) => theme.id !== DEFAULT_THEME.id))("gives $name readable field borders and its own action colour", (theme) => {
    const c = theme.colors;
    expect(contrastRatio(c.inputBorder, c.field)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.headingMarker, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.primary, c.background)).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_THEMES.filter((other) => other.colors.primary === c.primary)).toHaveLength(1);
  });

  it("fills omitted tokens from Graphite and keeps heading dots independent from dark buttons", () => {
    const theme = parseAppearanceTheme(JSON.stringify(custom));
    expect(theme.colors.headingMarker).toBe("#2563eb");
    expect(theme.colors.primary).toBe(DEFAULT_THEME_COLORS.primary);
    const css = themeCssVariables(theme);
    expect(css["--heading-marker"]).toBe("#2563eb");
    expect(css["--primary"]).toBe(DEFAULT_THEME_COLORS.primary);
    expect(css["--popover"]).toBe(theme.colors.surface);
    expect(css["--sidebar-accent"]).toBe(theme.colors.accent);
    expect(css["--table-row-selected"]).toBe(theme.colors.rowSelected);
  });

  it.each([
    "not json", "null", "[]", JSON.stringify({ ...custom, version: 2 }),
    JSON.stringify({ ...custom, id: "bad id" }), JSON.stringify({ ...custom, name: " " }),
    JSON.stringify({ ...custom, css: "body {display:none}" }),
    JSON.stringify({ ...custom, colors: { background: "url(https://example.com)" } }),
    JSON.stringify({ ...custom, colors: { unknown: "#ffffff" } }),
    JSON.stringify({ ...custom, colors: { background: "#fff" } }),
    JSON.stringify({ ...custom, colors: { text: "#ffffff" } }),
    JSON.stringify({ ...custom, colors: { primary: "#ffffff" } }),
    JSON.stringify({ ...custom, colors: { rowSelected: "#333333" } }),
    JSON.stringify({ ...custom, colors: { focus: "#ffffff" } }),
    `{"version":1,"id":"custom","name":"Custom","colors":{"__proto__":"#ffffff"}}`,
    " ".repeat(MAX_THEME_JSON_LENGTH + 1),
  ])("rejects malformed, executable, unknown or unreadable input %#", (input) => {
    expect(() => parseAppearanceTheme(input)).toThrow();
  });

  it("round-trips an exported custom palette", () => {
    const parsed = parseAppearanceTheme(JSON.stringify(custom));
    expect(parseAppearanceTheme(JSON.stringify(parsed))).toEqual(parsed);
  });
});

describe("appearance preferences", () => {
  it("isolates users and safely encodes their keys", () => {
    expect(appearanceStorageKey("first")).not.toBe(appearanceStorageKey("second"));
    expect(appearanceStorageKey("user/a")).toBe("gmed.appearance.v1.user%2Fa");
  });

  it("recovers corrupt storage and a deleted selection", () => {
    expect(parseAppearancePreferences("invalid")).toEqual(EMPTY_APPEARANCE);
    expect(parseAppearancePreferences(JSON.stringify({ selectedId: "missing", themes: [] }))).toEqual(EMPTY_APPEARANCE);
  });

  it("retains valid custom palettes while discarding corrupt and reserved entries", () => {
    const theme = parseAppearanceTheme(JSON.stringify(custom));
    const stored = { selectedId: theme.id, themes: [null, DEFAULT_THEME, theme, theme] };
    expect(parseAppearancePreferences(JSON.stringify(stored))).toEqual({ selectedId: theme.id, themes: [theme] });
  });

  it("updates a custom ID rather than creating duplicates and protects built-ins", () => {
    const theme = parseAppearanceTheme(JSON.stringify(custom));
    const added = addAppearanceTheme(EMPTY_APPEARANCE, theme);
    expect(addAppearanceTheme(added, { ...theme, name: "Updated" }).themes).toHaveLength(1);
    expect(() => addAppearanceTheme(added, DEFAULT_THEME)).toThrow("reserved-id");
  });

  it("caps saved palettes but allows editing an existing one at the limit", () => {
    const themes = Array.from({ length: MAX_CUSTOM_THEMES }, (_, index) => ({ ...DEFAULT_THEME, id: `custom-${index}` }));
    const full = { selectedId: themes[0].id, themes };
    expect(() => addAppearanceTheme(full, { ...DEFAULT_THEME, id: "extra" })).toThrow("theme-limit");
    expect(addAppearanceTheme(full, themes[0]).themes).toHaveLength(MAX_CUSTOM_THEMES);
  });
});

describe("contrast levels apart from the theme", () => {
  it.each(BUILTIN_THEMES)("soften $name step by step and keep text readable", (theme) => {
    const soft = withContrast(theme, "soft"), softer = withContrast(theme, "softer");
    expect(withContrast(theme, "standard")).toBe(theme);
    // The validator keeps text and secondary text at 4.5:1 and focus at 3:1.
    for (const variant of [soft, softer]) expect(parseAppearanceTheme(JSON.stringify(variant))).toEqual(variant);
    for (const key of ["inputBorder", "border"] as const) {
      const ratios = [theme, soft, softer].map((item) => contrastRatio(item.colors[key], item.colors.surface));
      expect(ratios[1]).toBeLessThan(ratios[0]);
      expect(ratios[2]).toBeLessThan(ratios[1]);
    }
    expect(contrastRatio(softer.colors.text, softer.colors.surface)).toBeLessThanOrEqual(contrastRatio(theme.colors.text, theme.colors.surface));
    expect(softer.colors.primary).toBe(theme.colors.primary);
  });

  it("stores the level with the theme choice and ignores unknown levels", () => {
    expect(parseAppearancePreferences(JSON.stringify({ selectedId: DEFAULT_THEME.id, themes: [], contrast: "softer" })).contrast).toBe("softer");
    expect(parseAppearancePreferences(JSON.stringify({ selectedId: DEFAULT_THEME.id, themes: [], contrast: "high" }))).toEqual(EMPTY_APPEARANCE);
    const theme = parseAppearanceTheme(JSON.stringify(custom));
    expect(addAppearanceTheme({ ...EMPTY_APPEARANCE, contrast: "soft" }, theme).contrast).toBe("soft");
  });
});

describe("own control colours", () => {
  it("accepts control colours in theme JSON and falls back when they are absent", () => {
    const withControlKeys = parseAppearanceTheme(JSON.stringify({ ...custom, colors: { placeholder: "#6B7280", dropdown: "#FAFAFA", dropdownHighlight: "#EEF2FF" } }));
    expect(withControlKeys.colors.placeholder).toBe("#6b7280");
    const css = themeCssVariables(withControlKeys);
    expect(css["--control-placeholder"]).toBe("#6b7280");
    expect(css["--control-popover"]).toBe("#fafafa");
    expect(css["--control-highlight"]).toBe("#eef2ff");
    const fallback = themeCssVariables(DEFAULT_THEME);
    expect(fallback["--control-placeholder"]).toBe(DEFAULT_THEME.colors.textMuted);
    expect(fallback["--control-popover"]).toBe(DEFAULT_THEME.colors.surface);
    expect(fallback["--control-highlight"]).toBe(DEFAULT_THEME.colors.accent);
    expect(() => parseAppearanceTheme(JSON.stringify({ ...custom, colors: { dropdown: "red" } }))).toThrow("invalid-color");
  });

  it("stores valid control colours, drops broken ones and lets them win over the theme", () => {
    const stored = { selectedId: DEFAULT_THEME.id, themes: [], controls: { inputBorder: "#112233", placeholder: "url(x)", text: "#000000", css: "#ffffff" } };
    const preferences = parseAppearancePreferences(JSON.stringify(stored));
    expect(preferences.controls).toEqual({ inputBorder: "#112233", text: "#000000" });
    expect(withControls(DEFAULT_THEME, preferences.controls).colors.inputBorder).toBe("#112233");
    expect(withControls(DEFAULT_THEME, undefined)).toBe(DEFAULT_THEME);
    expect(parseAppearancePreferences(JSON.stringify({ ...stored, controls: { focus: "nope" } }))).toEqual(EMPTY_APPEARANCE);
  });

  it("sets section dots and counters only when a colour is given", () => {
    expect(themeCssVariables(DEFAULT_THEME)).not.toHaveProperty("--dot");
    const css = themeCssVariables(withControls(DEFAULT_THEME, { dot: "#16a34a", badge: "#dc2626", badgeText: "#ffffff" }));
    expect(css["--dot"]).toBe("#16a34a");
    expect(css["--badge"]).toBe("#dc2626");
    expect(css["--badge-foreground"]).toBe("#ffffff");
    expect(parseAppearanceTheme(JSON.stringify({ ...custom, colors: { dot: "#16A34A", badge: "#DC2626" } })).colors.dot).toBe("#16a34a");
  });
});
