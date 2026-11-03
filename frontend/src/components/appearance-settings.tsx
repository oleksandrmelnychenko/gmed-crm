import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, Contrast, Download, Palette, Upload } from "lucide-react";
import { AppearanceControlColors } from "@/components/appearance-control-colors";
import { CONTRAST_LEVEL_TEXT } from "@/components/appearance-menu";
import { openContrastMeter } from "@/components/contrast-meter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import {
  addAppearanceTheme, BUILTIN_THEMES, CONTRAST_LEVELS, DEFAULT_THEME, withControls, MAX_THEME_JSON_LENGTH,
  parseAppearanceTheme, ThemeValidationError, type AppearanceTheme, type ThemeErrorCode,
} from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { cn } from "@/lib/utils";

const TEXT = {
  ru: {
    title: "Оформление", hint: "Светлые темы сохраняются для вашего аккаунта в этом браузере.",
    custom: "Своя тема · JSON", template: "Шаблон", apply: "Сохранить и применить", export: "Экспорт темы", import: "Импорт файла",
    reset: "Вернуть GMED", contrast: "Проверить контраст", remove: "Удалить тему", preview: "Предпросмотр", action: "Основная кнопка", secondary: "Подпись поля",
    editor: "JSON темы", saved: "Тема сохранена", storage: "Не удалось сохранить тему в браузере.",
    scope: "Цвета предупреждений, ошибок и статусов сохраняют своё значение. Тема меняет палитру, а не размеры элементов.",
    errors: { "invalid-json": "Проверьте синтаксис JSON.", "invalid-theme": "Нужна светлая тема версии 1: id, name и colors. Максимум 16 КБ.", "invalid-color": "Неизвестный цвет или неверный формат. Используйте #RRGGBB.", "low-contrast": "Недостаточный контраст: текст ≥4,5:1, фокус ≥3:1.", "reserved-id": "Измените id: это имя встроенной темы.", "theme-limit": "Можно сохранить до 30 своих тем." },
  },
  de: {
    title: "Darstellung", hint: "Helle Themes werden für Ihr Konto in diesem Browser gespeichert.",
    custom: "Eigenes Theme · JSON", template: "Vorlage", apply: "Speichern und anwenden", export: "Theme exportieren", import: "Datei importieren",
    reset: "GMED wiederherstellen", contrast: "Kontrast prüfen", remove: "Theme löschen", preview: "Vorschau", action: "Primäre Schaltfläche", secondary: "Feldbeschriftung",
    editor: "Theme-JSON", saved: "Theme gespeichert", storage: "Das Theme konnte nicht im Browser gespeichert werden.",
    scope: "Warnungen, Fehler und Statusfarben behalten ihre Bedeutung. Das Theme ändert die Farbpalette, nicht die Größe der Elemente.",
    errors: { "invalid-json": "Bitte JSON-Syntax prüfen.", "invalid-theme": "Helles Theme Version 1 mit id, name und colors erforderlich. Maximal 16 KB.", "invalid-color": "Unbekannte Farbe oder ungültiges Format. #RRGGBB verwenden.", "low-contrast": "Kontrast zu gering: Text ≥4,5:1, Fokus ≥3:1.", "reserved-id": "Bitte id ändern: Diese ID gehört zu einem integrierten Theme.", "theme-limit": "Maximal 30 eigene Themes möglich." },
  },
  en: {
    title: "Appearance", hint: "Light themes are saved for your account in this browser.",
    custom: "Custom theme · JSON", template: "Template", apply: "Save and apply", export: "Export theme", import: "Import file",
    reset: "Restore GMED", contrast: "Check contrast", remove: "Delete theme", preview: "Preview", action: "Primary button", secondary: "Field label",
    editor: "Theme JSON", saved: "Theme saved", storage: "Could not save the theme in this browser.",
    scope: "Warning, error and status colours keep their meaning. Themes change the palette, not element sizes.",
    errors: { "invalid-json": "Check the JSON syntax.", "invalid-theme": "Use a light version 1 theme with id, name and colors. Maximum 16 KB.", "invalid-color": "Unknown colour or invalid format. Use #RRGGBB.", "low-contrast": "Contrast is too low: text ≥4.5:1, focus ≥3:1.", "reserved-id": "Change id: this ID belongs to a built-in theme.", "theme-limit": "You can save up to 30 custom themes." },
  },
  uk: {
    title: "Оформлення", hint: "Світлі теми зберігаються для вашого акаунта в цьому браузері.",
    custom: "Власна тема · JSON", template: "Шаблон", apply: "Зберегти й застосувати", export: "Експорт теми", import: "Імпорт файлу",
    reset: "Повернути GMED", contrast: "Перевірити контраст", remove: "Видалити тему", preview: "Попередній перегляд", action: "Основна кнопка", secondary: "Підпис поля",
    editor: "JSON теми", saved: "Тему збережено", storage: "Не вдалося зберегти тему в браузері.",
    scope: "Кольори попереджень, помилок і статусів зберігають своє значення. Тема змінює палітру, а не розміри елементів.",
    errors: { "invalid-json": "Перевірте синтаксис JSON.", "invalid-theme": "Потрібна світла тема версії 1: id, name та colors. Максимум 16 КБ.", "invalid-color": "Невідомий колір або хибний формат. Використовуйте #RRGGBB.", "low-contrast": "Недостатній контраст: текст ≥4,5:1, фокус ≥3:1.", "reserved-id": "Змініть id: це назва вбудованої теми.", "theme-limit": "Можна зберегти до 30 власних тем." },
  },
} as const;

