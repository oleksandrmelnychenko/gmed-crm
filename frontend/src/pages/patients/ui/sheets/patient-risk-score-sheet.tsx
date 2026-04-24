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
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

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
      return l("Sturzrisiko", "Risk padeniya", "Fall risk");
    case "frailty":
      return l("Gebrechlichkeit", "Hrupkost", "Frailty");
    case "nutrition_risk":
      return l("Ernaehrungsrisiko", "Risk pitaniya", "Nutrition risk");
    case "other":
      return l("Sonstiges", "Drugoe", "Other");
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

const riskScoreTextareaClassName = cn(textareaClass, "min-h-[96px]");

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
      toast.error(l("Ungueltiges Datum.", "Nekorrektnaya data.", "Invalid date."));
      return;
    }
    const scoreValue = parseNumber(form.scoreValue);
    if (scoreValue == null) {
      toast.error(l("Wert ist erforderlich.", "Znachenie obyazatelno.", "Score value is required."));
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
        toast.error(l("Eingaben muessen JSON-Objekt sein.", "Vhodnye dannye dolzhny byt JSON-obektom.", "Inputs must be a JSON object."));
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
      toast.success(l("Risikoscore gespeichert.", "Risk-skor sohranen.", "Risk score saved."));
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
      title={l("Risikoscore hinzufugen", "Dobavit risk-skor", "Add risk score")}
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
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-computed-at">
            {l("Berechnet am", "Rasschitano", "Computed at")}
          </Label>
          <Input
            id="patient-risk-score-computed-at"
            type="datetime-local"
            value={form.computedAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, computedAt: event.target.value }))
            }
            className={inputClass}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-type">
            {l("Score-Typ", "Tip skora", "Score type")}
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
            <SelectTrigger id="patient-risk-score-type" className={cn("w-full", selectClass)}>
              <SelectValue placeholder={l("Typ waehlen", "Vyberite tip", "Select score type")}>
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
            {l("Wert", "Znachenie", "Score value")}
          </Label>
          <Input
            id="patient-risk-score-value"
            inputMode="decimal"
            value={form.scoreValue}
            onChange={(event) =>
              setForm((current) => ({ ...current, scoreValue: event.target.value }))
            }
            className={inputClass}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-scale-max">
            {l("Skalen-Max", "Maks shkaly", "Scale max")}
          </Label>
          <Input
            id="patient-risk-score-scale-max"
            inputMode="decimal"
            value={form.scaleMax}
            onChange={(event) =>
              setForm((current) => ({ ...current, scaleMax: event.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-source">
            {l("Quelle", "Istochnik", "Source")}
          </Label>
          <Input
            id="patient-risk-score-source"
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-interpretation">
          {l("Interpretation", "Interpretaciya", "Interpretation")}
        </Label>
        <textarea
          id="patient-risk-score-interpretation"
          className={riskScoreTextareaClassName}
          value={form.interpretation}
          onChange={(event) =>
            setForm((current) => ({ ...current, interpretation: event.target.value }))
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-risk-score-inputs">
          {l("Eingaben (JSON)", "Vhodnye dannye (JSON)", "Inputs (JSON)")}
        </Label>
        <textarea
          id="patient-risk-score-inputs"
          className={riskScoreTextareaClassName}
          value={form.inputsJson}
          onChange={(event) =>
            setForm((current) => ({ ...current, inputsJson: event.target.value }))
          }
          placeholder='{"age": 72, "bmi": 27}'
        />
      </div>
    </PatientSheetScaffold>
  );
}
