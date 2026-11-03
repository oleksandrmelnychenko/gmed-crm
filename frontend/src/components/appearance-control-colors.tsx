import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import {
  CONTROL_COLORS, contrastRatio, withContrast, type ControlColor, type ControlColors, type ThemeColors,
} from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { cn } from "@/lib/utils";

const TEXT = {
  ru: {
    title: "Цвета элементов управления", reset: "Сбросить", resetAll: "Сбросить все", need: "нужно",
    hint: "Свои цвета полей и выпадающих списков. Действуют поверх темы и контраста и попадают в JSON при экспорте.",
    labels: { inputBorder: "Граница поля", field: "Фон поля", placeholder: "Подсказка в поле", focus: "Рамка фокуса", dropdown: "Фон выпадающего списка", dropdownHighlight: "Подсветка пункта списка" },
  },
  de: {
    title: "Farben der Bedienelemente", reset: "Zurücksetzen", resetAll: "Alle zurücksetzen", need: "nötig",
    hint: "Eigene Farben für Felder und Auswahllisten. Sie gelten über Theme und Kontrast und werden beim Export ins JSON übernommen.",
    labels: { inputBorder: "Feldrahmen", field: "Feldhintergrund", placeholder: "Platzhalter", focus: "Fokusrahmen", dropdown: "Hintergrund der Auswahlliste", dropdownHighlight: "Hervorhebung in der Liste" },
  },
  en: {
    title: "Control colours", reset: "Reset", resetAll: "Reset all", need: "needs",
    hint: "Your own colours for fields and dropdowns. They apply on top of the theme and contrast and go into the JSON on export.",
    labels: { inputBorder: "Field border", field: "Field background", placeholder: "Placeholder", focus: "Focus ring", dropdown: "Dropdown background", dropdownHighlight: "Dropdown highlight" },
  },
  uk: {
    title: "Кольори елементів керування", reset: "Скинути", resetAll: "Скинути все", need: "потрібно",
    hint: "Власні кольори полів і випадних списків. Діють поверх теми й контрасту та потрапляють у JSON під час експорту.",
    labels: { inputBorder: "Межа поля", field: "Фон поля", placeholder: "Підказка в полі", focus: "Рамка фокуса", dropdown: "Фон випадного списку", dropdownHighlight: "Підсвітка пункту списку" },
  },
} as const;

/** The colour a control uses now: the person's own, else the palette's, else its fallback. */
function effectiveControlColor(colors: ThemeColors, key: ControlColor): string {
  if (key === "placeholder") return colors.placeholder ?? colors.textMuted;
  if (key === "dropdown") return colors.dropdown ?? colors.surface;
  if (key === "dropdownHighlight") return colors.dropdownHighlight ?? colors.accent;
  return colors[key];
}

/** The pair each colour is judged against and the WCAG minimum for it. */
function check(colors: ThemeColors, key: ControlColor): { ratio: number; required: number } {
  const value = (name: ControlColor) => effectiveControlColor(colors, name);
  switch (key) {
    case "inputBorder": return { ratio: contrastRatio(value("inputBorder"), value("field")), required: 3 };
    case "field": return { ratio: contrastRatio(colors.text, value("field")), required: 4.5 };
    case "placeholder": return { ratio: contrastRatio(value("placeholder"), value("field")), required: 4.5 };
    case "focus": return { ratio: contrastRatio(value("focus"), colors.surface), required: 3 };
    case "dropdown": return { ratio: contrastRatio(colors.text, value("dropdown")), required: 4.5 };
    case "dropdownHighlight": return { ratio: contrastRatio(colors.text, value("dropdownHighlight")), required: 4.5 };
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
    <fieldset className="max-w-3xl rounded-lg border border-border p-3" data-testid="appearance-control-colors">
      <legend className="px-1 text-sm font-medium">{text.title}</legend>
      <p className="mb-3 text-xs text-muted-foreground">{text.hint}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CONTROL_COLORS.map((key) => {
          const value = effectiveControlColor(colors, key);
          const { ratio, required } = check(colors, key);
          const own = controls?.[key] !== undefined;
          const id = `control-color-${key}`;
          return (
            <div key={key} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <input id={id} type="color" value={value} onChange={(event) => update({ ...controls, [key]: event.target.value.toLowerCase() })}
                className="size-8 shrink-0 cursor-pointer rounded border border-input bg-field p-0.5" />
              <label htmlFor={id} className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", own && "font-medium")}>{text.labels[key]}</span>
                <span className={cn("block font-mono text-xs", ratio < required ? "text-destructive" : "text-muted-foreground")}>
                  {value} · {ratio.toFixed(2)}:1{ratio < required ? ` · ${text.need} ${required}:1` : ""}
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
      {controls ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => update({})}>{text.resetAll}</Button> : null}
    </fieldset>
  );
}
