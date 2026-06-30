import { Fragment, lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountBadge, EmptyCell } from "@/components/ui-shell";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { PauseCircle, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import { fetchProviders } from "@/pages/providers/data/provider-api";
import { specializationLabelForValue } from "@/pages/providers/model/specialization-labels";
import type { ProviderSummary } from "@/pages/providers/model/types";
import type {
  PatientRiskScore,
  PatientVitalMeasurement,
} from "../../model/detail-resource-types";

import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
  darreichungsformLabel,
} from "../../data/medication-options";

import {
  blankNarrative,
  createPatientRecommendation,
  deletePatientRecommendation,
  fetchAllDoctors,
  fetchNarrativeHistory,
  fetchPatientClinical,
  fetchPatientRecommendations,
  savePatientClinicalWarnings,
  savePatientDiagnoses,
  savePatientExaminations,
  savePatientMedications,
  savePatientNarrative,
  savePatientProcedures,
  savePatientVerlauf,
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
  type PatientRecommendation,
  type RecommendationLifecycleStatus,
} from "@/pages/patients/data/patient-clinical";

import { AnamneseSection } from "./anamnese-section";
import { DiagnosisTreeSection } from "./diagnosis-tree";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

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

function patientVitalDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
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

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const datePillClass =
  "inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700";

export const CLINICAL_PROVIDER_QUERY = "/providers?active_only=true&provider_type=medical";

export function clinicalMedicalProviderRows(providers: ProviderSummary[]): ProviderSummary[] {
  return providers.filter((provider) => provider.provider_type === "medical");
}

type ClinicalSectionGroup = { key: string; label: string };
type ClinicalSectionTone = "neutral" | "danger" | "warning";
type IndexedClinicalItem<T> = { item: T; index: number };
type MedicationHoldDraft = Pick<ClinicalMedication, "on_hold" | "hold_until" | "hold_note">;
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

