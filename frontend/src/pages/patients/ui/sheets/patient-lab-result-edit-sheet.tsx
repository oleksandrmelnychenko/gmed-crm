import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Field, inputClass, textareaClass } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  deletePatientLabResult,
  updatePatientLabResult,
  type PatientLabResultCorrectionPayload,
} from "@/pages/patients/data/patient-lab-results";
import type { PatientLabResult } from "@/pages/patients/model/detail-resource-types";
import { FormSection } from "../shared/patient-form-primitives";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Bilingual = (ru: string, de: string) => string;

export type PatientLabResultCorrectionForm = {
  measuredAt: string;
  measuredAtPrecision: "date" | "datetime";
  panel: string;
  analyteName: string;
  resultText: string;
  numericResult: string;
  comparator: "" | "<" | "<=" | "=" | ">=" | ">";
  unit: string;
  referenceText: string;
  referenceLow: string;
  referenceHigh: string;
  abnormalFlag: PatientLabResult["abnormal_flag"];
  correctionNote: string;
};

export type PatientLabCorrectionValidationError =
  | "measured_at"
  | "analyte_name"
  | "result_text"
  | "panel"
  | "numeric_result"
  | "unit"
  | "reference_text"
  | "reference_low"
  | "reference_high"
  | "reference_range"
  | "result_numeric_mismatch"
  | "result_comparator_mismatch"
  | "result_unit_mismatch"
  | "abnormal_flag_conflict"
  | "correction_note";

type CorrectionBuildResult =
  | { ok: true; payload: PatientLabResultCorrectionPayload }
  | { ok: false; error: PatientLabCorrectionValidationError };

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function numberToForm(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

export function patientLabCorrectionFormFromResult(
  result: PatientLabResult,
): PatientLabResultCorrectionForm {
  const measuredAtPrecision = result.measured_at_precision === "date" ? "date" : "datetime";
  return {
    measuredAt:
      measuredAtPrecision === "date"
        ? result.measured_at.slice(0, 10)
        : toLocalDateTimeInput(result.measured_at),
    measuredAtPrecision,
    panel: result.panel ?? "",
    analyteName: result.analyte_name,
    resultText: result.result_text,
    numericResult: numberToForm(result.numeric_result),
    comparator: result.comparator ?? "",
    unit: result.unit ?? "",
    referenceText: result.reference_text ?? "",
    referenceLow: numberToForm(result.reference_low),
    referenceHigh: numberToForm(result.reference_high),
    abnormalFlag: result.abnormal_flag,
    correctionNote: "",
  };
}

function parseOptionalNumber(
  value: string,
  error: PatientLabCorrectionValidationError,
): { ok: true; value: number | null } | { ok: false; error: PatientLabCorrectionValidationError } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, error };
}

type ParsedDisplayedLabResult = {
  numericResult: number;
  comparator: PatientLabResultCorrectionForm["comparator"];
  explicitUnit: string | null;
  flagHint: PatientLabResult["abnormal_flag"] | null;
};

type DisplayedLabResultProjection =
  | { kind: "textual" }
  | { kind: "invalid" }
  | ({ kind: "numeric" } & ParsedDisplayedLabResult);

function canonicalizeDisplayedLabComparator(value: string) {
  return value
    .replace(/^(\s*)≤/u, "$1<=")
    .replace(/^(\s*)≥/u, "$1>=");
}

function labFlagHint(value: string): PatientLabResult["abnormal_flag"] | null {
  const normalized = value.toUpperCase();
  if (normalized === "H") return "high";
  if (normalized === "L") return "low";
  if (normalized === "A") return "abnormal";
  if (normalized === "N") return "normal";
  return null;
}

