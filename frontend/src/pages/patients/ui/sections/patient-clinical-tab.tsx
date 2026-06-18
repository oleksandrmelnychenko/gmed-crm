import { Fragment, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
// import { downloadApiFile } from "@/lib/api"; // PDF-Export (Medikationsplan / Arztbrief) тимчасово вимкнено
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import { fetchProviders } from "@/pages/providers/data/provider-api";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { DARREICHUNGSFORM_OPTIONS, EINNAHMEFORM_OPTIONS } from "../../data/medication-options";

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
  updatePatientRecommendation,
  type AllDoctorOption,
  type ClinicalAttribution,
  type ClinicalDiagnosis,
  type ClinicalExamination,
  type ClinicalMedication,
  type ClinicalNarrative,
  type ClinicalProcedure,
  type ClinicalWarning,
  type ClinicalWarningKind,
  type PatientRecommendation,
  type RecommendationLifecycleStatus,
} from "@/pages/patients/data/patient-clinical";

import { AnamneseSection } from "./anamnese-section";
import { DiagnosisTreeSection } from "./diagnosis-tree";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

type ClinicalSectionGroup = { key: string; label: string };
type IndexedClinicalItem<T> = { item: T; index: number };

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

function trimToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function attributionLabel(item: ClinicalAttribution): string | null {
  const doctor = [item.doctor_title, item.doctor_name].filter(Boolean).join(" ").trim();
  return [doctor || null, item.provider_name].filter(Boolean).join(" · ") || null;
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

  // Rendered as a paper-like document (always light) to match the official BMP.
  const headCell = "border border-zinc-300 px-2.5 py-2 font-bold text-zinc-900";
  const headDoseCell = "border border-zinc-300 px-1.5 py-2 text-center font-bold text-zinc-900";
  const bodyCell = "border border-zinc-300 px-2.5 py-1.5 align-top text-zinc-900";
  const bodyDoseCell = "border border-zinc-300 px-1.5 py-1.5 text-center align-top font-mono text-zinc-900";

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-300 bg-white">
      <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
        <thead>
          <tr className="bg-zinc-200/70">
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
              <th scope="col" className="border border-zinc-300 px-2 py-2 text-right font-bold">
                <span className="sr-only">{tx("Действия", "Aktionen")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label && section.key !== "dauer" ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="border border-zinc-300 bg-zinc-100 px-2.5 py-1.5 text-[13px] font-bold text-zinc-900"
                  >
                    {section.label}
                  </td>
                </tr>
              ) : null}
              {section.rows.map(({ item, index }) => {
                const attribution = attributionLabel(item);
                return (
                  <tr key={item.id ?? index} className={item.on_hold ? "bg-amber-50" : undefined}>
                    <td className={cn(bodyCell, "whitespace-pre-line")}>{item.wirkstoff || "—"}</td>
                    <td className={cn(bodyCell, "font-medium")}>
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                      {item.on_hold ? (
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          {tx("На холд", "Auf Hold")}
                          {item.hold_until ? ` ${tx("до", "bis")} ${item.hold_until}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(bodyCell, "whitespace-pre-line font-mono")}>{item.staerke || ""}</td>
                    <td className={cn(bodyCell, "whitespace-pre-line")}>{item.form || ""}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_morgens)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_mittags)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_abends)}</td>
                    <td className={bodyDoseCell}>{doseCell(item.dose_nachts)}</td>
                    <td className={cn(bodyCell, "whitespace-nowrap")}>{item.einheit || ""}</td>
                    <td className={bodyCell}>
                      {item.hinweis ? <span className="whitespace-pre-line break-words">{item.hinweis}</span> : null}
                      {attribution ? (
                        <span className="mt-0.5 block text-[10px] text-zinc-500">{attribution}</span>
                      ) : null}
                    </td>
                    <td className={bodyCell}>{item.grund || ""}</td>
                    {canManage ? (
                      <td className="border border-zinc-300 px-2 py-1.5 text-right align-top">
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
      await onSave(next);
      setList(next);
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    if (!editing || !isValid(editing.draft)) return;
    const next = [...list];
    if (editing.index === null) next.push(editing.draft);
    else next[editing.index] = editing.draft;
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

  const renderRow = (item: T, index: number) => (
    <div
      key={item.id ?? index}
      className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2"
    >
      <div className="min-w-0 flex-1">{rowView ? rowView(item) : null}</div>
      {renderActions(item, index)}
    </div>
  );

  const indexed = list.map((item, index) => ({ item, index }));

  return (
    <section className="rounded-xl border border-border/70 bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {count ?? <Badge variant="outline" className="rounded-full text-[11px]">{list.length}</Badge>}
        </div>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            onClick={() => setEditing({ index: null, draft: blank() })}
          >
            <Plus className="size-3.5" />
            {tx("Добавить", "Hinzufügen")}
          </Button>
        ) : null}
      </header>

      <div className="space-y-2 p-3">
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
                    <div key={group.key} className="space-y-2">
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
function PatientRecommendationsSection({
  recommendations,
  allDoctors,
  patientId,
  canManage,
  onReload,
  tx,
}: {
  recommendations: PatientRecommendation[];
  allDoctors: AllDoctorOption[];
  patientId: string;
  canManage: boolean;
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
  const lifecycleLabel = (value: RecommendationLifecycleStatus) => {
    const option = LIFECYCLE_OPTIONS.find((o) => o.value === value);
    return option ? tx(option.ru, option.de) : value;
  };
  const doctorName = (rec: PatientRecommendation) => {
    if (rec.source_doctor_name) return rec.source_doctor_name;
    const doctor = allDoctors.find((d) => d.id === rec.source_doctor_id);
    return doctor ? [doctor.title, doctor.name].filter(Boolean).join(" ") : null;
  };
  const validityLabel = (rec: PatientRecommendation) =>
    [rec.valid_from, rec.valid_to].some(Boolean)
      ? `${rec.valid_from ?? "…"} – ${rec.valid_to ?? "…"}`
      : null;

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
        "flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2",
        muted ? "bg-muted/40" : "bg-background",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{rec.title}</span>
          {typeLabel(rec.recommendation_type) ? (
            <Badge variant="outline" className="rounded-full text-[10px]">
              {typeLabel(rec.recommendation_type)}
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn("rounded-full text-[10px]", lifecycleBadgeClass(rec.lifecycle_status))}>
            {lifecycleLabel(rec.lifecycle_status)}
          </Badge>
        </div>
        {rec.description ? <p className="text-[11px] text-muted-foreground">{rec.description}</p> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {doctorName(rec) ? <span>{doctorName(rec)}</span> : null}
          {validityLabel(rec) ? <span>{validityLabel(rec)}</span> : null}
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
            {tx("Empfehlung", "Empfehlung")}
          </Button>
        ) : null}
      </header>

      <div className="space-y-2 p-3">
        {recommendations.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Рекомендаций нет", "Keine Empfehlungen")}
          </p>
        ) : null}

        {activeRecs.map((rec) => renderRow(rec, false))}

        {doneRecs.length > 0 ? (
          <div className="space-y-2">
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
                  onChange={(e) => set({ description: trimToNull(e.target.value) })}
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
                    {allDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {[doctor.title, doctor.name].filter(Boolean).join(" ")}
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
                    onChange={(e) => set({ recommended_on: trimToNull(e.target.value) })}
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
                    onChange={(e) => set({ valid_from: trimToNull(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
                <Field label={tx("Действует до", "Gültig bis")}>
                  <Input
                    type="date"
                    value={editing.valid_to ?? ""}
                    onChange={(e) => set({ valid_to: trimToNull(e.target.value) })}
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
                    onChange={(e) => set({ reminder_at: trimToNull(e.target.value) })}
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
                      onChange={(e) => set({ outcome_note: trimToNull(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  {editing.lifecycle_status === "erfolg" ? (
                    <Field label={tx("Дата выполнения", "Erledigt am")}>
                      <Input
                        type="date"
                        value={editing.outcome_at ?? ""}
                        onChange={(e) => set({ outcome_at: trimToNull(e.target.value) })}
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              <Field label={tx("Внутренняя заметка", "Interne Notiz")}>
                <textarea
                  value={editing.note_intern ?? ""}
                  onChange={(e) => set({ note_intern: trimToNull(e.target.value) })}
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
  const [narrative, setNarrative] = useState<ClinicalNarrative>(blankNarrative());
  const [recommendations, setRecommendations] = useState<PatientRecommendation[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [allDoctors, setAllDoctors] = useState<AllDoctorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

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
      fetchProviders("/providers?active_only=true&provider_type=medical").catch(() => [] as ProviderSummary[]),
      fetchAllDoctors().catch(() => [] as AllDoctorOption[]),
    ])
      .then(([clinical, recs, providerRows, doctorRows]) => {
        if (!active) return;
        setAllergien(clinical.allergien ?? []);
        setCave(clinical.cave ?? []);
        setDiagnoses(clinical.diagnoses ?? []);
        setMedications(clinical.medications ?? []);
        setExaminations(clinical.examinations ?? []);
        setProcedures(clinical.procedures ?? []);
        setNarrative(clinical.narrative ?? blankNarrative());
        setRecommendations(recs ?? []);
        setProviders((providerRows ?? []).filter((provider) => provider.provider_type === "medical"));
        setAllDoctors(doctorRows ?? []);
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
    const label = attributionLabel(item);
    return label ? (
      <p className="mt-0.5 text-[11px] text-muted-foreground">{tx("Назначил", "Verordnet von")}: {label}</p>
    ) : null;
  };

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
            {tx("Medikationsplan (PDF)", "Medikationsplan (PDF)")}
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
        tx={tx}
        onSave={async (next) => {
          await savePatientClinicalWarnings(patientId, "allergie", next);
          setAllergien(next);
        }}
        rowView={(w) => (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{w.label}</span>
              {w.severity ? (
                <span className="text-[11px] text-muted-foreground">{w.severity}</span>
              ) : null}
            </div>
            {w.reaction ? <p className="text-[11px] text-muted-foreground">{w.reaction}</p> : null}
            {w.note ? <p className="text-[11px] text-muted-foreground">{w.note}</p> : null}
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
                onChange={(e) => set({ reaction: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder={tx("Сыпь, отёк", "Hautausschlag, Schwellung")}
              />
            </Field>
            <Field label={tx("Тяжесть", "Schweregrad")}>
              <Input
                value={draft.severity ?? ""}
                onChange={(e) => set({ severity: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder={tx("лёгкая / средняя / тяжёлая", "leicht / mittel / schwer")}
              />
            </Field>
            <Field label={tx("Примечание", "Notiz")}>
              <Input
                value={draft.note ?? ""}
                onChange={(e) => set({ note: trimToNull(e.target.value) })}
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
        tx={tx}
        onSave={async (next) => {
          await savePatientClinicalWarnings(patientId, "cave", next);
          setCave(next);
        }}
        rowView={(w) => (
          <div>
            <span className="text-sm font-medium text-foreground">{w.label}</span>
            {w.note ? <p className="text-[11px] text-muted-foreground">{w.note}</p> : null}
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
                onChange={(e) => set({ note: trimToNull(e.target.value) })}
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
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {p.performed_on ? (
                <span className="text-[11px] text-muted-foreground">{p.performed_on}</span>
              ) : null}
              <span className="text-sm font-medium text-foreground">{p.label}</span>
              {p.ops_code ? (
                <span className="font-mono text-[11px] text-muted-foreground">({p.ops_code})</span>
              ) : null}
            </div>
            {p.note ? <p className="text-[11px] text-muted-foreground">{p.note}</p> : null}
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
                  onChange={(e) => set({ ops_code: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="5-470.10"
                />
              </Field>
              <Field label={tx("Дата", "Datum")}>
                <Input
                  type="date"
                  value={draft.performed_on ?? ""}
                  onChange={(e) => set({ performed_on: trimToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Примечание", "Notiz")}>
              <Input
                value={draft.note ?? ""}
                onChange={(e) => set({ note: trimToNull(e.target.value) })}
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
            renderActions={renderActions}
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
                  onChange={(e) => set({ wirkstoff: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Bisoprolol"
                />
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Дозировка", "Stärke")}>
                <Input
                  value={draft.staerke ?? ""}
                  onChange={(e) => set({ staerke: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="5 mg"
                />
              </Field>
              <Field label={tx("Единица", "Einheit")}>
                <Input
                  value={draft.einheit ?? ""}
                  onChange={(e) => set({ einheit: trimToNull(e.target.value) })}
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
                    onChange={(e) => set({ [key]: trimToNull(e.target.value) } as Partial<ClinicalMedication>)}
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
                onChange={(e) => set({ grund: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder="Bluthochdruck"
              />
            </Field>
            <Field label={tx("Указания", "Hinweise")}>
              <Input
                value={draft.hinweis ?? ""}
                onChange={(e) => set({ hinweis: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder="Während oder nach den Mahlzeiten"
              />
            </Field>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label={tx("Дата назначения", "Verordnet am")}>
                <Input
                  type="date"
                  value={draft.verordnet_am ?? ""}
                  onChange={(e) => set({ verordnet_am: trimToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Приём с", "Einnahme von")}>
                <Input
                  type="date"
                  value={draft.einnahme_von ?? ""}
                  onChange={(e) => set({ einnahme_von: trimToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Приём до", "Einnahme bis")}>
                <Input
                  type="date"
                  value={draft.einnahme_bis ?? ""}
                  onChange={(e) => set({ einnahme_bis: trimToNull(e.target.value) })}
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
            <fieldset className="rounded-lg border border-amber-300/70 bg-amber-50/40 p-2">
              <CheckboxField
                label={tx("На холд (пациент не принимает)", "Auf Hold (Patient nimmt es nicht)")}
                checked={draft.on_hold}
                onChange={(checked) =>
                  set({
                    on_hold: checked,
                    hold_until: checked ? draft.hold_until : null,
                    hold_note: checked ? draft.hold_note : null,
                  })
                }
              />
              {draft.on_hold ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label={tx("До какого числа", "Bis wann")}>
                    <Input
                      type="date"
                      value={draft.hold_until ?? ""}
                      onChange={(e) => set({ hold_until: e.target.value || null })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label={tx("Заметка", "Notiz")}>
                    <Input
                      value={draft.hold_note ?? ""}
                      onChange={(e) => set({ hold_note: e.target.value || null })}
                      className={inputClass}
                      placeholder={tx("Причина паузы", "Grund der Pause")}
                    />
                  </Field>
                </div>
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
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{e.title}</span>
              {e.performed_on ? (
                <span className="text-[11px] text-muted-foreground">{e.performed_on}</span>
              ) : null}
              {e.status === "pending" ? (
                <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-[10px] text-amber-700">
                  {tx("Ожидается", "Ausstehend")}
                </Badge>
              ) : null}
            </div>
            {e.result ? <p className="text-[11px] text-muted-foreground">{e.result}</p> : null}
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
                  onChange={(e) => set({ performed_on: trimToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Результат / Befund", "Befund")}>
              <textarea
                value={draft.result ?? ""}
                onChange={(e) => set({ result: trimToNull(e.target.value) })}
                className={cn(inputClass, "h-20 py-2")}
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

      {/* ---- Recommendations (Empfehlungen) — admin CRUD ---- */}
      <PatientRecommendationsSection
        recommendations={recommendations}
        allDoctors={allDoctors}
        patientId={patientId}
        canManage={canManage}
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
