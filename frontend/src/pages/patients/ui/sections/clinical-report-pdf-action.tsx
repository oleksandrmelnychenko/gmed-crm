import { useMemo, useRef, useState } from "react";
import { Check, FileText, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const CLINICAL_REPORT_SECTIONS = [
  { key: "warnings", ru: "Аллергии и CAVE", de: "Allergien und CAVE" },
  { key: "diagnoses", ru: "Диагнозы", de: "Diagnosen" },
  { key: "procedures", ru: "Процедуры", de: "Prozeduren" },
  { key: "anamnesis", ru: "Анамнез и осмотр", de: "Anamnese und Untersuchung" },
  { key: "examinations", ru: "Выполненные обследования", de: "Abgeschlossene Untersuchungen" },
  { key: "follow_up", ru: "Динамика и наблюдение", de: "Verlauf" },
  { key: "assessment", ru: "Оценка и заключение врача", de: "Ärztliche Beurteilung" },
  { key: "recommendations", ru: "Рекомендации", de: "Empfehlungen" },
  { key: "medications", ru: "Актуальная медикация", de: "Aktuelle Medikation" },
  { key: "vitals", ru: "Последние витальные показатели", de: "Letzte Vitalparameter" },
  { key: "vaccination", ru: "Прививочный статус", de: "Impfstatus" },
] as const;

type ClinicalReportSectionKey = typeof CLINICAL_REPORT_SECTIONS[number]["key"];

export function ClinicalReportPdfAction({ patientId }: { patientId: string }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ClinicalReportSectionKey[]>(() =>
    CLINICAL_REPORT_SECTIONS.map((section) => section.key),
  );
  const pending = useRef(false);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const allKeys = useMemo(
    () => CLINICAL_REPORT_SECTIONS.map((section) => section.key),
    [],
  );

  function setDialogOpen(nextOpen: boolean) {
    if (busy) return;
    if (nextOpen) setSelected(allKeys);
    setOpen(nextOpen);
  }

  function toggle(key: ClinicalReportSectionKey) {
    setSelected((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : allKeys.filter((item) => item === key || current.includes(item)));
  }

  async function download() {
    if (!patientId || selected.length === 0 || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const params = new URLSearchParams({ lang, sections: selected.join(",") });
      await downloadApiFile(
        `/patients/${encodeURIComponent(patientId)}/clinical.pdf?${params.toString()}`,
        "medizinische-zusammenfassung.pdf",
        { cache: "no-store" },
      );
      setOpen(false);
    } catch {
      toast.error(tx(
        "Не удалось сформировать медицинскую сводку. Повторите попытку.",
        "Die medizinische Zusammenfassung konnte nicht erstellt werden. Bitte erneut versuchen.",
      ));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-9 gap-1.5 rounded-lg px-3.5"
      disabled={!patientId}
      title={tx(
        "Сформировать медицинскую сводку из сохранённых данных пациента",
        "Medizinische Zusammenfassung aus den gespeicherten Patientendaten erstellen",
      )}
      onClick={() => setDialogOpen(true)}
    >
      <FileText className="size-3.5" aria-hidden />
      {tx("Медицинская сводка (PDF)", "Medizinische Zusammenfassung (PDF)")}
    </Button>

    <Dialog open={open} onOpenChange={setDialogOpen} allowImplicitDismissal>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[92dvh] sm:max-w-2xl sm:pb-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border/70 bg-muted/20 px-4 py-3.5 pr-12 sm:px-5 sm:pr-14">
          <DialogTitle className="flex min-w-0 items-start gap-2 pr-0 text-base leading-snug sm:leading-snug">
            <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
            <span>{tx("Состав медицинской сводки", "Inhalt der medizinischen Zusammenfassung")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {tx(
              "Выберите разделы, которые должны войти в PDF.",
              "Wählen Sie die Abschnitte aus, die in das PDF aufgenommen werden sollen.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground" role="status">
                {tx("Выбрано", "Ausgewählt")}
                <Badge variant="secondary" className="tabular-nums">{selected.length} / {allKeys.length}</Badge>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" disabled={busy || selected.length === allKeys.length} onClick={() => setSelected(allKeys)}>
                  {tx("Выбрать все", "Alle auswählen")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" disabled={busy || selected.length === 0} onClick={() => setSelected([])}>
                  {tx("Снять выбор", "Auswahl aufheben")}
                </Button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2">
              {CLINICAL_REPORT_SECTIONS.map((section) => {
                const checked = selected.includes(section.key);
                return <label
                  key={section.key}
                  className={cn(
                    "flex min-h-10 min-w-0 items-center gap-2.5 border-b border-border/60 px-3 py-2 text-[13px] leading-5 last:border-b-0 sm:odd:border-r sm:last:col-span-2 sm:last:border-r-0",
                    busy ? "cursor-default opacity-60" : "cursor-pointer hover:bg-muted/30",
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(section.key)}
                  />
                  <span className={cn(
                    "pointer-events-none flex size-4 shrink-0 items-center justify-center rounded-sm border peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-field",
                  )} aria-hidden>
                    {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                  </span>
                  <span className="min-w-0 break-words">{tx(section.ru, section.de)}</span>
                </label>;
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 border-t border-border/70 bg-muted/20 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button type="button" size="sm" variant="outline" className="h-9 rounded-md sm:h-8" disabled={busy} onClick={() => setDialogOpen(false)}>
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-md sm:h-8"
            disabled={selected.length === 0 || busy}
            aria-busy={busy}
            onClick={() => void download()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
            {tx("Скачать PDF", "PDF herunterladen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
