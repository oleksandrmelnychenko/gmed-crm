import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountBadge, EmptyCell } from "@/components/ui-shell";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
// import { downloadApiFile } from "@/lib/api"; // PDF-Export (Medikationsplan / Arztbrief) тимчасово вимкнено
import { getLang, useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { LoaderCircle, PauseCircle, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import { fetchProviders, fetchSpecializations } from "@/pages/providers/data/provider-api";
import {
  specializationLabelForItem,
  specializationLabelForValue,
} from "@/pages/providers/model/specialization-labels";
import type { ProviderSummary, SpecializationItem } from "@/pages/providers/model/types";
import type {
  PatientLabResult,
  PatientRiskScore,
  PatientVitalMeasurement,
} from "../../model/detail-resource-types";

import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
  darreichungsformLabel,
} from "../../data/medication-options";

import {
  createPatientRecommendation,
  deletePatientNarrative,
  deletePatientRecommendation,
  deduplicateAllDoctorOptions,
  fetchAllDoctors,
  fetchNarrativeHistory,
  fetchPatientClinical,
  fetchPatientMedicationEquivalents,
  fetchPatientRecommendations,
  savePatientClinicalWarnings,
  savePatientDiagnoses,
  savePatientExaminations,
  savePatientImpfstatus,
  savePatientMedications,
  savePatientNarrative,
  savePatientProcedures,
  savePatientVerlauf,
  updateClinicalMedicationLifecycle,
  updatePatientRecommendation,
  type AllDoctorOption,
  type ClinicalAttribution,
  type ClinicalDiagnosis,
  type ClinicalExamination,
  type ClinicalMedication,
  type ClinicalNarrative,
  type ClinicalProcedure,
  type ClinicalVerlaufEntry,
  type ClinicalWarning,
  type ClinicalWarningKind,
  type PatientImpfstatus,
  type PatientRecommendation,
  type RecommendationLifecycleStatus,
} from "@/pages/patients/data/patient-clinical";

import { type GermanEquivalent } from "@/lib/api/clinical";
import { MedicationEquivalentsPanel } from "@/pages/case-workspace/medication-equivalents-panel";
import {
  fetchPatientMedicationImportHistory,
  persistClinicalDocumentMedication,
  persistClinicalDocumentVital,
  type ClinicalDocumentCandidatePayloads,
  type ImportedMedicationResponse,
  type ImportedLabResultPayload,
  type ImportedMedicationPayload,
  type ImportedVitalPayload,
  type ClinicalDocumentImport,
  type ClinicalDocumentImportCandidate,
  type MedicationImportHistoryEvent,
} from "@/pages/patients/data/clinical-document-import";
import {
  groupMedicationImportHistory,
  type MedicationHistorySeries,
} from "@/pages/patients/data/medication-document-import";

import { AnamneseSection } from "./anamnese-section";
import { ClinicalDocumentImportSheet } from "./clinical-document-import-sheet";
import { DiagnosisTreeSection } from "./diagnosis-tree";
import { ClinicalSpecializationsField } from "./clinical-specializations-field";
import { ClinicalRecordSource } from "./clinical-record-source";
import { MedicationBmpImportAction } from "./medication-bmp-import-sheet";
import { PatientSymptomsPainSections } from "./patient-symptoms-pain-sections";
import {
  collectAttachedClinicalSpecializations,
  clinicalSpecializationFilterAllowsEditing,
  filterClinicalDiagnosisTree,
  filterClinicalNarrative,
  filterClinicalRecords,
  mergeFilteredClinicalNarrative,
  mergeFilteredClinicalRecords,
  patientSpecializationRecords,
} from "./clinical-specialization-filter";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";
import {
  PatientLabCorrectionMetadata,
  PatientLabResultDeleteAction,
  PatientLabResultDeleteSheet,
  PatientLabResultEditAction,
  PatientLabResultEditSheet,
} from "../sheets/patient-lab-result-edit-sheet";

const loadPatientVitalsSheet = () => import("../sheets/patient-vitals-sheet");
const loadPatientRiskScoreSheet = () => import("../sheets/patient-risk-score-sheet");

const LazyPatientVitalsSheet = lazy(async () => {
  const mod = await loadPatientVitalsSheet();
  return { default: mod.PatientVitalsSheet };
});

const LazyPatientRiskScoreSheet = lazy(async () => {
  const mod = await loadPatientRiskScoreSheet();
  return { default: mod.PatientRiskScoreSheet };
});

type Bilingual = (ru: string, de: string) => string;

const PATIENT_RISK_SCORE_TYPE_LABELS: Record<string, { ru: string; de: string }> = {
  cha2ds2_vasc: { ru: "CHA₂DS₂-VASc", de: "CHA₂DS₂-VASc" },
  has_bled: { ru: "HAS-BLED", de: "HAS-BLED" },
  framingham: { ru: "Framingham", de: "Framingham" },
  fall_risk: { ru: "Риск падения", de: "Sturzrisiko" },
  frailty: { ru: "Старческая астения", de: "Gebrechlichkeit" },
  nutrition_risk: { ru: "Риск нарушения питания", de: "Ernährungsrisiko" },
  other: { ru: "Другое", de: "Sonstiges" },
};

const PATIENT_VITAL_NUMBER_FORMATTERS: Record<string, Intl.NumberFormat> = {
  '{"maximumFractionDigits":0}': new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }),
  '{"maximumFractionDigits":1}': new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
};

function formatVitalNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
) {
  if (value == null || Number.isNaN(value)) return null;
  try {
    const formatterKey = JSON.stringify(options);
    return PATIENT_VITAL_NUMBER_FORMATTERS[formatterKey]?.format(value) ?? `${value}`;
  } catch {
    return `${value}`;
  }
}

function patientRiskScoreTypeLabel(scoreType: string, tx: Bilingual): string {
  const entry = PATIENT_RISK_SCORE_TYPE_LABELS[scoreType];
  if (entry) return tx(entry.ru, entry.de);
  return scoreType;
}

