import { useCallback, useEffect, useState } from "react";
import { Contrast, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { auditContrast, CONTRAST_METER_IGNORE, type ContrastFinding, type ContrastKind } from "@/lib/contrast-audit";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "gmed-contrast-meter-open";

/** Opens the meter from anywhere in the shell (theme menu, appearance settings). */
export function openContrastMeter() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const TEXT = {
  ru: {
    title: "Контраст", rerun: "Проверить снова", close: "Закрыть", none: "Проблем с контрастом на экране не найдено.",
    summary: (count: number) => `Проблем на экране: ${count}`, disabled: "Неактивные элементы (исключение WCAG)",
    hint: "Проверяется видимая часть страницы в текущей теме. Нажмите на строку, чтобы показать элемент.",
    need: "нужно", kinds: { text: "Текст", icon: "Иконка", border: "Граница поля", placeholder: "Подсказка в поле" },
  },
  de: {
    title: "Kontrast", rerun: "Erneut prüfen", close: "Schließen", none: "Keine Kontrastprobleme auf dem Bildschirm gefunden.",
    summary: (count: number) => `Probleme auf dem Bildschirm: ${count}`, disabled: "Deaktivierte Elemente (WCAG-Ausnahme)",
    hint: "Geprüft wird der sichtbare Teil der Seite im aktuellen Theme. Zeile anklicken, um das Element zu zeigen.",
    need: "nötig", kinds: { text: "Text", icon: "Symbol", border: "Feldrahmen", placeholder: "Platzhalter" },
  },
  en: {
    title: "Contrast", rerun: "Check again", close: "Close", none: "No contrast problems found on screen.",
    summary: (count: number) => `Problems on screen: ${count}`, disabled: "Disabled elements (WCAG exception)",
    hint: "Checks the visible part of the page in the current theme. Click a row to show the element.",
    need: "needs", kinds: { text: "Text", icon: "Icon", border: "Field border", placeholder: "Placeholder" },
  },
  uk: {
    title: "Контраст", rerun: "Перевірити знову", close: "Закрити", none: "Проблем із контрастом на екрані не знайдено.",
    summary: (count: number) => `Проблем на екрані: ${count}`, disabled: "Неактивні елементи (виняток WCAG)",
    hint: "Перевіряється видима частина сторінки в поточній темі. Натисніть на рядок, щоб показати елемент.",
    need: "потрібно", kinds: { text: "Текст", icon: "Іконка", border: "Межа поля", placeholder: "Підказка в полі" },
  },
} as const;

function highlight(element: Element) {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  const { outline, outlineOffset } = element.style;
  element.style.outline = "2px dashed #dc2626";
  element.style.outlineOffset = "2px";
  window.setTimeout(() => {
    element.style.outline = outline;
    element.style.outlineOffset = outlineOffset;
  }, 2000);
}

function FindingRow({ finding, kinds, need }: { finding: ContrastFinding; kinds: Record<ContrastKind, string>; need: string }) {
  return (
    <li>
      <button type="button" onClick={() => highlight(finding.element)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded border border-border text-[11px] font-semibold"
          style={{ backgroundColor: finding.background, color: finding.foreground }}>Aa</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground">{kinds[finding.kind]} · {finding.label}</span>
          <span className="block font-mono text-muted-foreground">{finding.ratio.toFixed(2)}:1 · {need} {finding.required}:1</span>
        </span>
      </button>
    </li>
  );
}

export function ContrastMeter() {
  const { lang } = useLang();
  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  const [findings, setFindings] = useState<ContrastFinding[] | null>(null);
  const run = useCallback(() => {
    // Let menus close and the theme repaint before measuring.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setFindings(auditContrast(document))));
  }, []);
  useEffect(() => {
    window.addEventListener(OPEN_EVENT, run);
    return () => window.removeEventListener(OPEN_EVENT, run);
  }, [run]);
  useEffect(() => {
    if (!findings) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFindings(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findings]);
  if (!findings) return null;
  const active = findings.filter((finding) => !finding.disabled);
  const disabled = findings.filter((finding) => finding.disabled);
  return (
    <aside {...{ [CONTRAST_METER_IGNORE]: "" }} role="region" aria-label={text.title} data-testid="contrast-meter"
      className="fixed bottom-4 right-4 z-[160] flex max-h-[min(32rem,70dvh)] w-[min(22rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Contrast className="size-4 shrink-0" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-semibold">{text.title}</h2>
        <Button size="icon-sm" variant="ghost" onClick={run} aria-label={text.rerun} title={text.rerun}><RefreshCw /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setFindings(null)} aria-label={text.close} title={text.close}><X /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p role="status" className={cn("px-2 pb-1 text-xs font-medium", active.length ? "text-destructive" : "text-foreground")}>
          {active.length ? text.summary(active.length) : text.none}
        </p>
        <ul className="space-y-0.5">{active.map((finding, index) => <FindingRow key={index} finding={finding} kinds={text.kinds} need={text.need} />)}</ul>
        {disabled.length ? (
          <>
            <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">{text.disabled}: {disabled.length}</p>
            <ul className="space-y-0.5">{disabled.map((finding, index) => <FindingRow key={index} finding={finding} kinds={text.kinds} need={text.need} />)}</ul>
          </>
        ) : null}
      </div>
      <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">{text.hint}</p>
    </aside>
  );
}
