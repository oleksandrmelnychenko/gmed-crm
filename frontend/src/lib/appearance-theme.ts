/** Versioned, portable palette. Only validated hex colours may become CSS values. */
export const DEFAULT_THEME_COLORS = {
  background: "#ebedf4",
  surface: "#ffffff",
  text: "#1a1a22",
  textMuted: "#4c5262",
  primary: "#161922",
  primaryText: "#f4f3f1",
  muted: "#f0f1f6",
  accent: "#e6e8f0",
  border: "#dfe2eb",
  inputBorder: "#d6dae5",
  field: "#ffffff",
  focus: "#777f9e",
  sidebar: "#f7f8fb",
  headingMarker: "#f97316",
  rowAlternate: "#f6f7f8",
  rowHover: "#eceef1",
  rowActive: "#e9ebef",
  rowSelected: "#e1e5eb",
} as const;

export type ThemeColor = keyof typeof DEFAULT_THEME_COLORS;
export type ThemeColors = Record<ThemeColor, string>;
export type AppearanceTheme = {
  version: 1;
  id: string;
  name: string;
  colors: ThemeColors;
};

export const DEFAULT_THEME: AppearanceTheme = {
  version: 1, id: "gmed-graphite", name: "GMED Graphite", colors: { ...DEFAULT_THEME_COLORS },
};

export const BUILTIN_THEMES: readonly AppearanceTheme[] = [DEFAULT_THEME, {
  // Each palette owns its action colour, accent and heading marker; field borders
  // keep at least 3:1 against white (WCAG 1.4.11).
  version: 1, id: "gmed-sage", name: "GMED Sage", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#e6eee8", primary: "#275e40", primaryText: "#ffffff",
    text: "#1b2a22", textMuted: "#45574c", muted: "#eff5f0", accent: "#d2e6d8",
    border: "#cddbd1", inputBorder: "#7c9584", focus: "#3a7a55", sidebar: "#f0f6f1", headingMarker: "#a16207",
    rowAlternate: "#f4f8f5", rowHover: "#e7f0ea", rowActive: "#dceadf", rowSelected: "#cde2d4",
  },
}, {
  version: 1, id: "gmed-ocean", name: "GMED Ocean", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#e4edf7", primary: "#1b5488", primaryText: "#ffffff",
    text: "#14283b", textMuted: "#40556a", muted: "#eef4fb", accent: "#d1e2f4",
    border: "#c9d8e8", inputBorder: "#7a91aa", focus: "#2b6cb0", sidebar: "#eff5fc", headingMarker: "#c2410c",
    rowAlternate: "#f3f7fc", rowHover: "#e5eef8", rowActive: "#d9e7f5", rowSelected: "#c9ddf2",
  },
}, {
  version: 1, id: "gmed-lagoon", name: "GMED Lagoon", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#e1f0ee", primary: "#0c605c", primaryText: "#ffffff",
    text: "#12302d", textMuted: "#3c5b57", muted: "#edf7f5", accent: "#cbe7e2",
    border: "#c2dbd7", inputBorder: "#759893", focus: "#147d76", sidebar: "#eef8f6", headingMarker: "#c2410c",
    rowAlternate: "#f2f9f8", rowHover: "#e3f1ee", rowActive: "#d6ebe7", rowSelected: "#c6e3de",
  },
}, {
  version: 1, id: "gmed-iris", name: "GMED Iris", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#ece8f8", primary: "#5b3fa0", primaryText: "#ffffff",
    text: "#2a2140", textMuted: "#564a6f", muted: "#f4f1fc", accent: "#e0d7f5",
    border: "#d9d0ee", inputBorder: "#8f82ad", focus: "#6a4cbd", sidebar: "#f6f3fd", headingMarker: "#be185d",
    rowAlternate: "#f8f6fd", rowHover: "#efeafa", rowActive: "#e6dff7", rowSelected: "#dcd2f3",
  },
}, {
  version: 1, id: "gmed-dune", name: "GMED Dune", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#f2eadf", primary: "#843c1b", primaryText: "#ffffff",
    text: "#2f261d", textMuted: "#5f503d", muted: "#f8f3ec", accent: "#efdcc8",
    border: "#e3d4c1", inputBorder: "#a28a72", focus: "#a9542a", sidebar: "#faf5ee", headingMarker: "#b45309",
    rowAlternate: "#fbf8f3", rowHover: "#f4ebe0", rowActive: "#eee1d1", rowSelected: "#e8d6c1",
  },
}, {
  version: 1, id: "gmed-rose", name: "GMED Rose", colors: {
    ...DEFAULT_THEME_COLORS,
    background: "#f6e8ee", primary: "#962d58", primaryText: "#ffffff",
    text: "#33202a", textMuted: "#664856", muted: "#fcf3f6", accent: "#f3d5e1",
    border: "#e9d1db", inputBorder: "#ab8798", focus: "#ab3766", sidebar: "#fdf3f7", headingMarker: "#c2410c",
    rowAlternate: "#fdf6f9", rowHover: "#f7e9ef", rowActive: "#f2dce6", rowSelected: "#eccfdc",
  },
}];