export function patientVitalDateTime(
  value: string | null | undefined,
  fallback: string,
  precision?: PatientVitalMeasurement["measured_at_precision"],
): string {
  if (!value) return fallback;
  try {
    if (precision === "date") {
      const datePart = value.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return fallback;
      return cachedDateTimeFormat(getLang() === "ru" ? "ru-RU" : "de-DE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${datePart}T00:00:00Z`));
    }
    return cachedDateTimeFormat(getLang() === "ru" ? "ru-RU" : "de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function patientVitalIsImported(
  item: Pick<PatientVitalMeasurement, "source_candidate_id">,
): boolean {
  return Boolean(item.source_candidate_id);
}

export function groupPatientLabResults(rows: PatientLabResult[]) {
  const groups = new Map<string, { name: string; rows: PatientLabResult[] }>();
  for (const row of rows) {
    const key = row.analyte_name.trim().toLocaleLowerCase();
    const group = groups.get(key) ?? { name: row.analyte_name.trim(), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort(
        (left, right) => Date.parse(right.measured_at) - Date.parse(left.measured_at),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function patientLabMeasuredDate(row: Pick<PatientLabResult, "measured_at">): string | null {
  const value = row.measured_at.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function patientLabLatestDate(rows: PatientLabResult[]): string {
  return rows.reduce((latest, row) => {
    const measuredDate = patientLabMeasuredDate(row);
    return measuredDate && measuredDate > latest ? measuredDate : latest;
  }, "");
}

export function filterPatientLabResultsByPeriod(
  rows: PatientLabResult[],
  dateFrom: string,
  dateTo: string,
): PatientLabResult[] {
  if (!dateFrom && !dateTo) return rows;
  return rows.filter((row) => {
    const measuredDate = patientLabMeasuredDate(row);
    if (!measuredDate) return false;
    return (!dateFrom || measuredDate >= dateFrom) && (!dateTo || measuredDate <= dateTo);
  });
}

type PatientVitalMetricLabels = {
  bloodPressure: string;
  heartRate: string;
  temperature?: string;
  oxygenSaturation?: string;
  respiratoryRate?: string;
  weight: string;
  height: string;
  bmi: string;
  notSet: string;
};

export function patientVitalMetrics(
  item: PatientVitalMeasurement,
  labels: PatientVitalMetricLabels,
): { label: string; value: string }[] {
  return [
    item.bp_systolic != null && item.bp_diastolic != null
      ? {
          label: labels.bloodPressure,
          value: `${formatVitalNumber(item.bp_systolic, { maximumFractionDigits: 0 }) ?? labels.notSet}/${
            formatVitalNumber(item.bp_diastolic, { maximumFractionDigits: 0 }) ?? labels.notSet
          }`,
        }
      : null,
    item.heart_rate != null
      ? {
          label: labels.heartRate,
          value: formatVitalNumber(item.heart_rate, { maximumFractionDigits: 0 }) ?? labels.notSet,
        }
      : null,
    item.temperature_c != null
      ? {
          label: labels.temperature ?? "Temp.",
          value: `${formatVitalNumber(item.temperature_c) ?? labels.notSet} °C`,
        }
      : null,
    item.oxygen_saturation != null
      ? {
          label: labels.oxygenSaturation ?? "SpO₂",
          value: `${formatVitalNumber(item.oxygen_saturation) ?? labels.notSet} %`,
        }
      : null,
    item.respiratory_rate != null
      ? {
          label: labels.respiratoryRate ?? "AF",
          value: `${formatVitalNumber(item.respiratory_rate, { maximumFractionDigits: 0 }) ?? labels.notSet} /min`,
        }
      : null,
    item.weight_kg != null
      ? {
          label: labels.weight,
          value: `${formatVitalNumber(item.weight_kg) ?? labels.notSet} kg`,
        }
      : null,
    item.height_cm != null
      ? {
          label: labels.height,
          value: `${formatVitalNumber(item.height_cm) ?? labels.notSet} cm`,
        }
      : null,
    item.bmi != null
      ? {
          label: labels.bmi,
          value: formatVitalNumber(item.bmi) ?? labels.notSet,
        }
      : null,
  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));
}

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-field px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const datePillClass =
  "inline-flex items-center whitespace-nowrap rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700";
const periodPillClass =
  "inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700";
const reminderPillClass =
  "inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700";

export const CLINICAL_PROVIDER_QUERY = "/providers?active_only=true&provider_type=medical";

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function localToday(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function medicationHasEnded(
  medication: Pick<ClinicalMedication, "einnahme_bis">,
  today = localToday(),
): boolean {
  const endDate = dateOnly(medication.einnahme_bis);
  return Boolean(endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate < today);
}

function medicationDateRangeValid(medication: ClinicalMedication): boolean {
  const intakeStart = dateOnly(medication.einnahme_von);
  const intakeEnd = dateOnly(medication.einnahme_bis);
  const holdStart = dateOnly(medication.hold_from);
  const holdEnd = dateOnly(medication.hold_until);
  return !(
    (intakeStart && intakeEnd && intakeEnd < intakeStart)
    || (holdStart && holdEnd && holdEnd < holdStart)
  );
}

export function clinicalMedicalProviderRows(providers: ProviderSummary[]): ProviderSummary[] {
  return providers.filter((provider) => provider.provider_type === "medical");
}

type ClinicalSectionGroup = { key: string; label: string };
type ClinicalSectionTone = "neutral" | "danger" | "warning";
type IndexedClinicalItem<T> = { item: T; index: number };
type MedicationHoldDraft = Pick<
  ClinicalMedication,
  "on_hold" | "hold_from" | "hold_until" | "hold_note"
>;
type MedicationHoldEditor = {
  index: number;
  medication: ClinicalMedication;
  draft: MedicationHoldDraft;
};

type ClinicalSectionListViewArgs<T extends { id?: string | null }> = {
  indexed: IndexedClinicalItem<T>[];
  groups?: ClinicalSectionGroup[];
  groupOf?: (item: T) => string;
  renderActions: (item: T, index: number) => ReactNode;
};

function blankAttribution(): ClinicalAttribution {
  return {
    provider_id: null,
    provider_name: null,
    doctor_id: null,
    doctor_name: null,
    doctor_title: null,
    doctor_fachbereich: null,
  };
}

function blankMedication(): ClinicalMedication {
  return {
    ...blankAttribution(),
    category: "dauer",
    wirkstoff: null,
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
    status: "aktiv",
    apothekenpflichtig: false,
    rezeptpflichtig: false,
    btm: false,
    aut_idem_sperre: false,
    abgabebeschraenkung: false,
    sonstige_vermerke: null,
    on_hold: false,
    hold_from: null,
    hold_until: null,
    hold_note: null,
  };
}

function blankProcedure(): ClinicalProcedure {
  return {
    ...blankAttribution(),
    label: "",
    ops_code: null,
    performed_on: null,
    note: null,
  };
}

function blankExamination(): ClinicalExamination {
  return {
    ...blankAttribution(),
    kind: null,
    title: "",
    performed_on: null,
    status: "final",
    result: null,
    note: null,
    red_flags: null,
    specialization_ids: [],
    specializations: [],
  };
}

function blankWarning(kind: ClinicalWarningKind): ClinicalWarning {
  return { kind, label: "", reaction: null, severity: null, note: null };
}

function blankVerlaufEntry(): ClinicalVerlaufEntry {
  return {
    ...blankAttribution(),
    occurred_on: null,
    note: "",
  };
}

function hasDoctorAttribution(item: ClinicalAttribution): boolean {
  return Boolean(item.doctor_id || item.doctor_name || item.doctor_title || item.doctor_fachbereich);
}

function verlaufFallbackKey(item: ClinicalVerlaufEntry): string {
  return [
    item.occurred_on ?? "",
    item.provider_id ?? "",
    item.note.trim(),
  ].join("|");
}

export function mergeVerlaufDoctorAttribution(
  serverRows: ClinicalVerlaufEntry[],
  fallbackRows: ClinicalVerlaufEntry[],
): ClinicalVerlaufEntry[] {
  if (fallbackRows.length === 0) return serverRows;
  const fallbackById = new Map(
    fallbackRows
      .filter((row) => row.id && hasDoctorAttribution(row))
      .map((row) => [row.id, row] as const),
  );
  const fallbackByKey = new Map(
    fallbackRows
      .filter((row) => hasDoctorAttribution(row))
      .map((row) => [verlaufFallbackKey(row), row] as const),
  );

  return serverRows.map((row) => {
    if (hasDoctorAttribution(row)) return row;
    const fallback = (row.id ? fallbackById.get(row.id) : null) ?? fallbackByKey.get(verlaufFallbackKey(row));
    if (!fallback) return row;
    return {
      ...row,
      doctor_id: fallback.doctor_id,
      doctor_name: fallback.doctor_name,
      doctor_title: fallback.doctor_title,
      doctor_fachbereich: fallback.doctor_fachbereich,
    };
  });
}

/**
 * Empty string -> null. Does NOT trim, so spaces stay typeable in controlled
 * inputs (trimming on every keystroke strips the just-typed trailing space and
 * makes it impossible to type a space). Trimming happens once, on save, via
 * {@link trimDraftStrings}.
 */
function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

/** Trim every top-level string field at save time (empty -> null). */
function trimDraftStrings<T>(draft: T): T {
  if (!draft || typeof draft !== "object") return draft;
  const out = { ...(draft as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      out[key] = trimmed === "" ? null : trimmed;
    }
  }
  return out as T;
}

export function attributionLabel(item: ClinicalAttribution, lang?: "de" | "ru"): string | null {
  const doctor = [item.doctor_title, item.doctor_name].filter(Boolean).join(" ").trim();
  const fachbereich = clinicalSpecializationLabel(item, lang);
  const doctorWithFachbereich = [
    doctor || null,
    fachbereich ? `(${fachbereich})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return [doctorWithFachbereich || null, item.provider_name].filter(Boolean).join(" · ") || null;
}

export function clinicalSpecializationLabel(
  item: ClinicalAttribution,
  lang?: "de" | "ru",
): string | null {
  const fachbereich = item.doctor_fachbereich?.trim();
  if (!fachbereich) return null;
  return lang ? specializationLabelForValue(fachbereich, [], lang) : fachbereich;
}

function allDoctorOptionLabel(doctor: AllDoctorOption): string {
  const doctorName = [doctor.title, doctor.name].filter(Boolean).join(" ").trim();
  return [doctorName || doctor.name, doctor.provider_name].filter(Boolean).join(" · ");
}

function recommendationDoctorLabel(
  rec: PatientRecommendation,
  doctorOptions: AllDoctorOption[],
  lang: "de" | "ru",
): string | null {
  const option = doctorOptions.find((doctor) => doctor.id === rec.source_doctor_id);
  const doctor = [
    rec.source_doctor_title ?? option?.title ?? null,
    rec.source_doctor_name ?? option?.name ?? null,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const fachbereich = rec.source_doctor_fachbereich ?? option?.fachbereich ?? null;
  const doctorWithFachbereich = [
    doctor || null,
    fachbereich ? `(${specializationLabelForValue(fachbereich, [], lang)})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [doctorWithFachbereich || null, option?.provider_name ?? null]
    .filter(Boolean)
    .join(" · ") || null;
}

function groupedClinicalItems<T>(
  indexed: IndexedClinicalItem<T>[],
  groups: ClinicalSectionGroup[] | undefined,
  groupOf: ((item: T) => string) | undefined,
  fallbackLabel: string,
) {
  if (!groups || !groupOf) return [{ key: "all", label: null as string | null, rows: indexed }];

  const groupedIndexes = new Set<number>();
  const sections = groups.flatMap((group) => {
    const rows = indexed.filter(({ item, index }) => {
      const matches = groupOf(item) === group.key;
      if (matches) groupedIndexes.add(index);
      return matches;
    });
    return rows.length > 0 ? [{ key: group.key, label: group.label, rows }] : [];
  });
  const remaining = indexed.filter(({ index }) => !groupedIndexes.has(index));
  return remaining.length > 0
    ? [...sections, { key: "other", label: fallbackLabel, rows: remaining }]
    : sections;
}

function clinicalSectionToneClasses(tone: ClinicalSectionTone) {
  const addButton = "border-orange-500 bg-orange-500 text-white hover:border-orange-600 hover:bg-orange-600 hover:text-white";
  if (tone === "danger") {
    return {
      section: "border-border/70 bg-card",
      header: "border-border/60",
      row: "border-rose-300 bg-rose-50/40",
      addButton,
    };
  }
  if (tone === "warning") {
    return {
      section: "border-border/70 bg-card",
      header: "border-border/60",
      row: "border-orange-300 bg-orange-50/40",
      addButton,
    };
  }
  return {
    section: "border-border/70 bg-card",
    header: "border-border/60",
    row: "border-border/50 bg-background",
    addButton: "",
  };
}

export function PatientMedicationTable({
  canManage,
  groupOf,
  groups,
  indexed,
  renderActions,
  tx,
}: {
  canManage: boolean;
  groupOf?: (item: ClinicalMedication) => string;
  groups?: ClinicalSectionGroup[];
  indexed: IndexedClinicalItem<ClinicalMedication>[];
  renderActions: (item: ClinicalMedication, index: number) => ReactNode;
  tx: Bilingual;
}) {
  const sections = groupedClinicalItems(indexed, groups, groupOf, tx("Другое", "Weitere"));
  const columnCount = canManage ? 13 : 12;
  const doseCell = (value: string | null) => {
    const normalized = value?.trim() ?? "";
    return normalized || <span aria-hidden="true" className="text-muted-foreground/35">—</span>;
  };

  const headCell = "px-2.5 py-2 text-xs font-medium text-muted-foreground";
  const headDoseCell = "px-1.5 py-2 text-center text-xs font-medium text-muted-foreground";
  const bodyCell = "break-words px-2.5 py-2.5 align-middle leading-snug text-foreground";
  const bodyDoseCell = "px-1.5 py-2.5 text-center align-middle font-mono tabular-nums text-foreground";

  return (
    <div className="overflow-x-auto bg-card">
      <table className="w-full min-w-[1160px] border-collapse text-left text-xs">
        <thead className="border-b border-border/40 bg-card">
          <tr>
            <th scope="col" className={headCell}>{tx("Действующее вещество", "Wirkstoff")}</th>
            <th scope="col" className={headCell}>{tx("Торговое название", "Handelsname")}</th>
            <th scope="col" className={headCell}>{tx("Дозировка", "Stärke")}</th>
            <th scope="col" className={headCell}>{tx("Форма", "Form")}</th>
            <th scope="col" className={headDoseCell}>{tx("Утро", "Morgens")}</th>
            <th scope="col" className={headDoseCell}>{tx("День", "Mittags")}</th>
            <th scope="col" className={headDoseCell}>{tx("Вечер", "Abends")}</th>
            <th scope="col" className={headDoseCell}>{tx("Ночь", "Zur Nacht")}</th>
            <th scope="col" className={headCell}>{tx("Ед.", "Einheit")}</th>
            <th scope="col" className={headCell}>{tx("Указания", "Hinweise")}</th>
            <th scope="col" className={headCell}>{tx("Показание", "Grund")}</th>
            <th scope="col" className={headCell}>{tx("Источник", "Quelle")}</th>
            {canManage ? (
              <th scope="col" className="px-2.5 py-2 text-right text-xs font-medium text-muted-foreground">
                {tx("Действия", "Aktionen")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label && section.key !== "dauer" ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="bg-muted/55 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground"
                  >
                    {section.label}
                  </td>
                </tr>
              ) : null}
              {section.rows.map(({ item, index }) => {
                const attribution = attributionLabel(item);
                const ended = medicationHasEnded(item);
                return (
                  <tr
                    key={item.id ?? index}
                    className={cn(
                      "transition-colors",
                      ended
                        ? "bg-rose-50/70"
                        : item.on_hold
                          ? "bg-amber-50/70"
                          : "even:bg-muted/20 hover:bg-muted/45",
                    )}
                  >
                    <td className={cn(bodyCell, "whitespace-pre-line font-medium")}>{item.wirkstoff || "—"}</td>
                    <td className={bodyCell}>
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                      {item.einnahme_bis ? (
                        <span
                          className={cn(
                            "mt-0.5 block text-[10px] font-semibold uppercase tracking-wide",
                            ended ? "text-rose-700" : "text-emerald-700",
                          )}
                        >
                          {ended
                            ? tx("Приём завершён", "Einnahme beendet")
                            : tx("Приём до", "Einnahme bis")}{" "}
                          {dateOnly(item.einnahme_bis)}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(bodyCell, "whitespace-pre-line font-mono")}>{item.staerke || ""}</td>
                    <td className={cn(bodyCell, "whitespace-pre-line")}>
                      {darreichungsformLabel(item.form)}
                    </td>
                    {item.on_hold ? (
                      <td colSpan={4} className="px-2.5 py-2 align-top text-left text-amber-800">
                        <span className="block text-[11px] font-semibold">
                          {tx("На холд", "Auf Hold")}
                          {item.hold_from ? ` ${tx("с", "seit")} ${dateOnly(item.hold_from)}` : ""}
                          {item.hold_until ? ` ${tx("до", "bis")} ${dateOnly(item.hold_until)}` : ""}
                        </span>
                        {item.hold_note ? (
                          <span className="mt-0.5 block break-words text-[10px] font-normal">
                            {item.hold_note}
                          </span>
                        ) : null}
                      </td>
                    ) : (
                      <>
                        <td className={bodyDoseCell}>{doseCell(item.dose_morgens)}</td>
                        <td className={bodyDoseCell}>{doseCell(item.dose_mittags)}</td>
                        <td className={bodyDoseCell}>{doseCell(item.dose_abends)}</td>
                        <td className={bodyDoseCell}>{doseCell(item.dose_nachts)}</td>
                      </>
                    )}
                    <td className={cn(bodyCell, "whitespace-nowrap")}>{item.einheit || ""}</td>
                    <td className={bodyCell}>
                      {item.hinweis ? <span className="whitespace-pre-line break-words">{item.hinweis}</span> : null}
                      {attribution ? (
                        <span className="mt-1 block max-w-full break-words text-[10px] leading-snug text-muted-foreground">
                          {attribution}
                        </span>
                      ) : null}
                    </td>
                    <td className={bodyCell}>{item.grund || ""}</td>
                    <td className={cn(bodyCell, "min-w-40")}>
                      <ClinicalRecordSource item={item} tx={tx} />
                    </td>
                    {canManage ? (
                      <td className="px-2 py-2 text-right align-top">
                        {renderActions(item, index)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Provider + doctor attribution selector, reused by every section's form. */
function ProviderDoctorFields({
  value,
  providers,
  onChange,
  tx,
}: {
  value: ClinicalAttribution;
  providers: ProviderSummary[];
  onChange: (next: ClinicalAttribution) => void;
  tx: Bilingual;
}) {
  // Keyed by provider so a stale list never shows under a freshly picked provider,
  // and so we never call setState synchronously inside the effect.
  const [doctorsState, setDoctorsState] = useState<{ providerId: string | null; list: DoctorOption[] }>(
    { providerId: null, list: [] },
  );

  useEffect(() => {
    let active = true;
    const providerId = value.provider_id;
    if (!providerId) return;
    getProviderDoctors(providerId)
      .then((rows) => {
        if (active) setDoctorsState({ providerId, list: rows });
      })
      .catch(() => {
        if (active) setDoctorsState({ providerId, list: [] });
      });
    return () => {
      active = false;
    };
  }, [value.provider_id]);

  const doctors = doctorsState.providerId === value.provider_id ? doctorsState.list : [];

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <Field label={tx("Провайдер", "Anbieter")}>
        <NativeComboboxSelect
          value={value.provider_id ?? ""}
          aria-label={tx("Провайдер", "Anbieter")}
          className={inputClass}
          onChange={(event) => {
            const id = event.target.value || null;
            const name = providers.find((p) => p.id === id)?.name ?? null;
            onChange({
              provider_id: id,
              provider_name: name,
              doctor_id: null,
              doctor_name: null,
              doctor_title: null,
              doctor_fachbereich: null,
            });
          }}
        >
          <option value="">{tx("Провайдер", "Anbieter")}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={tx("Врач", "Arzt")}>
        <NativeComboboxSelect
          value={value.doctor_id ?? ""}
          disabled={!value.provider_id}
          aria-label={tx("Врач", "Arzt")}
          className={inputClass}
          onChange={(event) => {
            const id = event.target.value || null;
            const doctor = doctors.find((d) => d.id === id);
            onChange({
              ...value,
              doctor_id: id,
              doctor_name: doctor?.name ?? null,
              doctor_title: doctor?.title ?? null,
              doctor_fachbereich: doctor?.fachbereich ?? null,
            });
          }}
        >
          <option value="">{tx("Врач", "Arzt")}</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {[doctor.title, doctor.name].filter(Boolean).join(" ")}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
    </div>
  );
}

/** Generic add / edit / remove + replace-all-save list for one clinical section. */
function ClinicalSection<T extends { id?: string | null }>({
  title,
  count,
  items,
  blank,
  isValid,
  rowView,
  listView,
  form,
  onSave,
  canManage,
  tx,
  groups,
  groupOf,
  tone = "neutral",
  sectionClassName,
  rowClassName,
  headerAction,
}: {
  title: string;
  count?: ReactNode;
  items: T[];
  blank: () => T;
  isValid: (draft: T) => boolean;
  /** Per-row read view. Optional when a `listView` renders the whole list. */
  rowView?: (item: T) => ReactNode;
  listView?: (args: ClinicalSectionListViewArgs<T>) => ReactNode;
  form: (draft: T, set: (patch: Partial<T>) => void) => ReactNode;
  onSave: (next: T[]) => Promise<unknown>;
  canManage: boolean;
  tx: Bilingual;
  /** When provided, rows render under sub-headers (a Haupt/Neben-style tree). */
  groups?: ClinicalSectionGroup[];
  groupOf?: (item: T) => string;
  tone?: ClinicalSectionTone;
  sectionClassName?: string;
  rowClassName?: string;
  headerAction?: ReactNode;
}) {
  const [list, setList] = useState<T[]>(items);
  const [editing, setEditing] = useState<{ index: number | null; draft: T } | null>(null);
  const [busy, setBusy] = useState(false);

  // Sync the local list from props, but never while a row is being edited:
  // a realtime refresh landing mid-edit would otherwise swap the baseline the
  // user is editing against. Once the editor closes, we re-sync to the latest.
  useEffect(() => {
    if (!editing) setList(items);
  }, [items, editing]);

  const set = (patch: Partial<T>) =>
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));

  async function persist(next: T[]) {
    setBusy(true);
    try {
      const saved = await onSave(next);
      setList(Array.isArray(saved) ? (saved as T[]) : next);
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    if (!editing || !isValid(editing.draft)) return;
    const cleaned = trimDraftStrings(editing.draft);
    const next = [...list];
    if (editing.index === null) next.push(cleaned);
    else next[editing.index] = cleaned;
    void persist(next);
  }

  const renderActions = (item: T, index: number) =>
    canManage ? (
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-7 rounded-md p-0"
          aria-label={tx("Редактировать", "Bearbeiten")}
          title={tx("Редактировать", "Bearbeiten")}
          onClick={() => setEditing({ index, draft: { ...item } })}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-7 rounded-md p-0 text-destructive"
          aria-label={tx("Удалить", "Löschen")}
          title={tx("Удалить", "Löschen")}
          disabled={busy}
          onClick={() => void persist(list.filter((_, i) => i !== index))}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    ) : null;

  const toneClasses = clinicalSectionToneClasses(tone);

  const renderRow = (item: T, index: number) => (
    <div
      key={item.id ?? index}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border px-3 py-2",
        toneClasses.row,
        rowClassName,
      )}
    >
      <div className="min-w-0">{rowView ? rowView(item) : null}</div>
      {renderActions(item, index)}
    </div>
  );

  const indexed = list.map((item, index) => ({ item, index }));

  return (
    <section className={cn("rounded-xl border", toneClasses.section, sectionClassName)}>
      <header className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3", toneClasses.header)}>
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {count ?? <Badge variant="outline" className="rounded-full text-[11px]">{list.length}</Badge>}
        </div>
        <div className={cn("flex flex-wrap items-center justify-end gap-2", headerAction && "w-full sm:w-auto")}>
          {headerAction}
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("h-8 rounded-lg", toneClasses.addButton)}
              onClick={() => setEditing({ index: null, draft: blank() })}
            >
              <Plus className="size-3.5" />
              {tx("Добавить", "Hinzufügen")}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn(listView && list.length > 0 ? "min-w-0" : "space-y-1.5 p-3")}>
        {list.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Пока нет записей", "Noch keine Einträge")}
          </p>
        ) : null}

        {list.length > 0 ? (
          listView
            ? listView({ indexed, groups, groupOf, renderActions })
            : groups && groupOf
              ? groups.map((group) => {
                  const rows = indexed.filter(({ item }) => groupOf(item) === group.key);
                  if (rows.length === 0) return null;
                  return (
                    <div key={group.key} className="space-y-1.5">
                      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      {rows.map(({ item, index }) => renderRow(item, index))}
                    </div>
                  );
                })
              : indexed.map(({ item, index }) => renderRow(item, index))
        ) : null}

        <PatientSheetScaffold
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          width="form-heavy"
          title={
            editing?.index === null
              ? `${tx("Добавить", "Hinzufügen")}: ${title}`
              : `${tx("Редактировать", "Bearbeiten")}: ${title}`
          }
          footer={
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => setEditing(null)}
              >
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy || !editing || !isValid(editing.draft)}
                onClick={submitDraft}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </>
          }
        >
          {editing ? form(editing.draft, set) : null}
        </PatientSheetScaffold>
      </div>
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{children}</label>;
}

// A label that wraps its control, so the visible caption is also the control's
// accessible name (implicit association — no id juggling needed).
function Field({
  label,
  children,
  required = false,
}: {
  label: ReactNode;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
    </label>
  );
}

// A checkbox whose caption is its accessible name (label wraps the input).
function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        className="size-4 rounded border-border"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function MedicationHoldDialog({
  editor,
  busy,
  onChange,
  onClose,
  onSubmit,
  tx,
}: {
  editor: MedicationHoldEditor | null;
  busy: boolean;
  onChange: (patch: Partial<MedicationHoldDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
  tx: Bilingual;
}) {
  const draft = editor?.draft;
  const medicationName =
    editor?.medication.handelsname?.trim() || editor?.medication.wirkstoff?.trim();
  const holdRangeValid = Boolean(
    editor
    && draft
    && medicationDateRangeValid({ ...editor.medication, ...draft }),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Dialog
      allowImplicitDismissal
      open={Boolean(editor)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tx("На холд", "Auf Hold")}</DialogTitle>
            <DialogDescription>
              {medicationName || tx("Медикамент", "Medikament")}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="space-y-3">
              <CheckboxField
                label={tx("Пациент не принимает препарат", "Patient nimmt das Medikament nicht")}
                checked={draft.on_hold}
                onChange={(checked) =>
                  onChange({
                    on_hold: checked,
                    hold_from: checked ? (draft.hold_from ?? localToday()) : null,
                    hold_until: checked ? draft.hold_until : null,
                    hold_note: checked ? draft.hold_note : null,
                  })
                }
              />

              {draft.on_hold ? (
                <div className="grid gap-3">
                  <Field label={tx("Не принимает с", "Pausiert seit")}>
                    <Input
                      type="date"
                      value={draft.hold_from ?? ""}
                      onChange={(event) => onChange({ hold_from: event.target.value || null })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label={tx("До какого числа", "Bis wann")}>
                    <Input
                      type="date"
                      min={draft.hold_from ?? undefined}
                      value={draft.hold_until ?? ""}
                      onChange={(event) => onChange({ hold_until: event.target.value || null })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label={tx("Заметка", "Notiz")}>
                    <textarea
                      value={draft.hold_note ?? ""}
                      onChange={(event) => onChange({ hold_note: blankToNull(event.target.value) })}
                      className={cn(inputClass, "h-24 resize-y py-2")}
                      placeholder={tx("Причина паузы", "Grund der Pause")}
                    />
                  </Field>
                  {!holdRangeValid ? (
                    <p role="alert" className="text-xs text-destructive">
                      {tx(
                        "Дата окончания холда не может быть раньше даты начала.",
                        "Das Hold-Ende darf nicht vor dem Beginn liegen.",
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg"
              disabled={busy}
              onClick={onClose}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg"
              disabled={busy || !draft || !holdRangeValid}
            >
              {draft?.on_hold ? tx("Сохранить холд", "Hold speichern") : tx("Снять холд", "Hold entfernen")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Empfehlungstyp options (value matches the DB `recommendation_type` check). */
const RECOMMENDATION_TYPE_OPTIONS: { value: string; ru: string; de: string }[] = [
  { value: "follow_up", ru: "Контрольный визит", de: "Kontrolltermin" },
  { value: "consultation", ru: "Консультация", de: "Konsultation" },
  { value: "lab_test", ru: "Лабораторный анализ", de: "Laboruntersuchung" },
  { value: "imaging", ru: "Визуализация", de: "Bildgebung" },
  { value: "document", ru: "Документ", de: "Dokument" },
  { value: "medication_review", ru: "Проверка медикаментов", de: "Medikationsprüfung" },
  { value: "other", ru: "Другое", de: "Sonstiges" },
];

const RECOMMENDATION_PRIORITY_OPTIONS: { value: string; ru: string; de: string }[] = [
  { value: "low", ru: "Низкий", de: "Niedrig" },
  { value: "normal", ru: "Обычный", de: "Normal" },
  { value: "high", ru: "Высокий", de: "Hoch" },
  { value: "urgent", ru: "Срочный", de: "Dringend" },
];

const LIFECYCLE_OPTIONS: { value: RecommendationLifecycleStatus; ru: string; de: string }[] = [
  { value: "aktiv", ru: "Активна", de: "Aktiv" },
  { value: "erfolg", ru: "Выполнена", de: "Erfolg" },
  { value: "nicht_erfolgt", ru: "Не выполнена", de: "Nicht erfolgt" },
  { value: "unbekannt", ru: "Неизвестно", de: "Unbekannt" },
];

/** Draft used by the create/edit form; `id` absent means "create". */
type RecommendationDraft = {
  id?: string;
  title: string;
  description: string | null;
  recommendation_type: string | null;
  source_doctor_id: string | null;
  recommended_on: string | null;
  priority: string | null;
  valid_from: string | null;
  valid_to: string | null;
  reminder_lead_days: number | null;
  reminder_at: string | null;
  lifecycle_status: RecommendationLifecycleStatus;
  outcome_note: string | null;
  outcome_at: string | null;
  note_intern: string | null;
};

function blankRecommendationDraft(): RecommendationDraft {
  return {
    title: "",
    description: null,
    recommendation_type: null,
    source_doctor_id: null,
    recommended_on: null,
    priority: "normal",
    valid_from: null,
    valid_to: null,
    reminder_lead_days: null,
    reminder_at: null,
    lifecycle_status: "aktiv",
    outcome_note: null,
    outcome_at: null,
    note_intern: null,
  };
}

function recommendationToDraft(rec: PatientRecommendation): RecommendationDraft {
  return {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    recommendation_type: rec.recommendation_type,
    source_doctor_id: rec.source_doctor_id,
    recommended_on: rec.recommended_on,
    priority: rec.priority,
    valid_from: rec.valid_from,
    valid_to: rec.valid_to,
    reminder_lead_days: rec.reminder_lead_days,
    reminder_at: rec.reminder_at,
    lifecycle_status: rec.lifecycle_status,
    outcome_note: rec.outcome_note,
    outcome_at: rec.outcome_at,
    note_intern: rec.note_intern,
  };
}

function lifecycleBadgeClass(status: RecommendationLifecycleStatus): string {
  switch (status) {
    case "erfolg":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "nicht_erfolgt":
      return "border-rose-300 bg-rose-50 text-rose-700";
    case "unbekannt":
      return "border-slate-300 bg-slate-50 text-slate-600";
    default:
      return "border-sky-300 bg-sky-50 text-sky-700";
  }
}

/** Admin CRUD for patient recommendations (Empfehlungen). Replaces the old read-only block. */
export function PatientRecommendationsSection({
  recommendations,
  allDoctors,
  patientId,
  canManage,
  lang,
  onReload,
  tx,
}: {
  recommendations: PatientRecommendation[];
  allDoctors: AllDoctorOption[];
  patientId: string;
  canManage: boolean;
  lang: "de" | "ru";
  onReload: () => void;
  tx: Bilingual;
}) {
  const [editing, setEditing] = useState<RecommendationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const set = (patch: Partial<RecommendationDraft>) =>
    setEditing((current) => (current ? { ...current, ...patch } : current));

  const typeLabel = (value: string | null) => {
    const option = RECOMMENDATION_TYPE_OPTIONS.find((o) => o.value === value);
    return option ? tx(option.ru, option.de) : null;
  };
  const doctorOptions = deduplicateAllDoctorOptions(allDoctors);
  const lifecycleLabel = (value: RecommendationLifecycleStatus) => {
    const option = LIFECYCLE_OPTIONS.find((o) => o.value === value);
    return option ? tx(option.ru, option.de) : value;
  };
  const doctorName = (rec: PatientRecommendation) => recommendationDoctorLabel(rec, doctorOptions, lang);
  const validityLabel = (rec: PatientRecommendation) =>
    [rec.valid_from, rec.valid_to].some(Boolean)
      ? `${rec.valid_from ?? "…"} – ${rec.valid_to ?? "…"}`
      : null;
  const dueAtLabel = (rec: PatientRecommendation) => dateOnly(rec.due_at);

  const isValid = (draft: RecommendationDraft) => draft.title.trim() !== "";

  async function submitDraft() {
    if (!editing || !isValid(editing)) return;
    setBusy(true);
    try {
      const payload = {
        title: editing.title.trim(),
        description: editing.description,
        recommendation_type: editing.recommendation_type,
        source_doctor_id: editing.source_doctor_id,
        recommended_on: editing.recommended_on,
        priority: editing.priority,
        valid_from: editing.valid_from,
        valid_to: editing.valid_to,
        reminder_lead_days: editing.reminder_lead_days,
        reminder_at: editing.reminder_at,
        lifecycle_status: editing.lifecycle_status,
        outcome_note: editing.lifecycle_status === "aktiv" ? null : editing.outcome_note,
        outcome_at: editing.lifecycle_status === "erfolg" ? editing.outcome_at : null,
        note_intern: editing.note_intern,
      };
      if (editing.id) {
        await updatePatientRecommendation(patientId, editing.id, payload);
      } else {
        await createPatientRecommendation(patientId, payload);
      }
      setEditing(null);
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  async function removeRecommendation(rec: PatientRecommendation) {
    setBusy(true);
    try {
      await deletePatientRecommendation(patientId, rec.id);
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось удалить", "Löschen fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  const activeRecs = recommendations.filter((rec) => rec.lifecycle_status !== "erfolg");
  const doneRecs = recommendations.filter((rec) => rec.lifecycle_status === "erfolg");

  const renderRow = (rec: PatientRecommendation, muted: boolean) => (
    <div
      key={rec.id}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border border-border/40 bg-white px-3 py-2",
        muted && "opacity-70",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">{rec.title}</span>
          {typeLabel(rec.recommendation_type) ? (
            <Badge variant="outline" className="rounded-full text-[10px]">
              {typeLabel(rec.recommendation_type)}
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn("rounded-full text-[10px]", lifecycleBadgeClass(rec.lifecycle_status))}>
            {lifecycleLabel(rec.lifecycle_status)}
          </Badge>
          {rec.recommended_on ? <span className={datePillClass}>{rec.recommended_on}</span> : null}
          {validityLabel(rec) ? (
            <span className={periodPillClass}>
              {tx("Период", "Zeitraum")}: {validityLabel(rec)}
            </span>
          ) : null}
          {rec.reminder_at ? (
            <span className={reminderPillClass}>
              {tx("Дата напоминания", "Erinnerungsdatum")}: {dateOnly(rec.reminder_at)}
            </span>
          ) : null}
          {dueAtLabel(rec) ? <span className={datePillClass}>{dueAtLabel(rec)}</span> : null}
        </div>
        {rec.description ? (
          <p className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{rec.description}</p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          {doctorName(rec) ? (
            <span className="min-w-0 max-w-full break-words text-foreground">{doctorName(rec)}</span>
          ) : null}
        </div>
        <ClinicalRecordSource item={rec} tx={tx} />
      </div>
      {canManage ? (
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-7 rounded-md p-0"
            aria-label={tx("Редактировать", "Bearbeiten")}
            title={tx("Редактировать", "Bearbeiten")}
            onClick={() => setEditing(recommendationToDraft(rec))}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-7 rounded-md p-0 text-destructive"
            aria-label={tx("Удалить", "Löschen")}
            title={tx("Удалить", "Löschen")}
            disabled={busy}
            onClick={() => void removeRecommendation(rec)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="rounded-xl border border-border/70 bg-slate-50/60">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="text-sm font-semibold text-foreground">{tx("Рекомендации", "Empfehlungen")}</h3>
          <Badge variant="outline" className="rounded-full text-[11px]">{recommendations.length}</Badge>
        </div>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            onClick={() => setEditing(blankRecommendationDraft())}
          >
            <Plus className="size-3.5" />
            {tx("Добавить рекомендацию", "Empfehlung hinzufügen")}
          </Button>
        ) : null}
      </header>

      <div className="space-y-1.5 p-3">
        {recommendations.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Рекомендаций нет", "Keine Empfehlungen")}
          </p>
        ) : null}

        {activeRecs.map((rec) => renderRow(rec, false))}

        {doneRecs.length > 0 ? (
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              onClick={() => setShowDone((current) => !current)}
            >
              <span>{tx("Выполнено", "Erledigt")}</span>
              <Badge variant="outline" className="rounded-full text-[10px]">{doneRecs.length}</Badge>
              <span className="ml-auto text-[10px]">{showDone ? tx("Скрыть", "Ausblenden") : tx("Показать", "Anzeigen")}</span>
            </button>
            {showDone ? doneRecs.map((rec) => renderRow(rec, true)) : null}
          </div>
        ) : null}

        <PatientSheetScaffold
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          width="form-heavy"
          title={
            editing?.id
              ? `${tx("Редактировать", "Bearbeiten")}: ${tx("Рекомендация", "Empfehlung")}`
              : `${tx("Добавить", "Hinzufügen")}: ${tx("Рекомендация", "Empfehlung")}`
          }
          footer={
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => setEditing(null)}
              >
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy || !editing || !isValid(editing)}
                onClick={submitDraft}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </>
          }
        >
          {editing ? (
            <div className="space-y-2">
              <Field label={tx("Заголовок", "Titel")}>
                <Input
                  value={editing.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className={inputClass}
                  placeholder={tx("Контроль через 3 месяца", "Kontrolle in 3 Monaten")}
                />
              </Field>
              <Field label={tx("Описание", "Beschreibung")}>
                <textarea
                  value={editing.description ?? ""}
                  onChange={(e) => set({ description: blankToNull(e.target.value) })}
                  className={cn(inputClass, "h-20 py-2")}
                />
              </Field>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={tx("Тип", "Typ")}>
                  <NativeComboboxSelect
                    value={editing.recommendation_type ?? ""}
                    aria-label={tx("Тип", "Typ")}
                    className={inputClass}
                    onChange={(e) => set({ recommendation_type: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {RECOMMENDATION_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {tx(option.ru, option.de)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field label={tx("Рекомендующий врач", "Empfehlender Arzt")}>
                  <NativeComboboxSelect
                    value={editing.source_doctor_id ?? ""}
                    aria-label={tx("Рекомендующий врач", "Empfehlender Arzt")}
                    className={inputClass}
                    onChange={(e) => set({ source_doctor_id: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {doctorOptions.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {allDoctorOptionLabel(doctor)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={tx("Дата рекомендации", "Empfohlen am")}>
                  <Input
                    type="date"
                    value={editing.recommended_on ?? ""}
                    onChange={(e) => set({ recommended_on: blankToNull(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
                <Field label={tx("Приоритет", "Priorität")}>
                  <NativeComboboxSelect
                    value={editing.priority ?? ""}
                    aria-label={tx("Приоритет", "Priorität")}
                    className={inputClass}
                    onChange={(e) => set({ priority: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {RECOMMENDATION_PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {tx(option.ru, option.de)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={tx("Действует с", "Gültig ab")}>
                  <Input
                    type="date"
                    value={editing.valid_from ?? ""}
                    onChange={(e) => set({ valid_from: blankToNull(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
                <Field label={tx("Действует до", "Gültig bis")}>
                  <Input
                    type="date"
                    value={editing.valid_to ?? ""}
                    onChange={(e) => set({ valid_to: blankToNull(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={tx("Напомнить за (дней)", "Erinnerung (Tage vorher)")}>
                  <Input
                    type="number"
                    min={0}
                    value={editing.reminder_lead_days ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      set({ reminder_lead_days: raw === "" ? null : Number(raw) });
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field label={tx("Дата напоминания", "Erinnerungsdatum")}>
                  <Input
                    type="date"
                    value={editing.reminder_at ?? ""}
                    onChange={(e) => set({ reminder_at: blankToNull(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label={tx("Статус выполнения", "Status")}>
                <NativeComboboxSelect
                  value={editing.lifecycle_status}
                  aria-label={tx("Статус выполнения", "Status")}
                  className={inputClass}
                  onChange={(e) => set({ lifecycle_status: e.target.value as RecommendationLifecycleStatus })}
                >
                  {LIFECYCLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {tx(option.ru, option.de)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              {editing.lifecycle_status !== "aktiv" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label={tx("Примечание к результату", "Ergebnisnotiz")}>
                    <Input
                      value={editing.outcome_note ?? ""}
                      onChange={(e) => set({ outcome_note: blankToNull(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  {editing.lifecycle_status === "erfolg" ? (
                    <Field label={tx("Дата выполнения", "Erledigt am")}>
                      <Input
                        type="date"
                        value={editing.outcome_at ?? ""}
                        onChange={(e) => set({ outcome_at: blankToNull(e.target.value) })}
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              <Field label={tx("Внутренняя заметка", "Interne Notiz")}>
                <textarea
                  value={editing.note_intern ?? ""}
                  onChange={(e) => set({ note_intern: blankToNull(e.target.value) })}
                  className={cn(inputClass, "h-20 py-2")}
                />
              </Field>
            </div>
          ) : null}
        </PatientSheetScaffold>
      </div>
    </section>
  );
}

/**
 * Wraps the clinical sections either as a routed tab (`<TabsContent>`) or as a plain
 * embedded block (used below the patient overview card on the profile screen).
 */
function ClinicalWrapper({
  embedded,
  className,
  children,
}: {
  embedded: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (embedded) return <div className={className}>{children}</div>;
  return (
    <TabsContent value="clinical" className={className}>
      {children}
    </TabsContent>
  );
}

function PatientLabHistoryTable({
  rows,
  storageKey,
  canManage,
  tx,
  onEdit,
  onDelete,
}: {
  rows: PatientLabResult[];
  storageKey: string;
  canManage: boolean;
  tx: Bilingual;
  onEdit: (row: PatientLabResult) => void;
  onDelete: (row: PatientLabResult) => void;
}) {
  const [notePreview, setNotePreview] = useState<PatientLabResult | null>(null);
  const columns = useMemo<ColumnDef<PatientLabResult>[]>(
    () => [
      {
        id: "measured_at",
        label: tx("Дата", "Datum"),
        accessor: (row) => row.measured_at,
        width: 180,
        pinned: "left",
        required: true,
        render: (row) => (
          <span className={datePillClass}>
            {patientVitalDateTime(row.measured_at, row.measured_at, row.measured_at_precision)}
          </span>
        ),
      },
      {
        id: "result",
        label: tx("Значение", "Wert"),
        accessor: (row) => row.result_text,
        width: 105,
        align: "left",
        render: (row) => (
          <span
            className={cn(
              "font-mono font-semibold tabular-nums",
              row.abnormal_flag === "normal" && "text-emerald-700",
              (row.abnormal_flag === "low"
                || row.abnormal_flag === "high"
                || row.abnormal_flag === "abnormal")
                && "text-rose-700",
            )}
          >
            {row.result_text}
          </span>
        ),
      },
      {
        id: "unit",
        label: tx("Единица", "Einheit"),
        accessor: (row) => row.unit,
        width: 105,
        render: (row) => <span className="text-muted-foreground">{row.unit || "—"}</span>,
      },
      {
        id: "reference",
        label: tx("Референс", "Referenz"),
        accessor: (row) => `${row.reference_text ?? ""} ${row.interpretation_note ?? ""}`.trim(),
        width: 280,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <div className="min-w-0 space-y-1 text-muted-foreground">
            <span className="block font-medium text-foreground/80">{row.reference_text || "—"}</span>
            {row.interpretation_note ? (
              <button
                type="button"
                className="block max-w-full truncate text-left text-[11px] font-medium leading-4 text-blue-700 hover:text-blue-800 hover:underline"
                title={row.interpretation_note}
                onClick={(event) => {
                  event.stopPropagation();
                  setNotePreview(row);
                }}
              >
                {tx("Примечание лаборатории", "Laborhinweis")}
              </button>
            ) : null}
          </div>
        ),
      },
      {
        id: "laboratory",
        label: tx("Лаборатория", "Labor"),
        accessor: (row) => row.laboratory_name,
        width: 180,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <span className={cn("block truncate", !row.laboratory_name && "text-muted-foreground")} title={row.laboratory_name ?? undefined}>
            {row.laboratory_name ?? tx("Не указана", "Nicht angegeben")}
          </span>
        ),
      },
      {
        id: "document",
        label: tx("Документ", "Dokument"),
        accessor: (row) => row.source_document_name,
        width: 320,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <div className="min-w-0 space-y-1 text-muted-foreground">
            <ClinicalRecordSource item={row} tx={tx} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
              {row.source_country ? <span>{row.source_country}</span> : null}
              {row.recorded_by_name ? (
                <span className="min-w-0 truncate" title={row.recorded_by_name}>
                  {tx("Внёс", "Erfasst von")}: {row.recorded_by_name}
                </span>
              ) : null}
            </div>
            <PatientLabCorrectionMetadata item={row} tx={tx} />
          </div>
        ),
      },
    ],
    [tx],
  );

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowId={(row) => row.id}
        storageKey={storageKey}
        density="compact"
        disableRowHover
        rowHeightOverrides={{ comfortable: 56, compact: 48, condensed: 42 }}
        rowActions={canManage ? (row) => (
          <div className="flex items-center justify-end gap-1">
            <PatientLabResultEditAction
              label={tx("Исправить", "Korrigieren")}
              onEdit={() => onEdit(row)}
            />
            <PatientLabResultDeleteAction
              label={tx("Удалить", "Löschen")}
              onDelete={() => onDelete(row)}
            />
          </div>
        ) : undefined}
        rowActionsLabel={tx("Действия", "Aktionen")}
        rowActionsWidth={80}
        className="w-full min-w-0 shadow-none"
      />

      <Dialog open={notePreview !== null} onOpenChange={(open) => !open && setNotePreview(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tx("Примечание лаборатории", "Laborhinweis")}</DialogTitle>
            <DialogDescription>
              {[notePreview?.analyte_name, notePreview?.reference_text].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-line rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">
            {notePreview?.interpretation_note}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PatientVitalsHistoryTable({
  rows,
  canManage,
  tx,
  onEdit,
  onDelete,
}: {
  rows: PatientVitalMeasurement[];
  canManage: boolean;
  tx: Bilingual;
  onEdit: (row: PatientVitalMeasurement) => void;
  onDelete: (row: PatientVitalMeasurement) => void;
}) {
  const notSet = tx("Не указано", "Nicht gesetzt");
  const value = (number: number | null | undefined, suffix = "", maximumFractionDigits = 1) => {
    const formatted = formatVitalNumber(number, { maximumFractionDigits });
    return formatted ? `${formatted}${suffix}` : "—";
  };
  const columns = useMemo<ColumnDef<PatientVitalMeasurement>[]>(
    () => [
      {
        id: "measured_at",
        label: tx("Дата", "Datum"),
        accessor: (row) => row.measured_at,
        width: 180,
        render: (row) => (
          <span className={datePillClass}>
            {patientVitalDateTime(row.measured_at, notSet, row.measured_at_precision)}
          </span>
        ),
      },
      {
        id: "blood_pressure",
        label: tx("АД", "RR"),
        accessor: (row) => row.bp_systolic,
        width: 100,
        align: "right",
        render: (row) => (
          <span className="font-mono tabular-nums">
            {row.bp_systolic != null && row.bp_diastolic != null
              ? `${value(row.bp_systolic, "", 0)}/${value(row.bp_diastolic, "", 0)}`
              : "—"}
          </span>
        ),
      },
      {
        id: "heart_rate",
        label: tx("ЧСС", "Herzfrequenz"),
        accessor: (row) => row.heart_rate,
        width: 100,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.heart_rate, "", 0)}</span>,
      },
      {
        id: "temperature",
        label: tx("Темп.", "Temp."),
        accessor: (row) => row.temperature_c,
        width: 100,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.temperature_c, " °C")}</span>,
      },
      {
        id: "oxygen_saturation",
        label: "SpO₂",
        accessor: (row) => row.oxygen_saturation,
        width: 90,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.oxygen_saturation, " %")}</span>,
      },
      {
        id: "respiratory_rate",
        label: tx("ЧД", "AF"),
        accessor: (row) => row.respiratory_rate,
        width: 90,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.respiratory_rate, " /min", 0)}</span>,
      },
      {
        id: "weight",
        label: tx("Вес", "Gewicht"),
        accessor: (row) => row.weight_kg,
        width: 100,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.weight_kg, " kg")}</span>,
      },
      {
        id: "height",
        label: tx("Рост", "Größe"),
        accessor: (row) => row.height_cm,
        width: 100,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.height_cm, " cm")}</span>,
      },
      {
        id: "bmi",
        label: "BMI",
        accessor: (row) => row.bmi,
        width: 80,
        align: "right",
        render: (row) => <span className="font-mono tabular-nums">{value(row.bmi)}</span>,
      },
      {
        id: "source",
        label: tx("Источник", "Quelle"),
        accessor: (row) => row.source_document_name ?? row.recorded_by_name,
        width: 300,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <div className="min-w-0 text-muted-foreground">
            <ClinicalRecordSource item={row} tx={tx} />
            {row.recorded_by_name ? (
              <p className="truncate text-[10px]" title={row.recorded_by_name}>
                {tx("Внёс", "Erfasst von")}: {row.recorded_by_name}
              </p>
            ) : null}
            {row.notes ? <p className="truncate text-[11px]" title={row.notes}>{row.notes}</p> : null}
          </div>
        ),
      },
    ],
    [notSet, tx],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowId={(row) => row.id}
      density="compact"
      disableRowHover
      rowHeightOverrides={{ comfortable: 56, compact: 50, condensed: 42 }}
      rowActions={canManage ? (row) => (
        patientVitalIsImported(row) ? null : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-7 rounded-md p-0"
              aria-label={tx("Редактировать", "Bearbeiten")}
              title={tx("Редактировать", "Bearbeiten")}
              onClick={() => onEdit(row)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-7 rounded-md p-0 text-destructive"
              aria-label={tx("Удалить показатель", "Vitalwert löschen")}
              title={tx("Удалить показатель", "Vitalwert löschen")}
              onClick={() => onDelete(row)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )
      ) : undefined}
      rowActionsLabel={tx("Действия", "Aktionen")}
      rowActionsWidth={88}
      className="rounded-lg border-border/60 bg-white shadow-none"
    />
  );
}

function PatientRiskScoresTable({
  rows,
  canManage,
  tx,
  onEdit,
  onDelete,
}: {
  rows: PatientRiskScore[];
  canManage: boolean;
  tx: Bilingual;
  onEdit: (row: PatientRiskScore) => void;
  onDelete: (row: PatientRiskScore) => void;
}) {
  const notSet = tx("Не указано", "Nicht gesetzt");
  const columns = useMemo<ColumnDef<PatientRiskScore>[]>(
    () => [
      {
        id: "computed_at",
        label: tx("Дата", "Datum"),
        accessor: (row) => row.computed_at,
        width: 180,
        render: (row) => (
          <span className={datePillClass}>{patientVitalDateTime(row.computed_at, notSet)}</span>
        ),
      },
      {
        id: "score_type",
        label: tx("Тип", "Typ"),
        accessor: (row) => patientRiskScoreTypeLabel(row.score_type, tx),
        width: 190,
        render: (row) => (
          <span className="font-medium text-foreground">{patientRiskScoreTypeLabel(row.score_type, tx)}</span>
        ),
      },
      {
        id: "score_value",
        label: tx("Оценка риска", "Risikowert"),
        accessor: (row) => row.score_value,
        width: 130,
        align: "right",
        render: (row) => {
          const score = formatVitalNumber(row.score_value) ?? notSet;
          const scale = row.scale_max != null ? formatVitalNumber(row.scale_max) : null;
          return <span className="font-mono font-semibold tabular-nums">{scale ? `${score} / ${scale}` : score}</span>;
        },
      },
      {
        id: "interpretation",
        label: tx("Интерпретация", "Interpretation"),
        accessor: (row) => row.interpretation,
        width: 280,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <span className="block truncate text-muted-foreground" title={row.interpretation ?? undefined}>
            {row.interpretation || "—"}
          </span>
        ),
      },
      {
        id: "source",
        label: tx("Источник", "Quelle"),
        accessor: (row) => row.source ?? row.recorded_by_name,
        width: 240,
        cellClassName: "whitespace-normal",
        render: (row) => (
          <div className="min-w-0 text-muted-foreground">
            <p className="truncate" title={row.source ?? undefined}>{row.source || "—"}</p>
            <p className="truncate text-[11px]">
              {tx("Записал", "Erfasst von")}: {row.recorded_by_name ?? tx("Неизвестно", "Unbekannt")}
            </p>
          </div>
        ),
      },
    ],
    [notSet, tx],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowId={(row) => row.id}
      density="compact"
      rowHeightOverrides={{ comfortable: 56, compact: 50, condensed: 42 }}
      rowActions={canManage ? (row) => (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-7 rounded-md p-0"
            aria-label={tx("Редактировать", "Bearbeiten")}
            title={tx("Редактировать", "Bearbeiten")}
            onClick={() => onEdit(row)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-7 rounded-md p-0 text-destructive"
            aria-label={tx("Удалить риск-скор", "Risikoscore löschen")}
            title={tx("Удалить риск-скор", "Risikoscore löschen")}
            onClick={() => onDelete(row)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      ) : undefined}
      rowActionsLabel={tx("Действия", "Aktionen")}
      rowActionsWidth={88}
      className="rounded-lg border-border/60 bg-white shadow-none"
    />
  );
}

function medicationHistoryText(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function medicationHistoryRegimen(snapshot: Record<string, unknown>, tx: Bilingual) {
  const dose = ["dose_morgens", "dose_mittags", "dose_abends", "dose_nachts"]
    .map((key) => medicationHistoryText(snapshot, key) ?? "0")
    .join("-");
  const hasDose = ["dose_morgens", "dose_mittags", "dose_abends", "dose_nachts"]
    .some((key) => medicationHistoryText(snapshot, key));
  return [
    medicationHistoryText(snapshot, "staerke"),
    medicationHistoryText(snapshot, "form"),
    localizedMedicationRoute(medicationHistoryText(snapshot, "einnahmeform"), tx),
    hasDose
      ? `${dose}${medicationHistoryText(snapshot, "einheit") ? ` ${medicationHistoryText(snapshot, "einheit")}` : ""}`
      : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function localizedMedicationStatus(status: string | null | undefined, tx: Bilingual) {
  switch (status?.trim().toLowerCase()) {
    case "aktiv":
    case "active":
      return tx("Активен", "Aktiv");
    case "pausiert":
    case "paused":
      return tx("Приостановлен", "Pausiert");
    case "abgesetzt":
    case "stopped":
      return tx("Отменён", "Abgesetzt");
    case "geplant":
    case "planned":
      return tx("Запланирован", "Geplant");
    default:
      return status ?? "";
  }
}

function localizedMedicationRoute(route: string | null | undefined, tx: Bilingual) {
  switch (route?.trim().toLowerCase()) {
    case "oral":
      return tx("Перорально", "Oral");
    case "intravenous":
    case "iv":
      return tx("Внутривенно", "Intravenös");
    case "subcutaneous":
      return tx("Подкожно", "Subkutan");
    case "topical":
      return tx("Наружно", "Topisch");
    case "inhalation":
      return tx("Ингаляционно", "Inhalativ");
    default:
      return route ?? "";
  }
}

function localizedClinicalSeverity(severity: string | null | undefined, tx: Bilingual) {
  switch (severity?.trim().toLowerCase()) {
    case "leicht":
    case "mild":
      return tx("Лёгкая", "Leicht");
    case "mittel":
    case "moderate":
      return tx("Средняя", "Mittel");
    case "schwer":
    case "severe":
      return tx("Тяжёлая", "Schwer");
    default:
      return severity ?? "";
  }
}

function MedicationHistoryTree({
  series,
  total,
  loadingMore,
  tx,
  onLoadMore,
}: {
  series: MedicationHistorySeries[];
  total: number;
  loadingMore: boolean;
  tx: Bilingual;
  onLoadMore: () => void;
}) {
  const actionMeta = (action: MedicationImportHistoryEvent["event_type"]) => {
    if (action === "deduplicated") {
      return { label: tx("Подтверждено повторным документом", "Durch weiteres Dokument bestätigt"), tone: "border-slate-200 bg-slate-50 text-slate-700" };
    }
    if (action === "regimen_changed") {
      return { label: tx("Изменение схемы", "Schemaänderung"), tone: "border-sky-200 bg-sky-50 text-sky-800" };
    }
    if (action === "status_transition") {
      return { label: tx("Изменение статуса", "Statuswechsel"), tone: "border-amber-200 bg-amber-50 text-amber-800" };
    }
    if (action === "historical_observation") {
      return { label: tx("Историческое наблюдение", "Historische Beobachtung"), tone: "border-violet-200 bg-violet-50 text-violet-800" };
    }
    return { label: tx("Создано", "Erstellt"), tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  };

  return (
    <section className="rounded-xl border border-border/70 bg-slate-50/60">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
            <h3 className="text-sm font-semibold text-foreground">
              {tx("История медикаментов", "Medikationsverlauf")}
            </h3>
            <CountBadge>{series.length} {tx("линий", "Serien")}</CountBadge>
          </div>
          <p className="mt-0.5 max-w-3xl text-xs leading-4 text-muted-foreground">
            {tx(
              "Каждая линия показывает текущее состояние и неизменяемую хронологию OCR-документов, схем и статусов.",
              "Jede Serie zeigt den aktuellen Stand und die unveränderliche Chronologie aus OCR-Dokumenten, Schemata und Statuswechseln.",
            )}
          </p>
        </div>
        <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-800">
          {total} {tx("событий", "Ereignisse")}
        </Badge>
      </header>

      <div className="space-y-2 p-3">
        {series.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-sm text-muted-foreground">
            {tx(
              "История появится после подтверждённого OCR-импорта медикаментов.",
              "Der Verlauf erscheint nach einem bestätigten OCR-Medikamentenimport.",
            )}
          </div>
        ) : null}
        {series.map((group, index) => {
          const current = group.current;
          const currentRegimen = current
            ? [
                current.staerke,
                current.form,
                localizedMedicationRoute(current.einnahmeform, tx),
                [current.dose_morgens, current.dose_mittags, current.dose_abends, current.dose_nachts]
                  .some(Boolean)
                  ? `${[current.dose_morgens ?? "0", current.dose_mittags ?? "0", current.dose_abends ?? "0", current.dose_nachts ?? "0"].join("-")}${current.einheit ? ` ${current.einheit}` : ""}`
                  : null,
              ].filter(Boolean).join(" · ")
            : "";
          return (
            <details
              key={group.key}
              open={index === 0}
              className="group rounded-lg border border-border/60 bg-white"
            >
              <summary className="grid cursor-pointer list-none gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {current?.handelsname || group.identity || tx("Медикамент", "Medikament")}
                    </p>
                    {current?.wirkstoff && current.handelsname ? (
                      <span className="text-xs text-muted-foreground">{current.wirkstoff}</span>
                    ) : null}
                    {current?.status ? (
                      <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800">
                        {localizedMedicationStatus(current.status, tx)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 break-words text-xs leading-4 text-muted-foreground">
                    {currentRegimen || tx("Текущая схема отсутствует", "Kein aktuelles Schema")}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-xs text-muted-foreground">
                    {group.events.length} {tx("событий", "Ereignisse")}
                  </span>
                  <span aria-hidden className="text-base text-muted-foreground transition-transform group-open:rotate-90">›</span>
                </div>
              </summary>

              <div className="border-t border-border/50 p-3">
                {current ? (
                  <div className="mb-2.5 overflow-hidden rounded-lg border border-emerald-200/80 bg-emerald-50/25">
                    <div className="grid gap-1.5 border-b border-emerald-200/70 px-3 py-2.5 sm:grid-cols-[minmax(11rem,0.4fr)_minmax(0,1fr)] sm:items-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{tx("Текущее состояние", "Aktueller Stand")}</p>
                      <p className="text-xs font-semibold text-foreground">{localizedMedicationStatus(current.status, tx)}</p>
                    </div>
                    <div className="grid gap-1.5 border-b border-emerald-200/70 px-3 py-2.5 sm:grid-cols-[minmax(11rem,0.4fr)_minmax(0,1fr)] sm:items-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{tx("Схема", "Schema")}</p>
                      <p className="break-words text-xs text-foreground">{currentRegimen || "—"}</p>
                    </div>
                    <div className="grid gap-1.5 border-b border-emerald-200/70 px-3 py-2.5 sm:grid-cols-[minmax(11rem,0.4fr)_minmax(0,1fr)] sm:items-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{tx("Дата источника", "Quelldatum")}</p>
                      <p className="text-xs text-foreground">{current.source_date || current.einnahme_von || "—"}</p>
                    </div>
                    <div className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(11rem,0.4fr)_minmax(0,1fr)] sm:items-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{tx("Страна", "Land")}</p>
                      <p className="text-xs text-foreground">{current.source_country || "—"}</p>
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-lg border border-border/50 bg-white">
                  {group.events.map((event) => {
                    const action = actionMeta(event.event_type);
                    const regimen = medicationHistoryRegimen(event.new_value, tx);
                    const status = medicationHistoryText(event.new_value, "status");
                    return (
                      <article key={event.id} className="border-b border-border/50 bg-white px-3 py-2.5 last:border-b-0">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className={cn("rounded-full text-[10px]", action.tone)}>
                                {action.label}
                              </Badge>
                              <span className="text-xs font-semibold text-foreground">
                              {event.source_date || new Intl.DateTimeFormat(tx("ru-RU", "de-DE")).format(new Date(event.created_at))}
                              </span>
                              {status ? <span className="text-xs text-muted-foreground">{localizedMedicationStatus(status, tx)}</span> : null}
                            </div>
                            <p className="mt-1 break-words text-xs font-medium leading-5 text-foreground">
                              {regimen || tx("Схема не указана", "Kein Schema angegeben")}
                            </p>
                          </div>
                          <div className="max-w-full text-right text-[11px] leading-5 text-muted-foreground">
                            <ClinicalRecordSource
                              item={event}
                              tx={tx}
                              className="ml-auto max-w-[360px] [&>button]:ml-auto [&>span]:ml-auto"
                            />
                            <p>
                              {[event.source_country, event.source_page ? `${tx("стр.", "S.")} ${event.source_page}` : null]
                                .filter(Boolean).join(" · ") || "—"}
                            </p>
                          </div>
                        </div>
                        {event.reviewed_by_name ? (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {tx("Проверил", "Geprüft von")}: {event.reviewed_by_name}
                          </p>
                        ) : null}
                        {event.source_raw_text ? (
                          <details className="mt-2 rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5">
                            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                              {tx("OCR-фрагмент", "OCR-Quelltext")}
                            </summary>
                            <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-foreground">
                              {event.source_raw_text}
                            </p>
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                  {group.events.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
                      {tx("Для текущей записи ещё нет OCR-событий.", "Für den aktuellen Eintrag gibt es noch keine OCR-Ereignisse.")}
                    </p>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
        {total > series.reduce((sum, group) => sum + group.events.length, 0) ? (
          <div className="flex justify-center pt-2">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {tx("Загрузить более ранние события", "Ältere Ereignisse laden")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function PatientClinicalTab({
  patientId,
  patientIdentity,
  canManage,
  documentImportOpen,
  onDocumentImportOpenChange,
  embedded = false,
}: {
  patientId: string;
  patientIdentity: {
    firstName?: string | null;
    lastName?: string | null;
    birthDate?: string | null;
    patientIdentifier?: string | null;
  };
  canManage: boolean;
  documentImportOpen: boolean;
  onDocumentImportOpenChange: (open: boolean) => void;
  embedded?: boolean;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [allergien, setAllergien] = useState<ClinicalWarning[]>([]);
  const [cave, setCave] = useState<ClinicalWarning[]>([]);
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [medications, setMedications] = useState<ClinicalMedication[]>([]);
  const [medicationImportHistory, setMedicationImportHistory] = useState<MedicationImportHistoryEvent[]>([]);
  const [medicationHistoryTotal, setMedicationHistoryTotal] = useState(0);
  const [medicationHistoryLoadingMore, setMedicationHistoryLoadingMore] = useState(false);
  const [examinations, setExaminations] = useState<ClinicalExamination[]>([]);
  const [procedures, setProcedures] = useState<ClinicalProcedure[]>([]);
  const [verlauf, setVerlauf] = useState<ClinicalVerlaufEntry[]>([]);
  const [narrative, setNarrative] = useState<ClinicalNarrative | null>(null);
  const [impfstatus, setImpfstatus] = useState<PatientImpfstatus | null>(null);
  const [impfstatusDraft, setImpfstatusDraft] = useState("");
  const [impfstatusBusy, setImpfstatusBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<PatientRecommendation[]>([]);
  const [vitalsHistory, setVitalsHistory] = useState<PatientVitalMeasurement[]>([]);
  const [labResults, setLabResults] = useState<PatientLabResult[]>([]);
  const [labPeriodDraft, setLabPeriodDraft] = useState({ dateFrom: "", dateTo: "" });
  const [labPeriodApplied, setLabPeriodApplied] = useState({ dateFrom: "", dateTo: "" });
  const labPeriodPatientIdRef = useRef<string | null>(null);
  const [riskScores, setRiskScores] = useState<PatientRiskScore[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [allDoctors, setAllDoctors] = useState<AllDoctorOption[]>([]);
  const [specializations, setSpecializations] = useState<SpecializationItem[]>([]);
  const [selectedSpecializationId, setSelectedSpecializationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [vitalsSheetOpen, setVitalsSheetOpen] = useState(false);
  const [vitalsEditor, setVitalsEditor] = useState<PatientVitalMeasurement | null>(null);
  const [labResultEditor, setLabResultEditor] = useState<PatientLabResult | null>(null);
  const [labResultDeleteTarget, setLabResultDeleteTarget] = useState<PatientLabResult | null>(null);
  const [riskScoreSheetOpen, setRiskScoreSheetOpen] = useState(false);
  const [riskScoreEditor, setRiskScoreEditor] = useState<PatientRiskScore | null>(null);
  const [vitalDeleteTarget, setVitalDeleteTarget] = useState<PatientVitalMeasurement | null>(null);
  const [riskScoreDeleteTarget, setRiskScoreDeleteTarget] = useState<PatientRiskScore | null>(null);
  const [clinicalDeleteBusy, setClinicalDeleteBusy] = useState(false);
  const [medicationHoldEditor, setMedicationHoldEditor] = useState<MedicationHoldEditor | null>(null);
  const [medicationHoldBusy, setMedicationHoldBusy] = useState(false);

  useEffect(() => {
    setSelectedSpecializationId(null);
  }, [patientId]);

  // Refetch when another client edits this patient's clinical record.
  useDebouncedRealtimeSubscription(["patient.clinical_updated"], (_event, events) => {
    if (events.some((event) => event.patient_id === patientId)) {
      setVersion((current) => current + 1);
    }
  });

  useEffect(() => {
    let active = true;
    // All setState happens in async callbacks (never synchronously in the effect
    // body) so the loading flag below stays as the initial value until data lands.
    Promise.all([
      fetchPatientClinical(patientId),
      fetchPatientRecommendations(patientId).catch(() => [] as PatientRecommendation[]),
      fetchProviders(CLINICAL_PROVIDER_QUERY).catch(() => [] as ProviderSummary[]),
      fetchAllDoctors().catch(() => [] as AllDoctorOption[]),
      fetchSpecializations().catch(() => [] as SpecializationItem[]),
      apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${patientId}/vitals`).catch(() => ({
        items: [] as PatientVitalMeasurement[],
      })),
      apiFetch<{ items: PatientLabResult[] }>(`/patients/${patientId}/lab-results`).catch(() => ({
        items: [] as PatientLabResult[],
      })),
      apiFetch<{ items: PatientRiskScore[] }>(`/patients/${patientId}/risk-scores`).catch(() => ({
        items: [] as PatientRiskScore[],
      })),
      fetchPatientMedicationImportHistory(patientId).catch(() => ({
        items: [] as MedicationImportHistoryEvent[],
        total: 0,
        limit: 200,
        offset: 0,
      })),
    ])
      .then(([clinical, recs, providerRows, doctorRows, specializationRows, vitals, labs, scores, medicationHistory]) => {
        if (!active) return;
        setAllergien(clinical.allergien ?? []);
        setCave(clinical.cave ?? []);
        setDiagnoses(clinical.diagnoses ?? []);
        setMedications(clinical.medications ?? []);
        setExaminations(clinical.examinations ?? []);
        setProcedures(clinical.procedures ?? []);
        setVerlauf((current) => mergeVerlaufDoctorAttribution(clinical.verlauf ?? [], current));
        setNarrative(clinical.narrative ?? null);
        setImpfstatus(clinical.impfstatus ?? null);
        setImpfstatusDraft(clinical.impfstatus?.status_text ?? "");
        setRecommendations(recs ?? []);
        setProviders(clinicalMedicalProviderRows(providerRows ?? []));
        setAllDoctors(doctorRows ?? []);
        setSpecializations(specializationRows ?? []);
        setVitalsHistory(Array.isArray(vitals?.items) ? vitals.items : []);
        const nextLabResults = Array.isArray(labs?.items) ? labs.items : [];
        setLabResults(nextLabResults);
        if (labPeriodPatientIdRef.current !== patientId) {
          const latestLabDate = patientLabLatestDate(nextLabResults);
          setLabPeriodDraft({ dateFrom: latestLabDate, dateTo: latestLabDate });
          setLabPeriodApplied({ dateFrom: "", dateTo: "" });
          labPeriodPatientIdRef.current = patientId;
        }
        setRiskScores(Array.isArray(scores?.items) ? scores.items : []);
        setMedicationImportHistory(Array.isArray(medicationHistory.items) ? medicationHistory.items : []);
        setMedicationHistoryTotal(medicationHistory.total ?? medicationHistory.items.length);
        setError("");
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : tx("Не удалось загрузить", "Laden fehlgeschlagen"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId, version]);

  const filteredLabResults = useMemo(
    () => filterPatientLabResultsByPeriod(
      labResults,
      labPeriodApplied.dateFrom,
      labPeriodApplied.dateTo,
    ),
    [labPeriodApplied.dateFrom, labPeriodApplied.dateTo, labResults],
  );

  const labResultGroups = useMemo(() => {
    return groupPatientLabResults(filteredLabResults);
  }, [filteredLabResults]);

  const labPeriodIsApplied = Boolean(labPeriodApplied.dateFrom || labPeriodApplied.dateTo);

  function applyLabPeriod() {
    if (!labPeriodDraft.dateFrom || !labPeriodDraft.dateTo) return;
    if (labPeriodDraft.dateFrom > labPeriodDraft.dateTo) {
      toast.error(tx("Дата начала должна быть не позже даты окончания.", "Das Startdatum darf nicht nach dem Enddatum liegen."));
      return;
    }
    setLabPeriodApplied(labPeriodDraft);
  }

  function resetLabPeriod() {
    const latestLabDate = patientLabLatestDate(labResults);
    setLabPeriodDraft({ dateFrom: latestLabDate, dateTo: latestLabDate });
    setLabPeriodApplied({ dateFrom: "", dateTo: "" });
  }

  const medicationHistorySeries = useMemo(
    () => groupMedicationImportHistory(medications, medicationImportHistory),
    [medicationImportHistory, medications],
  );
  async function loadMoreMedicationHistory() {
    if (medicationHistoryLoadingMore || medicationImportHistory.length >= medicationHistoryTotal) return;
    setMedicationHistoryLoadingMore(true);
    try {
      const page = await fetchPatientMedicationImportHistory(patientId, {
        limit: 200,
        offset: medicationImportHistory.length,
      });
      setMedicationImportHistory((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !existing.has(item.id))];
      });
      setMedicationHistoryTotal(page.total);
    } catch (historyError) {
      toast.error(
        historyError instanceof Error
          ? historyError.message
          : tx("Не вдалося завантажити історію медикаментів", "Medikationsverlauf konnte nicht geladen werden"),
      );
    } finally {
      setMedicationHistoryLoadingMore(false);
    }
  }

  const attributionRow = (item: ClinicalAttribution) => {
    const label = attributionLabel(item, lang);
    return label ? (
      <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-foreground">
        {tx("Назначил", "Verordnet von")}: {label}
      </p>
    ) : null;
  };

  const verlaufAttributionRow = (item: ClinicalVerlaufEntry) => {
    const hasDoctor = Boolean(item.doctor_id || item.doctor_name || item.doctor_title || item.doctor_fachbereich);
    const label = hasDoctor ? attributionLabel(item, lang) : null;
    if (label) {
      return (
        <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-foreground">
          {tx("Назначил", "Verordnet von")}: {label}
        </p>
      );
    }
    return item.provider_name ? (
      <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
        {tx("Провайдер", "Anbieter")}: {item.provider_name}
      </p>
    ) : null;
  };

  function openMedicationHoldEditor(index: number, medication: ClinicalMedication) {
    setMedicationHoldEditor({
      index,
      medication,
      draft: {
        on_hold: Boolean(medication.on_hold),
        hold_from: medication.hold_from ?? null,
        hold_until: medication.hold_until ?? null,
        hold_note: medication.hold_note ?? null,
      },
    });
  }

  async function applyClinicalDocumentCandidates(
    documentImport: ClinicalDocumentImport,
    candidates: ClinicalDocumentImportCandidate[],
    sourceCountry: string,
    candidatePayloads: ClinicalDocumentCandidatePayloads,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const importMarker = (candidateId: string) =>
      `[clinical-import:${documentImport.id}:${candidateId}]`;
    const importedDiagnoses = candidates
      .filter((item) => item.target === "diagnosis" && item.value.trim())
      .filter(
        (item) =>
          !diagnoses.some((existing) => existing.note?.includes(importMarker(item.id))),
      )
      .map((item): ClinicalDiagnosis => ({
        cid: `import-${documentImport.id}-${item.id}`,
        parent_cid: null,
        parent_id: null,
        kind: item.normalized.kind === "main" ? "main" : "secondary",
        label: item.value.trim(),
        specialization_ids: [],
        specializations: [],
        certainty: item.normalized.certainty === "verdacht" ? "verdacht" : "bestaetigt",
        chronifizierung: null,
        icd_code: typeof item.normalized.icd_code === "string" ? item.normalized.icd_code : null,
        ops_code: null,
        diagnosed_on: null,
        note: `Import: ${documentImport.document_name ?? documentImport.document_id}\n${importMarker(item.id)}`,
        red_flags: null,
        source_mode: "extern",
        external_clinic: null,
        external_doctor: null,
        external_country: sourceCountry,
        provider_id: null,
        provider_name: null,
        doctor_id: null,
        doctor_name: null,
        doctor_title: null,
        doctor_fachbereich: null,
        treating_doctor_id: null,
        treating_doctor_name: null,
        treating_doctor_title: null,
        treating_none: true,
      }));
    if (importedDiagnoses.length > 0) {
      await savePatientDiagnoses(patientId, importedDiagnoses, "merge");
      setDiagnoses((current) => [...current, ...importedDiagnoses]);
      counts.diagnoses = importedDiagnoses.length;
    }

    const importedMedicationResponses: ImportedMedicationResponse[] = [];
    for (const item of candidates.filter((candidate) => candidate.target === "medication")) {
      const payload = candidatePayloads[item.id];
      if (!payload || !("candidate_id" in payload) || payload.candidate_id !== item.id) {
        throw new Error(
          tx(
            "Для імпорту медикаменту потрібно вказати діючу речовину.",
            "Für den Medikamentenimport muss ein Wirkstoff angegeben werden.",
          ),
        );
      }
      importedMedicationResponses.push(
        await persistClinicalDocumentMedication(
          patientId,
          documentImport.id,
          payload as ImportedMedicationPayload,
        ),
      );
    }
    if (importedMedicationResponses.length > 0) {
      const [refreshedClinical, refreshedHistory] = await Promise.all([
        fetchPatientClinical(patientId),
        fetchPatientMedicationImportHistory(patientId),
      ]);
      setMedications(refreshedClinical.medications ?? []);
      setMedicationImportHistory(refreshedHistory.items ?? []);
      setMedicationHistoryTotal(refreshedHistory.total ?? refreshedHistory.items.length);
      counts.medications = importedMedicationResponses.length;
      const deduplicated = importedMedicationResponses.filter(
        (response) => response.action === "deduplicated",
      ).length;
      const regimenChanged = importedMedicationResponses.filter(
        (response) => response.action === "regimen_changed",
      ).length;
      const statusTransitions = importedMedicationResponses.filter(
        (response) => response.action === "status_transition",
      ).length;
      if (deduplicated > 0 || regimenChanged > 0 || statusTransitions > 0) {
        toast.info(
          tx(
            `Медикаменти: без дублювання — ${deduplicated}, нових схем — ${regimenChanged}, змін статусу — ${statusTransitions}.`,
            `Medikation: dedupliziert ${deduplicated}, neue Schemata ${regimenChanged}, Statuswechsel ${statusTransitions}.`,
          ),
          6_000,
        );
      }
      const matchCandidateCount = importedMedicationResponses.reduce(
        (sum, response) => sum + response.match_candidate_count,
        0,
      );
      if (matchCandidateCount > 0) {
        toast.info(
          tx(
            `Знайдено ${matchCandidateCount} кандидатів у каталозі ліків. Вони потребують окремої перевірки.`,
            `${matchCandidateCount} Arzneimittelkandidaten gefunden. Sie müssen separat geprüft werden.`,
          ),
          6_000,
        );
      }
    }

    const importedExaminations = candidates
      .filter((item) => item.target === "examination" && item.value.trim())
      .filter(
        (item) =>
          !examinations.some((existing) => existing.note?.includes(importMarker(item.id))),
      )
      .map((item): ClinicalExamination => ({
        kind: "other",
        title:
          typeof item.normalized.title === "string" && item.normalized.title.trim()
            ? item.normalized.title.trim()
            : item.source.section,
        performed_on: null,
        status: "final",
        result: item.value.trim(),
        note: `Import: ${documentImport.document_name ?? documentImport.document_id}\n${importMarker(item.id)}`,
        red_flags: null,
        specialization_ids: [],
        specializations: [],
        provider_id: null,
        provider_name: null,
        doctor_id: null,
        doctor_name: null,
        doctor_title: null,
        doctor_fachbereich: null,
      }));
    if (importedExaminations.length > 0) {
      const next = [...examinations, ...importedExaminations];
      await savePatientExaminations(patientId, next);
      setExaminations(next);
      counts.examinations = importedExaminations.length;
    }

    const importedLabResults = candidates
      .filter((item) => item.target === "lab_result")
      .filter(
        (item) =>
          !labResults.some(
            (existing) =>
              existing.source_import_id === documentImport.id &&
              existing.source_candidate_id === item.id,
          ),
    );
    for (const item of importedLabResults) {
      const payload = candidatePayloads[item.id];
      if (
        !payload ||
        !("analyte_name" in payload) ||
        payload.source_candidate_id !== item.id
      ) {
        throw new Error(
          tx(
            "Зафіксований payload аналізу відсутній або не збігається.",
            "Der vorbereitete Laborwert-Payload fehlt oder stimmt nicht überein.",
          ),
        );
      }
      await apiFetch(`/patients/${patientId}/lab-results`, {
        method: "POST",
        body: JSON.stringify(payload as ImportedLabResultPayload),
      });
    }
    if (importedLabResults.length > 0) {
      counts.lab_results = importedLabResults.length;
    }

    const importedVitals = candidates.filter((item) => item.target === "vital");
    for (const item of importedVitals) {
      const payload = candidatePayloads[item.id];
      if (
        !payload
        || !("bp_systolic" in payload)
        || payload.source_import_id !== documentImport.id
        || payload.source_candidate_id !== item.id
      ) {
        throw new Error(
          tx(
            "Зафиксированный payload показателей отсутствует или не совпадает.",
            "Der vorbereitete Vitalwert-Payload fehlt oder stimmt nicht überein.",
          ),
        );
      }
      await persistClinicalDocumentVital(patientId, payload as ImportedVitalPayload);
    }
    if (importedVitals.length > 0) {
      const refreshedVitals = await apiFetch<{ items: PatientVitalMeasurement[] }>(
        `/patients/${patientId}/vitals`,
        { cache: "no-store" },
      );
      setVitalsHistory(Array.isArray(refreshedVitals.items) ? refreshedVitals.items : []);
      counts.vitals = importedVitals.length;
    }

    const importedAnamnesis = candidates
      .filter((item) => item.target === "anamnesis" && item.value.trim())
      .map((item) => item.value.trim())
      .filter((value, index, values) => values.indexOf(value) === index);
    const currentAnamnesis = narrative?.anamnese_aktuelle ?? "";
    const unseenAnamnesis = importedAnamnesis
      .filter((value) => !currentAnamnesis.includes(value));
    const mergedAnamnesis = currentAnamnesis.trim()
      ? `${currentAnamnesis}\n\n${unseenAnamnesis.join("\n\n")}`
      : unseenAnamnesis.join("\n\n");
    if (unseenAnamnesis.length > 0) {
      const saved = await savePatientNarrative(patientId, {
        ...(narrative ?? {
          id: null,
          case_id: null,
          anamnese_vorgeschichte: null,
          anamnese_vegetative: null,
          anamnese_sozial: null,
          beurteilung: null,
          red_flags: null,
          specialization_ids: [],
          specializations: [],
          anamnese_at: new Date().toISOString(),
        }),
        anamnese_aktuelle: mergedAnamnesis,
        is_active: true,
      });
      setNarrative(saved);
      counts.anamnesis = 1;
    }

    const importedRecommendations = candidates
      .filter((item) => item.target === "recommendation" && item.value.trim())
      .filter(
        (item) =>
          !recommendations.some(
            (existing) =>
              existing.source_document_id === documentImport.document_id &&
              existing.description === item.value.trim(),
          ),
      );
    for (const item of importedRecommendations) {
      const saved = await createPatientRecommendation(patientId, {
        title: lang === "de" ? "Empfehlung aus Dokument" : "Рекомендация из документа",
        description: item.value.trim(),
        recommendation_type: "follow_up",
        priority: "normal",
        lifecycle_status: "aktiv",
        source_document_id: documentImport.document_id,
      });
      setRecommendations((current) => [...current, saved]);
    }
    if (importedRecommendations.length > 0) {
      counts.recommendations = importedRecommendations.length;
    }

    setVersion((current) => current + 1);
    return counts;
  }

  function updateMedicationHoldDraft(patch: Partial<MedicationHoldDraft>) {
    setMedicationHoldEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              ...patch,
            },
          }
        : current,
    );
  }

  async function submitMedicationHoldEditor() {
    if (!medicationHoldEditor) return;
    const draft = medicationHoldEditor.draft;
    const next = medications.map((item, index) =>
      index === medicationHoldEditor.index
        ? trimDraftStrings({
            ...updateClinicalMedicationLifecycle(item, { onHold: draft.on_hold }),
            hold_from: draft.on_hold ? draft.hold_from : null,
            hold_until: draft.on_hold ? draft.hold_until : null,
            hold_note: draft.on_hold ? draft.hold_note : null,
          })
        : item,
    );

    setMedicationHoldBusy(true);
    try {
      await savePatientMedications(patientId, next);
      setMedications(next);
      setMedicationHoldEditor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setMedicationHoldBusy(false);
    }
  }

  function reloadVitals() {
    apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${patientId}/vitals`)
      .then((res) => setVitalsHistory(Array.isArray(res?.items) ? res.items : []))
      .catch(() => setVersion((current) => current + 1));
  }

  function reloadRiskScores() {
    apiFetch<{ items: PatientRiskScore[] }>(`/patients/${patientId}/risk-scores`)
      .then((res) => setRiskScores(Array.isArray(res?.items) ? res.items : []))
      .catch(() => setVersion((current) => current + 1));
  }

  async function deleteVitalMeasurement() {
    if (!vitalDeleteTarget) return;
    if (patientVitalIsImported(vitalDeleteTarget)) {
      setVitalDeleteTarget(null);
      toast.error(
        tx(
          "Импортированные показатели нельзя удалить из истории документа.",
          "Importierte Vitalwerte können nicht aus dem Dokumentverlauf gelöscht werden.",
        ),
      );
      return;
    }
    setClinicalDeleteBusy(true);
    try {
      await apiFetch(
        `/patients/${patientId}/vitals/${vitalDeleteTarget.id}/delete`,
        { method: "POST" },
      );
      setVitalDeleteTarget(null);
      reloadVitals();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tx("Не удалось удалить показатель", "Vitalwert konnte nicht gelöscht werden"),
      );
    } finally {
      setClinicalDeleteBusy(false);
    }
  }

  async function deleteRiskScore() {
    if (!riskScoreDeleteTarget) return;
    setClinicalDeleteBusy(true);
    try {
      await apiFetch(
        `/patients/${patientId}/risk-scores/${riskScoreDeleteTarget.id}/delete`,
        { method: "POST" },
      );
      setRiskScoreDeleteTarget(null);
      reloadRiskScores();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tx("Не удалось удалить риск-скор", "Risikoscore konnte nicht gelöscht werden"),
      );
    } finally {
      setClinicalDeleteBusy(false);
    }
  }

  const attachedSpecializations = collectAttachedClinicalSpecializations(
    patientSpecializationRecords({ diagnoses, examinations, narrative }),
    specializations,
  );
  const activeSpecializationId = attachedSpecializations.some(
    (item) => item.id === selectedSpecializationId,
  )
    ? selectedSpecializationId
    : null;
  const visibleDiagnoses = filterClinicalDiagnosisTree(diagnoses, activeSpecializationId);
  const visibleExaminations = filterClinicalRecords(examinations, activeSpecializationId);
  const visibleNarrative = filterClinicalNarrative(narrative, activeSpecializationId);

  if (loading) {
    return (
      <ClinicalWrapper embedded={embedded} className={embedded ? "min-h-[120px]" : "mt-4 min-h-[400px]"}>
        <p className="py-10 text-center text-sm text-muted-foreground">{tx("Загрузка…", "Laden…")}</p>
      </ClinicalWrapper>
    );
  }

  return (
    <ClinicalWrapper
      embedded={embedded}
      className={embedded ? "space-y-4" : "mt-4 min-h-[400px] space-y-4"}
    >
      {/* PDF-Export (Medikationsplan / Arztbrief) — тимчасово вимкнено.
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            onClick={() => void downloadApiFile(`/patients/${patientId}/medikationsplan.pdf`, "medikationsplan.pdf")}
          >
            {tx("Медикаментозный план (PDF)", "Medikationsplan (PDF)")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            onClick={() => void downloadApiFile(`/patients/${patientId}/clinical.pdf`, "arztbrief.pdf")}
          >
            {tx("Экспорт Arztbrief (PDF)", "Arztbrief (PDF)")}
          </Button>
        </div>
      </div>
      */}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <section
        aria-label={tx("Фильтр специализаций", "Spezialisierungsfilter")}
        className="rounded-xl border border-border/70 bg-card px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              activeSpecializationId === null
                ? "border-amber-400 bg-amber-100 text-amber-900 ring-1 ring-amber-300/70"
                : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-900",
            )}
            aria-pressed={activeSpecializationId === null}
            onClick={() => setSelectedSpecializationId(null)}
          >
            {tx("Все специализации", "Alle Spezialisierungen")}
          </button>
          {attachedSpecializations.map((item) => {
            const selected = activeSpecializationId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  selected
                    ? "border-amber-400 bg-amber-100 text-amber-900 ring-1 ring-amber-300/70"
                    : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-900",
                )}
                aria-pressed={selected}
                onClick={() => setSelectedSpecializationId(item.id)}
              >
                {specializationLabelForItem(item, lang === "de" ? "de" : "ru")}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Allergien ---- */}
      <ClinicalSection<ClinicalWarning>
        title={tx("Аллергии", "Allergien")}
        items={allergien}
        blank={() => blankWarning("allergie")}
        isValid={(w) => w.label.trim() !== ""}
        canManage={canManage}
        tone="warning"
        tx={tx}
        onSave={async (next) => {
          await savePatientClinicalWarnings(patientId, "allergie", next);
          setAllergien(next);
        }}
        rowView={(w) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 max-w-full break-words text-sm font-medium text-orange-950">{w.label}</span>
              {w.severity ? (
                <span className="min-w-0 max-w-full break-words text-[11px] text-orange-800">
                  {localizedClinicalSeverity(w.severity, tx)}
                </span>
              ) : null}
            </div>
            {w.reaction ? (
              <p className="min-w-0 max-w-full break-words text-[11px] text-orange-800">{w.reaction}</p>
            ) : null}
            {w.note ? (
              <p className="min-w-0 max-w-full break-words text-[11px] text-orange-800">{w.note}</p>
            ) : null}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <Field label={tx("Аллерген", "Allergen")}>
              <Input
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                className={inputClass}
                placeholder={tx("Пенициллин", "Penicillin")}
              />
            </Field>
            <Field label={tx("Реакция", "Reaktion")}>
              <Input
                value={draft.reaction ?? ""}
                onChange={(e) => set({ reaction: blankToNull(e.target.value) })}
                className={inputClass}
                placeholder={tx("Сыпь, отёк", "Hautausschlag, Schwellung")}
              />
            </Field>
            <Field label={tx("Тяжесть", "Schweregrad")}>
              <Input
                value={draft.severity ?? ""}
                onChange={(e) => set({ severity: blankToNull(e.target.value) })}
                className={inputClass}
                placeholder={tx("лёгкая / средняя / тяжёлая", "leicht / mittel / schwer")}
              />
            </Field>
            <Field label={tx("Примечание", "Notiz")}>
              <Input
                value={draft.note ?? ""}
                onChange={(e) => set({ note: blankToNull(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      />

      {/* ---- CAVE ---- */}
      <ClinicalSection<ClinicalWarning>
        title={tx("CAVE", "CAVE")}
        items={cave}
        blank={() => blankWarning("cave")}
        isValid={(w) => w.label.trim() !== ""}
        canManage={canManage}
        tone="danger"
        tx={tx}
        onSave={async (next) => {
          await savePatientClinicalWarnings(patientId, "cave", next);
          setCave(next);
        }}
        rowView={(w) => (
          <div className="min-w-0 space-y-1">
            <span className="block min-w-0 max-w-full break-words text-sm font-medium text-rose-950">
              {w.label}
            </span>
            {w.note ? (
              <p className="min-w-0 max-w-full break-words text-[11px] text-rose-800">{w.note}</p>
            ) : null}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <Field label="CAVE">
              <Input
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                className={inputClass}
                placeholder={tx("Антикоагуляция", "Antikoagulation")}
              />
            </Field>
            <Field label={tx("Примечание", "Notiz")}>
              <Input
                value={draft.note ?? ""}
                onChange={(e) => set({ note: blankToNull(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      />

      <PatientSymptomsPainSections
        patientId={patientId}
        canManage={canManage}
        refreshKey={version}
      />

      {/* ---- Diagnoses (tree) ---- */}
      <DiagnosisTreeSection
        items={visibleDiagnoses}
        providers={providers}
        allDoctors={allDoctors}
        specializations={specializations}
        canManage={canManage && clinicalSpecializationFilterAllowsEditing(activeSpecializationId)}
        lang={lang}
        onSave={async (next) => {
          const merged = activeSpecializationId
            ? mergeFilteredClinicalRecords(diagnoses, visibleDiagnoses, next)
            : next;
          await savePatientDiagnoses(patientId, merged);
          setDiagnoses(merged);
        }}
      />

      <ClinicalDocumentImportSheet
        key={patientId}
        open={documentImportOpen}
        onOpenChange={onDocumentImportOpenChange}
        patientId={patientId}
        patientIdentity={patientIdentity}
        lang={lang}
        existingItems={{
          diagnosis: diagnoses.map((item, index) => ({
            id: item.id ?? item.cid ?? `diagnosis-${index}`,
            primary: item.label,
            secondary: item.icd_code,
          })),
          anamnesis: narrative
            ? [
                {
                  id: narrative.id ?? "active-anamnesis",
                  primary:
                    narrative.anamnese_aktuelle ??
                    narrative.anamnese_vorgeschichte ??
                    tx("Активная версия анамнеза", "Aktive Anamneseversion"),
                  secondary: narrative.beurteilung,
                },
              ]
            : [],
          medication: medications.map((item, index) => ({
            id: item.id ?? `medication-${index}`,
            primary: [item.handelsname, item.wirkstoff].filter(Boolean).join(" · "),
            secondary: [item.staerke, item.form].filter(Boolean).join(" · ") || null,
            medicationSeriesId: item.medication_series_id,
            medicationIdentity: item.wirkstoff,
          })),
          examination: examinations.map((item, index) => ({
            id: item.id ?? `examination-${index}`,
            primary: item.title,
            secondary: item.result,
          })),
          vital: vitalsHistory.map((item) => ({
            id: item.id,
            primary: patientVitalMetrics(item, {
              bloodPressure: tx("АД", "RR"),
              heartRate: tx("ЧСС", "Herzfrequenz"),
              temperature: tx("Темп.", "Temp."),
              oxygenSaturation: "SpO₂",
              respiratoryRate: tx("ЧД", "AF"),
              weight: tx("Вес", "Gewicht"),
              height: tx("Рост", "Größe"),
              bmi: "BMI",
              notSet: "—",
            }).map((metric) => `${metric.label}: ${metric.value}`).join(" · "),
            secondary: patientVitalDateTime(
              item.measured_at,
              item.measured_at,
              item.measured_at_precision,
            ),
          })),
          lab_result: labResults.map((item) => ({
            id: item.id,
            primary: `${item.analyte_name}: ${item.result_text}${item.unit ? ` ${item.unit}` : ""}`,
            secondary: patientVitalDateTime(
              item.measured_at,
              item.measured_at,
              item.measured_at_precision,
            ),
          })),
          recommendation: recommendations.map((item) => ({
            id: item.id,
            primary: item.title,
            secondary: item.description,
          })),
        }}
        onApply={applyClinicalDocumentCandidates}
      />

      {/* ---- Therapie / Procedures (OPS) ---- */}
      <ClinicalSection<ClinicalProcedure>
        title={tx("Терапия / Процедуры", "Therapie / Eingriffe")}
        items={procedures}
        sectionClassName="bg-slate-50/60"
        rowClassName="border-border/40 bg-white"
        blank={blankProcedure}
        isValid={(p) => p.label.trim() !== ""}
        canManage={canManage}
        tx={tx}
        onSave={async (next) => {
          await savePatientProcedures(patientId, next);
          setProcedures(next);
        }}
        rowView={(p) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {p.performed_on ? (
                <span className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
                  {p.performed_on}
                </span>
              ) : null}
              <span className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">{p.label}</span>
              {p.ops_code ? (
                <span className="min-w-0 max-w-full break-words font-mono text-[11px] text-muted-foreground">
                  ({p.ops_code})
                </span>
              ) : null}
            </div>
            {p.note ? (
              <p className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{p.note}</p>
            ) : null}
            {attributionRow(p)}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <Field label={tx("Терапия / Вмешательство", "Therapie / Eingriff")}>
              <Input
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                className={inputClass}
                placeholder="Appendektomie, laparoskopisch"
              />
            </Field>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="OPS">
                <Input
                  value={draft.ops_code ?? ""}
                  onChange={(e) => set({ ops_code: blankToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="5-470.10"
                />
              </Field>
              <Field label={tx("Дата", "Datum")}>
                <Input
                  type="date"
                  value={draft.performed_on ?? ""}
                  onChange={(e) => set({ performed_on: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Примечание", "Notiz")}>
              <Input
                value={draft.note ?? ""}
                onChange={(e) => set({ note: blankToNull(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalProcedure>)}
            />
          </div>
        )}
      />

      {/* ---- Anamnese (versioned) ---- */}
      <AnamneseSection
        active={visibleNarrative}
        specializations={specializations}
        canManage={canManage}
        lang={lang}
        onSave={async (next) => {
          const merged = mergeFilteredClinicalNarrative(
            narrative,
            next,
            activeSpecializationId,
          );
          const saved = await savePatientNarrative(patientId, merged);
          setNarrative(saved);
          setVersion((current) => current + 1);
        }}
        onDelete={async (narrativeId) => {
          const activeNarrative = await deletePatientNarrative(patientId, narrativeId);
          setNarrative(activeNarrative);
          setVersion((current) => current + 1);
        }}
        loadHistory={() => fetchNarrativeHistory(patientId)}
      />

      {/* ---- Verlauf ---- */}
      <ClinicalSection<ClinicalVerlaufEntry>
        title={tx("Течение", "Verlauf")}
        sectionClassName="bg-slate-50/60"
        rowClassName="border-border/40 bg-white"
        items={verlauf}
        blank={blankVerlaufEntry}
        isValid={(item) => item.note.trim() !== ""}
        canManage={canManage}
        tx={tx}
        onSave={async (next) => {
          await savePatientVerlauf(patientId, next);
          try {
            const clinical = await fetchPatientClinical(patientId);
            const saved = mergeVerlaufDoctorAttribution(clinical.verlauf ?? [], next);
            setVerlauf(saved);
            return saved;
          } catch {
            setVerlauf(next);
            setVersion((current) => current + 1);
            return next;
          }
        }}
        rowView={(item) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {item.occurred_on ? (
                <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                  {item.occurred_on}
                </span>
              ) : null}
            </div>
            <p className="min-w-0 max-w-full whitespace-pre-line break-words text-sm text-foreground">
              {item.note}
            </p>
            <ClinicalRecordSource item={item} tx={tx} />
            {verlaufAttributionRow(item)}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Дата", "Datum")}>
                <Input
                  type="date"
                  value={draft.occurred_on ?? ""}
                  onChange={(e) => set({ occurred_on: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalVerlaufEntry>)}
            />
            <Field label={tx("Заметки", "Notizen")}>
              <textarea
                value={draft.note}
                onChange={(e) => set({ note: e.target.value })}
                className={cn(inputClass, "h-28 py-2")}
              />
            </Field>
          </div>
        )}
      />

      {/* ---- Medications (Medikationsplan) ---- */}
      <ClinicalSection<ClinicalMedication>
        title={tx("Медикаменты", "Medikation")}
        headerAction={canManage ? (
          <MedicationBmpImportAction
            patientId={patientId}
            onImported={() => setVersion((current) => current + 1)}
          />
        ) : null}
        sectionClassName="bg-slate-50/60"
        rowClassName="border-border/40 bg-white"
        items={medications}
        blank={blankMedication}
        isValid={(m) =>
          Boolean(
            m.wirkstoff?.trim()
            && m.einnahmeform
            && m.form
            && medicationDateRangeValid(m),
          )
        }
        canManage={canManage}
        tx={tx}
        groups={[
          { key: "dauer", label: tx("Постоянная", "Dauermedikation") },
          { key: "besondere", label: tx("В особое время", "Zu besonderen Zeiten anzuwendende Medikamente") },
          { key: "selbst", label: tx("Самолечение", "Selbstmedikation") },
        ]}
        groupOf={(m) => m.category}
        onSave={async (next) => {
          await savePatientMedications(patientId, next);
          setMedications(next);
        }}
        listView={({ indexed, groups, groupOf, renderActions }) => (
          <PatientMedicationTable
            indexed={indexed}
            groups={groups}
            groupOf={groupOf}
            canManage={canManage}
            renderActions={(item, index) => {
              return (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "size-7 rounded-md p-0",
                      item.on_hold ? "text-emerald-700" : "text-amber-700",
                    )}
                    aria-label={
                      item.on_hold
                        ? tx("Снять с холда", "Hold entfernen")
                        : tx("Поставить на холд", "Auf Hold setzen")
                    }
                    title={
                      item.on_hold
                        ? tx("Снять с холда", "Hold entfernen")
                        : tx("Поставить на холд", "Auf Hold setzen")
                    }
                    disabled={medicationHoldBusy}
                    onClick={() => openMedicationHoldEditor(index, item)}
                  >
                    {item.on_hold ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}
                  </Button>
                  {renderActions(item, index)}
                </div>
              );
            }}
            tx={tx}
          />
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Категория", "Kategorie")}>
                <NativeComboboxSelect
                  value={draft.category}
                  aria-label={tx("Категория", "Kategorie")}
                  className={inputClass}
                  onChange={(e) => set({ category: e.target.value as ClinicalMedication["category"] })}
                >
                  <option value="dauer">{tx("Постоянная", "Dauermedikation")}</option>
                  <option value="besondere">{tx("По особым показаниям", "Zu besonderen Zeiten")}</option>
                  <option value="selbst">{tx("Самолечение", "Selbstmedikation")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Форма выпуска", "Darreichungsform")}>
                <NativeComboboxSelect
                  value={draft.form ?? ""}
                  required
                  aria-label={tx("Форма выпуска", "Darreichungsform")}
                  className={inputClass}
                  onChange={(e) => set({ form: e.target.value || null })}
                >
                  <option value="">—</option>
                  {DARREICHUNGSFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {draft.form &&
                  !DARREICHUNGSFORM_OPTIONS.some((option) => option.value === draft.form) ? (
                    <option value={draft.form}>{draft.form}</option>
                  ) : null}
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Способ применения", "Einnahmeform")}>
                <NativeComboboxSelect
                  value={draft.einnahmeform ?? ""}
                  required
                  aria-label={tx("Способ применения", "Einnahmeform")}
                  className={inputClass}
                  onChange={(e) => set({ einnahmeform: e.target.value || null })}
                >
                  <option value="">—</option>
                  {EINNAHMEFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Статус", "Status")}>
                <NativeComboboxSelect
                  value={draft.status}
                  aria-label={tx("Статус", "Status")}
                  className={inputClass}
                  onChange={(e) => set(updateClinicalMedicationLifecycle(draft, {
                    status: e.target.value as ClinicalMedication["status"],
                  }))}
                >
                  <option value="aktiv">{tx("Активный", "Aktiv")}</option>
                  <option value="pausiert">{tx("Приостановлен", "Pausiert")}</option>
                  <option value="abgesetzt">{tx("Отменён", "Abgesetzt")}</option>
                  <option value="geplant">{tx("Запланирован", "Geplant")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Торговое название", "Handelsname")}>
                <Input
                  value={draft.handelsname}
                  onChange={(e) => set({ handelsname: e.target.value })}
                  className={inputClass}
                  placeholder="Bisoprolol-ratiopharm"
                />
              </Field>
              <Field required label={tx("Действующее вещество", "Wirkstoff")}>
                <Input
                  required
                  value={draft.wirkstoff ?? ""}
                  onChange={(e) => set({ wirkstoff: blankToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Bisoprolol"
                />
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Дозировка", "Stärke")}>
                <Input
                  value={draft.staerke ?? ""}
                  onChange={(e) => set({ staerke: blankToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="5 mg"
                />
              </Field>
              <Field label={tx("Единица", "Einheit")}>
                <Input
                  value={draft.einheit ?? ""}
                  onChange={(e) => set({ einheit: blankToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Stück"
                />
              </Field>
            </div>
            <div>
              <FieldLabel>{tx("Приём: Утро · День · Вечер · Ночь", "Einnahme: Morgens · Mittags · Abends · zur Nacht")}</FieldLabel>
              <div className="grid grid-cols-4 gap-2">
                {(["dose_morgens", "dose_mittags", "dose_abends", "dose_nachts"] as const).map((key, idx) => (
                  <Input
                    key={key}
                    value={draft[key] ?? ""}
                    onChange={(e) => set({ [key]: blankToNull(e.target.value) } as Partial<ClinicalMedication>)}
                    className={cn(inputClass, "text-center")}
                    aria-label={
                      [
                        tx("Доза утром", "Dosis morgens"),
                        tx("Доза в обед", "Dosis mittags"),
                        tx("Доза вечером", "Dosis abends"),
                        tx("Доза на ночь", "Dosis zur Nacht"),
                      ][idx]
                    }
                    placeholder={["M", "Mi", "A", "N"][idx]}
                  />
                ))}
              </div>
            </div>
            <Field label={tx("Причина", "Grund")}>
              <Input
                value={draft.grund ?? ""}
                onChange={(e) => set({ grund: blankToNull(e.target.value) })}
                className={inputClass}
                placeholder="Bluthochdruck"
              />
            </Field>
            <Field label={tx("Указания", "Hinweise")}>
              <Input
                value={draft.hinweis ?? ""}
                onChange={(e) => set({ hinweis: blankToNull(e.target.value) })}
                className={inputClass}
                placeholder="Während oder nach den Mahlzeiten"
              />
            </Field>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label={tx("Дата назначения", "Verordnet am")}>
                <Input
                  type="date"
                  value={draft.verordnet_am ?? ""}
                  onChange={(e) => set({ verordnet_am: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Приём с", "Einnahme von")}>
                <Input
                  type="date"
                  value={draft.einnahme_von ?? ""}
                  onChange={(e) => set({ einnahme_von: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Приём до", "Einnahme bis")}>
                <Input
                  type="date"
                  min={draft.einnahme_von ?? undefined}
                  aria-invalid={!medicationDateRangeValid(draft)}
                  value={draft.einnahme_bis ?? ""}
                  onChange={(e) => set({ einnahme_bis: blankToNull(e.target.value) })}
                  className={cn(
                    inputClass,
                    !medicationDateRangeValid(draft) && "border-destructive",
                  )}
                />
              </Field>
            </div>
            {!medicationDateRangeValid(draft) ? (
              <p role="alert" className="text-xs text-destructive">
                {tx(
                  "Дата окончания не может быть раньше даты начала.",
                  "Das Enddatum darf nicht vor dem Startdatum liegen.",
                )}
              </p>
            ) : null}
            <fieldset className="rounded-lg border border-border/60 p-2">
              <legend className="px-1 text-[11px] font-medium text-muted-foreground">
                {tx("Правовой статус", "Rechtlicher Status")}
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <CheckboxField
                  label={tx("Аптечный", "Apothekenpflichtig")}
                  checked={draft.apothekenpflichtig}
                  onChange={(checked) => set({ apothekenpflichtig: checked })}
                />
                <CheckboxField
                  label={tx("Рецептурный", "Rezeptpflichtig")}
                  checked={draft.rezeptpflichtig}
                  onChange={(checked) => set({ rezeptpflichtig: checked })}
                />
                <CheckboxField
                  label={tx("Наркотическое (BTM)", "Betäubungsmittel (BTM)")}
                  checked={draft.btm}
                  onChange={(checked) => set({ btm: checked })}
                />
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-border/60 p-2">
              <legend className="px-1 text-[11px] font-medium text-muted-foreground">
                {tx("Предупреждения", "Warnhinweise")}
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <CheckboxField
                  label={tx("Aut-Idem-блок", "Aut-Idem-Sperre")}
                  checked={draft.aut_idem_sperre}
                  onChange={(checked) => set({ aut_idem_sperre: checked })}
                />
                <CheckboxField
                  label={tx("Огранич. отпуска", "Abgabebeschränkung")}
                  checked={draft.abgabebeschraenkung}
                  onChange={(checked) => set({ abgabebeschraenkung: checked })}
                />
                <CheckboxField
                  label={tx("Прочие пометки", "Sonstige Vermerke")}
                  checked={draft.sonstige_vermerke !== null}
                  onChange={(checked) => set({ sonstige_vermerke: checked ? (draft.sonstige_vermerke ?? "") : null })}
                />
              </div>
              {draft.sonstige_vermerke !== null ? (
                <Input
                  value={draft.sonstige_vermerke}
                  onChange={(e) => set({ sonstige_vermerke: e.target.value })}
                  className={cn(inputClass, "mt-2")}
                  aria-label={tx("Прочие пометки", "Sonstige Vermerke")}
                  placeholder={tx("Прочие пометки", "Sonstige Vermerke")}
                />
              ) : null}
            </fieldset>
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalMedication>)}
            />
          </div>
        )}
      />
      <MedicationHoldDialog
        editor={medicationHoldEditor}
        busy={medicationHoldBusy}
        tx={tx}
        onChange={updateMedicationHoldDraft}
        onClose={() => {
          if (!medicationHoldBusy) setMedicationHoldEditor(null);
        }}
        onSubmit={() => void submitMedicationHoldEditor()}
      />
      <MedicationHistoryTree
        series={medicationHistorySeries}
        total={medicationHistoryTotal}
        loadingMore={medicationHistoryLoadingMore}
        tx={tx}
        onLoadMore={() => void loadMoreMedicationHistory()}
      />

      {/* ---- Examinations / Befunde ---- */}
      <ClinicalSection<ClinicalExamination>
        title={tx("Обследования", "Befunde")}
        sectionClassName="bg-slate-50/60"
        rowClassName="border-border/40 bg-white"
        items={visibleExaminations}
        blank={blankExamination}
        isValid={(e) => e.title.trim() !== ""}
        canManage={canManage}
        tx={tx}
        onSave={async (next) => {
          const merged = activeSpecializationId
            ? mergeFilteredClinicalRecords(examinations, visibleExaminations, next)
            : next;
          await savePatientExaminations(patientId, merged);
          setExaminations(merged);
        }}
        rowView={(e) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">{e.title}</span>
              {e.performed_on ? (
                <span className={datePillClass}>
                  {e.performed_on}
                </span>
              ) : null}
              {e.status === "pending" ? (
                <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-[10px] text-amber-700">
                  {tx("Ожидается", "Ausstehend")}
                </Badge>
              ) : null}
            </div>
            {e.result ? (
              <p className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{e.result}</p>
            ) : null}
            {(e.specializations ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(e.specializations ?? []).map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                  >
                    {specializationLabelForItem(item, lang === "de" ? "de" : "ru")}
                  </span>
                ))}
              </div>
            ) : null}
            {e.red_flags ? (
              <p className="min-w-0 max-w-full break-words rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
                <span className="font-semibold">
                  {tx("Тревожные признаки", "Warnzeichen")}:
                </span>{" "}
                {e.red_flags}
              </p>
            ) : null}
            <ClinicalRecordSource item={e} tx={tx} />
            {attributionRow(e)}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Тип", "Art")}>
                <NativeComboboxSelect
                  value={draft.kind ?? ""}
                  aria-label={tx("Тип", "Art")}
                  className={inputClass}
                  onChange={(e) => set({ kind: (e.target.value || null) as ClinicalExamination["kind"] })}
                >
                  <option value="">—</option>
                  <option value="sonography">Sonografie</option>
                  <option value="lab">Labor</option>
                  <option value="histology">Histologie</option>
                  <option value="ecg">EKG</option>
                  <option value="microbiology">Mikrobiologie</option>
                  <option value="radiology">Röntgen</option>
                  <option value="exam">{tx("Осмотр", "Untersuchung")}</option>
                  <option value="other">{tx("Другое", "Sonstige")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Статус", "Status")}>
                <NativeComboboxSelect
                  value={draft.status}
                  aria-label={tx("Статус", "Status")}
                  className={inputClass}
                  onChange={(e) => set({ status: e.target.value as ClinicalExamination["status"] })}
                >
                  <option value="final">{tx("Готов", "Final")}</option>
                  <option value="pending">{tx("Ожидается", "Ausstehend")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Название", "Titel")}>
                <Input
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className={inputClass}
                  placeholder="Röntgen-Thorax"
                />
              </Field>
              <Field label={tx("Дата", "Datum")}>
                <Input
                  type="date"
                  value={draft.performed_on ?? ""}
                  onChange={(e) => set({ performed_on: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Результат / Befund", "Befund")}>
              <textarea
                value={draft.result ?? ""}
                onChange={(e) => set({ result: blankToNull(e.target.value) })}
                className={cn(inputClass, "h-[136px] py-2")}
                placeholder={tx("Описание результата", "Befundtext")}
              />
            </Field>
            <Field label={tx("Специализации", "Spezialisierungen")}>
              <ClinicalSpecializationsField
                ids={draft.specialization_ids ?? []}
                selected={draft.specializations ?? []}
                options={specializations}
                lang={lang}
                tx={tx}
                onChange={(specializationIds, selectedItems) =>
                  set({
                    specialization_ids: specializationIds,
                    specializations: selectedItems,
                  })
                }
              />
            </Field>
            <Field label={tx("Тревожные признаки", "Warnzeichen")}>
              <textarea
                value={draft.red_flags ?? ""}
                onChange={(e) => set({ red_flags: blankToNull(e.target.value) })}
                className={cn(inputClass, "h-24 py-2")}
                placeholder={tx(
                  "Тревожные признаки и особые риски",
                  "Warnzeichen und besondere Risiken",
                )}
              />
            </Field>
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalExamination>)}
            />
          </div>
        )}
      />

      {/* ---- Impfstatus (patient state, moved from the case per RFC D4) ---- */}
      <section className="rounded-xl border border-border/70 bg-slate-50/60">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
            <h3 className="text-sm font-semibold text-foreground">
              {tx("Статус вакцинации", "Impfstatus")}
            </h3>
            {impfstatus?.updated_at ? (
              <span className="text-[11px] text-muted-foreground">
                {cachedDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
                  dateStyle: "medium",
                }).format(new Date(impfstatus.updated_at))}
              </span>
            ) : null}
          </div>
        </header>
        <div className="space-y-3 p-4">
          <textarea
            value={impfstatusDraft}
            onChange={(e) => setImpfstatusDraft(e.target.value)}
            className={cn(inputClass, "h-24 border-border/40 bg-white py-2")}
            placeholder={tx(
              "Свободный текст о статусе вакцинации",
              "Freitext zum Impfstatus",
            )}
            disabled={!canManage || impfstatusBusy}
          />
          {canManage ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8 rounded-lg"
                disabled={
                  impfstatusBusy ||
                  impfstatusDraft.trim() === (impfstatus?.status_text ?? "").trim()
                }
                onClick={async () => {
                  setImpfstatusBusy(true);
                  try {
                    await savePatientImpfstatus(
                      patientId,
                      impfstatusDraft.trim() || null,
                    );
                    setVersion((current) => current + 1);
                  } catch (err: unknown) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : tx("Не удалось сохранить", "Speichern fehlgeschlagen"),
                    );
                  } finally {
                    setImpfstatusBusy(false);
                  }
                }}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---- Vitalwerte-Verlauf (moved from Profile) ---- */}
      {(canManage || vitalsHistory.length > 0) && (
      <section className="rounded-xl border border-border/70 bg-slate-50/60">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
            <h3 className="text-sm font-semibold text-foreground">{tx("История показателей", "Vitalwerte-Verlauf")}</h3>
            <Badge variant="outline" className="rounded-full border-border/60 bg-muted/25 text-foreground">
              {vitalsHistory.length} {tx("Записи", "Einträge")}
            </Badge>
          </div>
          {canManage ? (
            <Button
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => {
                setVitalsEditor(null);
                setVitalsSheetOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              {tx("Добавить", "Hinzufügen")}
            </Button>
          ) : null}
        </header>

        <div className="space-y-3 p-3">
          {vitalsHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
              {tx(
                "Для этого пациента пока не зафиксированы показатели.",
                "Für diesen Patienten wurden noch keine Vitalwerte dokumentiert.",
              )}
            </div>
          ) : null}

          {vitalsHistory.length > 0 ? (
            <PatientVitalsHistoryTable
              rows={vitalsHistory}
              canManage={canManage}
              tx={tx}
              onEdit={(item) => {
                setVitalsEditor(item);
                setVitalsSheetOpen(true);
              }}
              onDelete={setVitalDeleteTarget}
            />
          ) : null}
        </div>
      </section>
      )}

      {/* ---- Structured laboratory history ---- */}
      {canManage || labResults.length > 0 ? (
        <section className="rounded-xl border border-border/70 bg-slate-50/60">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
              <h3 className="text-sm font-semibold text-foreground">{tx("История анализов", "Laborverlauf")}</h3>
              <CountBadge>{labResultGroups.length} {tx("показателей", "Parameter")}</CountBadge>
            </div>
            <Badge variant="outline" className="rounded-full border-cyan-200 bg-cyan-50 text-cyan-800">
              {filteredLabResults.length}
              {labPeriodIsApplied ? ` / ${labResults.length}` : ""} {tx("результатов", "Ergebnisse")}
            </Badge>
          </header>

          <div className="grid items-end gap-2.5 border-b border-border/50 bg-white px-3 py-3 sm:grid-cols-[minmax(150px,220px)_minmax(150px,220px)_auto]">
            <Field label={tx("С", "Von")}>
              <Input
                type="date"
                value={labPeriodDraft.dateFrom}
                max={labPeriodDraft.dateTo || undefined}
                onChange={(event) => setLabPeriodDraft((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }))}
                className="h-9 rounded-lg border-border/60 bg-white"
              />
            </Field>
            <Field label={tx("По", "Bis")}>
              <Input
                type="date"
                value={labPeriodDraft.dateTo}
                min={labPeriodDraft.dateFrom || undefined}
                onChange={(event) => setLabPeriodDraft((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }))}
                className="h-9 rounded-lg border-border/60 bg-white"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-lg px-4"
                disabled={!labPeriodDraft.dateFrom || !labPeriodDraft.dateTo || labResults.length === 0}
                onClick={applyLabPeriod}
              >
                {tx("Выполнить", "Anwenden")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 rounded-lg px-4"
                disabled={labResults.length === 0}
                onClick={resetLabPeriod}
              >
                {tx("Сбросить", "Zurücksetzen")}
              </Button>
            </div>
          </div>

          <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
            {labResultGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                {labResults.length === 0
                  ? tx(
                      "Анализов пока нет. Загрузите лабораторный документ через OCR-билдер, чтобы создать историю.",
                      "Noch keine Laborwerte. Laden Sie einen Laborbefund über den OCR-Builder hoch, um den Verlauf anzulegen.",
                    )
                  : tx(
                      "За выбранный период результатов нет.",
                      "Für den gewählten Zeitraum liegen keine Ergebnisse vor.",
                    )}
              </div>
            ) : null}
            {labResultGroups.map((group, groupIndex) => {
              const latest = group.rows[0];
              return (
                <details
                  key={group.name.toLocaleLowerCase()}
                  open={groupIndex === 0}
                  className="group overflow-hidden rounded-lg border border-border/60 bg-white"
                >
                  <summary className="grid cursor-pointer list-none gap-2 px-3 py-2.5 sm:grid-cols-[minmax(220px,300px)_140px_minmax(0,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{group.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {group.rows.length} {tx("измерений", "Messungen")}
                        </span>
                        <span className={datePillClass}>
                          {patientVitalDateTime(
                            latest.measured_at,
                            latest.measured_at,
                            latest.measured_at_precision,
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {latest.result_text}{latest.unit ? ` ${latest.unit}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center">
                      {latest.abnormal_flag !== "normal" && latest.abnormal_flag !== "unknown" ? (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                          {tx("Отклонение", "Auffällig")}
                        </Badge>
                      ) : null}
                    </div>
                    <span aria-hidden className="text-xs text-muted-foreground transition-transform group-open:rotate-90">›</span>
                  </summary>

                  <div className="border-t border-border/50 bg-slate-50/40 p-1.5">
                    <PatientLabHistoryTable
                      rows={group.rows}
                      storageKey={`patient-clinical:lab-history:${group.name.toLocaleLowerCase()}`}
                      canManage={canManage}
                      tx={tx}
                      onEdit={setLabResultEditor}
                      onDelete={setLabResultDeleteTarget}
                    />
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---- Risikoscores (moved from Profile) ---- */}
      {(canManage || riskScores.length > 0) && (
      <section className="rounded-xl border border-border/70 bg-slate-50/60">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
            <h3 className="text-sm font-semibold text-foreground">{tx("Риск-скоры", "Risikoscores")}</h3>
            <CountBadge>
              {riskScores.length} {tx("Оценки", "Scores")}
            </CountBadge>
          </div>
          {canManage ? (
            <Button
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => {
                setRiskScoreEditor(null);
                setRiskScoreSheetOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              {tx("Добавить", "Hinzufügen")}
            </Button>
          ) : null}
        </header>

        <div className="space-y-3 p-3">
          {riskScores.length === 0 ? (
            <EmptyCell>
              {tx(
                "Для этого пациента пока нет риск-скоров.",
                "Für diesen Patienten wurden noch keine Risikoscores erfasst.",
              )}
            </EmptyCell>
          ) : (
            <PatientRiskScoresTable
              rows={riskScores}
              canManage={canManage}
              tx={tx}
              onEdit={(score) => {
                setRiskScoreEditor(score);
                setRiskScoreSheetOpen(true);
              }}
              onDelete={setRiskScoreDeleteTarget}
            />
          )}
        </div>
      </section>
      )}

      {canManage ? (
        <>
          <PatientLabResultEditSheet
            patientId={patientId}
            item={labResultEditor}
            open={Boolean(labResultEditor)}
            onOpenChange={(open) => {
              if (!open) setLabResultEditor(null);
            }}
            onSaved={(updated) => {
              setLabResults((current) =>
                current.map((item) => (item.id === updated.id ? updated : item)),
              );
              setLabResultEditor(null);
            }}
          />
          <PatientLabResultDeleteSheet
            patientId={patientId}
            item={labResultDeleteTarget}
            open={Boolean(labResultDeleteTarget)}
            onOpenChange={(open) => {
              if (!open) setLabResultDeleteTarget(null);
            }}
            onDeleted={(labResultId) => {
              setLabResults((current) => current.filter((item) => item.id !== labResultId));
              setLabResultDeleteTarget(null);
            }}
          />
        </>
      ) : null}

      {canManage && vitalsSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientVitalsSheet
            patientId={patientId}
            initialMeasurement={vitalsEditor}
            open={vitalsSheetOpen}
            onOpenChange={(open) => {
              setVitalsSheetOpen(open);
              if (!open) setVitalsEditor(null);
            }}
            onSaved={reloadVitals}
          />
        </Suspense>
      ) : null}

      {canManage && riskScoreSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientRiskScoreSheet
            patientId={patientId}
            initialScore={riskScoreEditor}
            open={riskScoreSheetOpen}
            onOpenChange={(open) => {
              setRiskScoreSheetOpen(open);
              if (!open) setRiskScoreEditor(null);
            }}
            onSaved={reloadRiskScores}
          />
        </Suspense>
      ) : null}

      <DirtyDismissConfirmDialog
        open={Boolean(vitalDeleteTarget)}
        title={tx("Удалить показатель?", "Vitalwert löschen?")}
        message={tx(
          "Запись будет удалена из истории показателей пациента.",
          "Der Eintrag wird aus dem Vitalwerte-Verlauf des Patienten gelöscht.",
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={
          clinicalDeleteBusy
            ? tx("Удаление…", "Löschen…")
            : tx("Удалить", "Löschen")
        }
        onCancel={() => {
          if (!clinicalDeleteBusy) setVitalDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!clinicalDeleteBusy) void deleteVitalMeasurement();
        }}
      />

      <DirtyDismissConfirmDialog
        open={Boolean(riskScoreDeleteTarget)}
        title={tx("Удалить риск-скор?", "Risikoscore löschen?")}
        message={tx(
          "Оценка риска и её входные данные будут удалены.",
          "Der Risikoscore und seine Eingabedaten werden gelöscht.",
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={
          clinicalDeleteBusy
            ? tx("Удаление…", "Löschen…")
            : tx("Удалить", "Löschen")
        }
        onCancel={() => {
          if (!clinicalDeleteBusy) setRiskScoreDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!clinicalDeleteBusy) void deleteRiskScore();
        }}
      />

      {/* ---- Recommendations (Empfehlungen) — admin CRUD ---- */}
      <PatientRecommendationsSection
        recommendations={recommendations}
        allDoctors={allDoctors}
        patientId={patientId}
        canManage={canManage}
        lang={lang}
        tx={tx}
        onReload={() => {
          fetchPatientRecommendations(patientId)
            .then((recs) => setRecommendations(recs ?? []))
            .catch(() => setVersion((current) => current + 1));
        }}
      />
    </ClinicalWrapper>
  );
}

export function PatientMedicationEquivalentsBlock({
  patientId,
  medications,
  tx,
}: {
  patientId: string;
  medications: ClinicalMedication[];
  tx: Bilingual;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [candidates, setCandidates] = useState<GermanEquivalent[]>([]);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const persisted = medications.filter((m): m is ClinicalMedication & { id: string } =>
    Boolean(m.id),
  );
  const selected = persisted.find((m) => m.id === selectedId) ?? persisted[0] ?? null;
  if (persisted.length === 0) return null;

  const resetResults = () => {
    setCandidates([]);
    setSearchCompleted(false);
    setError("");
  };

  const findEquivalents = async (include = includeCandidates) => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPatientMedicationEquivalents(patientId, selected.id, include);
      setCandidates(payload.candidates);
      setSearchCompleted(true);
    } catch (findError) {
      setCandidates([]);
      setSearchCompleted(false);
      setError(
        findError instanceof Error
          ? findError.message
          : tx("Не удалось загрузить эквиваленты.", "Äquivalente konnten nicht geladen werden."),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="grid gap-2">
        <Field label={tx("Медикамент для проверки эквивалентов", "Medikament für Äquivalent-Prüfung")}>
          <NativeComboboxSelect
            value={selected?.id ?? ""}
            aria-label={tx("Медикамент для проверки эквивалентов", "Medikament für Äquivalent-Prüfung")}
            className={inputClass}
            onChange={(e) => {
              setSelectedId(e.target.value || null);
              resetResults();
            }}
          >
            {persisted.map((m) => (
              <option key={m.id} value={m.id}>
                {m.handelsname || m.wirkstoff || "—"}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
      </div>

      <MedicationEquivalentsPanel
        medicationName={selected?.handelsname || selected?.wirkstoff || "—"}
        medicationSubstance={selected?.wirkstoff}
        candidates={candidates}
        includeCandidates={includeCandidates}
        searchCompleted={searchCompleted}
        loading={loading}
        error={error}
        verifyingEquivalentId={null}
        onFind={() => void findEquivalents()}
        onToggleCandidates={(include) => {
          setIncludeCandidates(include);
          if (searchCompleted) void findEquivalents(include);
        }}
      />
    </section>
  );
}
