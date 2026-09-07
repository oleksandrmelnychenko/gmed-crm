import { useRef, useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ApiRequestError, downloadApiFile } from "@/lib/api";
import { cn } from "@/lib/utils";

export function MedicationPlanPdfAction({ patientId, lang, disabled = false, className }: {
  patientId: string;
  lang: "ru" | "de";
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;

  async function download() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await downloadApiFile(
        `/patients/${encodeURIComponent(patientId)}/medikationsplan.pdf?lang=${lang}`,
        "medikationsplan.pdf",
        { cache: "no-store" },
      );
    } catch (error) {
      const empty = error instanceof ApiRequestError
        && (error.code === "medication_plan_empty"
          || (error.status === 422 && error.message === "medication_plan_empty"));
      toast.error(empty
        ? tx("Нет актуальных препаратов для медикаментозного плана.", "Keine aktuellen Medikamente für den Medikationsplan vorhanden.")
        : tx("Не удалось сформировать медикаментозный план. Повторите попытку.", "Der Medikationsplan konnte nicht erstellt werden. Bitte erneut versuchen."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Button type="button" size="sm" variant="outline"
    className={cn("h-8 gap-1.5 rounded-lg px-3", className)}
    disabled={disabled || busy} aria-busy={busy}
    title={tx("Скачать план актуальных препаратов", "Plan der aktuellen Medikamente herunterladen")}
    onClick={() => void download()}>
    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
    {tx("Медикаментозный план (PDF)", "Medikationsplan (PDF)")}
  </Button>;
}
