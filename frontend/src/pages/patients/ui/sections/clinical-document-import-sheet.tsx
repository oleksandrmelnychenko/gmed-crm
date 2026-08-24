import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  FileUp,
  FlaskConical,
  HeartPulse,
  History,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Pill,
  Plus,
  RefreshCw,
  RotateCcw,
  Stethoscope,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/ui/country-select";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { clearApiCache } from "@/lib/api";
import {
  createDocumentPreviewObjectUrl,
  revokeDocumentPreviewObjectUrl,
  uploadDocument,
} from "@/pages/documents/data/document-api";
import {
  completeClinicalDocumentImport,
  clinicalDocumentImportAfterPrepare,
  clinicalImportNeedsSourceCountry,
  createClinicalDocumentImport,
  deleteClinicalDocumentImport,
  fetchClinicalDocumentImport,
  fetchClinicalDocumentImports,
  prepareClinicalDocumentImport,
  rescanClinicalDocumentImport,
  retryClinicalDocumentImport,
  type ClinicalDocumentImport,
  type ClinicalDocumentImportCandidate,
  type ClinicalDocumentCandidatePayloads,
  type ClinicalDocumentImportDraft,
  type ClinicalDocumentImportStatus,
  type ClinicalDocumentImportSummary,
  type ClinicalDocumentImportTarget,
} from "@/pages/patients/data/clinical-document-import";
import {
  buildClinicalDocumentCandidatePayloads,
  deriveClinicalImportSourceCountry,
  isCanonicalClinicalImportSourceCountry,
  vitalImportValidation,
  type VitalImportValidationIssue,
} from "@/pages/patients/data/clinical-document-import-payloads";
import {
  checkClinicalDocumentSubject,
  clinicalDocumentIdentityConfirmationVisible,
  clinicalDocumentIdentityConfirmationForPrepare,
  clinicalDocumentIdentityNeedsExplicitConfirmation,
  clinicalDocumentIdentityPrepareMode,
  clinicalDocumentIdentityRequiresCurrentDecision,
  type PatientIdentityReference,
} from "@/pages/patients/data/clinical-document-subject";
import {
  medicationCandidateNeedsWirkstoff,
  medicationCandidateReviewDecision,
  medicationCandidateReviewBlockReason,
  medicationCandidateDisplay,
  medicationFieldConfidence,
  medicationIdentifiers,
  medicationReviewDecisionSummary,
  partitionMedicationReviewSelection,
  setMedicationCandidateReviewDecision,
  updateMedicationCandidateField,
} from "@/pages/patients/data/medication-document-import";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type ApplyResult = Record<string, number>;
type BuilderTab = "all" | "source" | ClinicalDocumentImportTarget;
type Bilingual = (ru: string, de: string) => string;
type MedicationReviewDisposition = "blocked" | "ready";

const CREATE_NEW_MEDICATION_SERIES = "__create_new_medication_series__";

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const IMPORT_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const IMPORT_POLL_BASE_DELAY_MS = 1_800;
const IMPORT_POLL_MAX_DELAY_MS = 15_000;
const IMPORT_HISTORY_POLL_DELAY_MS = 4_000;
const builderTabClassName =
  "h-14 min-w-0 justify-start gap-2 rounded-none border-0 border-r border-border bg-transparent px-3 py-3 text-left text-muted-foreground whitespace-normal last:border-r-0 hover:bg-muted/30 hover:text-foreground data-active:bg-muted/50 data-active:text-foreground data-active:shadow-none after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--brand)]";

export type ExistingClinicalImportItem = {
  id: string;
  primary: string;
  secondary?: string | null;
  medicationSeriesId?: string | null;
  medicationIdentity?: string | null;
};

export type ExistingClinicalImportItems = Record<
  ClinicalDocumentImportTarget,
  ExistingClinicalImportItem[]
>;

const targetOrder: ClinicalDocumentImportTarget[] = [
  "diagnosis",
  "anamnesis",
  "medication",
  "examination",
  "lab_result",
  "vital",
  "recommendation",
];

const targetLabels: Record<ClinicalDocumentImportTarget, { ru: string; de: string }> = {
  diagnosis: { ru: "Диагнозы", de: "Diagnosen" },
  anamnesis: { ru: "Анамнез", de: "Anamnese" },
  medication: { ru: "Медикаменты", de: "Medikation" },
  examination: { ru: "Обследования", de: "Befunde" },
  lab_result: { ru: "Анализы", de: "Laborwerte" },
  vital: { ru: "Показатели", de: "Vitalwerte" },
  recommendation: { ru: "Рекомендации", de: "Empfehlungen" },
};

const targetIcons: Record<ClinicalDocumentImportTarget, LucideIcon> = {
  diagnosis: Stethoscope,
  anamnesis: ClipboardList,
  medication: Pill,
  examination: Activity,
  lab_result: FlaskConical,
  vital: HeartPulse,
  recommendation: Lightbulb,
};

