import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { contrastRatio, withContrast, type ControlColor, type ControlColors, type ThemeColors } from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { cn } from "@/lib/utils";

type Group = "base" | "actions" | "fields" | "tables" | "dots";
const GROUPS: readonly { id: Group; keys: readonly ControlColor[] }[] = [
  { id: "base", keys: ["background", "surface", "sidebar", "muted", "accent", "border", "text", "textMuted"] },
  { id: "actions", keys: ["primary", "primaryText", "focus"] },
  { id: "fields", keys: ["inputBorder", "field", "placeholder", "dropdown", "dropdownHighlight"] },
  { id: "tables", keys: ["rowAlternate", "rowHover", "rowActive", "rowSelected"] },
  { id: "dots", keys: ["headingMarker", "dot", "badge", "badgeText"] },
];

type Labels = Record<ControlColor, string>;
const TEXT: Record<"ru" | "de" | "en" | "uk", {
  title: string; reset: string; resetAll: string; need: string; groups: Record<Group, string>; labels: Labels;
}> = {
  ru: {
    title: "Свои цвета", reset: "Сбросить", resetAll: "Сбросить все", need: "нужно",
    groups: { base: "Основа", actions: "Кнопки и фокус", fields: "Поля и списки", tables: "Таблицы", dots: "Точки и счётчики" },
    labels: {
      background: "Фон страницы", surface: "Карточки и панели", sidebar: "Боковое меню", muted: "Приглушённый фон", accent: "Активный пункт меню",
      border: "Границы блоков", text: "Текст", textMuted: "Второстепенный текст", primary: "Основная кнопка", primaryText: "Текст на кнопке",
      focus: "Рамка фокуса", inputBorder: "Граница поля", field: "Фон поля", placeholder: "Подсказка в поле", dropdown: "Фон выпадающего списка",
      dropdownHighlight: "Подсветка пункта списка", rowAlternate: "Чередование строк", rowHover: "Строка под курсором", rowActive: "Нажатая строка",
      rowSelected: "Выбранная строка", headingMarker: "Маркер заголовка", dot: "Точки у разделов", badge: "Счётчик", badgeText: "Цифры счётчика",
    },
  },
  de: {
    title: "Eigene Farben", reset: "Zurücksetzen", resetAll: "Alle zurücksetzen", need: "nötig",
    groups: { base: "Grundlage", actions: "Schaltflächen und Fokus", fields: "Felder und Listen", tables: "Tabellen", dots: "Punkte und Zähler" },
    labels: {
      background: "Seitenhintergrund", surface: "Karten und Panels", sidebar: "Seitenmenü", muted: "Gedämpfter Hintergrund", accent: "Aktiver Menüpunkt",
      border: "Rahmen von Blöcken", text: "Text", textMuted: "Sekundärer Text", primary: "Primäre Schaltfläche", primaryText: "Text auf Schaltfläche",
      focus: "Fokusrahmen", inputBorder: "Feldrahmen", field: "Feldhintergrund", placeholder: "Platzhalter", dropdown: "Hintergrund der Auswahlliste",
      dropdownHighlight: "Hervorhebung in der Liste", rowAlternate: "Zeilenwechsel", rowHover: "Zeile unter dem Zeiger", rowActive: "Gedrückte Zeile",
      rowSelected: "Ausgewählte Zeile", headingMarker: "Überschriftenmarker", dot: "Punkte an Abschnitten", badge: "Zähler", badgeText: "Ziffern im Zähler",
    },
  },
  en: {
    title: "Own colours", reset: "Reset", resetAll: "Reset all", need: "needs",
    groups: { base: "Base", actions: "Buttons and focus", fields: "Fields and lists", tables: "Tables", dots: "Dots and counters" },
    labels: {
      background: "Page background", surface: "Cards and panels", sidebar: "Side menu", muted: "Muted background", accent: "Active menu item",
      border: "Block borders", text: "Text", textMuted: "Secondary text", primary: "Primary button", primaryText: "Button text",
      focus: "Focus ring", inputBorder: "Field border", field: "Field background", placeholder: "Placeholder", dropdown: "Dropdown background",
      dropdownHighlight: "Dropdown highlight", rowAlternate: "Alternate rows", rowHover: "Row under the pointer", rowActive: "Pressed row",
      rowSelected: "Selected row", headingMarker: "Heading marker", dot: "Section dots", badge: "Counter", badgeText: "Counter digits",
    },
  },
  uk: {
    title: "Власні кольори", reset: "Скинути", resetAll: "Скинути все", need: "потрібно",
    groups: { base: "Основа", actions: "Кнопки й фокус", fields: "Поля та списки", tables: "Таблиці", dots: "Пімпочки та лічильники" },
    labels: {
      background: "Фон сторінки", surface: "Картки й панелі", sidebar: "Бічне меню", muted: "Приглушений фон", accent: "Активний пункт меню",
      border: "Межі блоків", text: "Текст", textMuted: "Другорядний текст", primary: "Основна кнопка", primaryText: "Текст на кнопці",
      focus: "Рамка фокуса", inputBorder: "Межа поля", field: "Фон поля", placeholder: "Підказка в полі", dropdown: "Фон випадного списку",
      dropdownHighlight: "Підсвітка пункту списку", rowAlternate: "Чергування рядків", rowHover: "Рядок під курсором", rowActive: "Натиснутий рядок",
      rowSelected: "Вибраний рядок", headingMarker: "Маркер заголовка", dot: "Пімпочки біля розділів", badge: "Лічильник", badgeText: "Цифри лічильника",
    },
  },
};

