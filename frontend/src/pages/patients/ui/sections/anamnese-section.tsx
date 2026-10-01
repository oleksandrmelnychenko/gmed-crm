import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { toast } from "@/components/ui/toast";
import { berlinLocalInputToIso, formatAppDateTime, isoToBerlinLocalInput } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { PatientSheetScaffold } from "@/pages/patients/ui/shared/patient-sheet-scaffold";
import type {
  ClinicalNarrative,
  ClinicalNarrativeSpecialization,
} from "@/pages/patients/data/patient-clinical";
import { specializationLabelForItem } from "@/pages/providers/model/specialization-labels";
import type { SpecializationItem } from "@/pages/providers/model/types";
import {
  composeChecklistText,
  emptySpecializationChecklist,
  isChecklistTemplate,
  isUnansweredChecklistNotation,
  readSpecializationChecklist,
  type SpecializationChecklist,
} from "@/pages/patients/data/specialization-checklist";
import { ClinicalSpecializationsField } from "./clinical-specializations-field";
import { SpecializationChecklistForm } from "./specialization-checklist-form";
import { ClinicalRecordSource } from "./clinical-record-source";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-field px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const datePillClass =
  "inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700";

/** The narrative fields (no untersuchungsbefund / Verlauf) in display order. */
type NarrativeFieldKey =
  | "anamnese_aktuelle"
  | "anamnese_vorgeschichte"
  | "anamnese_vegetative"
  | "anamnese_sozial"
  | "beurteilung"
  | "anamnese_familie";

function narrativeFields(tx: Bilingual): Array<{ key: NarrativeFieldKey; label: string }> {
  return [
    { key: "anamnese_aktuelle", label: tx("Актуальный анамнез", "Aktuelle Anamnese") },
    { key: "anamnese_vorgeschichte", label: tx("Доп. предыстория", "Weitere Vorgeschichte") },
    { key: "anamnese_vegetative", label: tx("Вегетативный анамнез", "Vegetative Anamnese") },
    { key: "anamnese_sozial", label: tx("Социальный анамнез", "Sozialanamnese") },
    { key: "beurteilung", label: tx("Оценка", "Beurteilung") },
    // Shown beside the assessment, in the last cell of the two-column form.
    { key: "anamnese_familie", label: tx("Семейный анамнез", "Familienanamnese") },
  ];
}

const NARRATIVE_READ_ORDER: NarrativeFieldKey[] = [
  "anamnese_aktuelle",
  "anamnese_vorgeschichte",
  "anamnese_vegetative",
  "anamnese_sozial",
  "anamnese_familie",
  "beurteilung",
];

/**
 * The points the clinic asks in every anamnesis. A new version starts with
 * them as real, editable text (owner decision 2026-10-01), not as a hint.
 */
export const NARRATIVE_FIELD_TEMPLATES = {
  anamnese_vorgeschichte: "Vorerkrankungen:\n\nRisikofaktoren:",
  anamnese_vegetative: "Appetit:\nTrinkmenge:\nWasserlassen:\nStuhlgang:\nSchlaf:",
  anamnese_sozial: "Familienstand:\nKinder:\nWohnsituation:\nBildung:\nBeruf:",
} as const;

