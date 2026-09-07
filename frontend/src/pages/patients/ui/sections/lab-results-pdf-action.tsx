import { useRef, useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ApiRequestError, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export function LabResultsPdfAction({ patientId, disabled = false }: {
  patientId: string;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;

  async function download() {
    if (!patientId || disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await downloadApiFile(
        `/patients/${encodeURIComponent(patientId)}/lab-results.pdf?lang=${lang}`,
        "laborergebnisse.pdf",
        { cache: "no-store" },
      );
    } catch (error) {
      const empty = error instanceof ApiRequestError
        && (error.code === "lab_results_empty"
          || (error.status === 422 && error.message === "lab_results_empty"));
      toast.error(empty
        ? tx("Нет лабораторных результатов для экспорта.", "Keine Laborergebnisse für den Export vorhanden.")
        : tx("Не удалось сформировать лабораторный отчёт. Повторите попытку.", "Der Laborbericht konnte nicht erstellt werden. Bitte erneut versuchen."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Button
    type="button"
    size="sm"
    variant="outline"
    className="h-8 gap-1.5 rounded-lg px-3"
    disabled={!patientId || disabled || busy}
    aria-busy={busy}
    title={tx("Скачать лабораторные результаты", "Laborergebnisse herunterladen")}
    onClick={() => void download()}
  >
    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
    {tx("Лабораторные результаты (PDF)", "Laborergebnisse (PDF)")}
  </Button>;
}
