import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FormSection } from "../shared/patient-form-primitives";
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
  l: (key: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
): string {
  switch (value) {
    case "medical_update":
      return l("patients_medical_update");
    case "patient_report":
      return l("patients_patient_report");
    case "provider_report":
      return l("patients_provider_report");
    case "treatment_note":
      return l("patients_treatment_note");
    case "followup_note":
      return l("patients_follow_up_note");
    case "warning":
      return l("patients_warning");
    case "other":
      return l("patients_other");
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entryDate = new Date(form.entryDate);
    if (Number.isNaN(entryDate.getTime())) {
      toast.error(l("patients_invalid_date"));
      return;
    }
    if (!form.content.trim()) {
      toast.error(l("patients_content_required"));
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
      toast.success(l("patients_entry_saved"));
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
      title={l("patients_add_card_entry")}
      maxWidthClassName="sm:max-w-[540px]"
      onSubmit={handleSubmit}
      bodyClassName="space-y-4 px-5 py-4"
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
      <FormSection title={l("patients_entry")}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label={l("patients_entry_date")} htmlFor="patient-card-entry-date">
            <Input
              id="patient-card-entry-date"
              type="datetime-local"
              value={form.entryDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, entryDate: event.target.value }))
              }
              required
            />
          </FormField>
          <FormField label={l("patients_category")} htmlFor="patient-card-entry-category">
            <NativeComboboxSelect
              id="patient-card-entry-category"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: (event.target.value ?? CATEGORY_OPTIONS[0]) as CategoryValue,
                }))
              }
              className={cn("w-full", selectClass)}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {categoryLabel(option, l, t)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
        </div>

        <FormField label={l("patients_source")} htmlFor="patient-card-entry-source">
          <Input
            id="patient-card-entry-source"
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            placeholder={l("patients_patient_clinic_doctor_phone_follow_up")}
          />
        </FormField>
      </FormSection>

      <FormSection title={l("patients_content")}>
        <FormField label={l("patients_note")} htmlFor="patient-card-entry-content">
          <textarea
            id="patient-card-entry-content"
            className={cardEntryTextareaClassName}
            value={form.content}
            onChange={(event) =>
              setForm((current) => ({ ...current, content: event.target.value }))
            }
            required
          />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
