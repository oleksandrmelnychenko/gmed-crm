import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { PatientSheetScaffold } from "@/pages/patients/ui/shared/patient-sheet-scaffold";
import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const datePillClass =
  "inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700";

/** The narrative fields (no untersuchungsbefund / Verlauf) in display order. */
type NarrativeFieldKey =
  | "anamnese_aktuelle"
  | "anamnese_vorgeschichte"
  | "anamnese_vegetative"
  | "anamnese_sozial"
  | "beurteilung";

function narrativeFields(tx: Bilingual): Array<{ key: NarrativeFieldKey; label: string }> {
  return [
    { key: "anamnese_aktuelle", label: tx("Актуальный анамнез", "Aktuelle Anamnese") },
    { key: "anamnese_vorgeschichte", label: tx("Доп. предыстория", "Weitere Vorgeschichte") },
    { key: "anamnese_vegetative", label: tx("Вегетативный анамнез", "Vegetative Anamnese") },
    { key: "anamnese_sozial", label: tx("Социальный анамнез", "Sozialanamnese") },
    { key: "beurteilung", label: tx("Оценка", "Beurteilung") },
  ];
}

/** A blank version: no id (new INSERT), active by default, fields empty. */
function blankVersion(): ClinicalNarrative {
  return {
    id: null,
    anamnese_aktuelle: null,
    anamnese_vorgeschichte: null,
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: null,
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}

export function copyNarrativeVersion(version: ClinicalNarrative): ClinicalNarrative {
  return {
    ...version,
    id: null,
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}

/** First non-empty field, used as a one-line preview in the history list. */
function versionSnippet(version: ClinicalNarrative): string {
  const keys: NarrativeFieldKey[] = [
    "anamnese_aktuelle",
    "anamnese_vorgeschichte",
    "anamnese_vegetative",
    "anamnese_sozial",
    "beurteilung",
  ];
  for (const key of keys) {
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function versionDate(version: ClinicalNarrative): string {
  return formatTimestamp(version.updated_at ?? version.created_at) || "—";
}

export function AnamneseSection({
  active,
  canManage,
  lang,
  onDelete,
  onSave,
  loadHistory,
}: {
  active: ClinicalNarrative | null;
  canManage: boolean;
  lang: string;
  onDelete?: (id: string) => Promise<unknown>;
  onSave: (n: ClinicalNarrative) => Promise<unknown>;
  loadHistory: () => Promise<ClinicalNarrative[]>;
}): JSX.Element {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const fields = narrativeFields(tx);

  const [editing, setEditing] = useState<ClinicalNarrative | null>(null);
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

  async function submit() {
    if (!editing) return;
    setBusy(true);
    try {
      await onSave(editing);
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

  const activeNonEmpty = active
    ? fields.filter((field) => {
        const value = active[field.key];
        return Boolean(value && value.trim());
      })
    : [];

  return (
    <section className="rounded-xl border border-border/70 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{tx("Анамнез", "Anamnese")}</h3>
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
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => setEditing(blankVersion())}
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
                    onClick={() => setEditing(copyNarrativeVersion(active))}
                  >
                    <Copy className="size-3.5" />
                    {tx("Копировать", "Kopieren")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => setEditing({ ...active })}
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
            <div className="grid gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2.5 md:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {tx("Последнее обновление", "Letzte Aktualisierung")}
                </p>
                <p className="mt-1">
                  <span className={datePillClass}>
                    {versionDate(active)}
                  </span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {tx("Статус", "Status")}
                </p>
                <p className="mt-1">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {tx("Активная версия", "Aktive Version")}
                  </span>
                </p>
              </div>
            </div>
            {activeNonEmpty.length > 0 ? (
              <dl className="grid gap-2.5 md:grid-cols-2">
                {activeNonEmpty.map((field) => (
                  <div key={field.key} className="min-w-0">
                    <dt className="mb-1 text-[11px] font-medium text-muted-foreground">{field.label}</dt>
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
          </div>
        ) : (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Пока нет анамнеза", "Noch keine Anamnese")}
          </p>
        )}

        {historyOpen ? (
          <div className="space-y-1.5 rounded-lg border border-border/50 bg-background p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tx("История версий", "Versionsverlauf")}
            </p>
            {historyLoading ? (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">{tx("Загрузка…", "Laden…")}</p>
            ) : history.length === 0 ? (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                {tx("Версий нет", "Keine Versionen")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((version) => {
                  const snippet = versionSnippet(version);
                  return (
                    <li
                      key={version.id ?? `${version.updated_at}`}
                      className="flex items-start justify-between gap-2.5 rounded-lg border border-border/50 bg-card px-3 py-2"
                    >
                      <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[10rem_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">
                            {tx("Последнее обновление", "Letzte Aktualisierung")}
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
                            onClick={() => setEditing(copyNarrativeVersion(version))}
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
                            onClick={() => setEditing({ ...version })}
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
          editing && editing.id
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
              disabled={busy || !editing}
              onClick={() => void submit()}
            >
              {tx("Сохранить", "Speichern")}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    {field.label}
                  </span>
                  <textarea
                    value={editing[field.key] ?? ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className={cn(inputClass, "h-24 py-2")}
                  />
                </label>
              ))}
            </div>
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