function parseLabResultSuffix(suffix: string): {
  explicitUnit: string | null;
  flagHint: PatientLabResult["abnormal_flag"] | null;
} | null {
  const trimmed = suffix.trim();
  if (!trimmed) return { explicitUnit: null, flagHint: null };
  const annotation = /^(.*?)(?:\s*)(?:\(([HLAN])\)|\[([HLAN])\])$/iu.exec(trimmed);
  const unitCandidate = annotation ? annotation[1].trim() : trimmed;
  const flagHint = annotation ? labFlagHint(annotation[2] ?? annotation[3]) : null;
  if (!unitCandidate) return { explicitUnit: null, flagHint };
  const plausibleUnit =
    /^[\p{L}\p{N}µμ%°/^*·.\-\s]+$/u.test(unitCandidate) &&
    /[\p{L}µμ%°/]/u.test(unitCandidate);
  return plausibleUnit ? { explicitUnit: unitCandidate, flagHint } : null;
}

function labNumbersMatch(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1) * 1e-9;
}

function parseLocaleAwareLabNumbers(token: string): number[] {
  const exponentMatch = /^(.*?)([eE][+-]?\d+)?$/u.exec(token);
  if (!exponentMatch) return [];
  const mantissa = exponentMatch[1].replace(/[ \u00a0\u202f]/gu, "");
  const exponent = exponentMatch[2] ?? "";
  const candidates: number[] = [];
  const add = (normalizedMantissa: string) => {
    const parsed = Number(`${normalizedMantissa}${exponent}`);
    if (Number.isFinite(parsed) && !candidates.some((candidate) => labNumbersMatch(candidate, parsed))) {
      candidates.push(parsed);
    }
  };
  const dotCount = (mantissa.match(/\./g) ?? []).length;
  const commaCount = (mantissa.match(/,/g) ?? []).length;
  if (dotCount > 0 && commaCount > 0) {
    const lastDot = mantissa.lastIndexOf(".");
    const lastComma = mantissa.lastIndexOf(",");
    if (lastComma > lastDot) {
      add(mantissa.replace(/\./g, "").replace(",", "."));
      add(mantissa.replace(/,/g, ""));
    } else {
      add(mantissa.replace(/,/g, ""));
      add(mantissa.replace(/,/g, "").replace(/\.(?=.*\.)/g, ""));
    }
  } else if (commaCount > 0) {
    add(mantissa.replace(",", "."));
    if (/^[+-]?\d{1,3}(?:,\d{3})+$/u.test(mantissa)) add(mantissa.replace(/,/g, ""));
  } else if (dotCount > 0) {
    add(mantissa);
    if (/^[+-]?\d{1,3}(?:\.\d{3})+$/u.test(mantissa)) add(mantissa.replace(/\./g, ""));
  } else {
    add(mantissa);
  }
  return candidates;
}

