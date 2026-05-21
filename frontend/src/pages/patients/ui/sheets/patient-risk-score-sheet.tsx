import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Field as FormField,
  Section as FormSection,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  l: (key: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
): string {
  switch (value) {
    case "cha2ds2_vasc":
      return "CHA2DS2-VASc";
    case "has_bled":
      return "HAS-BLED";
    case "framingham":
      return "Framingham";
    case "fall_risk":
      return l("patients_fall_risk");
    case "frailty":
      return l("patients_frailty");
    case "nutrition_risk":
      return l("patients_nutrition_risk");
    case "other":
      return l("patients_other_2");
    default:
      return formatUnknownValue(value, translations);
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setForm(blankForm());
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const computedAt = new Date(form.computedAt);
    if (Number.isNaN(computedAt.getTime())) {
      toast.error(l("patients_invalid_date_2"));
      return;
    }
    const scoreValue = parseNumber(form.scoreValue);
    if (scoreValue == null) {
      toast.error(l("patients_score_value_is_required"));
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
        toast.error(l("patients_inputs_must_be_a_json_object"));
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
      toast.success(l("patients_risk_score_saved"));
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
      title={l("patients_add_risk_score")}
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
      <FormSection title={l("patients_score")}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField
            label={l("patients_computed_at")}
            htmlFor="patient-risk-score-computed-at"
          >
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
          </FormField>
          <FormField label={l("patients_score_type")} htmlFor="patient-risk-score-type">
            <NativeComboboxSelect
              id="patient-risk-score-type"
              value={form.scoreType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  scoreType: (event.target.value ?? SCORE_TYPE_OPTIONS[0]) as ScoreType,
                }))
              }
              className={cn("w-full", selectClass)}
            >
              {SCORE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {scoreTypeLabel(option, l, t)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
          <FormField label={l("patients_score_value")} htmlFor="patient-risk-score-value">
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
          </FormField>
          <FormField label={l("patients_scale_max")} htmlFor="patient-risk-score-scale-max">
            <Input
              id="patient-risk-score-scale-max"
              inputMode="decimal"
              value={form.scaleMax}
              onChange={(event) =>
                setForm((current) => ({ ...current, scaleMax: event.target.value }))
              }
              className={inputClass}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={l("patients_interpretation")}>
        <FormField label={l("patients_source")} htmlFor="patient-risk-score-source">
          <Input
            id="patient-risk-score-source"
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            className={inputClass}
          />
        </FormField>
        <FormField
          label={l("patients_interpretation")}
          htmlFor="patient-risk-score-interpretation"
        >
          <textarea
            id="patient-risk-score-interpretation"
            className={riskScoreTextareaClassName}
            value={form.interpretation}
            onChange={(event) =>
              setForm((current) => ({ ...current, interpretation: event.target.value }))
            }
          />
        </FormField>
      </FormSection>

      <FormSection title={l("patients_additional")}>
        <FormField
          label={l("patients_inputs_json")}
          htmlFor="patient-risk-score-inputs"
        >
          <textarea
            id="patient-risk-score-inputs"
            className={riskScoreTextareaClassName}
            value={form.inputsJson}
            onChange={(event) =>
              setForm((current) => ({ ...current, inputsJson: event.target.value }))
            }
            placeholder={l("patients_risk_score_inputs_placeholder")}
          />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