/** The colour in use now: the person's own, else the palette's, else what the screen falls back to. */
function effectiveColor(colors: ThemeColors, key: ControlColor): string {
  switch (key) {
    case "placeholder": return colors.placeholder ?? colors.textMuted;
    case "dropdown": return colors.dropdown ?? colors.surface;
    case "dropdownHighlight": return colors.dropdownHighlight ?? colors.accent;
    case "dot": return colors.dot ?? colors.primary;
    case "badge": return colors.badge ?? colors.primary;
    case "badgeText": return colors.badgeText ?? "#ffffff";
    default: return colors[key];
  }
}

/** The pair each colour is judged against and its WCAG minimum; borders and row tints carry none. */
function check(colors: ThemeColors, key: ControlColor): { ratio: number; required: number | null } {
  const value = (name: ControlColor) => effectiveColor(colors, name);
  const pair = (first: string, second: string, required: number | null) => ({ ratio: contrastRatio(first, second), required });
  switch (key) {
    case "text": return pair(colors.text, colors.surface, 4.5);
    case "textMuted": return pair(colors.textMuted, colors.surface, 4.5);
    case "border": return pair(colors.border, colors.surface, null);
    case "primary": case "primaryText": return pair(colors.primaryText, colors.primary, 4.5);
    case "focus": return pair(colors.focus, colors.surface, 3);
    case "inputBorder": return pair(colors.inputBorder, value("field"), 3);
    case "placeholder": return pair(value("placeholder"), value("field"), 4.5);
    case "headingMarker": return pair(colors.headingMarker, colors.surface, 3);
    case "dot": return pair(value("dot"), colors.surface, 3);
    case "badge": case "badgeText": return pair(value("badgeText"), value("badge"), 4.5);
    default: return pair(colors.text, value(key), 4.5);
  }
}

export function AppearanceControlColors({ onError }: { onError: (cause: unknown) => void }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  const { theme, contrast, controls, preferences, save } = useAppearanceTheme(user?.id ?? null);
  const colors: ThemeColors = { ...withContrast(theme, contrast).colors, ...controls };
  const update = (next: ControlColors) => {
    try { save({ ...preferences, controls: Object.keys(next).length ? next : undefined }); }
    catch (cause) { onError(cause); }
  };
  const reset = (key: ControlColor) => {
    const next = { ...controls };
    delete next[key];
    update(next);
  };
  return (
    <fieldset className="min-w-0 max-w-6xl border-0 p-0" data-testid="appearance-control-colors">
      <legend className="mb-2 p-0 text-sm font-semibold">{text.title}</legend>
      <div className="columns-1 gap-6 md:columns-2 xl:columns-3">
        {GROUPS.map((group) => (
          <section key={group.id} className="mb-4 break-inside-avoid" aria-labelledby={`control-colors-${group.id}`}>
            <h3 id={`control-colors-${group.id}`} className="mb-1 flex items-center gap-2 font-mono text-xs font-medium text-foreground"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--dot,var(--heading-marker))]" />{text.groups[group.id]}</h3>
            <div className="space-y-0.5">
              {group.keys.map((key) => {
                const value = effectiveColor(colors, key);
                const { ratio, required } = check(colors, key);
                const low = required !== null && ratio < required;
                const own = controls?.[key] !== undefined;
                const id = `control-color-${key}`;
                return (
                  <div key={key} className="flex min-w-0 items-center gap-2 py-1">
                    <input id={id} type="color" value={value} onChange={(event) => update({ ...controls, [key]: event.target.value.toLowerCase() })}
                      className="size-7 shrink-0 cursor-pointer rounded border border-input bg-field p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                    <label htmlFor={id} className="min-w-0 flex-1">
                      <span className={cn("block break-words text-xs leading-4", own && "font-medium")}>{text.labels[key]}</span>
                      <span className={cn("block break-words font-mono text-[11px] leading-4", low ? "text-destructive" : "text-muted-foreground")}>
                        {value} · {ratio.toFixed(2)}:1{low ? ` · ${text.need} ${required}:1` : ""}
                      </span>
                    </label>
                    {own ? (
                      <Button size="icon-sm" variant="ghost" onClick={() => reset(key)} aria-label={`${text.reset}: ${text.labels[key]}`} title={text.reset}>
                        <RotateCcw />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {controls ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => update({})}>{text.resetAll}</Button> : null}
    </fieldset>
  );
}
