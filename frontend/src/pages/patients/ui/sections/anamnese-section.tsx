import { useEffect, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Pencil, Plus } from "lucide-react";

import { PatientSheetScaffold } from "@/pages/patients/ui/shared/patient-sheet-scaffold";
import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

/** The 6 narrative fields (no untersuchungsbefund) in display order. */
type NarrativeFieldKey =
  | "anamnese_aktuelle"
  | "anamnese_vorgeschichte"
  | "anamnese_vegetative"
  | "anamnese_sozial"
  | "beurteilung"
  | "verlauf";

function narrativeFields(tx: Bilingual): Array<{ key: NarrativeFieldKey; label: string }> {
  return [
    { key: "anamnese_aktuelle", label: tx("Актуальный анамнез", "Aktuelle Anamnese") },
    { key: "anamnese_vorgeschichte", label: tx("Доп. предыстория", "Weitere Vorgeschichte") },
    { key: "anamnese_vegetative", label: tx("Вегетативный анамнез", "Vegetative Anamnese") },
    { key: "anamnese_sozial", label: tx("Социальный анамнез", "Sozialanamnese") },
    { key: "beurteilung", label: tx("Оценка", "Beurteilung") },
    { key: "verlauf", label: tx("Течение", "Verlauf") },
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
    verlauf: null,
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
    "verlauf",
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

export function AnamneseSection({
  active,
  canManage,
  lang,
  onSave,
  loadHistory,
}: {
  active: ClinicalNarrative | null;
  canManage: boolean;
  lang: string;
  onSave: (n: ClinicalNarrative) => Promise<unknown>;
  loadHistory: () => Promise<ClinicalNarrative[]>;
}): JSX.Element {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const fields = narrativeFields(tx);

  const [editing, setEditing] = useState<ClinicalNarrative | null>(null);
  const [busy, setBusy] = useState(false);

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
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => setEditing({ ...active })}
                >
                  <Pencil className="size-3.5" />
                  {tx("Редактировать", "Bearbeiten")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="space-y-2.5 p-3">
        {active && activeNonEmpty.length > 0 ? (
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
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            {formatTimestamp(version.updated_at)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              version.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {version.is_active ? tx("активна", "aktiv") : tx("неактивна", "inaktiv")}
                          </span>
                        </div>
                        {snippet ? (
                          <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{snippet}</p>
                        ) : null}
                      </div>
                      {canManage ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="size-7 shrink-0 rounded-md p-0"
                          aria-label={tx("Редактировать", "Bearbeiten")}
                          title={tx("Редактировать", "Bearbeiten")}
                          onClick={() => setEditing({ ...version })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
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
    </section>
  );
}