function projectDisplayedLabResult(
  value: string,
  expectedNumericResult: number | null = null,
): DisplayedLabResultProjection {
  const trimmed = canonicalizeDisplayedLabComparator(value).trim();
  let comparator: PatientLabResultCorrectionForm["comparator"] = "";
  let numericText = trimmed;
  for (const candidate of ["<=", ">=", "<", ">", "="] as const) {
    if (trimmed.startsWith(candidate)) {
      comparator = candidate;
      numericText = trimmed.slice(candidate.length).trimStart();
      break;
    }
  }
  if (!numericText) return comparator ? { kind: "invalid" } : { kind: "textual" };
  if (!/[\d+\-.,]/.test(numericText[0])) {
    return comparator ? { kind: "invalid" } : { kind: "textual" };
  }

  const numericMatch =
    /^([+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)(.*)$/u.exec(numericText) ??
    /^([+-]?(?:\d[\d.,]*|[.,]\d+)(?:[eE][+-]?\d+)?)(.*)$/u.exec(numericText);
  if (!numericMatch) return { kind: "invalid" };
  if (/^[eE]/u.test(numericMatch[2])) return { kind: "invalid" };
  const candidates = parseLocaleAwareLabNumbers(numericMatch[1]);
  if (candidates.length === 0) return { kind: "invalid" };
  const suffix = parseLabResultSuffix(numericMatch[2]);
  if (!suffix) return { kind: "textual" };
  const numericResult = expectedNumericResult == null
    ? candidates[0]
    : candidates.find((candidate) => labNumbersMatch(candidate, expectedNumericResult)) ?? candidates[0];
  return {
    kind: "numeric",
    numericResult,
    comparator,
    explicitUnit: suffix.explicitUnit,
    flagHint: suffix.flagHint,
  };
}

export function parseDisplayedLabResult(
  value: string,
  expectedNumericResult: number | null = null,
): ParsedDisplayedLabResult | null {
  const projected = projectDisplayedLabResult(value, expectedNumericResult);
  if (projected.kind !== "numeric") return null;
  const { numericResult, comparator, explicitUnit, flagHint } = projected;
  return { numericResult, comparator, explicitUnit, flagHint };
}

function optionalFormNumber(value: string): number | null {
  const parsed = parseOptionalNumber(value, "numeric_result");
  return parsed.ok ? parsed.value : null;
}

export function derivePatientLabAbnormalFlag(
  numericResult: number,
  comparator: PatientLabResultCorrectionForm["comparator"],
  referenceLow: number | null,
  referenceHigh: number | null,
): "normal" | "low" | "high" | null {
  if (referenceLow == null || referenceHigh == null) return null;
  if (!comparator || comparator === "=") {
    if (numericResult < referenceLow) return "low";
    if (numericResult > referenceHigh) return "high";
    return "normal";
  }
  if (comparator === "<" && numericResult <= referenceLow) return "low";
  if (comparator === "<=" && numericResult < referenceLow) return "low";
  if (comparator === ">" && numericResult >= referenceHigh) return "high";
  if (comparator === ">=" && numericResult > referenceHigh) return "high";
  return null;
}

export function synchronizePatientLabResultText(
  form: PatientLabResultCorrectionForm,
  resultText: string,
): PatientLabResultCorrectionForm {
  const canonicalResultText = canonicalizeDisplayedLabComparator(resultText);
  const displayed = parseDisplayedLabResult(
    canonicalResultText,
    optionalFormNumber(form.numericResult),
  );
  if (!displayed) {
    return {
      ...form,
      resultText: canonicalResultText,
      numericResult: "",
      comparator: "",
      abnormalFlag: form.abnormalFlag,
    };
  }
  const referenceLow = optionalFormNumber(form.referenceLow);
  const referenceHigh = optionalFormNumber(form.referenceHigh);
  const abnormalFlag = displayed.flagHint ?? derivePatientLabAbnormalFlag(
    displayed.numericResult,
    displayed.comparator,
    referenceLow,
    referenceHigh,
  );
  return {
    ...form,
    resultText: canonicalResultText,
    numericResult: String(displayed.numericResult),
    comparator: displayed.comparator,
    unit: form.unit,
    abnormalFlag: abnormalFlag ?? form.abnormalFlag,
  };
}

function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function canonicalLabComparator(value: PatientLabResultCorrectionForm["comparator"]) {
  return !value || value === "=" ? "=" : value;
}

function normalizedLabUnit(value: string) {
  return value.replace(/\s/gu, "").toLowerCase();
}

export function buildPatientLabCorrectionPayload(
  form: PatientLabResultCorrectionForm,
): CorrectionBuildResult {
  const analyteName = form.analyteName.trim();
  const resultText = canonicalizeDisplayedLabComparator(form.resultText.trim());
  const correctionNote = form.correctionNote.trim();
  const panel = form.panel.trim();
  const unit = form.unit.trim();
  const referenceText = form.referenceText.trim();

  let measuredAt: string;
  if (form.measuredAtPrecision === "date") {
    if (!validDateOnly(form.measuredAt)) return { ok: false, error: "measured_at" };
    measuredAt = form.measuredAt;
  } else {
    const parsed = new Date(form.measuredAt);
    if (!form.measuredAt || Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "measured_at" };
    }
    measuredAt = parsed.toISOString();
  }

  if (!analyteName || analyteName.length > 160) return { ok: false, error: "analyte_name" };
  if (!resultText || resultText.length > 160) return { ok: false, error: "result_text" };
  if (panel.length > 160) return { ok: false, error: "panel" };
  if (unit.length > 80) return { ok: false, error: "unit" };
  if (referenceText.length > 240) return { ok: false, error: "reference_text" };
  if (!correctionNote || Array.from(correctionNote).length > 500) {
    return { ok: false, error: "correction_note" };
  }

  const numericResult = parseOptionalNumber(form.numericResult, "numeric_result");
  if (!numericResult.ok) return numericResult;
  const referenceLow = parseOptionalNumber(form.referenceLow, "reference_low");
  if (!referenceLow.ok) return referenceLow;
  const referenceHigh = parseOptionalNumber(form.referenceHigh, "reference_high");
  if (!referenceHigh.ok) return referenceHigh;
  if (
    referenceLow.value != null &&
    referenceHigh.value != null &&
    referenceLow.value > referenceHigh.value
  ) {
    return { ok: false, error: "reference_range" };
  }

  const displayed = projectDisplayedLabResult(resultText, numericResult.value);
  if (displayed.kind === "invalid") return { ok: false, error: "result_text" };
  if (displayed.kind === "numeric") {
    if (
      numericResult.value == null ||
      !labNumbersMatch(numericResult.value, displayed.numericResult)
    ) {
      return { ok: false, error: "result_numeric_mismatch" };
    }
    if (canonicalLabComparator(displayed.comparator) !== canonicalLabComparator(form.comparator)) {
      return { ok: false, error: "result_comparator_mismatch" };
    }
    if (
      displayed.explicitUnit &&
      normalizedLabUnit(displayed.explicitUnit) !== normalizedLabUnit(unit)
    ) {
      return { ok: false, error: "result_unit_mismatch" };
    }
    const derivedFlag = displayed.flagHint ?? derivePatientLabAbnormalFlag(
      numericResult.value,
      form.comparator,
      referenceLow.value,
      referenceHigh.value,
    );
    if (derivedFlag && form.abnormalFlag !== derivedFlag) {
      return { ok: false, error: "abnormal_flag_conflict" };
    }
  } else {
    if (numericResult.value != null) return { ok: false, error: "result_numeric_mismatch" };
    if (form.comparator) return { ok: false, error: "result_comparator_mismatch" };
  }

  return {
    ok: true,
    payload: {
      measured_at: measuredAt,
      panel: panel || null,
      analyte_name: analyteName,
      result_text: resultText,
      numeric_result: numericResult.value,
      comparator: form.comparator || null,
      unit: unit || null,
      reference_text: referenceText || null,
      reference_low: referenceLow.value,
      reference_high: referenceHigh.value,
      abnormal_flag: form.abnormalFlag,
      correction_note: correctionNote,
    },
  };
}

