import { SectionHeading } from "@/components/ui/section-heading";
import { ChartColumn, CircleDot, ListFilter, MousePointer2, Palette, RotateCcw, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
// The lead cabinet's own language, EN and UA included (QA 2026-11-12, B S3-1).
import { useInterfaceLang } from "@/pages/patient-lead/lead-cabinet-language";
import { withContrast, type ControlColor, type ControlColors, type ThemeColors } from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { cn } from "@/lib/utils";

type Group = "base" | "actions" | "fields" | "tables" | "dots" | "states";
const GROUP_ICONS = { base: Palette, actions: MousePointer2, fields: ListFilter, tables: Table2, dots: CircleDot, states: ChartColumn };
const GROUPS: readonly { id: Group; keys: readonly ControlColor[] }[] = [
  { id: "base", keys: ["background", "surface", "sidebar", "muted", "accent", "border", "text", "textMuted"] },
  { id: "actions", keys: ["primary", "primaryText", "focus"] },
  { id: "fields", keys: ["inputBorder", "field", "placeholder", "dropdown", "dropdownHighlight"] },
  { id: "tables", keys: ["rowAlternate", "rowHover", "rowActive", "rowSelected"] },
  { id: "dots", keys: ["headingMarker", "dot", "badge", "badgeText"] },
  { id: "states", keys: ["danger", "chart1", "chart2", "chart3", "chart4", "chart5", "overlay", "shadow"] },
];

type Labels = Record<ControlColor, string>;
const TEXT: Record<"ru" | "de" | "en" | "uk", {
  title: string; reset: string; resetAll: string; groups: Record<Group, string>; labels: Labels;
}> = {
  ru: {
    title: "Свои цвета", reset: "Сбросить", resetAll: "Сбросить все",
    groups: { base: "Основа", actions: "Кнопки и фокус", fields: "Поля и списки", tables: "Таблицы", dots: "Точки и счётчики", states: "Ошибки, графики, затемнение" },
    labels: {
      background: "Фон страницы", surface: "Карточки и панели", sidebar: "Боковое меню", muted: "Приглушённый фон", accent: "Активный пункт меню",
      border: "Границы блоков", text: "Текст", textMuted: "Второстепенный текст", primary: "Основная кнопка", primaryText: "Текст на кнопке",
      focus: "Рамка фокуса", inputBorder: "Граница поля", field: "Фон поля", placeholder: "Подсказка в поле", dropdown: "Фон выпадающего списка",
      dropdownHighlight: "Подсветка пункта списка", rowAlternate: "Чередование строк", rowHover: "Строка под курсором", rowActive: "Нажатая строка",
      rowSelected: "Выбранная строка", headingMarker: "Маркер заголовка", dot: "Точки у разделов", badge: "Счётчик", badgeText: "Цифры счётчика", danger: "Ошибки", chart1: "График 1", chart2: "График 2", chart3: "График 3", chart4: "График 4", chart5: "График 5", overlay: "Затемнение под окнами", shadow: "Тени",
    },
  },
  de: {
    title: "Eigene Farben", reset: "Zurücksetzen", resetAll: "Alle zurücksetzen",
    groups: { base: "Grundlage", actions: "Schaltflächen und Fokus", fields: "Felder und Listen", tables: "Tabellen", dots: "Punkte und Zähler", states: "Fehler, Diagramme, Abdunklung" },
    labels: {
      background: "Seitenhintergrund", surface: "Karten und Panels", sidebar: "Seitenmenü", muted: "Gedämpfter Hintergrund", accent: "Aktiver Menüpunkt",
      border: "Rahmen von Blöcken", text: "Text", textMuted: "Sekundärer Text", primary: "Primäre Schaltfläche", primaryText: "Text auf Schaltfläche",
      focus: "Fokusrahmen", inputBorder: "Feldrahmen", field: "Feldhintergrund", placeholder: "Platzhalter", dropdown: "Hintergrund der Auswahlliste",
      dropdownHighlight: "Hervorhebung in der Liste", rowAlternate: "Zeilenwechsel", rowHover: "Zeile unter dem Zeiger", rowActive: "Gedrückte Zeile",
      rowSelected: "Ausgewählte Zeile", headingMarker: "Überschriftenmarker", dot: "Punkte an Abschnitten", badge: "Zähler", badgeText: "Ziffern im Zähler", danger: "Fehler", chart1: "Diagramm 1", chart2: "Diagramm 2", chart3: "Diagramm 3", chart4: "Diagramm 4", chart5: "Diagramm 5", overlay: "Abdunklung hinter Fenstern", shadow: "Schatten",
    },
  },
  en: {
    title: "Own colours", reset: "Reset", resetAll: "Reset all",
    groups: { base: "Base", actions: "Buttons and focus", fields: "Fields and lists", tables: "Tables", dots: "Dots and counters", states: "Errors, charts, backdrop" },
    labels: {
      background: "Page background", surface: "Cards and panels", sidebar: "Side menu", muted: "Muted background", accent: "Active menu item",
      border: "Block borders", text: "Text", textMuted: "Secondary text", primary: "Primary button", primaryText: "Button text",
      focus: "Focus ring", inputBorder: "Field border", field: "Field background", placeholder: "Placeholder", dropdown: "Dropdown background",
      dropdownHighlight: "Dropdown highlight", rowAlternate: "Alternate rows", rowHover: "Row under the pointer", rowActive: "Pressed row",
      rowSelected: "Selected row", headingMarker: "Heading marker", dot: "Section dots", badge: "Counter", badgeText: "Counter digits", danger: "Errors", chart1: "Chart 1", chart2: "Chart 2", chart3: "Chart 3", chart4: "Chart 4", chart5: "Chart 5", overlay: "Backdrop behind windows", shadow: "Shadows",
    },
  },
  uk: {
    title: "Власні кольори", reset: "Скинути", resetAll: "Скинути все",
    groups: { base: "Основа", actions: "Кнопки й фокус", fields: "Поля та списки", tables: "Таблиці", dots: "Пімпочки та лічильники", states: "Помилки, графіки, затемнення" },
    labels: {
      background: "Фон сторінки", surface: "Картки й панелі", sidebar: "Бічне меню", muted: "Приглушений фон", accent: "Активний пункт меню",
      border: "Межі блоків", text: "Текст", textMuted: "Другорядний текст", primary: "Основна кнопка", primaryText: "Текст на кнопці",
      focus: "Рамка фокуса", inputBorder: "Межа поля", field: "Фон поля", placeholder: "Підказка в полі", dropdown: "Фон випадного списку",
      dropdownHighlight: "Підсвітка пункту списку", rowAlternate: "Чергування рядків", rowHover: "Рядок під курсором", rowActive: "Натиснутий рядок",
      rowSelected: "Вибраний рядок", headingMarker: "Маркер заголовка", dot: "Пімпочки біля розділів", badge: "Лічильник", badgeText: "Цифри лічильника", danger: "Помилки", chart1: "Графік 1", chart2: "Графік 2", chart3: "Графік 3", chart4: "Графік 4", chart5: "Графік 5", overlay: "Затемнення під вікнами", shadow: "Тіні",
    },
  },
};

/** The colour in use now: the person's own, else the palette's, else what the screen falls back to. */
function effectiveColor(colors: ThemeColors, key: ControlColor): string {
  switch (key) {
    case "placeholder": return colors.placeholder ?? colors.textMuted;
    case "dropdown": return colors.dropdown ?? colors.surface;
    case "dropdownHighlight": return colors.dropdownHighlight ?? colors.accent;
    case "dot": return colors.dot ?? colors.headingMarker;
    case "badge": return colors.badge ?? colors.primary;
    case "badgeText": return colors.badgeText ?? "#ffffff";
    case "danger": return colors.danger ?? "#dc2626";
    case "chart1": return colors.chart1 ?? "#f97316";
    case "chart2": return colors.chart2 ?? "#fb923c";
    case "chart3": return colors.chart3 ?? "#fdba74";
    case "chart4": return colors.chart4 ?? "#fed7aa";
    case "chart5": return colors.chart5 ?? "#fff4ed";
    case "overlay": return colors.overlay ?? "#000000";
    case "shadow": return colors.shadow ?? "#000000";
    default: return colors[key];
  }
}

export function AppearanceControlColors({ onError }: { onError: (cause: unknown) => void }) {
  const lang = useInterfaceLang();
  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  const { theme, contrast, controls, save } = useAppearanceTheme();
  const colors: ThemeColors = { ...withContrast(theme, contrast).colors, ...controls };
  const update = (key?: ControlColor, color?: string) => save(p => {
    const next: ControlColors = key ? { ...p.controls } : {};
    if (key && color) next[key] = color;
    else if (key) delete next[key];
    return { ...p, controls: Object.keys(next).length ? next : undefined };
  }).catch(onError);
  return (
    <fieldset className="min-w-0 max-w-6xl border-0 p-0" data-testid="appearance-control-colors">
      <legend className="mb-2 p-0 text-sm font-semibold">{text.title}</legend>
      <div className="columns-1 gap-6 md:columns-2 xl:columns-3">
        {GROUPS.map((group) => (
          <section key={group.id} className="mb-4 break-inside-avoid" aria-labelledby={`control-colors-${group.id}`}>
            <h3 id={`control-colors-${group.id}`} className="mb-1 flex items-center gap-2 font-mono text-xs font-medium text-foreground"><SectionHeading icon={GROUP_ICONS[group.id]}>{text.groups[group.id]}</SectionHeading></h3>
            <div className="space-y-0.5">
              {group.keys.map((key) => {
                const value = effectiveColor(colors, key);
                const own = controls?.[key] !== undefined;
                const id = `control-color-${key}`;
                return (
                  <div key={key} className="flex min-w-0 items-center gap-2 py-1">
                    <input id={id} type="color" value={value} onChange={(event) => update(key, event.target.value.toLowerCase())}
                      className="size-7 shrink-0 cursor-pointer rounded border border-input bg-field p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                    <label htmlFor={id} className="min-w-0 flex-1">
                      <span className={cn("block break-words text-xs leading-4", own && "font-medium")}>{text.labels[key]}</span>
                      <span className="block break-words font-mono text-[11px] leading-4 text-muted-foreground">
                        {value}
                      </span>
                    </label>
                    {own ? (
                      <Button size="icon-sm" variant="ghost" onClick={() => update(key)} aria-label={`${text.reset}: ${text.labels[key]}`} title={text.reset}>
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
      {controls ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => update()}>{text.resetAll}</Button> : null}
    </fieldset>
  );
}
