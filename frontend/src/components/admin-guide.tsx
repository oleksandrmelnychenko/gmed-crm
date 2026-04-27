import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";

type AdminGuideButtonProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Render the standard data-table toolbar guide section. Defaults to true. */
  showTableToolbarGuide?: boolean;
  /** Visual size of the trigger button. Defaults to h-9 w-9 outline. */
  buttonClassName?: string;
};

export function AdminGuideButton({
  title,
  description,
  children,
  showTableToolbarGuide = true,
  buttonClassName = "size-9 rounded-lg bg-card",
}: AdminGuideButtonProps) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);

  const guideLabel = lang === "de" ? "Anleitung" : "Гайд";
  const closeLabel = lang === "de" ? "Schließen" : "Закрыть";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={buttonClassName}
        title={guideLabel}
        aria-label={guideLabel}
        onClick={() => setOpen(true)}
      >
        <HelpCircle className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="space-y-4 text-[13px]">
            {children}
            {showTableToolbarGuide ? <TableToolbarGuide lang={lang} /> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="default"
              className="h-9 rounded-lg"
              onClick={() => setOpen(false)}
            >
              {closeLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type GuideSectionProps = {
  title: ReactNode;
  children: ReactNode;
};

export function GuideSection({ title, children }: GuideSectionProps) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

function TableToolbarGuide({ lang }: { lang: "de" | "ru" }) {
  const isDe = lang === "de";
  return (
    <GuideSection title={isDe ? "Tabellen-Toolbar" : "Панель таблицы"}>
      <ul className="space-y-1">
        <li>
          <span className="font-medium text-foreground">+ {isDe ? "Filter" : "Фильтр"}</span>{" "}
          —{" "}
          {isDe
            ? "beliebige Spalte filtern (Text/Auswahl/Datum/Zahl)."
            : "фильтрация по любой колонке (текст/список/дата/число)."}
        </li>
        <li>
          <span className="font-medium text-foreground">↑↓ {isDe ? "Sortierung" : "Сортировка"}</span>{" "}
          —{" "}
          {isDe
            ? "mehrstufige Sortierung; Klick auf Spaltenkopf — schnelles Toggle, Shift+Klick — hinzufügen."
            : "многоступенчатая сортировка; клик по заголовку — быстрый toggle, Shift+клик — добавить."}
        </li>
        <li>
          <span className="font-medium text-foreground">{isDe ? "Spalten" : "Колонки"}</span>{" "}
          —{" "}
          {isDe
            ? "Sichtbarkeit + Fixierung links (max 3 fixierte)."
            : "видимость + закрепление слева (до 3 закреплённых)."}
        </li>
        <li>
          <span className="font-medium text-foreground">{isDe ? "Dichte" : "Плотность"}</span>{" "}
          —{" "}
          {isDe
            ? "Zeilenhöhe: Komfortabel / Kompakt / Dicht."
            : "высота строк: Свободно / Компактно / Плотно."}
        </li>
        <li>
          <span className="font-medium text-foreground">{isDe ? "Spaltenbreite" : "Ширина колонок"}</span>{" "}
          —{" "}
          {isDe
            ? "rechte Kante des Headers ziehen; wird im Browser gespeichert."
            : "тяни правый край заголовка; сохраняется в браузере."}
        </li>
      </ul>
    </GuideSection>
  );
}