function validationErrorLabel(error: PatientLabCorrectionValidationError, tx: Bilingual) {
  const labels: Record<PatientLabCorrectionValidationError, string> = {
    measured_at: tx("Укажите корректную дату измерения.", "Geben Sie ein gültiges Messdatum an."),
    analyte_name: tx("Название показателя обязательно (до 160 символов).", "Der Parametername ist erforderlich (max. 160 Zeichen)."),
    result_text: tx("Отображаемое значение обязательно (до 160 символов).", "Der Anzeigewert ist erforderlich (max. 160 Zeichen)."),
    panel: tx("Название панели не должно превышать 160 символов.", "Der Panelname darf höchstens 160 Zeichen enthalten."),
    numeric_result: tx("Числовое значение имеет неверный формат.", "Der numerische Wert hat ein ungültiges Format."),
    unit: tx("Единица не должна превышать 80 символов.", "Die Einheit darf höchstens 80 Zeichen enthalten."),
    reference_text: tx("Референс не должен превышать 240 символов.", "Die Referenz darf höchstens 240 Zeichen enthalten."),
    reference_low: tx("Нижняя граница имеет неверный формат.", "Die Untergrenze hat ein ungültiges Format."),
    reference_high: tx("Верхняя граница имеет неверный формат.", "Die Obergrenze hat ein ungültiges Format."),
    reference_range: tx("Нижняя граница не может быть выше верхней.", "Die Untergrenze darf nicht über der Obergrenze liegen."),
    result_numeric_mismatch: tx("Отображаемое и числовое значения не совпадают. Исправьте отображаемое значение ещё раз для синхронизации.", "Anzeige- und Zahlenwert stimmen nicht überein. Bearbeiten Sie den Anzeigewert erneut, um sie zu synchronisieren."),
    result_comparator_mismatch: tx("Знак сравнения не совпадает с отображаемым значением.", "Das Vergleichszeichen stimmt nicht mit dem Anzeigewert überein."),
    result_unit_mismatch: tx("Единица в отображаемом значении не совпадает с полем единицы.", "Die Einheit im Anzeigewert stimmt nicht mit dem Einheitenfeld überein."),
    abnormal_flag_conflict: tx("Статус не соответствует значению и референсному диапазону.", "Der Status widerspricht dem Wert und Referenzbereich."),
    correction_note: tx("Укажите причину исправления (до 500 символов).", "Geben Sie den Korrekturgrund an (max. 500 Zeichen)."),
  };
  return labels[error];
}

function formatCorrectionTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return cachedDateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function PatientLabCorrectionMetadata({
  item,
  tx,
}: {
  item: PatientLabResult;
  tx: Bilingual;
}) {
  if (!item.corrected_at) return null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-amber-800">
      <Badge
        variant="outline"
        className="h-5 rounded-full border-amber-300 bg-amber-50 px-1.5 text-[9px] font-semibold text-amber-800"
      >
        <CheckCircle2 className="mr-1 size-3" />
        {tx("Исправлено", "Korrigiert")}
      </Badge>
      <span>
        {formatCorrectionTimestamp(item.corrected_at)}
        {item.corrected_by_name ? ` · ${item.corrected_by_name}` : ""}
      </span>
      {item.correction_note ? (
        <span className="max-w-[360px] truncate" title={item.correction_note}>
          · {item.correction_note}
        </span>
      ) : null}
    </div>
  );
}

export function PatientLabResultEditAction({
  label,
  onEdit,
}: {
  label: string;
  onEdit: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="size-7 rounded-md p-0"
      aria-label={label}
      title={label}
      onClick={onEdit}
    >
      <Pencil className="size-3.5" />
    </Button>
  );
}

export function PatientLabResultDeleteAction({
  label,
  onDelete,
}: {
  label: string;
  onDelete: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="size-7 rounded-md p-0 text-destructive hover:text-destructive"
      aria-label={label}
      title={label}
      onClick={onDelete}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

export function PatientLabResultEditSheet({
  patientId,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  item: PatientLabResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: PatientLabResult) => void;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const [form, setForm] = useState<PatientLabResultCorrectionForm | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(open && item ? patientLabCorrectionFormFromResult(item) : null);
    setError("");
  }, [item, open]);

  function patchForm(patch: Partial<PatientLabResultCorrectionForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !form || busy) return;
    const built = buildPatientLabCorrectionPayload(form);
    if (!built.ok) {
      setError(validationErrorLabel(built.error, tx));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const updated = await updatePatientLabResult(patientId, item.id, built.payload);
      onSaved(updated);
      onOpenChange(false);
      toast.success(tx("Результат анализа исправлен", "Laborwert wurde korrigiert"));
    } catch (submitError) {
      const message = submitError instanceof Error
        ? submitError.message
        : tx("Не удалось сохранить исправление", "Korrektur konnte nicht gespeichert werden");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
      width="form-heavy"
      onSubmit={handleSubmit}
      title={tx("Исправить результат анализа", "Laborwert korrigieren")}
      footer={
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button type="submit" size="sm" className="h-8 gap-1.5 rounded-lg" disabled={busy || !form}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {tx("Сохранить исправление", "Korrektur speichern")}
          </Button>
        </>
      }
    >
      {item && form ? (
        <>
          <FormSection title={tx("Измерение", "Messung")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={tx("Дата измерения", "Messdatum")} htmlFor="lab-correction-measured-at">
                <Input
                  id="lab-correction-measured-at"
                  type={form.measuredAtPrecision === "date" ? "date" : "datetime-local"}
                  step={form.measuredAtPrecision === "date" ? undefined : 0.001}
                  value={form.measuredAt}
                  onChange={(event) => patchForm({ measuredAt: event.target.value })}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label={tx("Панель", "Panel")} htmlFor="lab-correction-panel">
                <Input
                  id="lab-correction-panel"
                  value={form.panel}
                  onChange={(event) => patchForm({ panel: event.target.value })}
                  className={inputClass}
                  maxLength={160}
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={tx("Показатель", "Parameter")} htmlFor="lab-correction-analyte">
                <Input
                  id="lab-correction-analyte"
                  value={form.analyteName}
                  onChange={(event) => patchForm({ analyteName: event.target.value })}
                  className={inputClass}
                  maxLength={160}
                  required
                />
              </Field>
              <Field label={tx("Статус", "Status")} htmlFor="lab-correction-flag">
                <NativeComboboxSelect
                  id="lab-correction-flag"
                  value={form.abnormalFlag}
                  onChange={(event) => patchForm({
                    abnormalFlag: event.target.value as PatientLabResult["abnormal_flag"],
                  })}
                  className={cn("w-full", inputClass)}
                >
                  <option value="unknown">{tx("Неизвестно", "Unbekannt")}</option>
                  <option value="normal">{tx("Норма", "Normal")}</option>
                  <option value="low">{tx("Ниже нормы", "Zu niedrig")}</option>
                  <option value="high">{tx("Выше нормы", "Zu hoch")}</option>
                  <option value="abnormal">{tx("Отклонение", "Auffällig")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
          </FormSection>

          <FormSection title={tx("Значение", "Wert")}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
              <Field label={tx("Отображаемое значение", "Anzeigewert")} htmlFor="lab-correction-result-text">
                <Input
                  id="lab-correction-result-text"
                  value={form.resultText}
                  onChange={(event) => {
                    const resultText = event.target.value;
                    setForm((current) =>
                      current ? synchronizePatientLabResultText(current, resultText) : current,
                    );
                    setError("");
                  }}
                  className={inputClass}
                  maxLength={160}
                  required
                />
              </Field>
              <Field label={tx("Знак", "Zeichen")} htmlFor="lab-correction-comparator">
                <NativeComboboxSelect
                  id="lab-correction-comparator"
                  value={form.comparator}
                  onChange={(event) => patchForm({
                    comparator: event.target.value as PatientLabResultCorrectionForm["comparator"],
                  })}
                  className={cn("w-full", inputClass)}
                >
                  <option value="">—</option>
                  <option value="<">&lt;</option>
                  <option value="<=">≤</option>
                  <option value="=">=</option>
                  <option value=">=">≥</option>
                  <option value=">">&gt;</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Числовое значение", "Numerischer Wert")} htmlFor="lab-correction-numeric-result">
                <Input
                  id="lab-correction-numeric-result"
                  inputMode="decimal"
                  value={form.numericResult}
                  onChange={(event) => patchForm({ numericResult: event.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Единица измерения", "Einheit")} htmlFor="lab-correction-unit">
              <Input
                id="lab-correction-unit"
                value={form.unit}
                onChange={(event) => patchForm({ unit: event.target.value })}
                className={inputClass}
                maxLength={80}
              />
            </Field>
          </FormSection>

          <FormSection title={tx("Референс", "Referenz")}>
            <Field label={tx("Референсный текст", "Referenztext")} htmlFor="lab-correction-reference-text">
              <Input
                id="lab-correction-reference-text"
                value={form.referenceText}
                onChange={(event) => patchForm({ referenceText: event.target.value })}
                className={inputClass}
                maxLength={240}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={tx("Нижняя граница", "Untergrenze")} htmlFor="lab-correction-reference-low">
                <Input
                  id="lab-correction-reference-low"
                  inputMode="decimal"
                  value={form.referenceLow}
                  onChange={(event) => patchForm({ referenceLow: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Верхняя граница", "Obergrenze")} htmlFor="lab-correction-reference-high">
                <Input
                  id="lab-correction-reference-high"
                  inputMode="decimal"
                  value={form.referenceHigh}
                  onChange={(event) => patchForm({ referenceHigh: event.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={tx("Причина исправления", "Korrekturgrund")}>
            <Field
              label={tx("Комментарий для журнала", "Kommentar für das Protokoll")}
              htmlFor="lab-correction-note"
            >
              <textarea
                id="lab-correction-note"
                value={form.correctionNote}
                onChange={(event) => patchForm({ correctionNote: event.target.value })}
                className={cn(textareaClass, "min-h-[96px]")}
                placeholder={tx(
                  "Например: OCR неверно распознал десятичный разделитель",
                  "Zum Beispiel: OCR hat das Dezimaltrennzeichen falsch erkannt",
                )}
                required
              />
            </Field>
            <p className="text-right text-[10px] text-muted-foreground">
              {Array.from(form.correctionNote).length}/500
            </p>
          </FormSection>

          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </PatientSheetScaffold>
  );
}

export function PatientLabResultDeleteSheet({
  patientId,
  item,
  open,
  onOpenChange,
  onDeleted,
}: {
  patientId: string;
  item: PatientLabResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (labResultId: string) => void;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const [deletionNote, setDeletionNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDeletionNote("");
    setError("");
  }, [item, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || busy) return;
    const reason = deletionNote.trim();
    if (!reason || Array.from(reason).length > 500) {
      setError(tx(
        "Укажите причину удаления (до 500 символов).",
        "Geben Sie den Löschgrund an (max. 500 Zeichen).",
      ));
      return;
    }

    setBusy(true);
    setError("");
    try {
      await deletePatientLabResult(patientId, item.id, reason);
      onDeleted(item.id);
      onOpenChange(false);
      toast.success(tx("Результат анализа удалён", "Laborwert wurde gelöscht"));
    } catch (submitError) {
      const message = submitError instanceof Error
        ? submitError.message
        : tx("Не удалось удалить результат", "Laborwert konnte nicht gelöscht werden");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
      width="narrow"
      onSubmit={handleSubmit}
      title={tx("Удалить результат анализа", "Laborwert löschen")}
      description={tx(
        "Запись исчезнет из активной истории. Удаление будет сохранено в журнале.",
        "Der Eintrag verschwindet aus dem aktiven Verlauf. Die Löschung wird protokolliert.",
      )}
      footer={
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            className="h-8 gap-1.5 rounded-lg"
            disabled={busy || !item}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {tx("Удалить", "Löschen")}
          </Button>
        </>
      }
    >
      {item ? (
        <>
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
            <p className="text-sm font-semibold text-foreground">{item.analyte_name}</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {item.result_text}{item.unit ? ` ${item.unit}` : ""}
            </p>
          </div>
          <Field label={tx("Причина удаления", "Löschgrund")} htmlFor="lab-deletion-note">
            <textarea
              id="lab-deletion-note"
              value={deletionNote}
              onChange={(event) => {
                setDeletionNote(event.target.value);
                setError("");
              }}
              className={cn(textareaClass, "min-h-[112px]")}
              placeholder={tx(
                "Например: запись относится к другому пациенту",
                "Zum Beispiel: Eintrag gehört zu einem anderen Patienten",
              )}
              required
            />
          </Field>
          <p className="text-right text-[10px] text-muted-foreground">
            {Array.from(deletionNote).length}/500
          </p>
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </PatientSheetScaffold>
  );
}
