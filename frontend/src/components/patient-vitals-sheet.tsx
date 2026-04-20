import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const textareaClassName =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
      toast.error(l("Ungültiges Datum.", "Некорректная дата.", "Invalid date."));
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
      toast.success(l("Vitalwert gespeichert.", "Показатель сохранён.", "Vital measurement saved."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[540px] gap-0">
        <SheetHeader className="px-4 py-3 flex-row items-center justify-between">
          <SheetTitle>
            {l("Vitalwert erfassen", "Добавить показатель", "Add vital measurement")}
          </SheetTitle>
          {bmiPreview != null ? (
            <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700 text-[11px]">
              {l("BMI", "BMI", "BMI")} {formatBmi(bmiPreview)}
            </Badge>
          ) : null}
        </SheetHeader>

        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-measured-at">
                  {l("Gemessen am", "Измерено", "Measured at")}
                </Label>
                <Input
                  id="patient-vitals-measured-at"
                  type="datetime-local"
                  value={form.measuredAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, measuredAt: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-bp-systolic">
                  {l("RR systolisch", "Систолическое АД", "BP systolic")}
                </Label>
                <Input
                  id="patient-vitals-bp-systolic"
                  inputMode="decimal"
                  value={form.bpSystolic}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, bpSystolic: event.target.value }))
                  }
                  placeholder="mmHg"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-bp-diastolic">
                  {l("RR diastolisch", "Диастолическое АД", "BP diastolic")}
                </Label>
                <Input
                  id="patient-vitals-bp-diastolic"
                  inputMode="decimal"
                  value={form.bpDiastolic}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, bpDiastolic: event.target.value }))
                  }
                  placeholder="mmHg"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-heart-rate">
                  {l("Herzfrequenz", "ЧСС", "Heart rate")}
                </Label>
                <Input
                  id="patient-vitals-heart-rate"
                  inputMode="numeric"
                  value={form.heartRate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, heartRate: event.target.value }))
                  }
                  placeholder="bpm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-weight">
                  {l("Gewicht (kg)", "Вес (кг)", "Weight (kg)")}
                </Label>
                <Input
                  id="patient-vitals-weight"
                  inputMode="decimal"
                  value={form.weightKg}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weightKg: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-height">
                  {l("Größe (cm)", "Рост (см)", "Height (cm)")}
                </Label>
                <Input
                  id="patient-vitals-height"
                  inputMode="decimal"
                  value={form.heightCm}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, heightCm: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-bmi">
                  {l("BMI (optional)", "BMI (опционально)", "BMI (optional)")}
                </Label>
                <Input
                  id="patient-vitals-bmi"
                  inputMode="decimal"
                  value={form.bmi}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, bmi: event.target.value }))
                  }
                  placeholder={bmiPreview != null ? formatBmi(bmiPreview) : ""}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-vitals-notes">
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="patient-vitals-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={l(
                  "Klinischer Kontext, Beobachtungen, Umstände.",
                  "Клинический контекст, наблюдения, обстоятельства.",
                  "Clinical context, observations, circumstances.",
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
