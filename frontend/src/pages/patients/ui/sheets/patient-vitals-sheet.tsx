import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field as FormField,
  Section as FormSection,
  inputClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type FormState = {
  measuredAt: string;
  bpSystolic: string;
  bpDiastolic: string;
  heartRate: string;
  weightKg: string;
  heightCm: string;
  bmi: string;
  notes: string;
};

function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function blankForm(): FormState {
  return {
    measuredAt: toLocalDateTimeInput(new Date()),
    bpSystolic: "",
    bpDiastolic: "",
    heartRate: "",
    weightKg: "",
    heightCm: "",
    bmi: "",
    notes: "",
  };
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined;
}

function computeBmi(weightKg: string, heightCm: string): number | null {
  const weight = parseNumber(weightKg);
  const height = parseNumber(heightCm);
  if (weight == null || height == null || height <= 0) return null;
  const heightM = height / 100;
  return Math.round((weight / (heightM * heightM)) * 10) / 10;
}

function formatBmi(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

const vitalsTextareaClassName = cn(textareaClass, "min-h-[80px]");

export function PatientVitalsSheet({
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setForm(blankForm());
  }, [open]);

  const bmiPreview = useMemo(
    () => computeBmi(form.weightKg, form.heightCm),
    [form.weightKg, form.heightCm],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const measuredAt = new Date(form.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) {
      toast.error(l("Ungueltiges Datum.", "Nekorrektnaya data.", "Invalid date."));
      return;
    }
    const bmiOverride = parseNumber(form.bmi);
    const bmiValue = bmiOverride ?? bmiPreview ?? undefined;

    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/vitals`, {
        method: "POST",
        body: JSON.stringify({
          measured_at: measuredAt.toISOString(),
          bp_systolic: parseNumber(form.bpSystolic),
          bp_diastolic: parseNumber(form.bpDiastolic),
          heart_rate: parseInteger(form.heartRate),
          weight_kg: parseNumber(form.weightKg),
          height_cm: parseNumber(form.heightCm),
          bmi: bmiValue,
          notes: form.notes.trim() || null,
        }),
      });
      toast.success(l("Vitalwert gespeichert.", "Pokazatel sohranen.", "Vital measurement saved."));
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
      maxWidthClassName="sm:max-w-[540px]"
      onSubmit={handleSubmit}
      title={
        <span className="flex w-full items-center justify-between gap-2">
          <span>
            {l("Vitalwert erfassen", "Dobavit pokazatel", "Add vital measurement")}
          </span>
          {bmiPreview != null ? (
            <Badge
              variant="outline"
              className="rounded-full border-sky-200 bg-sky-50 text-[11px] text-sky-700"
            >
              {l("BMI", "BMI", "BMI")} {formatBmi(bmiPreview)}
            </Badge>
          ) : null}
        </span>
      }
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
      <FormSection title={l("Messung", "Измерение", "Measurement")}>
        <FormField
          label={l("Gemessen am", "Измерено", "Measured at")}
          htmlFor="patient-vitals-measured-at"
        >
          <Input
            id="patient-vitals-measured-at"
            type="datetime-local"
            value={form.measuredAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, measuredAt: event.target.value }))
            }
            className={inputClass}
            required
          />
        </FormField>

        <div className="grid gap-3 md:grid-cols-3">
          <FormField
            label={l("RR systolisch", "АД систолическое", "BP systolic")}
            htmlFor="patient-vitals-bp-systolic"
          >
            <Input
              id="patient-vitals-bp-systolic"
              inputMode="decimal"
              value={form.bpSystolic}
              onChange={(event) =>
                setForm((current) => ({ ...current, bpSystolic: event.target.value }))
              }
              className={inputClass}
              placeholder="mmHg"
            />
          </FormField>
          <FormField
            label={l("RR diastolisch", "АД диастолическое", "BP diastolic")}
            htmlFor="patient-vitals-bp-diastolic"
          >
            <Input
              id="patient-vitals-bp-diastolic"
              inputMode="decimal"
              value={form.bpDiastolic}
              onChange={(event) =>
                setForm((current) => ({ ...current, bpDiastolic: event.target.value }))
              }
              className={inputClass}
              placeholder="mmHg"
            />
          </FormField>
          <FormField
            label={l("Herzfrequenz", "ЧСС", "Heart rate")}
            htmlFor="patient-vitals-heart-rate"
          >
            <Input
              id="patient-vitals-heart-rate"
              inputMode="numeric"
              value={form.heartRate}
              onChange={(event) =>
                setForm((current) => ({ ...current, heartRate: event.target.value }))
              }
              className={inputClass}
              placeholder="bpm"
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={l("Anthropometrie", "Антропометрия", "Anthropometry")}>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField
            label={l("Gewicht (kg)", "Вес (кг)", "Weight (kg)")}
            htmlFor="patient-vitals-weight"
          >
            <Input
              id="patient-vitals-weight"
              inputMode="decimal"
              value={form.weightKg}
              onChange={(event) =>
                setForm((current) => ({ ...current, weightKg: event.target.value }))
              }
              className={inputClass}
            />
          </FormField>
          <FormField
            label={l("Groesse (cm)", "Рост (см)", "Height (cm)")}
            htmlFor="patient-vitals-height"
          >
            <Input
              id="patient-vitals-height"
              inputMode="decimal"
              value={form.heightCm}
              onChange={(event) =>
                setForm((current) => ({ ...current, heightCm: event.target.value }))
              }
              className={inputClass}
            />
          </FormField>
          <FormField
            label={l("BMI (optional)", "BMI (опционально)", "BMI (optional)")}
            htmlFor="patient-vitals-bmi"
          >
            <Input
              id="patient-vitals-bmi"
              inputMode="decimal"
              value={form.bmi}
              onChange={(event) =>
                setForm((current) => ({ ...current, bmi: event.target.value }))
              }
              className={inputClass}
              placeholder={bmiPreview != null ? formatBmi(bmiPreview) : ""}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={l("Zusatzlich", "Дополнительно", "Additional")}>
        <FormField label={l("Notizen", "Заметки", "Notes")} htmlFor="patient-vitals-notes">
          <textarea
            id="patient-vitals-notes"
            className={vitalsTextareaClassName}
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder={l(
              "Klinischer Kontext, Beobachtungen, Umstaende.",
              "Клинический контекст, наблюдения, обстоятельства.",
              "Clinical context, observations, circumstances.",
            )}
          />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
