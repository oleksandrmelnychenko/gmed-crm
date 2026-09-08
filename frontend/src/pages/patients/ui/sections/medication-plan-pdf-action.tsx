import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PdfFileIcon } from "@/components/pdf-file-icon";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { apiFetch, ApiRequestError, downloadApiFile } from "@/lib/api";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { hasCurrentPlanMedications } from "../../data/medication-plan-availability";
import type { PatientClinicalProfile } from "../../data/patient-clinical";

export function MedicationPlanPdfAction({ patientId, lang, disabled = false, className }: {
  patientId: string;
  lang: "ru" | "de";
  disabled?: boolean;
  className?: string;
}) {
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
    "Нет актуальных препаратов для медикаментозного плана.",
    "Keine aktuellen Medikamente für den Medikationsplan vorhanden.",
  );
  const status = availability?.patientId === patientId && availability.version === version
    ? availability.status : "loading";

  useDebouncedRealtimeSubscription(["patient.clinical_updated"], (_event, events) => {
    if (events.some((event) => event.patient_id === patientId)) {
      setVersion((current) => current + 1);
    }
  });

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      void apiFetch<Pick<PatientClinicalProfile, "medications">>(
        `/patients/${encodeURIComponent(patientId)}/clinical`, { forceFresh: true },
      ).then((response) => {
        if (!active || request !== latestRequest) return;
        setAvailability({
          patientId, version,
          status: Array.isArray(response.medications)
            ? hasCurrentPlanMedications(response.medications) ? "available" : "empty"
            : "unknown",
        });
      }).catch(() => {
        if (active && request === latestRequest) {
          // A failed availability check must not permanently block a PDF retry.
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
  }, [patientId, version]);

  async function download() {
    if (!patientId || disabled || status === "loading" || status === "empty" || pending.current) return;
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
      if (empty) {
        setAvailability({ patientId, version, status: "empty" });
        toast.info(emptyMessage);
      } else {
        toast.error(tx("Не удалось сформировать медикаментозный план. Повторите попытку.", "Der Medikationsplan konnte nicht erstellt werden. Bitte erneut versuchen."));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Button type="button" size="sm" variant="outline"
    className={cn("h-8 gap-1.5 rounded-lg px-3", className)}
    disabled={!patientId || disabled || busy || status === "loading" || status === "empty"} aria-busy={busy}
    title={status === "empty" ? emptyMessage : tx("Скачать план актуальных препаратов", "Plan der aktuellen Medikamente herunterladen")}
    onClick={() => void download()}>
    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <PdfFileIcon />}
    {tx("Медикаментозный план (PDF)", "Medikationsplan (PDF)")}
  </Button>;
}
