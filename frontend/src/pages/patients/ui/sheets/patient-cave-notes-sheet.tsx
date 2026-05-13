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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
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
      toast.success(l("patients_cave_notes_saved"));
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
      title={l("patients_update_cave_notes")}
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
      <FormSection title={l("patients_warnings")}>
        <p className="text-[12.5px] text-muted-foreground">
          {l("patients_persistent_clinical_warnings_that_should_stay_visible_be")}
        </p>
        <FormField
          label={l("patients_cave")}
          htmlFor="patient-cave-notes"
        >
        <textarea
          id="patient-cave-notes"
          className={caveTextareaClassName}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={l("patients_allergies_critical_contraindications_high_risk_condition")}
        />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
