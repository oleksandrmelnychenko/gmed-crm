import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const textareaClassName =
  "min-h-[240px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {l("Notizen bearbeiten", "Редактировать заметки", "Edit notes")}
          </SheetTitle>
        </SheetHeader>

        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-notes"
              >
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="patient-notes"
                className={textareaClassName}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={l(
                  "Allgemeine Notizen, Kontext, Präferenzen…",
                  "Общие заметки, контекст, предпочтения…",
                  "General notes, context, preferences…",
                )}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 px-4 py-3">
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
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
