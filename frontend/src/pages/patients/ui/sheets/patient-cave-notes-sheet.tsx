import { useReducer, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  Section as FormSection,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const caveTextareaClassName = cn(
  textareaClass,
  "min-h-[200px] border-rose-200 bg-rose-50/40 text-rose-900 placeholder:text-rose-400 focus:border-rose-400 focus:ring-rose-200/60",
);

export function PatientCaveNotesSheet({
  patientId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  initial: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <PatientCaveNotesSheetContent
      key={`${patientId}:${open ? "open" : "closed"}:${initial}`}
      patientId={patientId}
      initial={initial}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientCaveNotesSheetContent({
  patientId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  initial: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [value, setValue] = useReducer((_current: string, next: string) => next, initial);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/update`, {
        method: "POST",
        body: JSON.stringify({
          clinical_warnings: value.trim() || null,
        }),
      });
      toast.success(l("CAVE-Hinweise gespeichert.", "Заметки CAVE сохранены.", "Cave notes saved."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      title={l("CAVE-Hinweise aktualisieren", "Обновить заметки CAVE", "Update cave notes")}
      width="narrow"
      onSubmit={handleSubmit}
      bodyClassName="px-4 py-4 space-y-3"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            {t.common_cancel}
          </Button>
          <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={busy}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t.common_save}
          </Button>
        </>
      }
    >
      <FormSection title={l("Warnhinweise", "Предупреждения", "Warnings")}>
        <p className="text-[12.5px] text-muted-foreground">
          {l(
            "Dauerhafte klinische Warnhinweise, die vor Beginn von Koordination oder Behandlung sichtbar bleiben sollen.",
            "Постоянные клинические предупреждения, которые должны оставаться видимыми до начала координации или лечения.",
            "Persistent clinical warnings that should stay visible before coordination or treatment starts.",
          )}
        </p>
        <FormField
          label={l("CAVE", "CAVE", "CAVE")}
          htmlFor="patient-cave-notes"
        >
        <textarea
          id="patient-cave-notes"
          className={caveTextareaClassName}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={l(
            "Allergien, kritische Kontraindikationen, Hochrisiko-Vorerkrankungen...",
            "Аллергии, критические противопоказания, состояния высокого риска...",
            "Allergies, critical contraindications, high-risk conditions...",
          )}
        />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