function portableTheme(theme: AppearanceTheme, existingIds: readonly string[] = []) {
  const base = `${theme.id.slice(0, 38)}-custom`;
  let id = base;
  let counter = 2;
  while (existingIds.includes(id)) id = `${base}-${counter++}`;
  return JSON.stringify({ ...theme, id, name: `${theme.name.slice(0, 57)} Custom` }, null, 2);
}

export function AppearanceSettings() {
  const { search, key } = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (new URLSearchParams(search).get("section") !== "appearance") return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [search, key]);
  const { user } = useAuth();
  const { lang } = useLang();
  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  const contrastText = CONTRAST_LEVEL_TEXT[lang as keyof typeof CONTRAST_LEVEL_TEXT] ?? CONTRAST_LEVEL_TEXT.en;
  const { theme: selectedTheme, themes, preferences, contrast, controls, save } = useAppearanceTheme(user?.id ?? null);
  // Export and the JSON template carry the person's own control colours (owner 2026-11-03).
  const theme = useMemo(() => withControls(selectedTheme, controls), [selectedTheme, controls]);
  const [draft, setDraft] = useState(() => portableTheme(theme, themes.map((item) => item.id)));
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => { try { return parseAppearanceTheme(draft); } catch { return null; } }, [draft]);
  const fail = (cause: unknown) => setNotice({ error: true, message: cause instanceof ThemeValidationError
    ? `${text.errors[cause.code as ThemeErrorCode]}${cause.detail ? ` (${cause.detail})` : ""}` : text.storage });
  const select = (id: string) => {
    try { save({ ...preferences, selectedId: id }); setNotice({ error: false, message: text.saved }); }
    catch (cause) { fail(cause); }
  };
  const exportTheme = () => {
    const json = BUILTIN_THEMES.some((item) => item.id === theme.id) ? portableTheme(theme, themes.map((item) => item.id)) : JSON.stringify(theme, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${theme.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section ref={sectionRef} id="appearance" tabIndex={-1} className="scroll-mt-3 rounded-xl border border-border bg-card focus:outline-none" aria-labelledby="appearance-title" data-testid="appearance-settings">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Palette className="size-4" aria-hidden="true" />
        <h2 id="appearance-title" className="text-sm font-semibold">{text.title}</h2>
      </header>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">{text.hint}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={text.title}>
          {themes.map((item) => (
            <button key={item.id} type="button" onClick={() => select(item.id)} aria-pressed={theme.id === item.id}
              className={cn("inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring", theme.id === item.id ? "border-ring bg-accent" : "border-border bg-card hover:bg-muted")}>
              <span className="flex shrink-0 overflow-hidden rounded-sm border border-border" aria-hidden="true">
                {[item.colors.background, item.colors.primary, item.colors.headingMarker].map((color, index) => <span key={index} className="size-3" style={{ backgroundColor: color }} />)}
              </span>
              <span className="min-w-0 truncate">{item.name}</span>{theme.id === item.id ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={contrastText.title}>
          <span className="text-xs font-medium text-muted-foreground">{contrastText.title}</span>
          {CONTRAST_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={contrast === level} onClick={() => {
              try { save({ ...preferences, contrast: level }); setNotice({ error: false, message: text.saved }); } catch (cause) { fail(cause); }
            }}
              className={cn("rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring", contrast === level ? "border-ring bg-accent font-medium" : "border-border bg-card hover:bg-muted")}>
              {contrastText.levels[level]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={exportTheme}><Download />{text.export}</Button>
          <Button size="sm" variant="outline" onClick={openContrastMeter}><Contrast />{text.contrast}</Button>
          <Button size="sm" variant="ghost" onClick={() => select(DEFAULT_THEME.id)}>{text.reset}</Button>
          {!BUILTIN_THEMES.some((item) => item.id === theme.id) ? <Button size="sm" variant="ghost" onClick={() => {
            try { save({ ...preferences, selectedId: DEFAULT_THEME.id, themes: preferences.themes.filter((item) => item.id !== theme.id) }); setNotice(null); } catch (cause) { fail(cause); }
          }}>{text.remove}</Button> : null}
        </div>
        <AppearanceControlColors onError={fail} />
        <details className="max-w-3xl rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{text.custom}</summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => fileInput.current?.click()}><Upload />{text.import}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(portableTheme(theme, themes.map((item) => item.id))); setNotice(null); }}>{text.template}</Button>
              <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" aria-label={text.import} onChange={async (event) => {
                const file = event.target.files?.[0]; event.target.value = "";
                if (!file) return;
                try {
                  if (file.size > MAX_THEME_JSON_LENGTH) throw new ThemeValidationError("invalid-theme");
                  const contents = await file.text(); parseAppearanceTheme(contents); setDraft(contents); setNotice(null);
                } catch (cause) { fail(cause); }
              }} />
            </div>
            <label htmlFor="appearance-json" className="block font-mono text-xs text-muted-foreground">{text.editor}</label>
            <textarea id="appearance-json" value={draft} onChange={(event) => { setDraft(event.target.value); setNotice(null); }} maxLength={MAX_THEME_JSON_LENGTH}
              spellCheck={false} rows={9} className="block w-full rounded-lg border border-input bg-field p-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring" />
            {preview ? <div className="space-y-2 rounded-lg border p-3" style={{ backgroundColor: preview.colors.background, borderColor: preview.colors.border, color: preview.colors.text }} aria-label={text.preview}>
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: preview.colors.headingMarker }} /><span className="min-w-0 break-words">{text.preview} · {preview.name}</span></div>
              <div className="flex flex-wrap items-center gap-3 rounded-md p-3" style={{ backgroundColor: preview.colors.surface }}>
                <span className="font-mono text-xs" style={{ color: preview.colors.textMuted }}>{text.secondary}</span>
                <span className="rounded-lg px-3 py-1.5 text-sm font-medium" style={{ backgroundColor: preview.colors.primary, color: preview.colors.primaryText }}>{text.action}</span>
              </div>
            </div> : null}
            <Button size="sm" onClick={() => {
              try { save(addAppearanceTheme(preferences, parseAppearanceTheme(draft))); setNotice({ error: false, message: text.saved }); }
              catch (cause) { fail(cause); }
            }}>{text.apply}</Button>
            <p className="text-xs leading-relaxed text-muted-foreground">{text.scope}</p>
          </div>
        </details>
        {notice ? <p role={notice.error ? "alert" : "status"} className={cn("break-words text-xs", notice.error ? "text-destructive" : "text-muted-foreground")}>{notice.message}</p> : null}
      </div>
    </section>
  );
}
