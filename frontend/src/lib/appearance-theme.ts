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
  inputBorder: "#868c9e",
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
  // Graphite's calm neutral surfaces with GMED orange actions (owner 2026-11-03: two light
  // themes, no tinted floods). #c2410c keeps white button text at 5.2:1; #f97316 would be 2.8:1.
  version: 1, id: "gmed-orange", name: "GMED Orange", colors: {
    ...DEFAULT_THEME_COLORS,
    // Lighter than Graphite's surfaces (owner 2026-11-03: "трошки освітлити").
    background: "#f3f4f8", muted: "#f5f6f9", accent: "#eceef4", border: "#e6e8ee", sidebar: "#fafbfc",
    rowAlternate: "#f9fafb", rowHover: "#f1f2f6", rowActive: "#eceef3", rowSelected: "#e5e8ef",
    primary: "#c2410c", primaryText: "#ffffff", focus: "#ea580c", headingMarker: "#ea580c",
  },
}, {
  // Warm ivory surfaces with clay actions (owner 2026-11-03: a calm developer-tool look).
  version: 1, id: "gmed-clay", name: "GMED Clay", colors: {
    background: "#f6f4ee", surface: "#fdfcf9", text: "#1f1e1d", textMuted: "#5c5a53",
    primary: "#b4532f", primaryText: "#ffffff", muted: "#f6f4ee", accent: "#f0ece2",
    border: "#ebe7dc", inputBorder: "#918c7c", field: "#ffffff", focus: "#b4532f", sidebar: "#faf9f5",
    headingMarker: "#c15f3c", rowAlternate: "#fbfaf6", rowHover: "#f4f1e9", rowActive: "#f0ece2", rowSelected: "#ebe5d7",
  },
}, {
  // Pure neutral greys, black actions and a single blue for focus and heading dots.
  version: 1, id: "gmed-ink", name: "GMED Ink", colors: {
    background: "#f7f7f7", surface: "#ffffff", text: "#0d0d0d", textMuted: "#5d5d5d",
    primary: "#0d0d0d", primaryText: "#ffffff", muted: "#f7f7f7", accent: "#f0f0f0",
    border: "#ebebeb", inputBorder: "#8f8f8f", field: "#ffffff", focus: "#2563eb", sidebar: "#fcfcfc",
    headingMarker: "#2563eb", rowAlternate: "#fcfcfc", rowHover: "#f5f5f5", rowActive: "#f0f0f0", rowSelected: "#ebebeb",
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

/** Backgrounds on which normal and secondary UI text appears. */
const TEXT_BACKGROUNDS = ["background", "surface", "muted", "accent", "field", "sidebar", "rowAlternate", "rowHover", "rowActive", "rowSelected"] as const;

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
    for (const background of TEXT_BACKGROUNDS) {
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

/** Contrast is chosen apart from the theme and applies on top of any palette. */
export const CONTRAST_LEVELS = ["standard", "soft", "softer"] as const;
export type ContrastLevel = (typeof CONTRAST_LEVELS)[number];
const isContrastLevel = (value: unknown): value is ContrastLevel => CONTRAST_LEVELS.includes(value as ContrastLevel);

function mixHex(first: string, second: string, weight: number): string {
  return `#${[1, 3, 5].map((offset) => Math.round(
    parseInt(first.slice(offset, offset + 2), 16) * weight + parseInt(second.slice(offset, offset + 2), 16) * (1 - weight),
  ).toString(16).padStart(2, "0")).join("")}`;
}

/** Moves `color` towards `toward` by up to `amount`, stopping where it would drop below `floor` on any background. */
function soften(color: string, toward: string, amount: number, floor: number, backgrounds: readonly string[]): string {
  for (let step = amount; step > 0; step -= 0.01) {
    const candidate = mixHex(toward, color, step);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= floor)) return candidate;
  }
  return color;
}

/**
 * Softer levels lower contrast for eyes that find the standard palette harsh (owner 2026-11-03):
 * text, borders, focus and row states move towards the surface. Text never drops below
 * WCAG AA (4.5:1) and focus below 3:1; borders and row tints may go lighter.
 */
export function withContrast(theme: AppearanceTheme, level: ContrastLevel): AppearanceTheme {
  if (level === "standard") return theme;
  const c = theme.colors;
  const softer = level === "softer";
  const backgrounds = TEXT_BACKGROUNDS.map((key) => c[key]);
  const towardSurface = (color: string, amount: number) => mixHex(c.surface, color, amount);
  return {
    ...theme,
    colors: {
      ...c,
      text: soften(c.text, c.surface, softer ? 0.3 : 0.15, 7, backgrounds),
      textMuted: soften(c.textMuted, c.surface, softer ? 0.3 : 0.15, 4.5, backgrounds),
      border: towardSurface(c.border, softer ? 0.6 : 0.35),
      inputBorder: towardSurface(c.inputBorder, softer ? 0.45 : 0.25),
      focus: soften(c.focus, c.surface, softer ? 0.3 : 0.15, 3, [c.background, c.surface, c.field, c.sidebar]),
      accent: towardSurface(c.accent, softer ? 0.5 : 0.25),
      rowHover: towardSurface(c.rowHover, softer ? 0.5 : 0.25),
      rowActive: towardSurface(c.rowActive, softer ? 0.5 : 0.25),
      rowSelected: towardSurface(c.rowSelected, softer ? 0.45 : 0.2),
    },
  };
}

export type AppearancePreferences = { selectedId: string; themes: AppearanceTheme[]; contrast?: ContrastLevel };
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
    const contrast = isContrastLevel(stored.contrast) && stored.contrast !== "standard" ? { contrast: stored.contrast } : {};
    return { selectedId, themes, ...contrast };
  } catch { return EMPTY_APPEARANCE; }
}

export function addAppearanceTheme(preferences: AppearancePreferences, theme: AppearanceTheme): AppearancePreferences {
  if (BUILTIN_THEMES.some((item) => item.id === theme.id)) throw new ThemeValidationError("reserved-id");
  const others = preferences.themes.filter((item) => item.id !== theme.id);
  if (others.length >= MAX_CUSTOM_THEMES) throw new ThemeValidationError("theme-limit");
  return { ...preferences, selectedId: theme.id, themes: [...others, theme] };
}
