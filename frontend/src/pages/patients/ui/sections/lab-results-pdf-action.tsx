import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PdfFileIcon } from "@/components/pdf-file-icon";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { apiFetch, ApiRequestError, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";

export function LabResultsPdfAction({ patientId, disabled = false, hasResults, className }: {
  patientId: string;
  disabled?: boolean;
  hasResults?: boolean;
  className?: string;
}) {
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [availability, setAvailability] = useState<{
    patientId: string;
    version: number;
    status: "available" | "empty" | "unknown";
  } | null>(null);
  const pending = useRef(false);
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const emptyMessage = tx(
    "У пациента пока нет сохранённых результатов анализов.",
    "Für diesen Patienten sind noch keine Laborergebnisse gespeichert.",
  );
  const status = hasResults !== undefined
    ? hasResults ? "available" : "empty"
    : availability?.patientId === patientId && availability.version === version
      ? availability.status
      : "loading";

  useDebouncedRealtimeSubscription(["patient.clinical_updated"], (_event, events) => {
    if (hasResults === undefined && events.some((event) => event.patient_id === patientId)) {
      setVersion((current) => current + 1);
    }
  });

  useEffect(() => {
    if (!patientId || hasResults !== undefined) return;
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      void apiFetch<{ items: unknown[] }>(`/patients/${encodeURIComponent(patientId)}/lab-results`, {
        forceFresh: true,
      }).then((response) => {
        if (!active || request !== latestRequest) return;
        setAvailability({
          patientId,
          version,
          status: Array.isArray(response.items)
            ? response.items.length > 0 ? "available" : "empty"
            : "unknown",
        });
      }).catch(() => {
        if (active && request === latestRequest) {
          setAvailability({ patientId, version, status: "unknown" });
        }
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [hasResults, patientId, version]);

  async function download() {
    if (!patientId || disabled || status === "loading" || status === "empty" || pending.current) return;
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
      if (empty) {
        setAvailability({ patientId, version, status: "empty" });
        toast.info(emptyMessage);
      } else {
        toast.error(tx("Не удалось сформировать лабораторный отчёт. Повторите попытку.", "Der Laborbericht konnte nicht erstellt werden. Bitte erneut versuchen."));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Button
    type="button"
    size="sm"
    variant="outline"
    className={cn("h-8 gap-1.5 rounded-lg px-3", className)}
    disabled={!patientId || disabled || busy || status === "loading" || status === "empty"}
    aria-busy={busy}
    title={status === "empty" ? emptyMessage : tx("Скачать лабораторные результаты", "Laborergebnisse herunterladen")}
    onClick={() => void download()}
  >
    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <PdfFileIcon />}
    {tx("Лабораторные результаты (PDF)", "Laborergebnisse (PDF)")}
  </Button>;
}