function uniqueAllDoctorOptions(doctors: AllDoctorOption[]): AllDoctorOption[] {
  const byId = new Map<string, { doctor: AllDoctorOption; providers: string[] }>();
  doctors.forEach((doctor) => {
    const existing = byId.get(doctor.id);
    const providerName = doctor.provider_name?.trim();
    if (!existing) {
      byId.set(doctor.id, {
        doctor,
        providers: providerName ? [providerName] : [],
      });
      return;
    }
    if (providerName && !existing.providers.includes(providerName)) {
      existing.providers.push(providerName);
    }
  });

  return Array.from(byId.values()).map(({ doctor, providers }) => ({
    ...doctor,
    provider_name: providers.length > 0 ? providers.join(", ") : doctor.provider_name,
  }));
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
  const columnCount = canManage ? 12 : 11;
  const doseCell = (value: string | null) => (value && value.trim() ? value.trim() : "");

  // Design-system table styling (soft borders, muted header, hover rows).
  const headCell = "px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const headDoseCell = "px-1.5 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const bodyCell = "break-words px-2.5 py-2 align-top text-foreground";
  const bodyDoseCell = "px-1.5 py-2 text-center align-top font-mono tabular-nums text-foreground";

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
        <thead className="border-b border-border bg-muted/40">
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
            {canManage ? (
              <th scope="col" className="px-2 py-2 text-right">
                <span className="sr-only">{tx("Действия", "Aktionen")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label && section.key !== "dauer" ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="bg-muted/40 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {section.label}
                  </td>
                </tr>
              ) : null}
              {section.rows.map(({ item, index }) => {
                const attribution = attributionLabel(item);
                return (
                  <tr
                    key={item.id ?? index}
                    className={cn("transition-colors", item.on_hold ? "bg-amber-50/70" : "hover:bg-muted/30")}
                  >
                    <td className={cn(bodyCell, "whitespace-pre-line")}>{item.wirkstoff || "—"}</td>
                    <td className={cn(bodyCell, "font-medium")}>
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                      {item.on_hold ? (
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          {tx("На холд", "Auf Hold")}
                          {item.hold_until ? ` ${tx("до", "bis")} ${item.hold_until}` : ""}
                        </span>
                      ) : null}
                      {item.on_hold && item.hold_note ? (
                        <span className="mt-0.5 block break-words text-[10px] text-amber-800">
                          {item.hold_note}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(bodyCell, "whitespace-pre-line font-mono")}>{item.staerke || ""}</td>
                    <td className={cn(bodyCell, "whitespace-pre-line")}>
                      {darreichungsformLabel(item.form)}
                    </td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_morgens)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_mittags)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_abends)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_nachts)}</td>
                    <td className={cn(bodyCell, "whitespace-nowrap")}>{item.einheit || ""}</td>
                    <td className={bodyCell}>
                      {item.hinweis ? <span className="whitespace-pre-line break-words">{item.hinweis}</span> : null}
                      {attribution ? (
                        <span className="mt-0.5 block break-words text-[10px] text-muted-foreground">{attribution}</span>
                      ) : null}
                    </td>
                    <td className={bodyCell}>{item.grund || ""}</td>
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
      )}
    >
      <div className="min-w-0">{rowView ? rowView(item) : null}</div>
      {renderActions(item, index)}
    </div>
  );

  const indexed = list.map((item, index) => ({ item, index }));

  return (
    <section className={cn("rounded-xl border", toneClasses.section)}>
      <header className={cn("flex items-center justify-between gap-3 border-b px-4 py-3", toneClasses.header)}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {count ?? <Badge variant="outline" className="rounded-full text-[11px]">{list.length}</Badge>}
        </div>
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
      </header>

      <div className="space-y-1.5 p-3">
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
function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
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
  const medicationName = editor?.medication.handelsname?.trim();

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
                    hold_until: checked ? draft.hold_until : null,
                    hold_note: checked ? draft.hold_note : null,
                  })
                }
              />

              {draft.on_hold ? (
                <div className="grid gap-3">
                  <Field label={tx("До какого числа", "Bis wann")}>
                    <Input
                      type="date"
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
            <Button type="submit" size="sm" className="h-8 rounded-lg" disabled={busy || !draft}>
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
      return "border-zinc-300 bg-zinc-50 text-zinc-600";
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
  const doctorOptions = uniqueAllDoctorOptions(allDoctors);
  const lifecycleLabel = (value: RecommendationLifecycleStatus) => {
    const option = LIFECYCLE_OPTIONS.find((o) => o.value === value);
    return option ? tx(option.ru, option.de) : value;
  };
  const doctorName = (rec: PatientRecommendation) => recommendationDoctorLabel(rec, doctorOptions, lang);
  const validityLabel = (rec: PatientRecommendation) =>
    [rec.valid_from, rec.valid_to].some(Boolean)
      ? `${rec.valid_from ?? "…"} – ${rec.valid_to ?? "…"}`
      : null;
  const recommendationDateLabels = (rec: PatientRecommendation) =>
    [rec.recommended_on, validityLabel(rec), rec.due_at ? rec.due_at.slice(0, 10) : null].filter(
      (value): value is string => Boolean(value),
    );

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
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border border-border/50 px-3 py-2",
        muted ? "bg-muted/40" : "bg-background",
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
          {recommendationDateLabels(rec).map((date, index) => (
            <span key={`${date}-${index}`} className={datePillClass}>
              {date}
            </span>
          ))}
        </div>
        {rec.description ? (
          <p className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{rec.description}</p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          {doctorName(rec) ? (
            <span className="min-w-0 max-w-full break-words text-foreground">{doctorName(rec)}</span>
          ) : null}
        </div>
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
    <section className="rounded-xl border border-border/70 bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
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

export function PatientClinicalTab({
  patientId,
  canManage,
  embedded = false,
}: {
  patientId: string;
  canManage: boolean;
  embedded?: boolean;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [allergien, setAllergien] = useState<ClinicalWarning[]>([]);
  const [cave, setCave] = useState<ClinicalWarning[]>([]);
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [medications, setMedications] = useState<ClinicalMedication[]>([]);
  const [examinations, setExaminations] = useState<ClinicalExamination[]>([]);
  const [procedures, setProcedures] = useState<ClinicalProcedure[]>([]);
  const [verlauf, setVerlauf] = useState<ClinicalVerlaufEntry[]>([]);
  const [narrative, setNarrative] = useState<ClinicalNarrative>(blankNarrative());
  const [recommendations, setRecommendations] = useState<PatientRecommendation[]>([]);
  const [vitalsHistory, setVitalsHistory] = useState<PatientVitalMeasurement[]>([]);
  const [riskScores, setRiskScores] = useState<PatientRiskScore[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [allDoctors, setAllDoctors] = useState<AllDoctorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [vitalsSheetOpen, setVitalsSheetOpen] = useState(false);
  const [vitalsEditor, setVitalsEditor] = useState<PatientVitalMeasurement | null>(null);
  const [riskScoreSheetOpen, setRiskScoreSheetOpen] = useState(false);
  const [medicationHoldEditor, setMedicationHoldEditor] = useState<MedicationHoldEditor | null>(null);
  const [medicationHoldBusy, setMedicationHoldBusy] = useState(false);

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
      apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${patientId}/vitals`).catch(() => ({
        items: [] as PatientVitalMeasurement[],
      })),
      apiFetch<{ items: PatientRiskScore[] }>(`/patients/${patientId}/risk-scores`).catch(() => ({
        items: [] as PatientRiskScore[],
      })),
    ])
      .then(([clinical, recs, providerRows, doctorRows, vitals, scores]) => {
        if (!active) return;
        setAllergien(clinical.allergien ?? []);
        setCave(clinical.cave ?? []);
        setDiagnoses(clinical.diagnoses ?? []);
        setMedications(clinical.medications ?? []);
        setExaminations(clinical.examinations ?? []);
        setProcedures(clinical.procedures ?? []);
        setVerlauf((current) => mergeVerlaufDoctorAttribution(clinical.verlauf ?? [], current));
        setNarrative(clinical.narrative ?? blankNarrative());
        setRecommendations(recs ?? []);
        setProviders(clinicalMedicalProviderRows(providerRows ?? []));
        setAllDoctors(doctorRows ?? []);
        setVitalsHistory(Array.isArray(vitals?.items) ? vitals.items : []);
        setRiskScores(Array.isArray(scores?.items) ? scores.items : []);
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
        hold_until: medication.hold_until ?? null,
        hold_note: medication.hold_note ?? null,
      },
    });
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
            ...item,
            on_hold: draft.on_hold,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{tx("Клинический профиль", "Klinisches Profil")}</h2>
          <p className="text-xs text-muted-foreground">
            {tx(
              "Диагнозы, медикаменты и обследования пациента (с привязкой к провайдеру и врачу).",
              "Diagnosen, Medikation und Befunde des Patienten (mit Anbieter- und Arztbezug).",
            )}
          </p>
        </div>
        {/* PDF-Export (Medikationsplan / Arztbrief) — тимчасово вимкнено.
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
        */}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

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
                  {w.severity}
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

      {/* ---- Diagnoses (tree) ---- */}
      <DiagnosisTreeSection
        items={diagnoses}
        providers={providers}
        allDoctors={allDoctors}
        canManage={canManage}
        lang={lang}
        onSave={async (next) => {
          await savePatientDiagnoses(patientId, next);
          setDiagnoses(next);
        }}
      />

      {/* ---- Therapie / Procedures (OPS) ---- */}
      <ClinicalSection<ClinicalProcedure>
        title={tx("Терапия / Процедуры", "Therapie / Eingriffe")}
        items={procedures}
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
        active={narrative}
        canManage={canManage}
        lang={lang}
        onSave={async (next) => {
          const saved = await savePatientNarrative(patientId, next);
          setNarrative(saved);
          setVersion((current) => current + 1);
        }}
        loadHistory={() => fetchNarrativeHistory(patientId)}
      />

      {/* ---- Verlauf ---- */}
      <ClinicalSection<ClinicalVerlaufEntry>
        title={tx("Течение", "Verlauf")}
        items={verlauf}
        blank={blankVerlaufEntry}
        isValid={(item) => item.note.trim() !== "" && (!item.provider_id || Boolean(item.doctor_id))}
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
        items={medications}
        blank={blankMedication}
        isValid={(m) => m.handelsname.trim() !== "" && Boolean(m.einnahmeform) && Boolean(m.form)}
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
                  onChange={(e) => set({ status: e.target.value as ClinicalMedication["status"] })}
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
              <Field label={tx("Действующее вещество", "Wirkstoff")}>
                <Input
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
                  value={draft.einnahme_bis ?? ""}
                  onChange={(e) => set({ einnahme_bis: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
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

      {/* ---- Examinations / Befunde ---- */}
      <ClinicalSection<ClinicalExamination>
        title={tx("Обследования", "Befunde")}
        items={examinations}
        blank={blankExamination}
        isValid={(e) => e.title.trim() !== ""}
        canManage={canManage}
        tx={tx}
        onSave={async (next) => {
          await savePatientExaminations(patientId, next);
          setExaminations(next);
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
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalExamination>)}
            />
          </div>
        )}
      />

      {/* ---- Vitalwerte-Verlauf (moved from Profile) ---- */}
      {(canManage || vitalsHistory.length > 0) && (
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
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
            <div className="max-h-[540px] overflow-y-auto rounded-xl border border-border bg-card">
              {vitalsHistory.map((item) => {
                const notSet = tx("Не указано", "Nicht gesetzt");
                const vitalMetrics = [
                  item.bp_systolic != null && item.bp_diastolic != null
                    ? {
                        label: tx("АД", "RR"),
                        value: `${formatVitalNumber(item.bp_systolic, { maximumFractionDigits: 0 }) ?? notSet}/${
                          formatVitalNumber(item.bp_diastolic, { maximumFractionDigits: 0 }) ?? notSet
                        }`,
                      }
                    : null,
                  item.heart_rate != null
                    ? {
                        label: tx("ЧСС", "Herzfrequenz"),
                        value: formatVitalNumber(item.heart_rate, { maximumFractionDigits: 0 }) ?? notSet,
                      }
                    : null,
                  item.weight_kg != null
                    ? {
                        label: tx("Вес", "Gewicht"),
                        value: `${formatVitalNumber(item.weight_kg) ?? notSet} kg`,
                      }
                    : null,
                  item.height_cm != null
                    ? {
                        label: tx("Рост", "Größe"),
                        value: `${formatVitalNumber(item.height_cm) ?? notSet} cm`,
                      }
                    : null,
                  item.bmi != null
                    ? {
                        label: tx("BMI", "BMI"),
                        value: formatVitalNumber(item.bmi) ?? notSet,
                      }
                    : null,
                ].filter((metric): metric is { label: string; value: string } => Boolean(metric));

                return (
                  <div
                    key={item.id}
                    className="grid gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {patientVitalDateTime(item.measured_at, notSet)}
                        </p>
                        <span className="size-1 rounded-full bg-muted-foreground/35" />
                        <span className="text-xs text-muted-foreground">
                          {tx("Записал", "Erfasst von")} {item.recorded_by_name ?? tx("Неизвестно", "Unbekannt")}
                        </span>
                      </div>
                      {item.notes ? (
                        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {item.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 items-start gap-2 md:justify-end">
                      <div className="flex min-w-0 flex-wrap gap-1.5 md:justify-end">
                        {vitalMetrics.length > 0 ? (
                          vitalMetrics.map((metric) => (
                            <span
                              key={metric.label}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/25 px-2 py-1 text-xs text-muted-foreground"
                            >
                              <span>{metric.label}</span>
                              <span className="font-medium text-foreground">{metric.value}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">{notSet}</span>
                        )}
                      </div>
                      {canManage ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="size-7 shrink-0 rounded-md p-0"
                          aria-label={tx("Редактировать", "Bearbeiten")}
                          title={tx("Редактировать", "Bearbeiten")}
                          onClick={() => {
                            setVitalsEditor(item);
                            setVitalsSheetOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
      )}

      {/* ---- Risikoscores (moved from Profile) ---- */}
      {(canManage || riskScores.length > 0) && (
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{tx("Риск-скоры", "Risikoscores")}</h3>
            <CountBadge>
              {riskScores.length} {tx("Оценки", "Scores")}
            </CountBadge>
          </div>
          {canManage ? (
            <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setRiskScoreSheetOpen(true)}>
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
            <div className="space-y-1.5">
              {riskScores.map((score) => {
                const notSet = tx("Не указано", "Nicht gesetzt");
                const scoreValue = formatVitalNumber(score.score_value) ?? notSet;
                const scaleValue = score.scale_max != null ? formatVitalNumber(score.scale_max) : null;
                const riskValue = scaleValue ? `${scoreValue} / ${scaleValue}` : scoreValue;

                return (
                  <article
                    key={score.id}
                    className="grid items-start gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
                          {patientRiskScoreTypeLabel(score.score_type, tx)}
                        </span>
                        <span className={datePillClass}>
                          {patientVitalDateTime(score.computed_at, notSet)}
                        </span>
                      </div>

                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="inline-flex items-baseline gap-1">
                          <span className="text-muted-foreground">{tx("Записал", "Erfasst von")}</span>
                          <span className="font-medium text-foreground">
                            {score.recorded_by_name ?? tx("Неизвестно", "Unbekannt")}
                          </span>
                        </span>
                        {score.source ? (
                          <span className="inline-flex min-w-0 items-baseline gap-1">
                            <span className="shrink-0 text-muted-foreground">{tx("Источник", "Quelle")}</span>
                            <span className="min-w-0 break-words font-medium text-foreground">{score.source}</span>
                          </span>
                        ) : null}
                      </div>

                      {score.interpretation ? (
                        <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                          {score.interpretation}
                        </p>
                      ) : null}

                      {score.inputs ? (
                        <details className="mt-2 rounded-lg border border-border/50 bg-card">
                          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                            {tx("Входные данные", "Eingaben")}
                          </summary>
                          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border/50 px-3 py-2 text-[12px] text-foreground">
                            {JSON.stringify(score.inputs, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>

                    <div className="shrink-0 sm:text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {tx("Оценка риска", "Risikowert")}
                      </span>
                      <p className="mt-1 text-base font-semibold leading-none text-foreground">
                        {riskValue}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
      )}

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
            open={riskScoreSheetOpen}
            onOpenChange={setRiskScoreSheetOpen}
            onSaved={reloadRiskScores}
          />
        </Suspense>
      ) : null}

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
