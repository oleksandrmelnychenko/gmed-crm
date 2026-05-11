import { useReducer, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { textareaClass } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const notesTextareaClassName = cn(textareaClass, "min-h-[240px]");

export function PatientNotesSheet({
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
    <PatientNotesSheetContent
      key={`${patientId}:${open ? "open" : "closed"}:${initial}`}
      patientId={patientId}
      initial={initial}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientNotesSheetContent({
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
          notes: value.trim() || null,
        }),
      });
      toast.success(l("Notizen gespeichert.", "Заметки сохранены.", "Notes saved."));
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
      title={l("Notizen bearbeiten", "Редактировать заметки", "Edit notes")}
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
      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-notes"
        >
          {l("Notizen", "Заметки", "Notes")}
        </Label>
        <textarea
          id="patient-notes"
          className={notesTextareaClassName}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={l(
            "Allgemeine Notizen, Kontext, Praferenzen...",
            "Общие заметки, контекст, предпочтения...",
            "General notes, context, preferences...",
          )}
        />
      </div>
    </PatientSheetScaffold>
  );
}
