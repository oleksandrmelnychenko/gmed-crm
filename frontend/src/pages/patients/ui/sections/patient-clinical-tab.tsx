import { Fragment, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import { fetchProviders } from "@/pages/providers/data/provider-api";
import type { ProviderSummary } from "@/pages/providers/model/types";

import {
  blankNarrative,
  fetchPatientClinical,
  fetchPatientRecommendations,
  savePatientDiagnoses,
  savePatientExaminations,
  savePatientMedications,
  savePatientNarrative,
  savePatientProcedures,
  type ClinicalAttribution,
  type ClinicalDiagnosis,
  type ClinicalExamination,
  type ClinicalMedication,
  type ClinicalNarrative,
  type ClinicalProcedure,
  type PatientRecommendation,
} from "@/pages/patients/data/patient-clinical";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

type ClinicalSectionGroup = { key: string; label: string };
type IndexedClinicalItem<T> = { item: T; index: number };

type ClinicalSectionListViewArgs<T extends { id?: string }> = {
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
  };
}

function blankDiagnosis(): ClinicalDiagnosis {
  return {
    ...blankAttribution(),
    kind: "secondary",
    label: "",
    icd_code: null,
    grade: null,
    laterality: null,
    status: "active",
    diagnosed_on: null,
    note: null,
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
    dose_morgens: null,
    dose_mittags: null,
    dose_abends: null,
    dose_nachts: null,
    einheit: null,
    hinweis: null,
    grund: null,
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

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
      <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
        <thead className="border-b border-border/70 bg-muted/40 text-[11px] uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Действующее вещество", "Wirkstoff")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Торговое название", "Handelsname")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Дозировка", "Stärke")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Форма", "Form")}</th>
            <th scope="col" className="px-1.5 py-2 text-center font-semibold">{tx("Утро", "Morgens")}</th>
            <th scope="col" className="px-1.5 py-2 text-center font-semibold">{tx("День", "Mittags")}</th>
            <th scope="col" className="px-1.5 py-2 text-center font-semibold">{tx("Вечер", "Abends")}</th>
            <th scope="col" className="px-1.5 py-2 text-center font-semibold">{tx("Ночь", "Zur Nacht")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Ед.", "Einheit")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Указания", "Hinweise")}</th>
            <th scope="col" className="px-2.5 py-2 font-semibold">{tx("Показание", "Grund")}</th>
            {canManage ? (
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                <span className="sr-only">{tx("Действия", "Aktionen")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label ? (
                <tr className="bg-card/80">
                  <td colSpan={columnCount} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {section.label}
                      </span>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {section.rows.length}
                      </Badge>
                    </div>
                  </td>
                </tr>
              ) : null}
              {section.rows.map(({ item, index }) => {
                const attribution = attributionLabel(item);
                return (
                  <tr key={item.id ?? index} className="align-top transition-colors hover:bg-muted/25">
                    <td className="px-2.5 py-2.5 text-foreground">{item.wirkstoff || "—"}</td>
                    <td className="px-2.5 py-2.5 font-medium text-foreground">
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 font-mono text-foreground">
                      {item.staerke || ""}
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground">{item.form || ""}</td>
                    <td className="px-1.5 py-2.5 text-center font-mono text-foreground">{doseCell(item.dose_morgens)}</td>
                    <td className="px-1.5 py-2.5 text-center font-mono text-foreground">{doseCell(item.dose_mittags)}</td>
                    <td className="px-1.5 py-2.5 text-center font-mono text-foreground">{doseCell(item.dose_abends)}</td>
                    <td className="px-1.5 py-2.5 text-center font-mono text-foreground">{doseCell(item.dose_nachts)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-foreground">{item.einheit || ""}</td>
                    <td className="px-2.5 py-2.5 text-muted-foreground">
                      {item.hinweis ? <span className="break-words">{item.hinweis}</span> : null}
                      {attribution ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground/80">{attribution}</span>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2.5 text-foreground">{item.grund || ""}</td>
                    {canManage ? (
                      <td className="px-2 py-2 text-right">
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
    </div>
  );
}

/** Generic add / edit / remove + replace-all-save list for one clinical section. */
function ClinicalSection<T extends { id?: string }>({
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
        {canManage && !editing ? (
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
        {list.length === 0 && !editing ? (
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

        {editing ? (
          <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/[0.03] p-3">
            {form(editing.draft, set)}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg"
                onClick={() => setEditing(null)}
              >
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={busy || !isValid(editing.draft)}
                onClick={submitDraft}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </div>
          </div>
        ) : null}
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

/** Free-text Arztbrief blocks (Anamnese sub-sections, Befund, Beurteilung, Verlauf). */
function NarrativeSection({
  value,
  canManage,
  onSave,
  tx,
}: {
  value: ClinicalNarrative;
  canManage: boolean;
  onSave: (next: ClinicalNarrative) => Promise<unknown>;
  tx: Bilingual;
}) {
  const [draft, setDraft] = useState<ClinicalNarrative>(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const fields: Array<{ key: keyof ClinicalNarrative; label: string }> = [
    { key: "anamnese_aktuelle", label: tx("Актуальный анамнез", "Aktuelle Anamnese") },
    { key: "anamnese_vorgeschichte", label: tx("Доп. предыстория", "Weitere Vorgeschichte") },
    { key: "anamnese_vegetative", label: tx("Вегетативный анамнез", "Vegetative Anamnese") },
    { key: "anamnese_sozial", label: tx("Социальный анамнез", "Sozialanamnese") },
    { key: "untersuchungsbefund", label: tx("Объективный осмотр", "Untersuchungsbefund") },
    { key: "beurteilung", label: tx("Оценка", "Beurteilung") },
    { key: "verlauf", label: tx("Течение", "Verlauf") },
  ];

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{tx("Анамнез и заключение", "Anamnese & Beurteilung")}</h3>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {tx("Сохранить", "Speichern")}
          </Button>
        ) : null}
      </header>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <textarea
              value={draft[field.key] ?? ""}
              disabled={!canManage}
              onChange={(e) =>
                setDraft((current) => ({ ...current, [field.key]: e.target.value === "" ? null : e.target.value }))
              }
              className={cn(inputClass, "h-20 py-2")}
            />
          </Field>
        ))}
      </div>
    </section>
  );
}

export function PatientClinicalTab({
  patientId,
  canManage,
}: {
  patientId: string;
  canManage: boolean;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [medications, setMedications] = useState<ClinicalMedication[]>([]);
  const [examinations, setExaminations] = useState<ClinicalExamination[]>([]);
  const [procedures, setProcedures] = useState<ClinicalProcedure[]>([]);
  const [narrative, setNarrative] = useState<ClinicalNarrative>(blankNarrative());
  const [recommendations, setRecommendations] = useState<PatientRecommendation[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
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
      fetchProviders("/providers?active_only=true").catch(() => [] as ProviderSummary[]),
    ])
      .then(([clinical, recs, providerRows]) => {
        if (!active) return;
        setDiagnoses(clinical.diagnoses ?? []);
        setMedications(clinical.medications ?? []);
        setExaminations(clinical.examinations ?? []);
        setProcedures(clinical.procedures ?? []);
        setNarrative(clinical.narrative ?? blankNarrative());
        setRecommendations(recs ?? []);
        setProviders(providerRows ?? []);
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
      <TabsContent value="clinical" className="mt-4 min-h-[400px]">
        <p className="py-10 text-center text-sm text-muted-foreground">{tx("Загрузка…", "Laden…")}</p>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="clinical" className="mt-4 min-h-[400px] space-y-4">
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

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* ---- Diagnoses ---- */}
      <ClinicalSection<ClinicalDiagnosis>
        title={tx("Диагнозы", "Diagnosen")}
        items={diagnoses}
        blank={blankDiagnosis}
        isValid={(d) => d.label.trim() !== ""}
        canManage={canManage}
        tx={tx}
        groups={[
          { key: "main", label: tx("Основной диагноз", "Hauptdiagnose") },
          { key: "secondary", label: tx("Сопутствующие диагнозы", "Nebendiagnosen") },
        ]}
        groupOf={(d) => d.kind}
        onSave={async (next) => {
          await savePatientDiagnoses(patientId, next);
          setDiagnoses(next);
        }}
        rowView={(d) => (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[10px]",
                  d.kind === "main" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-border bg-muted/30",
                )}
              >
                {d.kind === "main" ? tx("Основной", "Hauptdiagnose") : tx("Сопутств.", "Nebendiagnose")}
              </Badge>
              <span className="text-sm font-medium text-foreground">{d.label}</span>
              {d.icd_code ? (
                <span className="font-mono text-[11px] text-muted-foreground">({d.icd_code})</span>
              ) : null}
              {d.grade ? <span className="text-[11px] text-muted-foreground">{d.grade}</span> : null}
            </div>
            {attributionRow(d)}
          </div>
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Тип", "Art")}>
                <NativeComboboxSelect
                  value={draft.kind}
                  aria-label={tx("Тип", "Art")}
                  className={inputClass}
                  onChange={(e) => set({ kind: e.target.value as ClinicalDiagnosis["kind"] })}
                >
                  <option value="main">{tx("Основной", "Hauptdiagnose")}</option>
                  <option value="secondary">{tx("Сопутствующий", "Nebendiagnose")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Статус", "Status")}>
                <NativeComboboxSelect
                  value={draft.status}
                  aria-label={tx("Статус", "Status")}
                  className={inputClass}
                  onChange={(e) => set({ status: e.target.value as ClinicalDiagnosis["status"] })}
                >
                  <option value="active">{tx("Активный", "Aktiv")}</option>
                  <option value="chronic">{tx("Хронический", "Chronisch")}</option>
                  <option value="resolved">{tx("Разрешён", "Ausgeheilt")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
            <Field label={tx("Диагноз", "Diagnose")}>
              <Input
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                className={inputClass}
                placeholder={tx("напр. Akute Appendizitis", "z. B. Akute Appendizitis")}
              />
            </Field>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label="ICD-10">
                <Input
                  value={draft.icd_code ?? ""}
                  onChange={(e) => set({ icd_code: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="K35.8"
                />
              </Field>
              <Field label={tx("Степень", "Grad")}>
                <Input
                  value={draft.grade ?? ""}
                  onChange={(e) => set({ grade: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Grad 1"
                />
              </Field>
              <Field label={tx("Сторона", "Seite")}>
                <NativeComboboxSelect
                  value={draft.laterality ?? ""}
                  aria-label={tx("Сторона", "Seite")}
                  className={inputClass}
                  onChange={(e) =>
                    set({ laterality: (e.target.value || null) as ClinicalDiagnosis["laterality"] })
                  }
                >
                  <option value="">—</option>
                  <option value="left">{tx("Слева", "Links")}</option>
                  <option value="right">{tx("Справа", "Rechts")}</option>
                  <option value="bilateral">{tx("Двусторонне", "Beidseits")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
            <Field label={tx("Дата диагноза", "Erstdiagnose")}>
              <Input
                value={draft.diagnosed_on ?? ""}
                onChange={(e) => set({ diagnosed_on: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder="ED 08/2022"
              />
            </Field>
            <ProviderDoctorFields
              value={draft}
              providers={providers}
              tx={tx}
              onChange={(attr) => set(attr as Partial<ClinicalDiagnosis>)}
            />
          </div>
        )}
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
                  value={draft.performed_on ?? ""}
                  onChange={(e) => set({ performed_on: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="31.07.2016"
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

      {/* ---- Anamnese / Befund / Beurteilung / Verlauf ---- */}
      <NarrativeSection
        value={narrative}
        canManage={canManage}
        tx={tx}
        onSave={async (next) => {
          await savePatientNarrative(patientId, next);
          setNarrative(next);
        }}
      />

      {/* ---- Medications (Medikationsplan) ---- */}
      <ClinicalSection<ClinicalMedication>
        title={tx("Медикаменты", "Medikation")}
        items={medications}
        blank={blankMedication}
        isValid={(m) => m.handelsname.trim() !== ""}
        canManage={canManage}
        tx={tx}
        groups={[
          { key: "dauer", label: tx("Постоянная", "Dauermedikation") },
          { key: "besondere", label: tx("По особым показаниям", "Zu besonderen Zeiten") },
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
              <Field label="Form">
                <Input
                  value={draft.form ?? ""}
                  onChange={(e) => set({ form: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Filmtabl."
                />
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="Handelsname">
                <Input
                  value={draft.handelsname}
                  onChange={(e) => set({ handelsname: e.target.value })}
                  className={inputClass}
                  placeholder="Bisoprolol-ratiopharm"
                />
              </Field>
              <Field label="Wirkstoff">
                <Input
                  value={draft.wirkstoff ?? ""}
                  onChange={(e) => set({ wirkstoff: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="Bisoprolol"
                />
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="Stärke">
                <Input
                  value={draft.staerke ?? ""}
                  onChange={(e) => set({ staerke: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="5 mg"
                />
              </Field>
              <Field label="Einheit">
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
            <Field label="Grund">
              <Input
                value={draft.grund ?? ""}
                onChange={(e) => set({ grund: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder="Bluthochdruck"
              />
            </Field>
            <Field label="Hinweise">
              <Input
                value={draft.hinweis ?? ""}
                onChange={(e) => set({ hinweis: trimToNull(e.target.value) })}
                className={inputClass}
                placeholder="Während oder nach den Mahlzeiten"
              />
            </Field>
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
                  value={draft.performed_on ?? ""}
                  onChange={(e) => set({ performed_on: trimToNull(e.target.value) })}
                  className={inputClass}
                  placeholder="01.03.2017"
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

      {/* ---- Recommendations (read-only, existing feature) ---- */}
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{tx("Рекомендации", "Empfehlungen")}</h3>
          <Badge variant="outline" className="rounded-full text-[11px]">{recommendations.length}</Badge>
        </header>
        <div className="space-y-2 p-3">
          {recommendations.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {tx("Рекомендаций нет", "Keine Empfehlungen")}
            </p>
          ) : (
            recommendations.map((rec) => (
              <div key={rec.id} className="rounded-lg border border-border/50 bg-background px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{rec.title}</span>
                  {rec.due_at ? <span className="text-[11px] text-muted-foreground">{rec.due_at}</span> : null}
                  {rec.status ? (
                    <Badge variant="outline" className="rounded-full text-[10px]">{rec.status}</Badge>
                  ) : null}
                </div>
                {rec.description ? (
                  <p className="text-[11px] text-muted-foreground">{rec.description}</p>
                ) : null}
                {rec.source_doctor_name ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{rec.source_doctor_name}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </TabsContent>
  );
}
