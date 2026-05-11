import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { selectClass, textareaClass } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const CATEGORY_OPTIONS = [
  "medical_update",
  "patient_report",
  "provider_report",
  "treatment_note",
  "followup_note",
  "warning",
  "other",
] as const;

function categoryLabel(
  value: string,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
): string {
  switch (value) {
    case "medical_update":
      return l("Medizinisches Update", "Медицинское обновление", "Medical update");
    case "patient_report":
      return l("Bericht des Patienten", "Сообщение пациента", "Patient report");
    case "provider_report":
      return l("Bericht der Klinik", "Отчет провайдера", "Provider report");
    case "treatment_note":
      return l("Behandlungsnotiz", "Заметка по лечению", "Treatment note");
    case "followup_note":
      return l("Nachsorge-Notiz", "Заметка по наблюдению", "Follow-up note");
    case "warning":
      return l("Warnhinweis", "Предупреждение", "Warning");
    case "other":
      return l("Sonstiges", "Другое", "Other");
    default:
      return formatUnknownValue(value, translations);
  }
}

function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type CategoryValue = (typeof CATEGORY_OPTIONS)[number];
type FormState = {
  entryDate: string;
  category: CategoryValue;
  source: string;
  content: string;
};

function blankForm(): FormState {
  return {
    entryDate: toLocalDateTimeInput(new Date()),
    category: CATEGORY_OPTIONS[0],
    source: "",
    content: "",
  };
}

const cardEntryTextareaClassName = cn(textareaClass, "min-h-[96px]");

export function PatientCardEntrySheet({
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <PatientCardEntrySheetContent
      key={`${patientId}:${open ? "open" : "closed"}`}
      patientId={patientId}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientCardEntrySheetContent({
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entryDate = new Date(form.entryDate);
    if (Number.isNaN(entryDate.getTime())) {
      toast.error(l("Ungultiges Datum.", "Некорректная дата.", "Invalid date."));
      return;
    }
    if (!form.content.trim()) {
      toast.error(l("Inhalt ist erforderlich.", "Содержание обязательно.", "Content required."));
      return;
    }

    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/card-entries`, {
        method: "POST",
        body: JSON.stringify({
          entry_date: entryDate.toISOString(),
          category: form.category,
          source: form.source.trim() || null,
          content: form.content.trim(),
        }),
      });
      toast.success(l("Eintrag gespeichert.", "Запись сохранена.", "Entry saved."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      title={l("Karteneintrag hinzufugen", "Добавить запись в карту", "Add card entry")}
      maxWidthClassName="sm:max-w-[540px]"
      onSubmit={handleSubmit}
      bodyClassName="px-4 py-4 space-y-4"
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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-card-entry-date"
          >
            {l("Eintragsdatum", "Дата записи", "Entry date")}
          </Label>
          <Input
            id="patient-card-entry-date"
            type="datetime-local"
            value={form.entryDate}
            onChange={(event) =>
              setForm((current) => ({ ...current, entryDate: event.target.value }))
            }
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-card-entry-category"
          >
            {l("Kategorie", "Категория", "Category")}
          </Label>
          <NativeComboboxSelect
            value={form.category}


            onChange={(event) => setForm((current) => ({
                ...current,
                category: (event.target.value ?? CATEGORY_OPTIONS[0]) as CategoryValue,
              }))} id="patient-card-entry-category" className={cn("w-full", selectClass)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {categoryLabel(option, l, t)}
                </option>
              ))}
            </NativeComboboxSelect>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-card-entry-source"
        >
          {l("Quelle", "Источник", "Source")}
        </Label>
        <Input
          id="patient-card-entry-source"
          value={form.source}
          onChange={(event) =>
            setForm((current) => ({ ...current, source: event.target.value }))
          }
          placeholder={l(
            "Patient, Klinik, Arzt, telefonische Nachverfolgung",
            "Пациент, клиника, врач, follow-up по телефону",
            "Patient, clinic, doctor, phone follow-up",
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-card-entry-content"
        >
          {l("Inhalt", "Содержание", "Content")}
        </Label>
        <textarea
          id="patient-card-entry-content"
          className={cardEntryTextareaClassName}
          value={form.content}
          onChange={(event) =>
            setForm((current) => ({ ...current, content: event.target.value }))
          }
          required
        />
      </div>
    </PatientSheetScaffold>
  );
}