/** A blank version: no id (new INSERT), active by default, the standard points pre-written. */
function blankVersion(): ClinicalNarrative {
  return {
    id: null,
    anamnese_aktuelle: null,
    ...NARRATIVE_FIELD_TEMPLATES,
    anamnese_familie: null,
    beurteilung: null,
    red_flags: null,
    specialization_ids: [],
    specializations: [],
    anamnese_at: new Date().toISOString(),
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}

export function copyNarrativeVersion(version: ClinicalNarrative): ClinicalNarrative {
  return {
    ...version,
    specialization_ids: [...(version.specialization_ids ?? [])],
    specializations: (version.specializations ?? []).map((item) => ({ ...item })),
    id: null,
    source_document_id: null,
    source_document_name: null,
    source_import_id: null,
    anamnese_at: new Date().toISOString(),
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}

export function editNarrativeVersion(version: ClinicalNarrative): ClinicalNarrative {
  return {
    ...version,
    specialization_ids: [...(version.specialization_ids ?? [])],
    specializations: (version.specializations ?? []).map((item) => ({ ...item })),
  };
}

/**
 * Specializations of the edited version after the selection changed. A newly
 * added one starts from its anamnesis template of the directory: a template
 * with yes/no questions opens as a checklist, any other as text. Texts and
 * answers that were already entered stay as they are.
 */
export function selectedNarrativeSpecializations(
  previous: ClinicalNarrativeSpecialization[],
  selected: SpecializationItem[],
): ClinicalNarrativeSpecialization[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return selected.map((item) => {
    const existing = previousById.get(item.id);
    if (existing) {
      return {
        ...item,
        narrative_text: existing.narrative_text ?? null,
        assessment_text: existing.assessment_text ?? null,
        checklist: existing.checklist ?? null,
      };
    }
    const template = item.anamnesis_template?.trim() || null;
    const asChecklist = isChecklistTemplate(template);
    return {
      ...item,
      narrative_text: asChecklist ? null : template,
      assessment_text: null,
      checklist: asChecklist && template ? emptySpecializationChecklist(template) : null,
    };
  });
}

/**
 * The checklist shown for a specialization of the edited version: the stored
 * one, or - for a text saved before its template became a checklist - an
 * unanswered one that keeps that text as the free text below the questions.
 */
export function narrativeSpecializationChecklist(
  item: ClinicalNarrativeSpecialization,
  options: SpecializationItem[],
): SpecializationChecklist | null {
  const stored = readSpecializationChecklist(item.checklist);
  if (stored) return stored;
  const template = options.find((option) => option.id === item.id)?.anamnesis_template?.trim();
  if (!template || !isChecklistTemplate(template)) return null;
  // A list of questions typed by hand before checklists existed is a template
  // itself, not something said about the patient: it is not kept as free text.
  const legacyText = isUnansweredChecklistNotation(item.narrative_text) ? "" : item.narrative_text ?? "";
  return emptySpecializationChecklist(template, legacyText);
}

/** First non-empty field, used as a one-line preview in the history list. */
function versionSnippet(version: ClinicalNarrative): string {
  for (const key of NARRATIVE_READ_ORDER) {
    const value = version[key];
    if (value && value.trim()) {
      const flat = value.trim().replace(/\s+/g, " ");
      return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
    }
  }
  return "";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  return formatAppDateTime(value) || value;
}

function versionDate(version: ClinicalNarrative): string {
  return formatTimestamp(version.anamnese_at ?? version.updated_at ?? version.created_at) || "—";
}

export function AnamneseSection({
  active,
  specializations = [],
  canManage,
  lang,
  onDelete,
  onSave,
  loadHistory,
  requireCurrent = false,
}: {
  active: ClinicalNarrative | null;
  specializations?: SpecializationItem[];
  canManage: boolean;
  lang: string;
  onDelete?: (id: string) => Promise<unknown>;
  onSave: (n: ClinicalNarrative) => Promise<unknown>;
  loadHistory: () => Promise<ClinicalNarrative[]>;
  requireCurrent?: boolean;
}): JSX.Element {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const fields = narrativeFields(tx);

  const [editing, setEditing] = useState<ClinicalNarrative | null>(null);
  const [editingMode, setEditingMode] = useState<"new" | "edit">("new");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClinicalNarrative | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ClinicalNarrative[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Refresh the history list whenever the active version changes while the
  // history panel is open (a save just landed), so it never shows a stale list.
  useEffect(() => {
    if (!historyOpen) return;
    let alive = true;
    setHistoryLoading(true);
    loadHistory()
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((error: unknown) => {
        if (alive) {
          toast.error(
            error instanceof Error ? error.message : tx("Не удалось загрузить", "Laden fehlgeschlagen"),
          );
        }
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
    // active drives the refresh; loadHistory/tx are stable enough for this use.
  }, [historyOpen, active]);

  function toggleHistory() {
    setHistoryOpen((open) => !open);
  }

  function setField(key: NarrativeFieldKey, value: string) {
    setEditing((current) =>
      current ? { ...current, [key]: value === "" ? null : value } : current,
    );
  }

  function openNew(version: ClinicalNarrative) {
    setEditingMode("new");
    setEditing(version);
  }

  function openEdit(version: ClinicalNarrative) {
    setEditingMode("edit");
    setEditing(editNarrativeVersion(version));
  }

  // The answers are stored together with the readable text composed from them.
  function updateSpecializationChecklist(specializationId: string, next: SpecializationChecklist) {
    setEditing((current) =>
      current
        ? {
            ...current,
            specializations: (current.specializations ?? []).map((item) =>
              item.id === specializationId
                ? { ...item, checklist: next, narrative_text: composeChecklistText(next) || null }
                : item,
            ),
          }
        : current,
    );
  }

  function removeSpecialization(specializationId: string) {
    setEditing((current) =>
      current
        ? {
            ...current,
            specialization_ids: (current.specialization_ids ?? []).filter(
              (id) => id !== specializationId,
            ),
            specializations: (current.specializations ?? []).filter(
              (item) => item.id !== specializationId,
            ),
          }
        : current,
    );
  }

  async function submit() {
    if (!editing) return;
    const anamneseAt = new Date(editing.anamnese_at ?? "");
    if (Number.isNaN(anamneseAt.getTime())) return;
    setBusy(true);
    try {
      await onSave({
        ...editing,
        anamnese_at: anamneseAt.toISOString(),
      });
      setEditing(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const id = deleteTarget?.id;
    if (!id || !onDelete) return;

    setDeleteBusy(true);
    try {
      await onDelete(id);
      setHistory((current) => current.filter((version) => version.id !== id));
      setEditing((current) => (current?.id === id ? null : current));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Не удалось удалить", "Löschen fehlgeschlagen"),
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  // The saved version reads in clinical order: the family anamnesis belongs
  // to the anamnesis blocks, before the assessment.
  const activeNonEmpty = active
    ? NARRATIVE_READ_ORDER.flatMap((key) => {
        const field = fields.find((item) => item.key === key);
        return field && active[key]?.trim() ? [field] : [];
      })
    : [];
  const currentMissing = Boolean(
    editing && requireCurrent && !editing.anamnese_aktuelle?.trim(),
  );
  const anamnesisTimeMissing = Boolean(editing && !editing.anamnese_at);

  return (
    <section className="rounded-xl border border-border/70 bg-slate-50/60">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="text-sm font-semibold text-foreground">{tx("Анамнез", "Anamnese")}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg"
            onClick={toggleHistory}
          >
            {historyOpen
              ? tx("Скрыть историю", "Verlauf ausblenden")
              : tx("Показать историю", "Verlauf anzeigen")}
          </Button>
          {canManage ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => openNew(blankVersion())}
              >
                <Plus className="size-3.5" />
                {tx("Новая версия", "Neue Version")}
              </Button>
              {active ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    onClick={() => openNew(copyNarrativeVersion(active))}
                  >
                    <Copy className="size-3.5" />
                    {tx("Копировать", "Kopieren")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => openEdit(active)}
                  >
                    <Pencil className="size-3.5" />
                    {tx("Редактировать", "Bearbeiten")}
                  </Button>
                  {active.id && onDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="size-8 rounded-lg border-rose-200 p-0 text-rose-700 hover:bg-rose-50"
                      aria-label={tx("Удалить анамнез", "Anamnese löschen")}
                      title={tx("Удалить анамнез", "Anamnese löschen")}
                      onClick={() => setDeleteTarget(active)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="space-y-2.5 p-3">
        {active ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border/60 bg-white">
              <div className="grid min-w-0 gap-1.5 border-b border-border/60 px-3 py-2.5 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] sm:items-center">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {tx("Дата и время анамнеза", "Zeitpunkt der Anamnese")}
                </p>
                <p>
                  <span className={datePillClass}>
                    {versionDate(active)}
                  </span>
                </p>
              </div>
              <div className="grid min-w-0 gap-1.5 border-b border-border/60 px-3 py-2.5 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] sm:items-center">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {tx("Статус", "Status")}
                </p>
                <p>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {tx("Активная версия", "Aktive Version")}
                  </span>
                </p>
              </div>
              <div className="grid min-w-0 gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] sm:items-center">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {tx("Источник", "Quelle")}
                </p>
                <div>
                  <ClinicalRecordSource item={active} tx={tx} />
                </div>
              </div>
            </div>
            {activeNonEmpty.length > 0 ? (
              <dl className="overflow-hidden rounded-lg border border-border/60 bg-white">
                {activeNonEmpty.map((field) => (
                  <div
                    key={field.key}
                    className="grid min-w-0 gap-1.5 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)]"
                  >
                    <dt className="text-[11px] font-medium text-muted-foreground">{field.label}</dt>
                    <dd className="whitespace-pre-line break-words text-sm text-foreground">
                      {active[field.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                {tx("Пока нет анамнеза", "Noch keine Anamnese")}
              </p>
            )}
            {(active.specializations ?? []).length > 0 ? (
              <div className="space-y-2">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {tx("Специализации", "Spezialisierungen")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(active.specializations ?? []).map((item) => (
                    <span
                      key={item.id}
                      className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                    >
                      {specializationLabelForItem(item, lang === "de" ? "de" : "ru")}
                    </span>
                  ))}
                </div>
                {(active.specializations ?? [])
                  .filter((item) => item.narrative_text || item.assessment_text)
                  .map((item) => (
                    <div
                      key={`${item.id}-details`}
                      className="overflow-hidden rounded-lg border border-border/60 bg-white"
                    >
                      <p className="border-b border-border/60 bg-muted/20 px-3 py-2 text-xs font-semibold text-foreground">
                        {specializationLabelForItem(item, lang === "de" ? "de" : "ru")}
                      </p>
                      <dl className="divide-y divide-border/60">
                        {item.narrative_text ? (
                          <div className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)]">
                            <dt className="text-[10px] font-medium text-muted-foreground">
                              {tx("Анамнез по специализации", "Fachspezifische Anamnese")}
                            </dt>
                            <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">
                              {item.narrative_text}
                            </dd>
                          </div>
                        ) : null}
                        {item.assessment_text ? (
                          <div className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)]">
                            <dt className="text-[10px] font-medium text-muted-foreground">
                              {tx(
                                "Оценка / заключение специалиста",
                                "Fachärztliche Beurteilung / Stellungnahme",
                              )}
                            </dt>
                            <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">
                              {item.assessment_text}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ))}
              </div>
            ) : null}
            {active.red_flags ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-rose-800">
                  {tx("Тревожные признаки", "Warnzeichen")}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-rose-900">
                  {active.red_flags}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Пока нет анамнеза", "Noch keine Anamnese")}
          </p>
        )}

        {historyOpen ? (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-white">
            <p className="border-b border-border/60 bg-muted/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tx("История версий", "Versionsverlauf")}
            </p>
            {historyLoading ? (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">{tx("Загрузка…", "Laden…")}</p>
            ) : history.length === 0 ? (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                {tx("Версий нет", "Keine Versionen")}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {history.map((version) => {
                  const snippet = versionSnippet(version);
                  return (
                    <li
                      key={version.id ?? `${version.updated_at}`}
                      className="flex items-start justify-between gap-2.5 bg-white px-3 py-2.5"
                    >
                      <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[10rem_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">
                            {tx("Дата и время анамнеза", "Zeitpunkt der Anamnese")}
                          </p>
                          <p className="mt-1">
                            <span className={datePillClass}>
                              {versionDate(version)}
                            </span>
                          </p>
                          <span
                            className={cn(
                              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                              version.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {version.is_active
                              ? tx("Активная версия", "Aktive Version")
                              : tx("Архивная версия", "Archivversion")}
                          </span>
                          <div className="mt-1.5">
                            <ClinicalRecordSource item={version} tx={tx} />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">
                            {tx("Содержимое", "Inhalt")}
                          </p>
                          <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
                            {snippet || tx("Без текста", "Ohne Text")}
                          </p>
                        </div>
                      </div>
                      {canManage ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-7 rounded-md p-0"
                            aria-label={tx("Копировать", "Kopieren")}
                            title={tx("Копировать", "Kopieren")}
                            onClick={() => openNew(copyNarrativeVersion(version))}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-7 rounded-md p-0"
                            aria-label={tx("Редактировать", "Bearbeiten")}
                            title={tx("Редактировать", "Bearbeiten")}
                            onClick={() => openEdit(version)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {version.id && onDelete ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="size-7 rounded-md p-0 text-rose-700 hover:bg-rose-50"
                              aria-label={tx("Удалить анамнез", "Anamnese löschen")}
                              title={tx("Удалить анамнез", "Anamnese löschen")}
                              onClick={() => setDeleteTarget(version)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <PatientSheetScaffold
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        width="form-heavy"
        title={
          editingMode === "edit"
            ? `${tx("Редактировать", "Bearbeiten")}: ${tx("Анамнез", "Anamnese")}`
            : `${tx("Новая версия", "Neue Version")}: ${tx("Анамнез", "Anamnese")}`
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
              disabled={busy || !editing || currentMissing || anamnesisTimeMissing}
              onClick={() => void submit()}
            >
              {tx("Сохранить", "Speichern")}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {tx("Дата и время анамнеза", "Zeitpunkt der Anamnese")}
                <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
              </span>
              <Input
                type="datetime-local"
                required
                aria-invalid={anamnesisTimeMissing}
                value={isoToBerlinLocalInput(editing.anamnese_at)}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? { ...current, anamnese_at: berlinLocalInputToIso(event.target.value) }
                      : current,
                  )
                }
                className={cn(inputClass, anamnesisTimeMissing && "border-destructive")}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    {field.label}
                    {requireCurrent && field.key === "anamnese_aktuelle" ? (
                      <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
                    ) : null}
                  </span>
                  <textarea
                    required={requireCurrent && field.key === "anamnese_aktuelle"}
                    aria-invalid={currentMissing && field.key === "anamnese_aktuelle"}
                    value={editing[field.key] ?? ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className={cn(
                      inputClass,
                      "h-24 py-2",
                      currentMissing && field.key === "anamnese_aktuelle" && "border-destructive",
                    )}
                  />
                  {currentMissing && field.key === "anamnese_aktuelle" ? (
                    <span role="alert" className="mt-1 block text-xs text-destructive">
                      {tx("Обязательное поле", "Pflichtfeld")}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {tx("Специализации", "Spezialisierungen")}
              </span>
              <ClinicalSpecializationsField
                ids={editing.specialization_ids ?? []}
                selected={editing.specializations ?? []}
                options={specializations}
                lang={lang}
                tx={tx}
                onChange={(specializationIds, selectedItems) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,
                          specialization_ids: specializationIds,
                          specializations: selectedNarrativeSpecializations(
                            current.specializations ?? [],
                            selectedItems,
                          ),
                        }
                      : current,
                  )
                }
              />
            </div>
            {(editing.specializations ?? []).map((specialization) => {
              const checklist = narrativeSpecializationChecklist(specialization, specializations);
              return (
              <div
                key={specialization.id}
                className="space-y-3 rounded-lg border border-border/60 bg-background p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    {specializationLabelForItem(specialization, lang === "de" ? "de" : "ru")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="size-7 shrink-0 rounded-md p-0 text-rose-700 hover:bg-rose-50"
                    aria-label={`${lang === "de" ? "Entfernen" : "Удалить"}: ${specializationLabelForItem(
                      specialization,
                      lang === "de" ? "de" : "ru",
                    )}`}
                    title={
                      lang === "de"
                        ? "Spezialisierung entfernen"
                        : "Удалить специализацию"
                    }
                    onClick={() => removeSpecialization(specialization.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {checklist ? (
                    <div className="space-y-1 md:col-span-2">
                      <span className="block text-[11px] font-medium text-muted-foreground">
                        {tx("Анамнез по специализации", "Fachspezifische Anamnese")}
                      </span>
                      <SpecializationChecklistForm
                        checklist={checklist}
                        tx={tx}
                        onChange={(next) => updateSpecializationChecklist(specialization.id, next)}
                      />
                    </div>
                  ) : null}
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {checklist
                        ? tx("Дополнение свободным текстом", "Ergänzung als Freitext")
                        : tx("Анамнез по специализации", "Fachspezifische Anamnese")}
                    </span>
                    <textarea
                      value={checklist ? checklist.notes : specialization.narrative_text ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (checklist) {
                          updateSpecializationChecklist(specialization.id, { ...checklist, notes: value });
                          return;
                        }
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                specializations: (current.specializations ?? []).map((item) =>
                                  item.id === specialization.id
                                    ? { ...item, narrative_text: value || null }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      }}
                      className={cn(inputClass, "h-28 py-2")}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {tx(
                        "Оценка / заключение специалиста",
                        "Fachärztliche Beurteilung / Stellungnahme",
                      )}
                    </span>
                    <textarea
                      value={specialization.assessment_text ?? ""}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                specializations: (current.specializations ?? []).map((item) =>
                                  item.id === specialization.id
                                    ? { ...item, assessment_text: event.target.value || null }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                      className={cn(inputClass, "h-28 py-2")}
                    />
                  </label>
                </div>
              </div>
              );
            })}
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Red flags
              </span>
              <textarea
                value={editing.red_flags ?? ""}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? { ...current, red_flags: event.target.value || null }
                      : current,
                  )
                }
                className={cn(inputClass, "h-24 py-2")}
                placeholder={tx(
                  "Тревожные признаки и особые риски",
                  "Warnzeichen und besondere Risiken",
                )}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, is_active: event.target.checked } : current,
                  )
                }
                className="size-4 rounded border-border text-primary focus:ring-2 focus:ring-ring/40"
              />
              <span className="text-sm text-foreground">{tx("Активный", "Aktiv")}</span>
            </label>
          </div>
        ) : null}
      </PatientSheetScaffold>

      <DirtyDismissConfirmDialog
        open={Boolean(deleteTarget)}
        title={tx("Удалить анамнез?", "Anamnese löschen?")}
        message={tx(
          "Версия анамнеза будет удалена. Если она активная, система выберет последнюю доступную версию.",
          "Diese Anamnese-Version wird gelöscht. Wenn sie aktiv ist, wählt das System die letzte verfügbare Version.",
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={deleteBusy ? tx("Удаление…", "Löschen…") : tx("Удалить", "Löschen")}
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteBusy) void confirmDelete();
        }}
      />
    </section>
  );
}