const targetTone: Record<ClinicalDocumentImportTarget, string> = {
  diagnosis: "border-rose-200 bg-rose-50 text-rose-700",
  anamnesis: "border-violet-200 bg-violet-50 text-violet-700",
  medication: "border-sky-200 bg-sky-50 text-sky-700",
  examination: "border-amber-200 bg-amber-50 text-amber-800",
  lab_result: "border-cyan-200 bg-cyan-50 text-cyan-800",
  vital: "border-pink-200 bg-pink-50 text-pink-800",
  recommendation: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const targetCardTone: Record<ClinicalDocumentImportTarget, string> = {
  diagnosis: "border-rose-200 bg-rose-50/35",
  anamnesis: "border-violet-200 bg-violet-50/35",
  medication: "border-sky-200 bg-sky-50/35",
  examination: "border-amber-200 bg-amber-50/35",
  lab_result: "border-cyan-200 bg-cyan-50/35",
  vital: "border-pink-200 bg-pink-50/35",
  recommendation: "border-emerald-200 bg-emerald-50/35",
};

function localizedLabNumber(value: string): number | null {
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function labCandidateDisplay(normalized: Record<string, unknown>): string {
  const analyte = typeof normalized.analyte_name === "string" ? normalized.analyte_name.trim() : "";
  const result = typeof normalized.result_text === "string" ? normalized.result_text.trim() : "";
  const unit = typeof normalized.unit === "string" ? normalized.unit.trim() : "";
  const reference = typeof normalized.reference_text === "string" ? normalized.reference_text.trim() : "";
  return `${analyte}: ${result}${unit ? ` ${unit}` : ""}${reference ? ` (Referenz: ${reference})` : ""}`.trim();
}

const reviewReasonLabels: Record<string, { ru: string; de: string }> = {
  medication_brand_without_active_ingredient: {
    ru: "В документе есть торговое название, но действующее вещество нужно указать вручную",
    de: "Handelsname erkannt, Wirkstoff muss manuell ergänzt werden",
  },
  active_ingredient_requires_confirmation: {
    ru: "Укажите и проверьте действующее вещество",
    de: "Wirkstoff ergänzen und prüfen",
  },
  medication_name_requires_confirmation: {
    ru: "Не удалось надёжно определить название препарата",
    de: "Arzneimittelname konnte nicht sicher bestimmt werden",
  },
  medication_lifecycle_change_requires_confirmation: {
    ru: "Изменение статуса препарата нужно подтвердить вручную",
    de: "Änderung des Medikationsstatus manuell bestätigen",
  },
  hold_end_requires_confirmation: {
    ru: "Проверьте дату завершения паузы",
    de: "Ende der Einnahmepause prüfen",
  },
  conflicting_medication_status: {
    ru: "В документе найдены противоречивые статусы препарата",
    de: "Im Dokument wurden widersprüchliche Medikationsstatus erkannt",
  },
  pzn_requires_confirmation: {
    ru: "Проверьте распознанный PZN",
    de: "Erkannte PZN prüfen",
  },
  dose_schedule_requires_confirmation: {
    ru: "Проверьте распознанную схему дозирования",
    de: "Erkanntes Dosierschema prüfen",
  },
  medication_active_ingredient_requires_confirmation: {
    ru: "Проверьте действующее вещество по оригиналу документа",
    de: "Wirkstoff mit dem Originaldokument abgleichen",
  },
  medication_regimen_requires_confirmation: {
    ru: "Проверьте дозировку и схему приёма",
    de: "Dosierung und Einnahmeschema prüfen",
  },
  medication_status_requires_confirmation: {
    ru: "Проверьте статус и даты приёма",
    de: "Status und Einnahmedaten prüfen",
  },
  medication_country_requires_confirmation: {
    ru: "Проверьте страну происхождения препарата",
    de: "Ursprungsland des Arzneimittels prüfen",
  },
  source_date_requires_confirmation: {
    ru: "Проверьте дату документа или дату вступления схемы в силу",
    de: "Dokument- bzw. Wirksamkeitsdatum des Schemas prüfen",
  },
  laboratory_date_requires_confirmation: {
    ru: "Проверьте и укажите дату лабораторного исследования",
    de: "Datum der Laboruntersuchung prüfen und ergänzen",
  },
  suspected_diagnosis_requires_confirmation: {
    ru: "Подозрение — требуется подтверждение",
    de: "Verdacht – Bestätigung erforderlich",
  },
  rule_out_is_not_an_active_diagnosis: {
    ru: "Цель исключения — не активный диагноз",
    de: "Ausschlussziel – keine aktive Diagnose",
  },
  negative_statement_is_not_an_active_diagnosis: {
    ru: "Отрицательный результат — не диагноз",
    de: "Negativer Befund – keine Diagnose",
  },
  low_ocr_confidence: {
    ru: "OCR распознал фрагмент неуверенно",
    de: "OCR-Fragment mit niedriger Konfidenz",
  },
  low_extraction_quality: {
    ru: "Качество исходного текста требует проверки",
    de: "Qualität des Quelltexts erfordert Prüfung",
  },
  extraction_quality_unavailable: {
    ru: "Качество фрагмента не удалось оценить",
    de: "Fragmentqualität konnte nicht bewertet werden",
  },
  incomplete_document_extraction: {
    ru: "OCR обработал не все страницы документа",
    de: "OCR hat nicht alle Dokumentseiten verarbeitet",
  },
};

const semanticLabels: Record<string, { ru: string; de: string }> = {
  suspected: { ru: "Подозрение", de: "Verdacht" },
  negated: { ru: "Отрицательный результат", de: "Negativer Befund" },
  rule_out: { ru: "Исключение", de: "Ausschluss" },
  diagnostic_intent: { ru: "Цель обследования", de: "Untersuchungsziel" },
  negative_finding: { ru: "Отрицательный результат", de: "Negativer Befund" },
  personal_history: { ru: "Перенесённое состояние", de: "Eigenanamnese" },
  family_history: { ru: "Семейный анамнез", de: "Familienanamnese" },
};

const draftWarningLabels: Record<string, { ru: string; de: string }> = {
  "Administrative cost estimate recognized; no clinical facts were proposed.": {
    ru: "Распознан административный расчёт стоимости. Клинические данные не предлагаются.",
    de: "Administrative Kostenschätzung erkannt. Es werden keine klinischen Daten vorgeschlagen.",
  },
  "No supported clinical sections were recognized; manual review is required.": {
    ru: "Поддерживаемые клинические разделы не найдены. Требуется ручная проверка.",
    de: "Keine unterstützten klinischen Abschnitte erkannt. Manuelle Prüfung erforderlich.",
  },
  "Low-confidence OCR evidence requires manual review.": {
    ru: "Часть OCR-текста распознана неуверенно и требует ручной сверки с документом.",
    de: "Ein Teil des OCR-Texts hat niedrige Konfidenz und muss mit dem Dokument geprüft werden.",
  },
  "OCR did not finish for every page; all proposed clinical facts require manual review.": {
    ru: "OCR обработал не все страницы. Все предложенные клинические данные необходимо сверить с документом вручную.",
    de: "OCR hat nicht alle Seiten verarbeitet. Alle vorgeschlagenen klinischen Angaben müssen manuell mit dem Dokument geprüft werden.",
  },
};

const importStatusLabels: Record<
  ClinicalDocumentImportStatus,
  { ru: string; de: string }
> = {
  queued: { ru: "В очереди", de: "In Warteschlange" },
  processing: { ru: "Обрабатывается", de: "Wird verarbeitet" },
  review_required: { ru: "Готово к проверке", de: "Bereit zur Prüfung" },
  applying: { ru: "Применение зафиксировано", de: "Übernahme vorbereitet" },
  applied: { ru: "Добавлено в карту", de: "Übernommen" },
  failed: { ru: "Ошибка", de: "Fehlgeschlagen" },
};

const importStatusTone: Record<ClinicalDocumentImportStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  processing: "border-sky-200 bg-sky-50 text-sky-700",
  review_required: "border-amber-200 bg-amber-50 text-amber-800",
  applying: "border-violet-200 bg-violet-50 text-violet-800",
  applied: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
};

function ImportStatusGlyph({ status }: { status: ClinicalDocumentImportStatus }) {
  if (status === "processing") return <LoaderCircle className="size-4 animate-spin" />;
  if (status === "queued") return <Clock3 className="size-4" />;
  if (status === "failed") return <AlertTriangle className="size-4" />;
  return <CheckCircle2 className="size-4" />;
}

function normalizedString(candidate: ClinicalDocumentImportCandidate, key: string) {
  const value = candidate.normalized[key];
  return typeof value === "string" ? value : null;
}

function normalizedStringArray(candidate: ClinicalDocumentImportCandidate, key: string) {
  const value = candidate.normalized[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRiskyCandidate(candidate: ClinicalDocumentImportCandidate) {
  const assertion = normalizedString(candidate, "assertion");
  const role = normalizedString(candidate, "semantic_role");
  const autoSelect = candidate.normalized.auto_select;
  return (
    autoSelect === false ||
    ["suspected", "negated", "rule_out"].includes(assertion ?? "") ||
    ["diagnostic_intent", "negative_finding"].includes(role ?? "") ||
    normalizedStringArray(candidate, "review_reasons").includes("low_ocr_confidence")
  );
}

function medicationDispositionLabel(
  disposition: MedicationReviewDisposition,
  tx: Bilingual,
) {
  if (disposition === "blocked") {
    return tx(
      "Укажите действующее вещество — без него запись нельзя импортировать",
      "Wirkstoff ergänzen – ohne Wirkstoff ist kein Import möglich",
    );
  }
  return tx(
    "Проверьте все поля — дублирование, изменение схемы и статуса система определит при сохранении",
    "Alle Felder prüfen – Deduplizierung, Schema- und Statusänderungen werden beim Speichern ermittelt",
  );
}

function MedicationCandidateEditor({
  candidate,
  disabled,
  disposition,
  defaultSourceCountry,
  onSourceCountryChange,
  seriesOptions,
  requiresExplicitSeries,
  tx,
  onPatch,
  onFocus,
}: {
  candidate: ClinicalDocumentImportCandidate;
  disabled: boolean;
  disposition: MedicationReviewDisposition;
  defaultSourceCountry: string;
  onSourceCountryChange: (country: string) => void;
  seriesOptions: ExistingClinicalImportItem[];
  requiresExplicitSeries: boolean;
  tx: Bilingual;
  onPatch: (patch: Partial<ClinicalDocumentImportCandidate>) => void;
  onFocus: () => void;
}) {
  const normalizedValue = (field: string) => {
    if (field === "source_date") {
      const value = candidate.normalized.source_date ?? candidate.normalized.effective_date;
      return typeof value === "string" ? value : "";
    }
    const value = candidate.normalized[field];
    return typeof value === "string" ? value : "";
  };
  const update = (field: string, value: string | boolean) => {
    onPatch(updateMedicationCandidateField(candidate, field, value));
  };
  const confidence = (field: string) => medicationFieldConfidence(candidate, field);
  const identifiers = medicationIdentifiers(candidate);
  const field = (
    key: string,
    label: string,
    options: { type?: "text" | "date"; className?: string; required?: boolean } = {},
  ) => {
    const score = confidence(key);
    return (
      <label className={cn("space-y-1", options.className)}>
        <span className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{label}{options.required ? " *" : ""}</span>
          {score !== null ? (
            <span className={cn(score < 0.7 && "text-amber-700")}>
              OCR {Math.round(score * 100)}%
            </span>
          ) : null}
        </span>
        <Input
          type={options.type ?? "text"}
          value={normalizedValue(key)}
          disabled={disabled}
          aria-required={options.required}
          aria-invalid={options.required && !normalizedValue(key).trim()}
          className={cn(
            "h-11 bg-white",
            options.required && !normalizedValue(key).trim() && "border-amber-400",
          )}
          onFocus={onFocus}
          onChange={(event) => update(key, event.target.value)}
        />
      </label>
    );
  };
  const onHold = candidate.normalized.on_hold === true || candidate.normalized.on_hold === "true";
  const asNeeded = candidate.normalized.as_needed === true || candidate.normalized.as_needed === "true";
  const country = defaultSourceCountry;
  const start = normalizedValue("einnahme_von");
  const end = normalizedValue("einnahme_bis");
  const invalidDateRange = Boolean(start && end && end < start);
  const selectedSeriesId = normalizedValue("medication_series_id");
  const createsNewSeries = candidate.normalized.create_new_series === true;
  const seriesSelection = createsNewSeries ? CREATE_NEW_MEDICATION_SERIES : selectedSeriesId;
  const ambiguousSeries = requiresExplicitSeries && !selectedSeriesId && !createsNewSeries;
  const updateSeriesSelection = (selection: string) => {
    const normalized = { ...candidate.normalized };
    delete normalized.medication_series_id;
    delete normalized.create_new_series;
    if (selection === CREATE_NEW_MEDICATION_SERIES) {
      normalized.create_new_series = true;
    } else if (selection) {
      normalized.medication_series_id = selection;
    }
    onPatch({ normalized, value: medicationCandidateDisplay(normalized) });
  };

  return (
    <div
      data-clinical-import-candidate-editor
      className="space-y-4 rounded-lg border border-white/70 bg-white/55 p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5",
          disposition === "blocked"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-slate-50 text-slate-700",
        )}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">{medicationDispositionLabel(disposition, tx)}</p>
          <p className="text-[11px] opacity-80">
            {tx(
              "OCR не подтверждает препарат и не подбирает замену автоматически.",
              "OCR bestätigt das Arzneimittel nicht und führt keine automatische Substitution durch.",
            )}
          </p>
        </div>
      </div>

      {seriesOptions.length > 0 || requiresExplicitSeries ? (
        <label className="block space-y-1 rounded-lg border border-sky-200 bg-sky-50/70 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-900">
            {tx("Линия медикамента", "Medikationsserie")}{requiresExplicitSeries ? " *" : ""}
          </span>
          <select
            value={seriesSelection}
            disabled={disabled}
            aria-required={requiresExplicitSeries}
            aria-invalid={ambiguousSeries}
            className={cn(
              "h-11 w-full rounded-md border bg-white px-3 text-sm",
              ambiguousSeries ? "border-amber-400" : "border-input",
            )}
            onChange={(event) => updateSeriesSelection(event.target.value)}
          >
            <option value="">
              {requiresExplicitSeries
                ? tx("Выберите подходящую линию", "Passende Medikationsserie auswählen")
                : tx("Определить при сохранении", "Beim Speichern zuordnen")}
            </option>
            {seriesOptions.map((option) => (
              <option key={option.medicationSeriesId ?? option.id} value={option.medicationSeriesId ?? ""}>
                {option.primary}{option.secondary ? ` · ${option.secondary}` : ""}
              </option>
            ))}
            <option value={CREATE_NEW_MEDICATION_SERIES}>
              {tx("Создать новую линию", "Neue Medikationsserie erstellen")}
            </option>
          </select>
          {ambiguousSeries ? (
            <span className="block text-[11px] text-amber-800">
              {tx(
                "Есть несколько текущих или выбранных записей с этим действующим веществом. Выберите линию вручную — система не будет угадывать.",
                "Mehrere aktuelle oder ausgewählte Einträge haben diesen Wirkstoff. Serie manuell wählen; es erfolgt keine automatische Zuordnung.",
              )}
            </span>
          ) : null}
          {createsNewSeries ? (
            <span className="block text-[11px] text-sky-800">
              {tx(
                "Будет создана отдельная параллельная линия; существующие схемы не перезаписываются.",
                "Es wird eine eigene parallele Serie erstellt; bestehende Schemata werden nicht überschrieben.",
              )}
            </span>
          ) : null}
        </label>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {field("wirkstoff", tx("Действующее вещество", "Wirkstoff"), { required: true, className: "xl:col-span-2" })}
        {field("handelsname", tx("Торговое название", "Handelsname"), { className: "xl:col-span-2" })}
        {field("staerke", tx("Дозировка / концентрация", "Stärke / Konzentration"))}
        {field("form", tx("Лекарственная форма", "Darreichungsform"))}
        {field("einnahmeform", tx("Способ введения", "Einnahmeform / Applikationsweg"), { className: "sm:col-span-2" })}
      </div>

      <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
          {tx("Схема приёма", "Einnahmeschema")}
        </p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {field("dose_morgens", tx("Утро", "Morgens"))}
          {field("dose_mittags", tx("День", "Mittags"))}
          {field("dose_abends", tx("Вечер", "Abends"))}
          {field("dose_nachts", tx("Ночь", "Nachts"))}
          {field("einheit", tx("Единица", "Einheit"), { className: "col-span-2 sm:col-span-1 xl:col-span-2" })}
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-sky-950">
          <input
            type="checkbox"
            checked={asNeeded}
            disabled={disabled}
            className="size-4 rounded border-sky-300 accent-sky-600"
            onChange={(event) => update("as_needed", event.target.checked)}
          />
          {tx("При необходимости (PRN)", "Bei Bedarf (PRN)")}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {field("source_date", tx("Дата документа / действия", "Dokument- / Wirksamkeitsdatum"), { type: "date" })}
        {field("verordnet_am", tx("Назначено", "Verordnet am"), { type: "date" })}
        {field("einnahme_von", tx("Приём с", "Einnahme von"), { type: "date" })}
        {field("einnahme_bis", tx("Приём до", "Einnahme bis"), { type: "date" })}
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Статус", "Status")}
          </span>
          <select
            value={normalizedValue("status") || "aktiv"}
            disabled={disabled}
            className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
            onChange={(event) => update("status", event.target.value)}
          >
            <option value="aktiv">{tx("Активный", "Aktiv")}</option>
            <option value="pausiert">{tx("Приостановлен", "Pausiert")}</option>
            <option value="abgesetzt">{tx("Отменён", "Abgesetzt")}</option>
            <option value="geplant">{tx("Запланирован", "Geplant")}</option>
          </select>
        </label>
      </div>
      {invalidDateRange ? (
        <p className="text-xs font-medium text-destructive">
          {tx("Дата окончания раньше даты начала.", "Das Enddatum liegt vor dem Startdatum.")}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Указания", "Hinweise")}
          </span>
          <textarea
            value={normalizedValue("hinweis")}
            disabled={disabled}
            className="min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            onFocus={onFocus}
            onChange={(event) => update("hinweis", event.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Показания / причина", "Grund / Indikation")}
          </span>
          <textarea
            value={normalizedValue("grund")}
            disabled={disabled}
            className="min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            onFocus={onFocus}
            onChange={(event) => update("grund", event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/60 bg-white/70 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Страна источника", "Ursprungsland")}
          </span>
          <Input
            value={country}
            maxLength={2}
            disabled={disabled}
            className="h-11 bg-white uppercase"
            onChange={(event) => {
              const country = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
              onSourceCountryChange(country);
            }}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-xs font-medium">
          <input
            type="checkbox"
            checked={onHold}
            disabled={disabled}
            className="size-4 rounded border-border accent-orange-500"
            onChange={(event) => update("on_hold", event.target.checked)}
          />
          {tx("Приём приостановлен", "Einnahme pausiert")}
        </label>
        {onHold ? field("hold_from", tx("Пауза с", "Pause von"), { type: "date" }) : null}
        {onHold ? field("hold_until", tx("Пауза до", "Pause bis"), { type: "date" }) : null}
        {onHold ? field("hold_note", tx("Причина паузы", "Pausengrund"), { className: "sm:col-span-2 xl:col-span-4" }) : null}
      </div>

      {identifiers ? (
        <p className="break-words rounded-md border border-border/60 bg-white px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{tx("Идентификаторы", "Kennungen")}:</span>{" "}
          {identifiers}
        </p>
      ) : null}
    </div>
  );
}

const vitalEditorFields = [
  { key: "bp_systolic", ru: "Давление, верхнее", de: "Blutdruck systolisch", unit: "mmHg", min: 40, max: 300, step: 1 },
  { key: "bp_diastolic", ru: "Давление, нижнее", de: "Blutdruck diastolisch", unit: "mmHg", min: 20, max: 200, step: 1 },
  { key: "heart_rate", ru: "Пульс", de: "Puls", unit: "bpm", min: 20, max: 300, step: 1 },
  { key: "temperature_c", ru: "Температура", de: "Temperatur", unit: "°C", min: 25, max: 45, step: 0.1 },
  { key: "oxygen_saturation", ru: "Сатурация", de: "Sauerstoffsättigung", unit: "%", min: 20, max: 100, step: 0.1 },
  { key: "respiratory_rate", ru: "Частота дыхания", de: "Atemfrequenz", unit: "/min", min: 3, max: 80, step: 1 },
  { key: "weight_kg", ru: "Вес", de: "Gewicht", unit: "kg", min: 1, max: 500, step: 0.1 },
  { key: "height_cm", ru: "Рост", de: "Größe", unit: "cm", min: 20, max: 250, step: 0.1 },
  { key: "bmi", ru: "BMI", de: "BMI", unit: "kg/m²", min: 5, max: 100, step: 0.1 },
] as const;

const vitalValidationLabels: Record<VitalImportValidationIssue, { ru: string; de: string }> = {
  missing_date: { ru: "Укажите дату измерения", de: "Messdatum angeben" },
  invalid_date: { ru: "Проверьте формат даты измерения", de: "Format des Messdatums prüfen" },
  missing_measurement: { ru: "Добавьте хотя бы один показатель", de: "Mindestens einen Vitalwert ergänzen" },
  invalid_number: { ru: "Один из показателей вне допустимого диапазона", de: "Ein Vitalwert liegt außerhalb des zulässigen Bereichs" },
  incomplete_blood_pressure: { ru: "Для давления нужны оба значения", de: "Für den Blutdruck sind beide Werte erforderlich" },
  invalid_blood_pressure: { ru: "Верхнее давление должно быть выше нижнего", de: "Der systolische Wert muss über dem diastolischen liegen" },
  bmi_conflict: { ru: "BMI не совпадает с весом и ростом", de: "BMI stimmt nicht mit Gewicht und Größe überein" },
  invalid_source_country: { ru: "Выберите страну документа", de: "Ursprungsland des Dokuments auswählen" },
  invalid_source_page: { ru: "Проверьте страницу источника", de: "Quellseite prüfen" },
};

function VitalCandidateEditor({
  candidate,
  disabled,
  sourceCountry,
  importId,
  tx,
  onPatch,
  onFocus,
  onSourceCountryChange,
}: {
  candidate: ClinicalDocumentImportCandidate;
  disabled: boolean;
  sourceCountry: string;
  importId: string;
  tx: Bilingual;
  onPatch: (patch: Partial<ClinicalDocumentImportCandidate>) => void;
  onFocus: () => void;
  onSourceCountryChange: (country: string) => void;
}) {
  const validation = vitalImportValidation(candidate, sourceCountry, importId);
  const normalizedNumber = (key: string) => {
    const value = candidate.normalized[key];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  };
  const updateNumber = (key: string, rawValue: string) => {
    const normalized = { ...candidate.normalized };
    if (!rawValue.trim()) delete normalized[key];
    else normalized[key] = localizedLabNumber(rawValue);
    onPatch({ normalized });
  };
  const calculatedBmi = validation.calculatedBmi;
  const explicitBmi = typeof candidate.normalized.bmi === "number" ? candidate.normalized.bmi : null;
  const bmiConflict = validation.issues.includes("bmi_conflict");

  return (
    <div
      data-clinical-import-candidate-editor
      className="space-y-4 rounded-xl border border-pink-200/80 bg-white/70 p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-pink-100 bg-pink-50/70 px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold text-pink-950">
            {tx("Проверьте дату и каждое измерение", "Datum und jeden Messwert prüfen")}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-pink-800">
            {tx(
              "В историю попадёт отдельная запись с источником и страницей документа.",
              "Im Verlauf wird ein eigener Eintrag mit Dokumentquelle und Seite angelegt.",
            )}
          </p>
        </div>
        <Badge variant="outline" className="border-pink-200 bg-white text-[10px] text-pink-800">
          {candidate.source.page
            ? tx(`Страница ${candidate.source.page}`, `Seite ${candidate.source.page}`)
            : tx("Страница не определена", "Seite nicht erkannt")}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Дата / время измерения", "Messdatum / -zeit")} *
          </span>
          <Input
            value={typeof candidate.normalized.measured_at === "string" ? candidate.normalized.measured_at : ""}
            disabled={disabled}
            placeholder="YYYY-MM-DD / YYYY-MM-DDTHH:MM:SSZ"
            aria-invalid={validation.issues.includes("missing_date") || validation.issues.includes("invalid_date")}
            className="h-11 bg-white font-mono"
            onFocus={onFocus}
            onChange={(event) => onPatch({
              normalized: { ...candidate.normalized, measured_at: event.target.value },
            })}
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            {tx(
              "Только дата или время с часовым поясом, например 2026-08-10T09:30:00+02:00.",
              "Nur Datum oder Uhrzeit mit Zeitzone, z. B. 2026-08-10T09:30:00+02:00.",
            )}
          </span>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Страна источника", "Ursprungsland")} *
          </span>
          <Input
            value={sourceCountry}
            maxLength={2}
            disabled={disabled}
            aria-invalid={!isCanonicalClinicalImportSourceCountry(sourceCountry)}
            className="h-11 bg-white uppercase"
            onFocus={onFocus}
            onChange={(event) => onSourceCountryChange(
              event.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
            )}
          />
        </label>
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Источник", "Quelle")}
          </span>
          <div className="flex h-11 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
            {candidate.source.section}
            {candidate.source.page ? ` · S. ${candidate.source.page}` : ""}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {vitalEditorFields.map((field) => (
          <label key={field.key} className="space-y-1 rounded-lg border border-pink-100 bg-pink-50/35 p-3">
            <span className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{tx(field.ru, field.de)}</span>
              <span className="normal-case text-pink-700">{field.unit}</span>
            </span>
            <Input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              inputMode="decimal"
              value={normalizedNumber(field.key)}
              disabled={disabled}
              className="h-11 bg-white text-base font-semibold"
              onFocus={onFocus}
              onChange={(event) => updateNumber(field.key, event.target.value)}
            />
            <span className="block text-[10px] text-muted-foreground">
              {field.min}–{field.max} {field.unit}
            </span>
          </label>
        ))}
      </div>

      {calculatedBmi != null ? (
        <div className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs",
          bmiConflict
            ? "border-amber-300 bg-amber-50 text-amber-950"
            : "border-emerald-200 bg-emerald-50 text-emerald-900",
        )}>
          <div>
            <p className="font-semibold">
              {tx("BMI по весу и росту", "BMI aus Gewicht und Größe")}: {calculatedBmi.toFixed(1)} kg/m²
            </p>
            {explicitBmi != null ? (
              <p className="mt-0.5 text-[11px] opacity-80">
                {tx("В документе", "Im Dokument")}: {explicitBmi.toFixed(1)} kg/m²
              </p>
            ) : null}
          </div>
          {bmiConflict && !disabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 bg-white"
              onClick={() => updateNumber("bmi", String(calculatedBmi))}
            >
              {tx("Использовать расчётный BMI", "Berechneten BMI übernehmen")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {validation.issues.length > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
          <p className="font-semibold">
            {tx("Запись нельзя подготовить, пока не исправлены поля:", "Der Eintrag kann erst nach Korrektur vorbereitet werden:")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validation.issues.map((issue) => (
              <li key={issue}>{tx(vitalValidationLabels[issue].ru, vitalValidationLabels[issue].de)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="size-4" />
          {tx("Показатели готовы к фиксации", "Vitalwerte sind zur Vorbereitung bereit")}
        </div>
      )}
    </div>
  );
}

function mergeReviewCandidates(
  incoming: ClinicalDocumentImportCandidate[],
  current: ClinicalDocumentImportCandidate[],
) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const existing = currentById.get(item.id);
    const lowConfidenceDiagnosis = item.target === "diagnosis" && item.confidence < 0.75;
    const normalized = existing?.normalized ?? item.normalized;
    const medicationDecision = medicationCandidateReviewDecision({
      target: item.target,
      normalized,
    });
    return {
      ...item,
      value: existing?.value ?? item.value,
      normalized,
      selected:
        item.target === "medication"
          ? medicationDecision === "include"
          : existing?.selected ??
            (
              item.selected !== false &&
              !lowConfidenceDiagnosis &&
              !isRiskyCandidate(item)
            ),
    };
  });
}

export function ClinicalDocumentImportSheet({
  open,
  onOpenChange,
  patientId,
  patientIdentity,
  lang,
  existingItems,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientIdentity: PatientIdentityReference;
  lang: string;
  existingItems: ExistingClinicalImportItems;
  onApply: (
    documentImport: ClinicalDocumentImport,
    candidates: ClinicalDocumentImportCandidate[],
    sourceCountry: string,
    candidatePayloads: ClinicalDocumentCandidatePayloads,
  ) => Promise<ApplyResult>;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const appliedNoticeRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentImport, setDocumentImport] = useState<ClinicalDocumentImport | null>(null);
  const [candidates, setCandidates] = useState<ClinicalDocumentImportCandidate[]>([]);
  const [sourceCountry, setSourceCountry] = useState("");
  const [patientIdentityConfirmed, setPatientIdentityConfirmed] = useState(false);
  const [activeTab, setActiveTab] = useState<BuilderTab>("all");
  const [manualTarget, setManualTarget] = useState<ClinicalDocumentImportTarget>("diagnosis");
  const [manualValue, setManualValue] = useState("");
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imports, setImports] = useState<ClinicalDocumentImportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClinicalDocumentImportSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const hasActiveHistoryJobs = imports.some((item) =>
    ["queued", "processing"].includes(item.status),
  );

  function clearPreview() {
    if (previewUrlRef.current) revokeDocumentPreviewObjectUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
    setPreviewError("");
  }

  useEffect(() => () => {
    if (previewUrlRef.current) revokeDocumentPreviewObjectUrl(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchClinicalDocumentImports(patientId)
      .then(({ items }) => {
        if (!cancelled) {
          setImports(items);
          setHistoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : tx("Не удалось загрузить историю", "Verlauf konnte nicht geladen werden"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId, lang]);

  useEffect(() => {
    if (!open || !hasActiveHistoryJobs) return;
    const timer = window.setInterval(() => {
      void fetchClinicalDocumentImports(patientId)
        .then(({ items }) => setImports(items))
        .catch(() => undefined);
    }, IMPORT_HISTORY_POLL_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [open, patientId, hasActiveHistoryJobs]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      clearPreview();
      setFile(null);
      setDocumentImport(null);
      setCandidates([]);
      setSourceCountry("");
      setPatientIdentityConfirmed(false);
      setActiveTab("all");
      setManualTarget("diagnosis");
      setManualValue("");
      setActiveCandidateId(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    onOpenChange(nextOpen);
  }

  function handleFileSelected(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!IMPORT_MIME_TYPES.has(nextFile.type)) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.error(tx("Поддерживаются только PDF, PNG и JPG", "Nur PDF, PNG und JPG werden unterstützt"));
      return;
    }
    if (nextFile.size > MAX_IMPORT_FILE_BYTES) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.error(tx("Файл превышает лимит 25 МБ", "Die Datei überschreitet das Limit von 25 MB"));
      return;
    }
    setFile(nextFile);
  }

  async function refreshHistory(silent = false) {
    if (!silent) setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetchClinicalDocumentImports(patientId);
      setImports(response.items);
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : tx("Не удалось загрузить историю", "Verlauf konnte nicht geladen werden"),
      );
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }

  async function loadPreview(documentId: string) {
    clearPreview();
    try {
      const nextPreview = await createDocumentPreviewObjectUrl(documentId);
      previewUrlRef.current = nextPreview.url;
      setPreview(nextPreview);
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : tx("Предпросмотр недоступен", "Vorschau nicht verfügbar"),
      );
    }
  }

  async function openImportSnapshot(item: ClinicalDocumentImportSummary) {
    setHistoryBusyId(item.id);
    try {
      const detail = await fetchClinicalDocumentImport(patientId, item.id);
      const snapshotCandidates = detail.reviewed_draft?.candidates ?? detail.draft.candidates;
      const nextCandidates = detail.reviewed_draft
        ? snapshotCandidates
        : mergeReviewCandidates(snapshotCandidates, []);
      setDocumentImport(detail);
      setCandidates(nextCandidates);
      setActiveCandidateId(snapshotCandidates[0]?.id ?? null);
      setActiveTab("all");
      if (detail.status === "applying" || detail.status === "applied") {
        setSourceCountry(detail.prepared_source_country ?? "");
        setPatientIdentityConfirmed(detail.prepared_patient_identity_confirmed ?? false);
      } else if (detail.status === "review_required") {
        setSourceCountry(deriveClinicalImportSourceCountry(nextCandidates));
        setPatientIdentityConfirmed(false);
      } else {
        setSourceCountry("");
        setPatientIdentityConfirmed(false);
      }
      await loadPreview(detail.document_id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось открыть снимок", "Snapshot konnte nicht geöffnet werden"),
      );
    } finally {
      setHistoryBusyId(null);
    }
  }

  async function deleteHistoryImport() {
    const target = deleteTarget;
    if (!target || deleteBusy) return;
    if (target.status === "applying") {
      setDeleteTarget(null);
      toast.error(
        tx(
          "Зафиксированное применение нельзя удалить. Откройте его и завершите импорт.",
          "Eine vorbereitete Übernahme kann nicht gelöscht werden. Öffnen und schließen Sie den Import ab.",
        ),
      );
      return;
    }

    setDeleteBusy(true);
    setHistoryBusyId(target.id);
    try {
      await deleteClinicalDocumentImport(patientId, target.id);
      setImports((current) => current.filter((item) => item.id !== target.id));
      if (documentImport?.id === target.id) {
        clearPreview();
        setDocumentImport(null);
        setCandidates([]);
        setActiveCandidateId(null);
        setActiveTab("all");
      }
      setDeleteTarget(null);
      toast.success(tx("Обработка удалена из истории", "Verarbeitung wurde aus dem Verlauf entfernt"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось удалить обработку", "Verarbeitung konnte nicht gelöscht werden"),
      );
    } finally {
      setDeleteBusy(false);
      setHistoryBusyId(null);
    }
  }

  function returnToHistory() {
    clearPreview();
    setDocumentImport(null);
    setCandidates([]);
    setActiveCandidateId(null);
    setActiveTab("all");
    setSourceCountry("");
    setPatientIdentityConfirmed(false);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    void refreshHistory(true);
  }

  const pollingImportId = documentImport?.id ?? null;
  const shouldPoll = Boolean(
    documentImport && ["queued", "processing"].includes(documentImport.status),
  );

  useEffect(() => {
    if (!pollingImportId || !shouldPoll) return;
    const importId = pollingImportId;

    let cancelled = false;
    let timer: number | null = null;
    let consecutiveFailures = 0;
    let errorReported = false;

    function schedule(delay: number) {
      if (cancelled) return;
      timer = window.setTimeout(() => void poll(), delay);
    }

    async function poll() {
      try {
        const next = await fetchClinicalDocumentImport(patientId, importId);
        if (cancelled) return;
        consecutiveFailures = 0;
        errorReported = false;
        setDocumentImport(next);
        if (!["queued", "processing"].includes(next.status)) {
          void refreshHistory(true);
        }
        if (next.status === "review_required") {
          setCandidates((current) => mergeReviewCandidates(next.draft.candidates, current));
          setSourceCountry(deriveClinicalImportSourceCountry(next.draft.candidates));
          setPatientIdentityConfirmed(false);
          setActiveCandidateId((activeId) =>
            activeId && next.draft.candidates.some((item) => item.id === activeId)
              ? activeId
              : (next.draft.candidates[0]?.id ?? null),
          );
          return;
        }
        if (["queued", "processing"].includes(next.status)) {
          schedule(IMPORT_POLL_BASE_DELAY_MS);
        }
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (!errorReported) {
          errorReported = true;
          toast.error(
            error instanceof Error
              ? error.message
              : tx("Ошибка обработки", "Verarbeitungsfehler"),
          );
        }
        const retryDelay = Math.min(
          IMPORT_POLL_BASE_DELAY_MS * 2 ** Math.min(consecutiveFailures - 1, 8),
          IMPORT_POLL_MAX_DELAY_MS,
        );
        schedule(retryDelay);
      }
    }

    schedule(IMPORT_POLL_BASE_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pollingImportId, shouldPoll, patientId, lang]);

  const medicationDispositionFor = (candidate: ClinicalDocumentImportCandidate) =>
    candidate.target === "medication"
      ? medicationCandidateNeedsWirkstoff(candidate) ? "blocked" as const : "ready" as const
      : null;
  const medicationSeriesOptionsFor = (candidate: ClinicalDocumentImportCandidate) => {
    if (candidate.target !== "medication") return [];
    const identity = normalizedString(candidate, "wirkstoff")?.trim().toLocaleLowerCase("de-DE");
    if (!identity) return [];
    const matches = existingItems.medication.filter(
      (item) =>
        Boolean(item.medicationSeriesId) &&
        item.medicationIdentity?.trim().toLocaleLowerCase("de-DE") === identity,
    );
    return Array.from(
      new Map(matches.map((item) => [item.medicationSeriesId as string, item])).values(),
    );
  };
  const matchingBatchMedicationCountFor = (candidate: ClinicalDocumentImportCandidate) => {
    if (candidate.target !== "medication") return 0;
    const identity = normalizedString(candidate, "wirkstoff")
      ?.trim()
      .toLocaleLowerCase("de-DE")
      .replace(/\s+/g, " ");
    if (!identity) return 0;
    return candidates.filter((item) => {
      if (item.target !== "medication" || (!item.selected && item.id !== candidate.id)) return false;
      return normalizedString(item, "wirkstoff")
        ?.trim()
        .toLocaleLowerCase("de-DE")
        .replace(/\s+/g, " ") === identity;
    }).length;
  };
  const candidateSelectionBlocked = (candidate: ClinicalDocumentImportCandidate) => {
    const seriesOptions = medicationSeriesOptionsFor(candidate);
    return medicationCandidateReviewBlockReason(
      candidate,
      seriesOptions.length,
      matchingBatchMedicationCountFor(candidate),
    ) !== null;
  };
  const { selected, blockedSelected } = partitionMedicationReviewSelection(
    candidates,
    (candidate) => medicationSeriesOptionsFor(candidate).length,
    matchingBatchMedicationCountFor,
  );
  const medicationReview = medicationReviewDecisionSummary(candidates);
  const frozenMedicationSelectionCount = candidates.filter(
    (candidate) => candidate.target === "medication" && candidate.selected,
  ).length;
  const medicationSelectedCount = documentImport?.status === "review_required"
    ? medicationReview.included
    : frozenMedicationSelectionCount;
  const visibleCandidates = useMemo(
    () => candidates.filter((item) => activeTab === "all" || item.target === activeTab),
    [activeTab, candidates],
  );
  const activeCandidate = candidates.find((item) => item.id === activeCandidateId) ?? null;
  const subjectCheck = useMemo(
    () => checkClinicalDocumentSubject(documentImport?.draft.subject, patientIdentity),
    [documentImport?.draft.subject, patientIdentity],
  );
  const identityPrepareMode = clinicalDocumentIdentityPrepareMode(
    documentImport?.status,
    documentImport?.prepared_identity_gate_version,
  );
  const requiresCurrentIdentityDecision = clinicalDocumentIdentityRequiresCurrentDecision(
    identityPrepareMode,
  );
  const identityPanelStatus = identityPrepareMode === "frozen_applying"
    ? "frozen"
    : subjectCheck.status;
  const extractedSubject = documentImport?.draft.subject;
  const extractedSubjectSummary = [
    [extractedSubject?.first_name, extractedSubject?.last_name].filter(Boolean).join(" "),
    extractedSubject?.birth_date,
    extractedSubject?.patient_identifier,
  ].filter(Boolean).join(" · ");
  const patientIdentitySummary = [
    [patientIdentity.firstName, patientIdentity.lastName].filter(Boolean).join(" "),
    patientIdentity.birthDate,
    patientIdentity.patientIdentifier,
  ].filter(Boolean).join(" · ");
  const activePage = activeCandidate?.source.page ?? 1;
  const hasCountryScopedCandidate = clinicalImportNeedsSourceCountry(selected);
  const newCount = (target: ClinicalDocumentImportTarget) =>
    candidates.filter((item) => item.target === target).length;

  function formatImportDate(value: string) {
    return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function appliedObjectCount(item: ClinicalDocumentImportSummary | ClinicalDocumentImport) {
    return Object.values(item.applied_counts).reduce((sum, count) => sum + count, 0);
  }

  async function startImport() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patient_id", patientId);
      form.append("auto_name", file.name);
      form.append("art", "medical_report");
      form.append("category", "medical_report");
      form.append("status", "active");
      form.append("visibility", "internal");
      form.append("is_medical", "true");
      form.append("ursprung", "clinical_document_import");
      const uploaded = await uploadDocument(form);
      clearApiCache("/documents");
      clearApiCache(`/patients/${patientId}/documents`);
      const created = await createClinicalDocumentImport(patientId, uploaded.id);
      setDocumentImport(created);
      setPatientIdentityConfirmed(false);
      await loadPreview(uploaded.id);
      void refreshHistory(true);
      toast.success(
        tx(
          "Документ загружен и поставлен в очередь",
          "Dokument wurde zur Verarbeitung eingereiht",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось загрузить документ", "Dokument konnte nicht hochgeladen werden"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!documentImport) return;
    setBusy(true);
    try {
      setDocumentImport(await retryClinicalDocumentImport(patientId, documentImport.id));
      void refreshHistory(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Повтор не удался", "Erneuter Versuch fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rescan() {
    if (!documentImport) return;
    setBusy(true);
    try {
      const rescanned = await rescanClinicalDocumentImport(patientId, documentImport.id);
      setDocumentImport(rescanned);
      setCandidates([]);
      setActiveCandidateId(null);
      setActiveTab("all");
      setSourceCountry("");
      setPatientIdentityConfirmed(false);
      void refreshHistory(true);
      toast.success(tx("Документ отправлен на повторное сканирование", "Dokument wird erneut gescannt"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось пересканировать документ", "Dokument konnte nicht erneut gescannt werden"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rescanHistoryItem(item: ClinicalDocumentImportSummary) {
    if (!["review_required", "failed", "applied"].includes(item.status)) return;
    setHistoryBusyId(item.id);
    try {
      const rescanned = item.status === "applied"
        ? await createClinicalDocumentImport(patientId, item.document_id)
        : await rescanClinicalDocumentImport(patientId, item.id);
      setDocumentImport(rescanned);
      setCandidates([]);
      setActiveCandidateId(null);
      setActiveTab("all");
      setSourceCountry("");
      setPatientIdentityConfirmed(false);
      await loadPreview(rescanned.document_id);
      await refreshHistory(true);
      toast.success(
        tx(
          "Документ отправлен на повторное сканирование",
          "Dokument wird erneut gescannt",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось пересканировать документ", "Dokument konnte nicht erneut gescannt werden"),
      );
    } finally {
      setHistoryBusyId(null);
    }
  }

  async function apply() {
    if (!documentImport) return;
    if (documentImport.status === "review_required" && medicationReview.unresolved > 0) {
      const unresolved = medicationReview.unresolvedCandidates[0];
      if (!unresolved) return;
      setActiveCandidateId(unresolved.id);
      setActiveTab("medication");
      window.requestAnimationFrame(() => {
        const card = Array.from(
          document.querySelectorAll<HTMLElement>("[data-clinical-import-candidate-id]"),
        ).find((element) => element.dataset.clinicalImportCandidateId === unresolved.id);
        card?.focus();
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      toast.error(
        tx(
          `Примите решение по каждому медикаменту: осталось ${medicationReview.unresolved}.`,
          `Für jedes Medikament eine Entscheidung treffen: ${medicationReview.unresolved} offen.`,
        ),
      );
      return;
    }
    if (
      documentImport.status === "review_required" &&
      selected.length === 0
    ) return;
    if (requiresCurrentIdentityDecision && subjectCheck.status === "hard_mismatch") {
      toast.error(
        tx(
          "Дата рождения, номер пациента или противоречивые данные в документе не совпадают с этой картой.",
          "Geburtsdatum, Patientennummer oder widersprüchliche Identitätsdaten passen nicht zu dieser Akte.",
        ),
      );
      return;
    }
    if (
      requiresCurrentIdentityDecision
      && clinicalDocumentIdentityNeedsExplicitConfirmation(subjectCheck.status)
      && !patientIdentityConfirmed
    ) {
      toast.error(
        subjectCheck.status === "profile_incomplete"
          ? tx(
              "В карточке пациента нет корректного имени. Проверьте оригинал и подтвердите импорт вручную.",
              "In der Patientenakte fehlt ein verlässlicher Name. Original prüfen und Import manuell bestätigen.",
            )
          : subjectCheck.status === "unavailable"
          ? tx(
              "OCR не подтвердил пациента. Проверьте личность в оригинале документа и подтвердите её вручную.",
              "OCR konnte den Patienten nicht bestätigen. Identität im Originaldokument prüfen und manuell bestätigen.",
            )
          : tx(
              "Подтвердите расхождение в данных пациента перед импортом.",
              "Bestätigen Sie die Abweichung bei der Patientenidentität vor dem Import.",
            ),
      );
      return;
    }
    if (documentImport.status === "review_required" && blockedSelected.length > 0) {
      const blocked = blockedSelected[0];
      const reason = medicationCandidateReviewBlockReason(
        blocked,
        medicationSeriesOptionsFor(blocked).length,
        matchingBatchMedicationCountFor(blocked),
      );
      setActiveCandidateId(blocked.id);
      setActiveTab(blocked.target);
      window.requestAnimationFrame(() => {
        const card = Array.from(
          document.querySelectorAll<HTMLElement>("[data-clinical-import-candidate-id]"),
        ).find((element) => element.dataset.clinicalImportCandidateId === blocked.id);
        card?.focus();
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      toast.error(
        reason === "missing_wirkstoff"
          ? tx(
              "У выбранного медикамента нет действующего вещества. Заполните это поле перед импортом.",
              "Für das ausgewählte Medikament fehlt der Wirkstoff. Bitte vor dem Import ergänzen.",
            )
          : tx(
              "Для выбранного медикамента нужно выбрать существующую линию или создать новую.",
              "Für das ausgewählte Medikament muss eine bestehende Serie gewählt oder eine neue erstellt werden.",
            ),
      );
      return;
    }
    if (hasCountryScopedCandidate && !isCanonicalClinicalImportSourceCountry(sourceCountry)) {
      toast.error(
        tx(
          "Выберите страну документа",
          "Ursprungsland des Dokuments auswählen",
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const latestImport = await fetchClinicalDocumentImport(patientId, documentImport.id);
      if (latestImport.status === "applied") {
        setDocumentImport(latestImport);
        toast.success(tx("Импорт уже был завершён", "Der Import wurde bereits abgeschlossen"));
        return;
      }
      if (latestImport.status !== "review_required" && latestImport.status !== "applying") {
        throw new Error(tx("Черновик ещё не готов к подтверждению", "Der Entwurf ist noch nicht zur Prüfung bereit"));
      }

      const latestSubjectCheck = checkClinicalDocumentSubject(
        latestImport.draft.subject,
        patientIdentity,
      );
      const latestIdentityPrepareMode = clinicalDocumentIdentityPrepareMode(
        latestImport.status,
        latestImport.prepared_identity_gate_version,
      );
      const latestRequiresCurrentIdentityDecision = clinicalDocumentIdentityRequiresCurrentDecision(
        latestIdentityPrepareMode,
      );
      const identityConfirmedForPrepare = clinicalDocumentIdentityConfirmationForPrepare({
        mode: latestIdentityPrepareMode,
        preparedIdentityConfirmed: latestImport.prepared_patient_identity_confirmed,
        newlyConfirmed: patientIdentityConfirmed,
      });
      if (latestRequiresCurrentIdentityDecision && latestSubjectCheck.status === "hard_mismatch") {
        throw new Error(
          tx(
            "Документ не соответствует выбранному пациенту по надёжным идентификаторам.",
            "Das Dokument stimmt bei starken Identifikatoren nicht mit dem ausgewählten Patienten überein.",
          ),
        );
      }
      if (
        latestRequiresCurrentIdentityDecision
        && clinicalDocumentIdentityNeedsExplicitConfirmation(latestSubjectCheck.status)
        && !identityConfirmedForPrepare
      ) {
        throw new Error(
          latestSubjectCheck.status === "profile_incomplete"
            ? tx(
                "В карточке пациента всё ещё нет корректного имени; требуется ручное подтверждение.",
                "In der Patientenakte fehlt weiterhin ein verlässlicher Name; manuelle Bestätigung ist erforderlich.",
              )
            : latestSubjectCheck.status === "unavailable"
            ? tx(
                "Личность пациента в оригинале документа ещё не подтверждена вручную.",
                "Die Patientenidentität im Originaldokument wurde noch nicht manuell bestätigt.",
              )
            : tx(
                "Расхождение в данных пациента ещё не подтверждено.",
                "Die Abweichung bei der Patientenidentität wurde noch nicht bestätigt.",
              ),
        );
      }

      let reviewedDraft: ClinicalDocumentImportDraft;
      let preparedCountry: string;
      let preparedImport: ClinicalDocumentImport = latestImport;
      if (latestImport.status === "applying") {
        if (!latestImport.reviewed_draft) {
          throw new Error(tx("Зафиксированный импорт не содержит снимка проверки", "Vorbereiteter Import enthält keinen Prüfsnapshot"));
        }
        reviewedDraft = latestImport.reviewed_draft;
        preparedCountry = latestImport.prepared_source_country ?? "";
      } else {
        reviewedDraft = {
          ...latestImport.draft,
          candidates,
        };
        preparedCountry = hasCountryScopedCandidate ? sourceCountry : "";
      }
      const { candidatePayloads, invalidCandidate } = buildClinicalDocumentCandidatePayloads(
        reviewedDraft.candidates,
        preparedCountry,
        latestImport.id,
      );
      if (invalidCandidate) {
        setActiveCandidateId(invalidCandidate.id);
        setActiveTab(invalidCandidate.target);
        window.requestAnimationFrame(() => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>("[data-clinical-import-candidate-id]"),
          ).find((element) => element.dataset.clinicalImportCandidateId === invalidCandidate.id);
          card?.focus();
          card?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        throw new Error(
          invalidCandidate.target === "lab_result"
            ? tx(
                "Для выбранного анализа нужны показатель, значение, дата и страна документа.",
                "Für den ausgewählten Laborwert sind Parameter, Wert, Datum und das Ursprungsland des Dokuments erforderlich.",
              )
            : invalidCandidate.target === "vital"
              ? tx(
                  "Исправьте отмеченные поля показателей: дата, страна документа, диапазоны, пара давления и соответствие BMI.",
                  "Markierte Vitalwert-Felder korrigieren: Datum, Ursprungsland, Wertebereiche, Blutdruckpaar und BMI-Konsistenz.",
                )
            : tx(
                "Для выбранного медикамента нужны действующее вещество и страна документа.",
                "Für das ausgewählte Medikament sind Wirkstoff und das Ursprungsland des Dokuments erforderlich.",
              ),
        );
      }
      const prepared = await prepareClinicalDocumentImport(
        patientId,
        latestImport.id,
        reviewedDraft,
        candidatePayloads,
        preparedCountry || null,
        identityConfirmedForPrepare,
      );
      preparedCountry = prepared.source_country ?? "";
      preparedImport = clinicalDocumentImportAfterPrepare(
        latestImport,
        reviewedDraft,
        prepared,
        new Date().toISOString(),
      );
      setDocumentImport(preparedImport);
      setPatientIdentityConfirmed(prepared.patient_identity_confirmed);
      setCandidates(reviewedDraft.candidates);
      const preparedCandidates = reviewedDraft.candidates.filter((candidate) => candidate.selected);
      const appliedCounts = await onApply(
        preparedImport,
        preparedCandidates,
        preparedCountry,
        candidatePayloads,
      );
      const completed = await completeClinicalDocumentImport(
        patientId,
        preparedImport.id,
        reviewedDraft,
        appliedCounts,
      );
      setDocumentImport(completed);
      setCandidates(completed.reviewed_draft?.candidates ?? candidates);
      setActiveTab("all");
      void refreshHistory(true);
      toast.success(
        tx(
          "Данные добавлены в карту пациента",
          "Daten wurden in die Patientenakte übernommen",
        ),
      );
      window.requestAnimationFrame(() => appliedNoticeRef.current?.focus());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Импорт не удался", "Import fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  function patchCandidate(id: string, patch: Partial<ClinicalDocumentImportCandidate>) {
    setCandidates((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function setMedicationDecision(id: string, decision: "include" | "exclude") {
    setCandidates((current) =>
      current.map((item) =>
        item.id === id ? setMedicationCandidateReviewDecision(item, decision) : item,
      ),
    );
  }

  function updateSourceCountry(country: string) {
    setSourceCountry(country);
    setCandidates((current) =>
      current.map((candidate) =>
        ["diagnosis", "lab_result", "medication", "vital"].includes(candidate.target)
          ? {
              ...candidate,
              normalized: { ...candidate.normalized, source_country: country },
            }
          : candidate,
      ),
    );
  }

  function addManualCandidate() {
    const value = manualValue.trim();
    if (!value || snapshotReadOnly) return;
    const manualLabParts = manualTarget === "lab_result"
      ? value.split("|").map((part) => part.trim())
      : [];
    if (manualTarget === "lab_result" && (manualLabParts.length < 2 || !manualLabParts[0] || !manualLabParts[1])) {
      toast.error(tx("Для анализа укажите: показатель | значение | единица | референс", "Laborwert angeben als: Parameter | Wert | Einheit | Referenz"));
      return;
    }
    const id = `manual:${crypto.randomUUID()}`;
    const normalized: Record<string, unknown> = (() => {
      if (manualTarget === "diagnosis") {
        return {
          kind: "secondary",
          label: value,
          certainty: "bestaetigt",
          source_mode: "extern",
          assertion: "confirmed",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "anamnesis") {
        return {
          anamnese_aktuelle: value,
          section_role: "manual",
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "medication") {
        return {
          wirkstoff: value,
          handelsname: "",
          staerke: null,
          form: null,
          einnahmeform: null,
          dose_morgens: null,
          dose_mittags: null,
          dose_abends: null,
          dose_nachts: null,
          einheit: null,
          hinweis: null,
          grund: null,
          verordnet_am: null,
          einnahme_von: null,
          einnahme_bis: null,
          source_date: null,
          status: "aktiv",
          on_hold: false,
          hold_from: null,
          hold_until: null,
          hold_note: null,
          as_needed: false,
          source_country: sourceCountry,
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
          medication_review_decision: "include",
        };
      }
      if (manualTarget === "examination") {
        return {
          kind: "other",
          title: tx("Выделено из документа", "Aus Dokument ausgewählt"),
          result: value,
          status: "final",
          section_role: "manual",
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "lab_result") {
        const [analyteName, resultText, unit, referenceText] = manualLabParts;
        return {
          panel: tx("Ручной ввод", "Manuelle Eingabe"),
          analyte_name: analyteName,
          result_text: resultText,
          numeric_result: localizedLabNumber(resultText.replace(/^(?:<=|>=|<|>|=)\s*/, "")),
          comparator: resultText.match(/^(<=|>=|<|>|=)/)?.[1] ?? null,
          unit: unit || null,
          reference_text: referenceText || null,
          reference_low: null,
          reference_high: null,
          abnormal_flag: "unknown",
          measured_on: new Date().toISOString().slice(0, 10),
          semantic_role: "laboratory_observation",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "vital") {
        return {
          measured_at: new Date().toISOString().slice(0, 10),
          units: {},
          assertion: "documented",
          semantic_role: "vital_measurement",
          auto_select: true,
          review_reasons: ["manual_values_required"],
          confidence_kind: "manual_user_entry",
        };
      }
      return {
        description: value,
        section_role: "manual",
        assertion: "reported",
        semantic_role: "manual_review",
        auto_select: true,
        review_reasons: [],
        confidence_kind: "manual_user_entry",
      };
    })();
    const candidate: ClinicalDocumentImportCandidate = {
      id,
      target: manualTarget,
      value,
      normalized,
      confidence: 1,
      selected: true,
      source: {
        page: null,
        section: tx("Ручной выбор", "Manuelle Auswahl"),
        text: value,
      },
    };
    setCandidates((current) => [...current, candidate]);
    setActiveCandidateId(id);
    setActiveTab(manualTarget);
    setManualValue("");
    toast.success(
      tx("Объект добавлен в черновик", "Objekt zum Entwurf hinzugefügt"),
    );
  }

  const reviewReady = documentImport?.status === "review_required";
  const applyingReady = documentImport?.status === "applying";
  const snapshotReady = reviewReady || applyingReady || documentImport?.status === "applied";
  const snapshotReadOnly = applyingReady || documentImport?.status === "applied";
  const identityImportBlocked = requiresCurrentIdentityDecision
    && (
      subjectCheck.status === "hard_mismatch"
      || (
        clinicalDocumentIdentityNeedsExplicitConfirmation(subjectCheck.status)
        && !patientIdentityConfirmed
      )
    );

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={handleOpenChange}
      maxWidthClassName="overflow-hidden sm:!top-1 sm:!bottom-1 sm:!right-1 sm:!w-[calc(100vw-8px)] sm:!max-w-[calc(100vw-8px)] sm:!rounded-2xl"
      title={tx("Конструктор импорта медицинского документа", "Assistent für den Import medizinischer Dokumente")}
      description={tx(
        "Проверяйте предложения системы рядом с оригиналом.",
        "Systemvorschläge direkt neben dem Original prüfen.",
      )}
      headerClassName="bg-white px-5 py-3"
      bodyClassName="!space-y-0 !overflow-hidden !bg-white !p-0"
      bodyWrapperClassName="h-full min-h-0"
      footer={
        reviewReady || applyingReady ? (
          <>
            {identityImportBlocked ? (
              <p className="mr-auto text-xs font-medium text-rose-700">
                {subjectCheck.status === "hard_mismatch"
                  ? tx(
                      "Импорт заблокирован: документ не соответствует выбранному пациенту",
                      "Import gesperrt: Dokument passt nicht zum ausgewählten Patienten",
                    )
                  : subjectCheck.status === "profile_incomplete"
                    ? tx(
                        "Исправьте имя в карточке или подтвердите пациента по оригиналу документа",
                        "Name in der Akte korrigieren oder Patienten anhand des Originals bestätigen",
                      )
                  : subjectCheck.status === "unavailable"
                    ? tx(
                        "Проверьте личность пациента в оригинале документа",
                        "Patientenidentität im Originaldokument prüfen",
                      )
                    : tx(
                        "Подтвердите расхождение в данных пациента",
                        "Abweichung bei der Patientenidentität bestätigen",
                      )}
              </p>
            ) : reviewReady && medicationReview.unresolved > 0 ? (
              <p className="mr-auto text-xs font-semibold text-amber-800">
                {tx(
                  `${medicationReview.unresolved} медикамент(а): выберите «Добавить» или «Не добавлять»`,
                  `${medicationReview.unresolved} Medikament(e): „Übernehmen“ oder „Nicht übernehmen“ wählen`,
                )}
              </p>
            ) : reviewReady && blockedSelected.length > 0 ? (
              <p className="mr-auto text-xs font-medium text-amber-700">
                {tx(
                  `${blockedSelected.length} медикамент(а) требуют проверки перед применением`,
                  `${blockedSelected.length} Medikament(e) müssen vor der Übernahme geprüft werden`,
                )}
              </p>
            ) : applyingReady ? (
              <p className="mr-auto text-xs font-medium text-violet-700">
                {tx("Выбор зафиксирован — импорт можно безопасно продолжить", "Auswahl ist eingefroren – Import kann sicher fortgesetzt werden")}
              </p>
            ) : (
              <span className="mr-auto" />
            )}
            {medicationReview.total > 0 ? (
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 bg-white text-xs",
                  reviewReady && medicationReview.unresolved > 0
                    ? "border-amber-300 text-amber-900"
                    : "border-sky-300 text-sky-900",
                )}
              >
                {tx("Медикаменты", "Medikation")}: {medicationSelectedCount}/{medicationReview.total}
              </Badge>
            ) : null}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {applyingReady ? tx("Закрыть", "Schließen") : tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                identityImportBlocked ||
                (reviewReady && medicationReview.unresolved > 0) ||
                (reviewReady && selected.length === 0)
              }
              onClick={apply}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {applyingReady
                ? tx("Продолжить и завершить", "Fortsetzen und abschließen")
                : tx("Подтвердить и добавить", "Prüfen und übernehmen")}
            </Button>
          </>
        ) : documentImport?.status === "applied" ? (
          <>
            <div className="mr-auto flex min-w-0 items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="truncate font-medium">
                {tx(
                  `${appliedObjectCount(documentImport)} объект(ов) добавлено в карту`,
                  `${appliedObjectCount(documentImport)} Objekt(e) in die Akte übernommen`,
                )}
              </span>
            </div>
            {medicationReview.total > 0 ? (
              <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-800">
                {tx("Медикаменты добавлены", "Medikamente übernommen")}: {documentImport.applied_counts.medications ?? 0}
              </Badge>
            ) : null}
            <Button type="button" variant="outline" onClick={returnToHistory}>
              <FileUp className="size-4" />
              {tx("Загрузить ещё документ", "Weiteres Dokument hochladen")}
            </Button>
            <Button type="button" onClick={() => handleOpenChange(false)}>
              <Check className="size-4" />
              {tx("Закрыть", "Schließen")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div
        data-clinical-import-workspace
        className="flex h-full min-h-0 flex-col bg-white"
      >
        {snapshotReady ? (
          <div className="shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border bg-white">
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const nextTab = value as BuilderTab;
                setActiveTab(nextTab);
                if (nextTab === "source") setActiveCandidateId(null);
              }}
            >
              <TabsList
                variant="line"
                aria-label={tx("Разделы конструктора импорта", "Bereiche des Importassistenten")}
                className="grid !h-14 !w-full min-w-[80rem] grid-cols-9 gap-0 rounded-none border-0 bg-transparent p-0 xl:min-w-0"
              >
                <TabsTrigger value="source" className={builderTabClassName}>
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                      activeTab === "source"
                        ? "border-[var(--brand)] text-[var(--brand)]"
                        : "border-muted-foreground/40 text-muted-foreground",
                    )}
                  >
                    <FileText aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="min-w-0 text-[11px] font-medium leading-tight">
                    {tx("Полный текст", "Volltext")}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="all" className={builderTabClassName}>
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                      activeTab === "all"
                        ? "border-[var(--brand)] text-[var(--brand)]"
                        : "border-muted-foreground/40 text-muted-foreground",
                    )}
                  >
                    <ListChecks aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="min-w-0 text-[11px] font-medium leading-tight">
                    {tx("Все", "Alle")}
                  </span>
                  <span className="rounded-full bg-orange-50 px-1.5 text-[10px] text-orange-700">
                    {candidates.length}
                  </span>
                </TabsTrigger>
                {targetOrder.map((target) => {
                  const TargetIcon = targetIcons[target];
                  return (
                    <TabsTrigger key={target} value={target} className={builderTabClassName}>
                      <span
                        className={cn(
                          "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                          activeTab === target
                            ? "border-[var(--brand)] text-[var(--brand)]"
                            : "border-muted-foreground/40 text-muted-foreground",
                        )}
                      >
                        <TargetIcon aria-hidden="true" className="size-3.5" />
                      </span>
                      <span className="min-w-0 text-[11px] font-medium leading-tight">
                        {targetLabels[target][lang === "de" ? "de" : "ru"]}
                      </span>
                      <span className="rounded-full bg-orange-50 px-1.5 text-[10px] text-orange-700">
                        {newCount(target)}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        ) : documentImport ? (
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4">
            <Button type="button" size="sm" variant="ghost" onClick={returnToHistory}>
              <ArrowLeft className="size-4" />
              {tx("К истории", "Zum Verlauf")}
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                {documentImport.document_name}
              </span>
              {documentImport.status === "review_required" ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={rescan}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  <span className="hidden sm:inline">
                    {tx("Пересканировать документ", "Dokument neu scannen")}
                  </span>
                  <span className="sm:hidden">{tx("Пересканировать", "Neu scannen")}</span>
                </Button>
              ) : null}
              <Badge variant="outline" className={importStatusTone[documentImport.status]}>
                <ImportStatusGlyph status={documentImport.status} />
                {importStatusLabels[documentImport.status][lang === "de" ? "de" : "ru"]}
              </Badge>
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[minmax(520px,58fr)_minmax(400px,42fr)] xl:grid-cols-[minmax(680px,62fr)_minmax(420px,38fr)]">
          <section className="flex min-h-0 flex-col bg-white">
          {!documentImport ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-3xl space-y-4">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {tx("Добавить данные из документа", "Daten aus Dokument übernehmen")}
                    </h3>
                  </div>

                  <button
                    type="button"
                    className={cn(
                      "flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-white px-5 py-5 text-center transition-colors",
                      "hover:border-[var(--brand)]/60 hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/35 focus-visible:ring-offset-2",
                      file ? "border-[var(--brand)]/60" : "border-border/80",
                    )}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleFileSelected(event.dataTransfer.files?.[0] ?? null);
                    }}
                  >
                    {file ? (
                      <FileText className="size-5 text-emerald-600" />
                    ) : (
                      <FileUp className="size-5 text-[var(--brand)]" />
                    )}
                    <span className="mt-2 max-w-full break-words text-xs font-semibold text-foreground">
                      {file?.name ?? tx("Выберите PDF или изображение", "PDF oder Bild auswählen")}
                    </span>
                    <span className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {file
                        ? tx("Файл готов к обработке", "Datei ist zur Verarbeitung bereit")
                        : tx(
                            "Нажмите или перетащите файл в эту область",
                            "Klicken oder Datei in diesen Bereich ziehen",
                          )}
                    </span>
                    <span className="mt-2 text-[10px] font-medium text-muted-foreground">
                      PDF · PNG · JPG · {tx("до 25 МБ", "bis 25 MB")}
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 w-full rounded-lg text-xs"
                    disabled={!file || busy}
                    onClick={startImport}
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                    {tx("Загрузить и построить черновик", "Hochladen und Entwurf erstellen")}
                  </Button>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <Check className="size-3" />
                    {tx(
                      "Данные попадут в карту только после вашего подтверждения",
                      "Daten gelangen erst nach Ihrer Bestätigung in die Akte",
                    )}
                  </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-border/70 bg-white">
                  <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <History className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold">
                          {tx("История обработки", "Verarbeitungsverlauf")}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {tx(
                            "Снимки документов этого пациента",
                            "Dokument-Snapshots dieses Patienten",
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={historyLoading}
                      onClick={() => void refreshHistory()}
                      aria-label={tx("Обновить историю", "Verlauf aktualisieren")}
                    >
                      <RefreshCw className={cn("size-4", historyLoading && "animate-spin")} />
                    </Button>
                  </header>

                  {historyError ? (
                    <div className="m-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {historyError}
                    </div>
                  ) : null}

                  {historyLoading && imports.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {tx("Загружаем историю…", "Verlauf wird geladen…")}
                    </div>
                  ) : imports.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <FileText className="mx-auto size-8 text-muted-foreground/50" />
                      <p className="mt-2 text-sm font-medium">
                        {tx("Обработок пока нет", "Noch keine Verarbeitungen")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx(
                          "После загрузки здесь появятся статус обработки и готовый снимок.",
                          "Nach dem Upload erscheinen hier Worker-Status und fertiger Snapshot.",
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {imports.map((item) => {
                        const appliedCount = appliedObjectCount(item);
                        return (
                          <div key={item.id} className="flex items-center transition-colors hover:bg-muted/25">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left disabled:cursor-wait"
                              disabled={historyBusyId === item.id}
                              onClick={() => void openImportSnapshot(item)}
                            >
                              <div
                                className={cn(
                                  "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                                  importStatusTone[item.status],
                                )}
                              >
                                {historyBusyId === item.id ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  <ImportStatusGlyph status={item.status} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="max-w-full truncate text-sm font-medium">
                                    {item.document_name ?? tx("Медицинский документ", "Medizinisches Dokument")}
                                  </p>
                                  <Badge variant="outline" className={importStatusTone[item.status]}>
                                    {importStatusLabels[item.status][lang === "de" ? "de" : "ru"]}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatImportDate(item.created_at)} · {item.candidate_count}{" "}
                                  {tx("объектов найдено", "Objekte erkannt")}
                                  {item.status === "applied"
                                    ? ` · ${appliedCount} ${tx("добавлено", "übernommen")}`
                                    : ""}
                                </p>
                              </div>
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                            </button>
                            {["review_required", "failed", "applied"].includes(item.status) ? (
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="shrink-0 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                                disabled={deleteBusy || historyBusyId === item.id}
                                onClick={() => void rescanHistoryItem(item)}
                                aria-label={tx("Пересканировать документ", "Dokument neu scannen")}
                                title={
                                  item.status === "applied"
                                    ? tx(
                                        "Пересканировать документ, сохранив предыдущий импорт",
                                        "Dokument neu scannen und vorherigen Import behalten",
                                      )
                                    : tx("Пересканировать документ", "Dokument neu scannen")
                                }
                              >
                                <RotateCcw className={cn("size-4", historyBusyId === item.id && "animate-spin")} />
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              className="mr-3 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              disabled={deleteBusy || historyBusyId === item.id || item.status === "applying"}
                              onClick={() => {
                                if (item.status !== "applying") setDeleteTarget(item);
                              }}
                              aria-label={tx("Удалить обработку", "Verarbeitung löschen")}
                              title={
                                item.status === "applying"
                                  ? tx("Сначала завершите зафиксированный импорт", "Vorbereitete Übernahme zuerst abschließen")
                                  : tx("Удалить обработку", "Verarbeitung löschen")
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : null}

          {documentImport && ["queued", "processing"].includes(documentImport.status) ? (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
            >
              <div className="relative flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <FileText className="size-7 text-primary" />
                <LoaderCircle className="absolute -right-1 -bottom-1 size-6 animate-spin rounded-full bg-background text-primary" />
              </div>
              <div>
                <p className="font-semibold">{tx("Строим клинический черновик…", "Klinischen Entwurf erstellen…")}</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {tx(
                    "Распознаём страницы, секции, диагнозы, анамнез, медикаменты, показатели, обследования и рекомендации.",
                    "Seiten, Abschnitte, Diagnosen, Anamnese, Medikation, Vitalwerte, Befunde und Empfehlungen werden erkannt.",
                  )}
                </p>
                <p className="mt-3 max-w-md text-xs font-medium text-foreground/75">
                  {tx(
                    "Окно останется открытым. Готовый черновик появится здесь автоматически.",
                    "Das Fenster bleibt geöffnet. Der fertige Entwurf erscheint hier automatisch.",
                  )}
                </p>
              </div>
            </div>
          ) : null}

          {documentImport?.status === "failed" ? (
            <div className="m-6 space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 text-destructive" />
                <div>
                  <p className="font-medium">{tx("Распознавание не удалось", "Erkennung fehlgeschlagen")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{documentImport.error_message}</p>
                </div>
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={retry}>
                <RotateCcw className="size-4" />
                {tx("Попробовать снова", "Erneut versuchen")}
              </Button>
            </div>
          ) : null}

          {snapshotReady ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 xl:p-5">
                {documentImport.status === "applied" ? (
                  <div
                    ref={appliedNoticeRef}
                    role="status"
                    aria-live="polite"
                    tabIndex={-1}
                    className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4" />
                      <div>
                        <p className="text-xs font-semibold">
                          {tx("Снимок подтверждён и добавлен", "Snapshot bestätigt und übernommen")}
                        </p>
                        <p className="text-[11px] text-emerald-800/80">
                          {documentImport.applied_at
                            ? formatImportDate(documentImport.applied_at)
                            : formatImportDate(documentImport.updated_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {medicationReview.total > 0 ? (
                        <Badge variant="outline" className="border-emerald-300 bg-white/60 text-emerald-800">
                          {tx("Медикаменты добавлены", "Medikamente übernommen")}: {documentImport.applied_counts.medications ?? 0}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="border-emerald-300 bg-white/60 text-emerald-800">
                        {appliedObjectCount(documentImport)} {tx("объектов", "Objekte")}
                      </Badge>
                    </div>
                  </div>
                ) : null}
                {documentImport.status === "applying" ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900">
                    <div className="flex items-center gap-2">
                      <Clock3 className="size-4" />
                      <div>
                        <p className="text-xs font-semibold">
                          {tx("Проверенный выбор зафиксирован", "Geprüfte Auswahl ist eingefroren")}
                        </p>
                        <p className="text-[11px] text-violet-800/80">
                          {tx(
                            "Редактирование отключено. Продолжите, чтобы безопасно завершить все записи.",
                            "Bearbeitung ist gesperrt. Fortsetzen, um alle Einträge sicher abzuschließen.",
                          )}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-violet-300 bg-white/60 text-violet-800">
                      {selected.length} {tx("выбрано", "ausgewählt")}
                    </Badge>
                  </div>
                ) : null}
                <div
                  role={identityPanelStatus === "hard_mismatch" ? "alert" : "status"}
                  className={cn(
                    "mb-4 rounded-xl border p-3 text-xs",
                    identityPanelStatus === "frozen"
                      ? "border-violet-200 bg-violet-50 text-violet-900"
                      : identityPanelStatus === "verified" || identityPanelStatus === "verified_variant"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : identityPanelStatus === "hard_mismatch"
                        ? "border-rose-300 bg-rose-50 text-rose-900"
                        : "border-amber-200 bg-amber-50 text-amber-900",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {identityPanelStatus === "verified" || identityPanelStatus === "verified_variant" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : identityPanelStatus === "frozen" ? (
                      <Clock3 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {identityPanelStatus === "frozen"
                          ? tx(
                              "Решение о пациенте зафиксировано",
                              "Patientenentscheidung ist eingefroren",
                            )
                          : identityPanelStatus === "verified"
                          ? tx("Пациент в документе проверен", "Patient im Dokument verifiziert")
                          : identityPanelStatus === "verified_variant"
                            ? tx(
                                "Пациент подтверждён по немецкому варианту написания",
                                "Patient über eine deutsche Namensvariante bestätigt",
                              )
                          : identityPanelStatus === "hard_mismatch"
                            ? tx("Документ не соответствует этой карте", "Dokument passt nicht zu dieser Akte")
                            : identityPanelStatus === "confirmation_required"
                              ? tx("Нужно подтвердить личность пациента", "Patientenidentität muss bestätigt werden")
                              : identityPanelStatus === "profile_incomplete"
                                ? tx(
                                    "В карточке нет корректного имени пациента",
                                    "In der Akte fehlt ein verlässlicher Patientenname",
                                  )
                              : tx(
                                  "В документе недостаточно данных для проверки пациента",
                                  "Dokument enthält zu wenig Daten zur Patientenprüfung",
                                )}
                      </p>
                      {extractedSubjectSummary ? (
                        <p className="mt-1 break-words">
                          {tx("В документе", "Im Dokument")}: {extractedSubjectSummary}
                        </p>
                      ) : null}
                      {patientIdentitySummary ? (
                        <p className="mt-0.5 break-words opacity-80">
                          {tx("В карте", "In der Akte")}: {patientIdentitySummary}
                        </p>
                      ) : null}
                      {identityPanelStatus === "hard_mismatch" ? (
                        <p className="mt-1 font-medium">
                          {tx(
                            "Импорт заблокирован. Проверьте документ и выбранную карту пациента.",
                            "Import gesperrt. Dokument und ausgewählte Patientenakte prüfen.",
                          )}
                        </p>
                      ) : null}
                      {identityPanelStatus === "verified_variant" ? (
                        <p className="mt-1 font-medium">
                          {tx(
                            "Имя совпадает после безопасной немецкой нормализации: ä/ae, ö/oe, ü/ue, ß/ss, титулы и пунктуация.",
                            "Der Name stimmt nach sicherer deutscher Normalisierung überein: ä/ae, ö/oe, ü/ue, ß/ss, Titel und Interpunktion.",
                          )}
                        </p>
                      ) : null}
                      {identityPanelStatus === "profile_incomplete" ? (
                        <p className="mt-1 font-medium">
                          {tx(
                            "Текущее имя выглядит как техническое значение. Исправьте профиль или проверьте личность по оригиналу.",
                            "Der aktuelle Name wirkt wie ein technischer Platzhalter. Profil korrigieren oder Identität im Original prüfen.",
                          )}
                        </p>
                      ) : null}
                      {clinicalDocumentIdentityConfirmationVisible(
                        identityPrepareMode,
                        subjectCheck.status,
                      ) ? (
                        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-white/60 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={patientIdentityConfirmed}
                            className="mt-0.5 size-4 accent-amber-700"
                            onChange={(event) => setPatientIdentityConfirmed(event.target.checked)}
                          />
                          <span className="font-medium">
                            {subjectCheck.status === "unavailable" || subjectCheck.status === "profile_incomplete"
                              ? tx(
                                  "Я вручную проверил(а) личность в оригинале документа и подтверждаю импорт именно в эту карту",
                                  "Ich habe die Identität im Originaldokument manuell geprüft und bestätige den Import in genau diese Akte",
                                )
                              : tx(
                                  "Я проверил(а) оригинал и подтверждаю импорт именно в эту карту",
                                  "Ich habe das Original geprüft und bestätige den Import in genau diese Akte",
                                )}
                          </span>
                        </label>
                      ) : null}
                      {identityPanelStatus === "frozen" ? (
                        <p className="mt-1 font-medium">
                          {documentImport.prepared_patient_identity_confirmed
                            ? tx(
                                "Личность пациента была явно подтверждена при фиксации импорта.",
                                "Die Patientenidentität wurde beim Einfrieren des Imports ausdrücklich bestätigt.",
                              )
                            : tx(
                                "Проверка была пройдена при фиксации; последующие изменения профиля не меняют снимок.",
                                "Die Prüfung wurde beim Einfrieren bestanden; spätere Profiländerungen ändern den Snapshot nicht.",
                              )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                {hasCountryScopedCandidate ? (
                  <section
                    className={cn(
                      "mb-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,360px)] sm:items-center",
                      isCanonicalClinicalImportSourceCountry(sourceCountry)
                        ? "border-border/70 bg-white"
                        : "border-amber-300 bg-amber-50/70",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">
                        {tx("Страна документа", "Ursprungsland des Dokuments")}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {tx(
                          "Выберите страну, где документ был выдан. Она сохранится как часть источника для всех выбранных медицинских данных.",
                          "Land auswählen, in dem das Dokument ausgestellt wurde. Es wird als Teil der Quelle aller ausgewählten medizinischen Daten gespeichert.",
                        )}
                      </p>
                    </div>
                    <label className="space-y-1">
                      <span className="sr-only">
                        {tx("Страна документа", "Ursprungsland des Dokuments")}
                      </span>
                      <CountrySelect
                        value={sourceCountry || null}
                        lang={lang}
                        required
                        disabled={snapshotReadOnly}
                        emptyLabel={tx("Выберите страну", "Land auswählen")}
                        aria-label={tx("Страна документа", "Ursprungsland des Dokuments")}
                        className="h-11 w-full bg-white"
                        onChange={(country) => updateSourceCountry(country ?? "")}
                      />
                    </label>
                  </section>
                ) : null}
                {documentImport.draft.warnings.map((warning) => (
                  <div key={warning} className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      {draftWarningLabels[warning]?.[lang === "de" ? "de" : "ru"] ?? warning}
                    </span>
                  </div>
                ))}

                {activeTab === "source" ? (
                  <section className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold">
                        {tx("Полный текст документа", "Vollständiger Dokumenttext")}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx(
                          "Выделите фрагмент — он автоматически появится в конструкторе объекта ниже.",
                          "Text markieren – der Ausschnitt erscheint automatisch im Objekt-Editor unten.",
                        )}
                      </p>
                    </div>

                    {documentImport.draft.raw_text ? (
                      <textarea
                        readOnly
                        value={documentImport.draft.raw_text}
                        className="min-h-[560px] max-h-[72vh] w-full resize-y rounded-xl border border-border/70 bg-slate-50/70 p-5 font-mono text-[13px] leading-6 text-foreground outline-none selection:bg-orange-200 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                        onSelect={(event) => {
                          if (!reviewReady) return;
                          const field = event.currentTarget;
                          const fragment = field.value
                            .slice(field.selectionStart, field.selectionEnd)
                            .trim();
                          if (fragment) setManualValue(fragment);
                        }}
                        aria-label={tx("Распознанный текст документа", "Erkannter Dokumenttext")}
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                        <FileText className="mx-auto size-8 text-muted-foreground/50" />
                        <p className="mt-2 text-sm font-medium">
                          {tx("Полный текст ещё не сохранён", "Gesamttext ist noch nicht gespeichert")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tx("Перезапустите обработку этого снимка.", "Diesen Snapshot erneut verarbeiten.")}
                        </p>
                      </div>
                    )}

                    {reviewReady ? (
                      <div className="rounded-xl border border-border/70 bg-white p-5">
                        <div className="mb-3 flex items-center gap-2">
                          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
                          <h5 className="text-sm font-semibold">
                            {tx("Добавить объект в черновик", "Objekt zum Entwurf hinzufügen")}
                          </h5>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start">
                          <label className="space-y-1">
                            <span className="text-xs font-medium">
                              {tx("Тип объекта", "Objekttyp")}
                            </span>
                            <select
                              value={manualTarget}
                              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                              onChange={(event) =>
                                setManualTarget(event.target.value as ClinicalDocumentImportTarget)
                              }
                            >
                              {targetOrder.map((target) => (
                                <option key={target} value={target}>
                                  {targetLabels[target][lang === "de" ? "de" : "ru"]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="min-w-0 space-y-3">
                            <label className="block space-y-1">
                              <span className="text-xs font-medium">
                                {tx("Выделенный фрагмент", "Ausgewählter Ausschnitt")}
                              </span>
                              <textarea
                                value={manualValue}
                                className="min-h-36 max-h-[50vh] w-full resize-y rounded-lg border border-border bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                                placeholder={tx("Выделите текст выше или введите его здесь…", "Oben Text markieren oder hier eingeben…")}
                                onChange={(event) => setManualValue(event.target.value)}
                              />
                            </label>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                className="h-10 gap-1.5"
                                disabled={!manualValue.trim()}
                                onClick={addManualCandidate}
                              >
                                <Plus className="size-4" />
                                {tx("Добавить", "Hinzufügen")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {activeTab !== "source" ? (activeTab === "all" ? targetOrder : [activeTab]).map((target) => {
                  const currentItems = existingItems[target];
                  const proposedItems = visibleCandidates.filter((item) => item.target === target);
                  if (activeTab === "all" && proposedItems.length === 0) return null;
                  return (
                    <section key={target} className="mb-8 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold">
                            {targetLabels[target][lang === "de" ? "de" : "ru"]}
                          </h4>
                          <p className="text-[11px] text-muted-foreground">
                            {currentItems.length} {tx("уже у пациента", "bereits beim Patienten")}
                          </p>
                        </div>
                        <Badge variant="outline" className={targetTone[target]}>
                          +{proposedItems.length}
                        </Badge>
                      </div>

                      {currentItems.length > 0 ? (
                        <details className="rounded-xl border border-border/60 bg-muted/15">
                          <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-muted-foreground">
                            {tx("Текущие данные пациента", "Aktuelle Patientendaten")} ({currentItems.length})
                          </summary>
                          <div className="space-y-3 border-t border-border/50 p-3">
                            {currentItems.map((item) => (
                              <div
                                key={item.id}
                                className={cn("rounded-lg border px-4 py-3.5", targetCardTone[target])}
                              >
                                <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-foreground">
                                  {item.primary}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className={cn("rounded-full text-[10px]", targetTone[target])}>
                                    {targetLabels[target][lang === "de" ? "de" : "ru"]}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-border/60 bg-white/80 text-[10px] font-medium text-muted-foreground"
                                  >
                                    {tx("Уже в карте", "Bereits in der Akte")}
                                  </Badge>
                                </div>
                                {item.secondary ? (
                                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                                    {item.secondary}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}

                      <div className="space-y-3">
                        {proposedItems.map((candidate) => {
                          const active = candidate.id === activeCandidateId;
                          const medicationDisposition = medicationDispositionFor(candidate);
                          const selectionBlocked = candidateSelectionBlocked(candidate);
                          const candidateSelected = candidate.selected;
                          const explicitMedicationDecision = medicationCandidateReviewDecision(candidate);
                          const medicationDecision = explicitMedicationDecision ?? (
                            snapshotReadOnly
                              ? candidateSelected ? "include" : "exclude"
                              : null
                          );
                          const reviewReasons = normalizedStringArray(candidate, "review_reasons");
                          const semanticKey =
                            normalizedString(candidate, "semantic_role") ??
                            normalizedString(candidate, "assertion");
                          const semanticLabel = semanticKey
                            ? semanticLabels[semanticKey]?.[lang === "de" ? "de" : "ru"]
                            : null;
                          return (
                            <article
                              key={candidate.id}
                              data-clinical-import-candidate-card
                              data-clinical-import-candidate-id={candidate.id}
                              tabIndex={-1}
                              className={cn(
                                "rounded-xl border px-4 py-4 transition-all",
                                targetCardTone[candidate.target],
                                active
                                  ? "border-orange-400 shadow-sm ring-2 ring-orange-100"
                                  : "hover:border-orange-300 hover:shadow-sm",
                                !candidateSelected && candidate.target !== "medication" && "opacity-60",
                                candidate.target === "medication" && medicationDecision === "include" &&
                                  "border-emerald-300 bg-emerald-50/45",
                                candidate.target === "medication" && medicationDecision === "exclude" &&
                                  "border-slate-300 bg-slate-50",
                                candidate.target === "medication" && medicationDecision === null &&
                                  "border-amber-400 bg-amber-50/55",
                              )}
                              onClick={() => setActiveCandidateId(candidate.id)}
                            >
                              <div className="flex items-start gap-3">
                                {candidate.target !== "medication" ? (
                                  <input
                                    type="checkbox"
                                    className="mt-2 size-4 shrink-0 rounded border-border accent-orange-500"
                                    checked={candidateSelected}
                                    disabled={snapshotReadOnly || selectionBlocked}
                                    onChange={(event) =>
                                      patchCandidate(candidate.id, { selected: event.target.checked })
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={tx("Импортировать запись", "Eintrag importieren")}
                                  />
                                ) : null}
                                <div className="min-w-0 flex-1">
                                  {candidate.target === "medication" ? (
                                    <div
                                      role="group"
                                      aria-label={tx("Решение по медикаменту", "Entscheidung zum Medikament")}
                                      className={cn(
                                        "mb-3 flex flex-col gap-3 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
                                        medicationDecision === "include"
                                          ? "border-emerald-300 bg-emerald-100/80 text-emerald-950"
                                          : medicationDecision === "exclude"
                                            ? "border-slate-300 bg-slate-100 text-slate-900"
                                            : "border-amber-400 bg-amber-100 text-amber-950",
                                      )}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <div className="flex min-w-0 items-start gap-2">
                                        {medicationDecision === "include" ? (
                                          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                                        ) : (
                                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                        )}
                                        <div>
                                          <p className="text-xs font-bold">
                                            {medicationDecision === "include"
                                              ? tx("Будет добавлен в карту пациента", "Wird in die Patientenakte übernommen")
                                              : medicationDecision === "exclude"
                                                ? tx("Не будет добавлен в карту пациента", "Wird nicht in die Patientenakte übernommen")
                                                : tx("Решение не принято — в карту не попадёт", "Keine Entscheidung – wird nicht in die Akte übernommen")}
                                          </p>
                                          {medicationDecision === null ? (
                                            <p className="mt-0.5 text-[11px] leading-4">
                                              {tx(
                                                "Редактирование карточки не включает медикамент автоматически.",
                                                "Das Bearbeiten der Karte übernimmt das Medikament nicht automatisch.",
                                              )}
                                            </p>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={medicationDecision === "include" ? "default" : "outline"}
                                          className={cn(
                                            "h-8 bg-white",
                                            medicationDecision === "include" && "bg-emerald-700 text-white hover:bg-emerald-800",
                                          )}
                                          disabled={snapshotReadOnly || selectionBlocked}
                                          onClick={() => setMedicationDecision(candidate.id, "include")}
                                        >
                                          <Check className="size-3.5" />
                                          {tx("Добавить", "Übernehmen")}
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={medicationDecision === "exclude" ? "default" : "outline"}
                                          className={cn(
                                            "h-8 bg-white",
                                            medicationDecision === "exclude" && "bg-slate-700 text-white hover:bg-slate-800",
                                          )}
                                          disabled={snapshotReadOnly}
                                          onClick={() => setMedicationDecision(candidate.id, "exclude")}
                                        >
                                          {tx("Не добавлять", "Nicht übernehmen")}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {candidate.target === "medication" && medicationDisposition ? (
                                    <MedicationCandidateEditor
                                      candidate={candidate}
                                      disabled={snapshotReadOnly}
                                      disposition={medicationDisposition}
                                      defaultSourceCountry={sourceCountry}
                                      onSourceCountryChange={updateSourceCountry}
                                      seriesOptions={medicationSeriesOptionsFor(candidate)}
                                      requiresExplicitSeries={
                                        medicationSeriesOptionsFor(candidate).length > 1 ||
                                        matchingBatchMedicationCountFor(candidate) > 1
                                      }
                                      tx={tx}
                                      onFocus={() => setActiveCandidateId(candidate.id)}
                                      onPatch={(patch) => patchCandidate(candidate.id, patch)}
                                    />
                                  ) : candidate.target === "vital" ? (
                                    <VitalCandidateEditor
                                      candidate={candidate}
                                      disabled={snapshotReadOnly || !candidate.selected}
                                      sourceCountry={sourceCountry}
                                      importId={documentImport.id}
                                      tx={tx}
                                      onFocus={() => setActiveCandidateId(candidate.id)}
                                      onSourceCountryChange={updateSourceCountry}
                                      onPatch={(patch) => patchCandidate(candidate.id, patch)}
                                    />
                                  ) : candidate.target === "lab_result" ? (
                                    <div
                                      data-clinical-import-candidate-editor
                                      className="grid gap-3 rounded-lg border border-white/70 bg-white/55 p-3 sm:grid-cols-2 xl:grid-cols-4"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {([
                                        ["analyte_name", tx("Показатель", "Parameter")],
                                        ["result_text", tx("Значение", "Wert")],
                                        ["unit", tx("Единица", "Einheit")],
                                        ["reference_text", tx("Референс", "Referenz")],
                                      ] as const).map(([field, label]) => (
                                        <label key={field} className="space-y-1">
                                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                                          <Input
                                            value={typeof candidate.normalized[field] === "string" ? candidate.normalized[field] as string : ""}
                                            disabled={snapshotReadOnly || !candidate.selected}
                                            className="h-10 bg-white"
                                            onFocus={() => setActiveCandidateId(candidate.id)}
                                            onChange={(event) => {
                                              const nextNormalized = { ...candidate.normalized, [field]: event.target.value };
                                              if (field === "result_text") {
                                                nextNormalized.numeric_result = localizedLabNumber(event.target.value.replace(/^(?:<=|>=|<|>|=)\s*/, ""));
                                                nextNormalized.comparator = event.target.value.match(/^(<=|>=|<|>|=)/)?.[1] ?? null;
                                              }
                                              if (field === "reference_text") {
                                                nextNormalized.reference_low = null;
                                                nextNormalized.reference_high = null;
                                                nextNormalized.abnormal_flag = "unknown";
                                              }
                                              patchCandidate(candidate.id, {
                                                normalized: nextNormalized,
                                                value: labCandidateDisplay(nextNormalized),
                                              });
                                            }}
                                          />
                                        </label>
                                      ))}
                                      <label className="space-y-1 sm:col-span-2 xl:col-span-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tx("Лаборатория", "Labor")}</span>
                                        <Input
                                          value={typeof candidate.normalized.laboratory_name === "string" ? candidate.normalized.laboratory_name : ""}
                                          disabled={snapshotReadOnly || !candidate.selected}
                                          className="h-10 bg-white"
                                          maxLength={160}
                                          placeholder={tx("Например: SYNLAB Berlin", "Zum Beispiel: SYNLAB Berlin")}
                                          onFocus={() => setActiveCandidateId(candidate.id)}
                                          onChange={(event) => {
                                            const nextNormalized = { ...candidate.normalized, laboratory_name: event.target.value };
                                            patchCandidate(candidate.id, { normalized: nextNormalized });
                                          }}
                                        />
                                      </label>
                                      <label className="space-y-1 sm:col-span-1">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tx("Дата", "Datum")}</span>
                                        <Input
                                          type="date"
                                          value={typeof candidate.normalized.measured_on === "string" ? candidate.normalized.measured_on : ""}
                                          disabled={snapshotReadOnly || !candidate.selected}
                                          className="h-10 bg-white"
                                          onChange={(event) => {
                                            const nextNormalized = { ...candidate.normalized, measured_on: event.target.value };
                                            patchCandidate(candidate.id, { normalized: nextNormalized });
                                          }}
                                        />
                                      </label>
                                      <label className="space-y-1 sm:col-span-1 xl:col-span-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tx("Группа", "Laborgruppe")}</span>
                                        <Input
                                          value={typeof candidate.normalized.panel === "string" ? candidate.normalized.panel : ""}
                                          disabled={snapshotReadOnly || !candidate.selected}
                                          className="h-10 bg-white"
                                          onChange={(event) => {
                                            const nextNormalized = { ...candidate.normalized, panel: event.target.value };
                                            patchCandidate(candidate.id, { normalized: nextNormalized });
                                          }}
                                        />
                                      </label>
                                      <label className="space-y-1">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tx("Статус", "Status")}</span>
                                        <select
                                          value={typeof candidate.normalized.abnormal_flag === "string" ? candidate.normalized.abnormal_flag : "unknown"}
                                          disabled={snapshotReadOnly || !candidate.selected}
                                          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                                          onChange={(event) => {
                                            const nextNormalized = { ...candidate.normalized, abnormal_flag: event.target.value };
                                            patchCandidate(candidate.id, { normalized: nextNormalized });
                                          }}
                                        >
                                          <option value="unknown">{tx("Не определён", "Unbekannt")}</option>
                                          <option value="normal">{tx("Норма", "Normal")}</option>
                                          <option value="low">{tx("Ниже", "Niedrig")}</option>
                                          <option value="high">{tx("Выше", "Hoch")}</option>
                                          <option value="abnormal">{tx("Отклонение", "Auffällig")}</option>
                                        </select>
                                      </label>
                                    </div>
                                  ) : (
                                    <textarea
                                      data-clinical-import-candidate-editor
                                      value={candidate.value}
                                      disabled={snapshotReadOnly || !candidate.selected}
                                      className={cn(
                                        "max-h-[55vh] w-full resize-y rounded-lg border border-white/70 bg-white/45 px-3 py-2.5 text-sm font-medium leading-6 text-foreground outline-none transition-colors hover:border-white hover:bg-white/70 focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:cursor-default disabled:opacity-55",
                                        active ? "min-h-44" : "min-h-32",
                                      )}
                                      onChange={(event) =>
                                        patchCandidate(candidate.id, { value: event.target.value })
                                      }
                                      onFocus={() => setActiveCandidateId(candidate.id)}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className={cn("rounded-full text-[10px]", targetTone[candidate.target])}
                                    >
                                      {targetLabels[candidate.target][lang === "de" ? "de" : "ru"]}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-border/60 bg-white/80 text-[10px] font-medium text-muted-foreground"
                                      title={tx(
                                        "Качество распознавания и классификации для ручной проверки, а не медицинская достоверность.",
                                        "Qualität von Erkennung und Klassifikation für die manuelle Prüfung, keine medizinische Gewissheit.",
                                      )}
                                    >
                                      {tx("Качество проверки", "Prüfqualität")} {Math.round(candidate.confidence * 100)}%
                                    </Badge>
                                    {semanticLabel ? (
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-800"
                                      >
                                        {semanticLabel}
                                      </Badge>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-orange-200 hover:text-orange-800"
                                      onClick={() => setActiveCandidateId(candidate.id)}
                                    >
                                      {candidate.source.section}
                                      {candidate.source.page ? ` · S. ${candidate.source.page}` : ""}
                                      <ChevronRight className="size-3" />
                                    </button>
                                  </div>
                                  {reviewReasons.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                      {reviewReasons.map((reason) => (
                                        <p
                                          key={reason}
                                          className="flex items-center gap-1.5 text-[11px] leading-4 text-amber-800"
                                        >
                                          <AlertTriangle className="size-3 shrink-0" />
                                          {reviewReasonLabels[reason]?.[lang === "de" ? "de" : "ru"] ?? reason}
                                        </p>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                }) : null}
              </div>
            </>
          ) : null}

          </section>

          <aside className="flex min-h-0 flex-col bg-white">
          {activeCandidate ? (
            <div className="shrink-0 border-b border-border/70 bg-white px-4 py-3">
              <p className="max-h-56 overflow-y-auto whitespace-pre-wrap pr-2 text-xs leading-5 text-foreground">
                {activeCandidate.source.text}
              </p>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 p-3">
            {preview ? (
              preview.contentType.startsWith("image/") ? (
                <div className="flex h-full items-start justify-center overflow-auto rounded-lg border border-border bg-white p-3">
                  <img src={preview.url} alt={tx("Медицинский документ", "Medizinisches Dokument")} className="max-w-full" />
                </div>
              ) : (
                <iframe
                  key={`${preview.url}-${activePage}`}
                  title={documentImport?.document_name ?? tx("Предпросмотр документа", "Dokumentvorschau")}
                  src={`${preview.url}#page=${activePage}&zoom=page-width`}
                  className="h-full w-full rounded-lg border border-border bg-white shadow-sm"
                />
              )
            ) : previewError ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground">
                {previewError}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-white p-6 text-center">
                <FileText className="size-10 text-muted-foreground/60" />
                <p className="text-sm font-medium">{tx("Документ появится здесь", "Dokument erscheint hier")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {tx(
                    "Предпросмотр останется открытым, пока вы переходите между медицинскими объектами.",
                    "Die Vorschau bleibt beim Wechsel zwischen medizinischen Objekten geöffnet.",
                  )}
                </p>
              </div>
            )}
          </div>
          </aside>
        </div>
      </div>
      <DirtyDismissConfirmDialog
        open={Boolean(deleteTarget)}
        title={tx("Удалить обработку?", "Verarbeitung löschen?")}
        message={tx(
          "Из истории этого пациента будет удалена только запись обработки. Исходный документ и уже добавленные медицинские данные сохранятся.",
          "Nur der Verarbeitungseintrag wird aus dem Verlauf dieses Patienten entfernt. Das Quelldokument und bereits übernommene medizinische Daten bleiben erhalten.",
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={deleteBusy ? tx("Удаление…", "Löschen…") : tx("Удалить", "Löschen")}
        confirmDisabled={deleteBusy}
        destructive
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteHistoryImport()}
      />
    </PatientSheetScaffold>
  );
}
