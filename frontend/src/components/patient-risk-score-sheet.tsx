import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const SCORE_TYPE_OPTIONS = [
  "cha2ds2_vasc",
  "has_bled",
  "framingham",
  "fall_risk",
  "frailty",
  "nutrition_risk",
  "other",
] as const;

type ScoreType = (typeof SCORE_TYPE_OPTIONS)[number];

function scoreTypeLabel(
  value: string,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "cha2ds2_vasc":
      return "CHA2DS2-VASc";
    case "has_bled":
      return "HAS-BLED";
    case "framingham":
      return "Framingham";
    case "fall_risk":
      return l("Sturzrisiko", "Риск падения", "Fall risk");
    case "frailty":
      return l("Gebrechlichkeit", "Хрупкость", "Frailty");
    case "nutrition_risk":
      return l("Ernährungsrisiko", "Риск питания", "Nutrition risk");
    case "other":
      return l("Sonstiges", "Другое", "Other");
    default:
      return value.replaceAll("_", " ");
  }
}

function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

type FormState = {
  computedAt: string;
  scoreType: ScoreType;
  scoreValue: string;
  scaleMax: string;
  interpretation: string;
  source: string;
  inputsJson: string;
};

function blankForm(): FormState {
  return {
    computedAt: toLocalDateTimeInput(new Date()),
    scoreType: SCORE_TYPE_OPTIONS[0],
    scoreValue: "",
    scaleMax: "",
    interpretation: "",
    source: "",
    inputsJson: "",
  };
}

const textareaClassName =
  "min-h-[96px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

export function PatientRiskScoreSheet({
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

  useEffect(() => {
    if (!open) setForm(blankForm());
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const computedAt = new Date(form.computedAt);
    if (Number.isNaN(computedAt.getTime())) {
      toast.error(l("Ungültiges Datum.", "Некорректная дата.", "Invalid date."));
      return;
    }
    const scoreValue = parseNumber(form.scoreValue);
    if (scoreValue == null) {
      toast.error(l("Wert ist erforderlich.", "Значение обязательно.", "Score value is required."));
      return;
    }
    const scaleMax = parseNumber(form.scaleMax);

    let inputs: Record<string, unknown> | undefined;
    if (form.inputsJson.trim()) {
      try {
        const parsed = JSON.parse(form.inputsJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        inputs = parsed as Record<string, unknown>;
      } catch {
        toast.error(l("Eingaben müssen JSON-Objekt sein.", "Входные данные должны быть JSON-объектом.", "Inputs must be a JSON object."));
        return;
      }
    }

    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/risk-scores`, {
        method: "POST",
        body: JSON.stringify({
          computed_at: computedAt.toISOString(),
          score_type: form.scoreType,
          score_value: scoreValue,
          scale_max: scaleMax,
          interpretation: form.interpretation.trim() || null,
          source: form.source.trim() || null,
          inputs,
        }),
      });
      toast.success(l("Risikoscore gespeichert.", "Риск-скор сохранён.", "Risk score saved."));
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
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {l("Risikoscore hinzufügen", "Добавить риск-скор", "Add risk score")}
          </SheetTitle>
        </SheetHeader>
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-computed-at">
                  {l("Berechnet am", "Рассчитано", "Computed at")}
                </Label>
                <Input
                  id="patient-risk-score-computed-at"
                  type="datetime-local"
                  value={form.computedAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, computedAt: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-type">
                  {l("Score-Typ", "Тип скора", "Score type")}
                </Label>
                <ShadSelect
                  value={form.scoreType}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      scoreType: (value ?? SCORE_TYPE_OPTIONS[0]) as ScoreType,
                    }))
                  }
                >
                  <SelectTrigger id="patient-risk-score-type" className="w-full">
                    <SelectValue placeholder={l("Typ wählen", "Выберите тип", "Select score type")}>
                      {form.scoreType ? scoreTypeLabel(form.scoreType, l) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCORE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {scoreTypeLabel(option, l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-value">
                  {l("Wert", "Значение", "Score value")}
                </Label>
                <Input
                  id="patient-risk-score-value"
                  inputMode="decimal"
                  value={form.scoreValue}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, scoreValue: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-scale-max">
                  {l("Skalen-Max", "Макс. шкалы", "Scale max")}
                </Label>
                <Input
                  id="patient-risk-score-scale-max"
                  inputMode="decimal"
                  value={form.scaleMax}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, scaleMax: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-source">
                  {l("Quelle", "Источник", "Source")}
                </Label>
                <Input
                  id="patient-risk-score-source"
                  value={form.source}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-interpretation">
                {l("Interpretation", "Интерпретация", "Interpretation")}
              </Label>
              <textarea
                id="patient-risk-score-interpretation"
                className={textareaClassName}
                value={form.interpretation}
                onChange={(event) =>
                  setForm((current) => ({ ...current, interpretation: event.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-inputs">
                {l("Eingaben (JSON)", "Входные данные (JSON)", "Inputs (JSON)")}
              </Label>
              <textarea
                id="patient-risk-score-inputs"
                className={textareaClassName}
                value={form.inputsJson}
                onChange={(event) =>
                  setForm((current) => ({ ...current, inputsJson: event.target.value }))
                }
                placeholder='{"age": 72, "bmi": 27}'
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
