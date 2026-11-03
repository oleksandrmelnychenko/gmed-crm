import { Menu } from "@base-ui/react/menu";
import { Check, Contrast, Palette, Settings2 } from "lucide-react";

import { openContrastMeter } from "@/components/contrast-meter";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { CONTRAST_LEVELS, type ContrastLevel } from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { useStaffNavigate } from "@/lib/use-staff-navigate";

const TEXT = {
  ru: { title: "Темы", settings: "Настройки оформления", contrast: "Проверить контраст", error: "Не удалось сохранить тему в браузере." },
  de: { title: "Themes", settings: "Darstellung anpassen", contrast: "Kontrast prüfen", error: "Das Theme konnte nicht im Browser gespeichert werden." },
  en: { title: "Themes", settings: "Appearance settings", contrast: "Check contrast", error: "Could not save the theme in this browser." },
  uk: { title: "Теми", settings: "Налаштування оформлення", contrast: "Перевірити контраст", error: "Не вдалося зберегти тему в браузері." },
} as const;

/** Contrast levels are picked apart from the theme (owner 2026-11-03). */
export const CONTRAST_LEVEL_TEXT = {
  ru: { title: "Контраст", levels: { standard: "Стандартный", soft: "Мягкий", softer: "Очень мягкий" } },
  de: { title: "Kontrast", levels: { standard: "Standard", soft: "Weich", softer: "Sehr weich" } },
  en: { title: "Contrast", levels: { standard: "Standard", soft: "Soft", softer: "Softer" } },
  uk: { title: "Контраст", levels: { standard: "Стандартний", soft: "Мʼякий", softer: "Дуже мʼякий" } },
} as const;

const ITEM_CLASS = "flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

export function AppearanceMenu({ onOpen }: { onOpen?: () => void }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  const contrastText = CONTRAST_LEVEL_TEXT[lang as keyof typeof CONTRAST_LEVEL_TEXT] ?? CONTRAST_LEVEL_TEXT.en;
  const { theme, themes, preferences, contrast, save } = useAppearanceTheme(user?.id ?? null);

  return (
    <Menu.Root onOpenChange={(open) => { if (open) onOpen?.(); }}>
      <Menu.Trigger
        aria-label={`${text.title}: ${theme.name}`}
        title={`${text.title}: ${theme.name}`}
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted"
      >
        <Palette aria-hidden="true" className="size-[17px]" />
        <span className="hidden xl:inline">{text.title}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} collisionPadding={12} className="isolate z-[150]">
          <Menu.Popup aria-label={text.title} className="w-60 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <Menu.RadioGroup
              aria-label={text.title}
              value={theme.id}
              onValueChange={(selectedId: string) => {
                try { save({ ...preferences, selectedId }); }
                catch { toast.error(text.error); }
              }}
              className="max-h-[min(22rem,60dvh)] overflow-y-auto"
            >
              {themes.map((item) => (
                <Menu.RadioItem key={item.id} value={item.id} label={item.name} closeOnClick className={ITEM_CLASS}>
                  <span aria-hidden="true" className="flex shrink-0 overflow-hidden rounded-sm border border-border">
                    {[item.colors.background, item.colors.primary, item.colors.headingMarker].map((color, index) => (
                      <span key={index} className="size-3" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <Menu.RadioItemIndicator><Check aria-hidden="true" className="size-4" /></Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Group>
              <Menu.GroupLabel className="px-2 pb-0.5 pt-1 text-xs font-medium text-muted-foreground">{contrastText.title}</Menu.GroupLabel>
              <Menu.RadioGroup
                value={contrast}
                onValueChange={(level: ContrastLevel) => {
                  try { save({ ...preferences, contrast: level }); }
                  catch { toast.error(text.error); }
                }}
              >
                {CONTRAST_LEVELS.map((level) => (
                  <Menu.RadioItem key={level} value={level} label={contrastText.levels[level]} closeOnClick={false} className={ITEM_CLASS}>
                    <span className="min-w-0 flex-1 truncate">{contrastText.levels[level]}</span>
                    <Menu.RadioItemIndicator><Check aria-hidden="true" className="size-4" /></Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item className={ITEM_CLASS} onClick={openContrastMeter}>
              <Contrast aria-hidden="true" className="size-4 shrink-0" />
              {text.contrast}
            </Menu.Item>
            <Menu.Item className={ITEM_CLASS} onClick={() => staffGo("/account?section=appearance")}>
              <Settings2 aria-hidden="true" className="size-4 shrink-0" />
              {text.settings}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