export const MAX_THEME_JSON_LENGTH = 16_384;
export const MAX_CUSTOM_THEMES = 30;
export type ThemeErrorCode = "invalid-json" | "invalid-theme" | "invalid-color" | "low-contrast" | "reserved-id" | "theme-limit";
export class ThemeValidationError extends Error {
  code: ThemeErrorCode;
  detail: string;
  constructor(code: ThemeErrorCode, detail = "") {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.code = code;
    this.detail = detail;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function parseAppearanceTheme(json: string): AppearanceTheme {
  if (json.length > MAX_THEME_JSON_LENGTH) throw new ThemeValidationError("invalid-theme");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ThemeValidationError("invalid-json"); }
  if (!isObject(value) || value.version !== 1 || typeof value.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(value.id) || typeof value.name !== "string" ||
    !value.name.trim() || value.name.length > 64 || !isObject(value.colors) ||
    Object.keys(value).some((key) => !["version", "id", "name", "colors"].includes(key))) {
    throw new ThemeValidationError("invalid-theme");
  }
  const colors: ThemeColors = { ...DEFAULT_THEME_COLORS };
  for (const [key, color] of Object.entries(value.colors)) {
    if (!Object.hasOwn(DEFAULT_THEME_COLORS, key) || typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
      throw new ThemeValidationError("invalid-color", key);
    }
    colors[key as ThemeColor] = color.toLowerCase();
  }
  // The palette is currently light-only. Semantic status chips keep their own colours.
  // Validate the backgrounds on which normal/secondary UI text actually appears.
  for (const foreground of ["text", "textMuted"] as const) {
    for (const background of ["background", "surface", "muted", "accent", "field", "sidebar", "rowAlternate", "rowHover", "rowActive", "rowSelected"] as const) {
      if (contrastRatio(colors[foreground], colors[background]) < 4.5) {
        throw new ThemeValidationError("low-contrast", `${foreground} / ${background}`);
      }
    }
  }
  if (contrastRatio(colors.primaryText, colors.primary) < 4.5) throw new ThemeValidationError("low-contrast", "primaryText / primary");
  for (const background of ["background", "surface", "field", "sidebar"] as const) {
    if (contrastRatio(colors.focus, colors[background]) < 3) throw new ThemeValidationError("low-contrast", `focus / ${background} (3:1)`);
  }
  // Fixed semantic status styles and existing light controls require light surfaces.
  if (luminance(colors.surface) < 0.5 || luminance(colors.background) < 0.5) throw new ThemeValidationError("invalid-theme");
  return { version: 1, id: value.id, name: value.name.trim(), colors };
}

export function themeCssVariables(theme: AppearanceTheme): Record<string, string> {
  const c = theme.colors;
  return {
    "--background": c.background, "--foreground": c.text,
    "--card": c.surface, "--card-foreground": c.text,
    "--popover": c.surface, "--popover-foreground": c.text,
    "--field": c.field, "--primary": c.primary, "--primary-foreground": c.primaryText,
    "--brand": c.primary, "--brand-soft": c.accent, "--brand-ring": c.focus,
    "--muted": c.muted, "--muted-foreground": c.textMuted,
    "--secondary": c.muted, "--secondary-foreground": c.text,
    "--accent": c.accent, "--accent-foreground": c.text,
    "--border": c.border, "--input": c.inputBorder, "--ring": c.focus,
    "--sidebar": c.sidebar, "--sidebar-foreground": c.text,
    "--sidebar-primary": c.primary, "--sidebar-primary-foreground": c.primaryText,
    "--sidebar-accent": c.accent, "--sidebar-accent-foreground": c.text,
    "--sidebar-border": c.border, "--sidebar-ring": c.focus,
    "--heading-marker": c.headingMarker,
    "--table-row-alternate": c.rowAlternate, "--table-row-hover": c.rowHover,
    "--table-row-active": c.rowActive, "--table-row-selected": c.rowSelected,
  };
}

export type AppearancePreferences = { selectedId: string; themes: AppearanceTheme[] };
export const EMPTY_APPEARANCE: AppearancePreferences = { selectedId: DEFAULT_THEME.id, themes: [] };
export const appearanceStorageKey = (userId: string) => `gmed.appearance.v1.${encodeURIComponent(userId)}`;

export function parseAppearancePreferences(raw: string | null): AppearancePreferences {
  if (!raw || raw.length > MAX_THEME_JSON_LENGTH * (MAX_CUSTOM_THEMES + 1)) return EMPTY_APPEARANCE;
  try {
    const stored: unknown = JSON.parse(raw);
    if (!isObject(stored) || !Array.isArray(stored.themes) || stored.themes.length > MAX_CUSTOM_THEMES) return EMPTY_APPEARANCE;
    const themes: AppearanceTheme[] = [];
    for (const entry of stored.themes) {
      try {
        const theme = parseAppearanceTheme(JSON.stringify(entry));
        if (!BUILTIN_THEMES.some((item) => item.id === theme.id) && !themes.some((item) => item.id === theme.id)) themes.push(theme);
      } catch { /* Ignore a damaged palette without losing other saved themes. */ }
    }
    const selectedId = [...BUILTIN_THEMES, ...themes].some((item) => item.id === stored.selectedId) ? String(stored.selectedId) : DEFAULT_THEME.id;
    return { selectedId, themes };
  } catch { return EMPTY_APPEARANCE; }
}

export function addAppearanceTheme(preferences: AppearancePreferences, theme: AppearanceTheme): AppearancePreferences {
  if (BUILTIN_THEMES.some((item) => item.id === theme.id)) throw new ThemeValidationError("reserved-id");
  const others = preferences.themes.filter((item) => item.id !== theme.id);
  if (others.length >= MAX_CUSTOM_THEMES) throw new ThemeValidationError("theme-limit");
  return { selectedId: theme.id, themes: [...others, theme] };
}
