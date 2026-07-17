import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PauseCircle, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
  darreichungsformLabel,
} from "@/pages/patients/data/medication-options";
import type {
  ClinicalAttribution,
  ClinicalMedication,
  ClinicalWarning,
  ClinicalWarningKind,
} from "@/pages/patients/data/patient-clinical";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Bilingual = (ru: string, de: string) => string;
type SectionTone = "neutral" | "danger" | "warning";
type IndexedItem<T> = { item: T; index: number };
type SectionGroup = { key: string; label: string };
type HoldDraft = Pick<
  ClinicalMedication,
  "on_hold" | "hold_from" | "hold_until" | "hold_note"
>;
type HoldEditor = {
  index: number;
  medication: ClinicalMedication;
  medications: ClinicalMedication[];
  draft: HoldDraft;
};

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

function localToday(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function medicationHasEnded(item: ClinicalMedication): boolean {
  const endDate = item.einnahme_bis?.slice(0, 10);
  return Boolean(endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate < localToday());
}

function medicationDateRangeValid(item: ClinicalMedication): boolean {
  const intakeStart = item.einnahme_von?.slice(0, 10);
  const intakeEnd = item.einnahme_bis?.slice(0, 10);
  const holdStart = item.hold_from?.slice(0, 10);
  const holdEnd = item.hold_until?.slice(0, 10);
  return !(
    (intakeStart && intakeEnd && intakeEnd < intakeStart)
    || (holdStart && holdEnd && holdEnd < holdStart)
  );
}

function trimDraftStrings<T>(draft: T): T {
  if (!draft || typeof draft !== "object") return draft;
  const out = { ...(draft as Record<string, unknown>) };
  Object.keys(out).forEach((key) => {
    const value = out[key];
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    out[key] = trimmed === "" ? null : trimmed;
  });
  return out as T;
}

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

function blankWarning(kind: ClinicalWarningKind): ClinicalWarning {
  return { kind, label: "", reaction: null, severity: null, note: null };
}

function fieldToneClasses(tone: SectionTone) {
  const addButton =
    "border-orange-500 bg-orange-500 text-white hover:border-orange-600 hover:bg-orange-600 hover:text-white";
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

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{children}</span>;
}

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
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

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
  const [doctorsState, setDoctorsState] = useState<{
    providerId: string | null;
    list: DoctorOption[];
  }>({ providerId: null, list: [] });

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
            onChange({
              ...value,
              provider_id: id,
              provider_name: providers.find((provider) => provider.id === id)?.name ?? null,
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
            const doctor = doctors.find((item) => item.id === id);
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

type ListViewArgs<T extends { id?: string | null }> = {
  indexed: IndexedItem<T>[];
  groups?: SectionGroup[];
  groupOf?: (item: T) => string;
  renderActions: (item: T, index: number) => ReactNode;
};

function ClinicalListSection<T extends { id?: string | null }>({
  title,
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
  items: T[];
  blank: () => T;
  isValid: (draft: T) => boolean;
  rowView?: (item: T) => ReactNode;
  listView?: (args: ListViewArgs<T>) => ReactNode;
  form: (draft: T, set: (patch: Partial<T>) => void) => ReactNode;
  onSave: (next: T[]) => Promise<unknown>;
  canManage: boolean;
  tx: Bilingual;
  groups?: SectionGroup[];
  groupOf?: (item: T) => string;
  tone?: SectionTone;
}) {
  const [list, setList] = useState(items);
  const [editing, setEditing] = useState<{ index: number | null; draft: T } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setList(items);
  }, [items, editing]);

  const set = (patch: Partial<T>) =>
    setEditing((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );

  async function persist(next: T[]) {
    setBusy(true);
    try {
      const saved = await onSave(next);
      setList(Array.isArray(saved) ? (saved as T[]) : next);
      setEditing(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    if (!editing || !isValid(editing.draft)) return;
    const next = [...list];
    const cleaned = trimDraftStrings(editing.draft);
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
          onClick={() => void persist(list.filter((_, itemIndex) => itemIndex !== index))}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    ) : null;

  const toneClasses = fieldToneClasses(tone);
  const indexed = list.map((item, index) => ({ item, index }));
  return (
    <section className={cn("rounded-xl border", toneClasses.section)}>
      <header className={cn("flex items-center justify-between gap-3 border-b px-4 py-3", toneClasses.header)}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <Badge variant="outline" className="rounded-full text-[11px]">{list.length}</Badge>
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
        ) : listView ? (
          listView({ indexed, groups, groupOf, renderActions })
        ) : (
          indexed.map(({ item, index }) => (
            <div
              key={item.id ?? index}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border px-3 py-2",
                toneClasses.row,
              )}
            >
              <div className="min-w-0">{rowView?.(item)}</div>
              {renderActions(item, index)}
            </div>
          ))
        )}

        <PatientSheetScaffold
          open={Boolean(editing)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditing(null);
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

export function PatientClinicalWarningSection({
  kind,
  items,
  canManage,
  lang,
  onSave,
}: {
  kind: ClinicalWarningKind;
  items: ClinicalWarning[];
  canManage: boolean;
  lang: string;
  onSave: (next: ClinicalWarning[]) => Promise<unknown>;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const isAllergy = kind === "allergie";
  return (
    <ClinicalListSection<ClinicalWarning>
      title={isAllergy ? tx("Аллергии", "Allergien") : "CAVE"}
      items={items}
      blank={() => blankWarning(kind)}
      isValid={(warning) => warning.label.trim() !== ""}
      canManage={canManage}
      tone={isAllergy ? "warning" : "danger"}
      tx={tx}
      onSave={onSave}
      rowView={(warning) => (
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={cn(
              "min-w-0 max-w-full break-words text-sm font-medium",
              isAllergy ? "text-orange-950" : "text-rose-950",
            )}>
              {warning.label}
            </span>
            {isAllergy && warning.severity ? (
              <span className="min-w-0 max-w-full break-words text-[11px] text-orange-800">
                {warning.severity}
              </span>
            ) : null}
          </div>
          {isAllergy && warning.reaction ? (
            <p className="min-w-0 max-w-full break-words text-[11px] text-orange-800">
              {warning.reaction}
            </p>
          ) : null}
          {warning.note ? (
            <p className={cn(
              "min-w-0 max-w-full break-words text-[11px]",
              isAllergy ? "text-orange-800" : "text-rose-800",
            )}>
              {warning.note}
            </p>
          ) : null}
        </div>
      )}
      form={(draft, set) => (
        <div className="space-y-2">
          <Field required label={isAllergy ? tx("Аллерген", "Allergen") : "CAVE"}>
            <Input
              required
              value={draft.label}
              onChange={(event) => set({ label: event.target.value })}
              className={inputClass}
              placeholder={isAllergy ? tx("Пенициллин", "Penicillin") : tx("Антикоагуляция", "Antikoagulation")}
            />
          </Field>
          {isAllergy ? (
            <>
              <Field label={tx("Реакция", "Reaktion")}>
                <Input
                  value={draft.reaction ?? ""}
                  onChange={(event) => set({ reaction: blankToNull(event.target.value) })}
                  className={inputClass}
                  placeholder={tx("Сыпь, отёк", "Hautausschlag, Schwellung")}
                />
              </Field>
              <Field label={tx("Тяжесть", "Schweregrad")}>
                <Input
                  value={draft.severity ?? ""}
                  onChange={(event) => set({ severity: blankToNull(event.target.value) })}
                  className={inputClass}
                  placeholder={tx("лёгкая / средняя / тяжёлая", "leicht / mittel / schwer")}
                />
              </Field>
            </>
          ) : null}
          <Field label={tx("Примечание", "Notiz")}>
            <Input
              value={draft.note ?? ""}
              onChange={(event) => set({ note: blankToNull(event.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>
      )}
    />
  );
}

function attributionLabel(item: ClinicalAttribution): string | null {
  const doctor = [item.doctor_title, item.doctor_name].filter(Boolean).join(" ").trim();
  const doctorWithSpecialty = [
    doctor || null,
    item.doctor_fachbereich ? `(${item.doctor_fachbereich})` : null,
  ].filter(Boolean).join(" ");
  return [doctorWithSpecialty || null, item.provider_name].filter(Boolean).join(" · ") || null;
}

function groupedMedicationItems(
  indexed: IndexedItem<ClinicalMedication>[],
  groups: SectionGroup[] | undefined,
  groupOf: ((item: ClinicalMedication) => string) | undefined,
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
    return rows.length ? [{ key: group.key, label: group.label, rows }] : [];
  });
  const remaining = indexed.filter(({ index }) => !groupedIndexes.has(index));
  return remaining.length
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
  groups?: SectionGroup[];
  indexed: IndexedItem<ClinicalMedication>[];
  renderActions: (item: ClinicalMedication, index: number) => ReactNode;
  tx: Bilingual;
}) {
  const sections = groupedMedicationItems(indexed, groups, groupOf, tx("Другое", "Weitere"));
  const columnCount = canManage ? 12 : 11;
  const headCell = "px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const headDoseCell = "px-1.5 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const bodyCell = "break-words px-2.5 py-2 align-top text-foreground";
  const bodyDoseCell = "px-1.5 py-2 text-center align-top font-mono tabular-nums text-foreground";
  const dose = (value: string | null) => value?.trim() ?? "";

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
            {canManage ? <th scope="col" className="px-2 py-2"><span className="sr-only">{tx("Действия", "Aktionen")}</span></th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label && section.key !== "dauer" ? (
                <tr>
                  <td colSpan={columnCount} className="bg-muted/40 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                          : "hover:bg-muted/30",
                    )}
                  >
                    <td className={cn(bodyCell, "whitespace-pre-line")}>{item.wirkstoff || "—"}</td>
                    <td className={cn(bodyCell, "font-medium")}>
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                      {item.einnahme_bis ? (
                        <span className={cn(
                          "mt-0.5 block text-[10px] font-semibold uppercase tracking-wide",
                          ended ? "text-rose-700" : "text-emerald-700",
                        )}>
                          {ended
                            ? tx("Приём завершён", "Einnahme beendet")
                            : tx("Приём до", "Einnahme bis")}{" "}
                          {item.einnahme_bis.slice(0, 10)}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(bodyCell, "whitespace-pre-line font-mono")}>{item.staerke || ""}</td>
                    <td className={cn(bodyCell, "whitespace-pre-line")}>{darreichungsformLabel(item.form)}</td>
                    {item.on_hold ? (
                      <td colSpan={4} className="px-2.5 py-2 align-top text-left text-amber-800">
                        <span className="block text-[11px] font-semibold">
                          {tx("На холд", "Auf Hold")}
                          {item.hold_from ? ` ${tx("с", "seit")} ${item.hold_from.slice(0, 10)}` : ""}
                          {item.hold_until ? ` ${tx("до", "bis")} ${item.hold_until.slice(0, 10)}` : ""}
                        </span>
                        {item.hold_note ? (
                          <span className="mt-0.5 block break-words text-[10px] font-normal">
                            {item.hold_note}
                          </span>
                        ) : null}
                      </td>
                    ) : (
                      <>
                        <td className={bodyDoseCell}>{dose(item.dose_morgens)}</td>
                        <td className={bodyDoseCell}>{dose(item.dose_mittags)}</td>
                        <td className={bodyDoseCell}>{dose(item.dose_abends)}</td>
                        <td className={bodyDoseCell}>{dose(item.dose_nachts)}</td>
                      </>
                    )}
                    <td className={cn(bodyCell, "whitespace-nowrap")}>{item.einheit || ""}</td>
                    <td className={bodyCell}>
                      {item.hinweis ? <span className="whitespace-pre-line break-words">{item.hinweis}</span> : null}
                      {attribution ? <span className="mt-0.5 block break-words text-[10px] text-muted-foreground">{attribution}</span> : null}
                    </td>
                    <td className={bodyCell}>{item.grund || ""}</td>
                    {canManage ? <td className="px-2 py-2 text-right align-top">{renderActions(item, index)}</td> : null}
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

function MedicationHoldDialog({
  editor,
  busy,
  onChange,
  onClose,
  onSubmit,
  tx,
}: {
  editor: HoldEditor | null;
  busy: boolean;
  onChange: (patch: Partial<HoldDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
  tx: Bilingual;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  const draft = editor?.draft;
  const holdRangeValid = Boolean(
    editor
    && draft
    && medicationDateRangeValid({ ...editor.medication, ...draft }),
  );
  return (
    <Dialog allowImplicitDismissal open={Boolean(editor)} onOpenChange={(nextOpen) => {
      if (!nextOpen && !busy) onClose();
    }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tx("На холд", "Auf Hold")}</DialogTitle>
            <DialogDescription>{editor?.medication.handelsname || editor?.medication.wirkstoff || tx("Медикамент", "Medikament")}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <CheckboxField
                label={tx("Пациент не принимает препарат", "Patient nimmt das Medikament nicht")}
                checked={draft.on_hold}
                onChange={(checked) => onChange({
                  on_hold: checked,
                  hold_from: checked ? (draft.hold_from ?? localToday()) : null,
                  hold_until: checked ? draft.hold_until : null,
                  hold_note: checked ? draft.hold_note : null,
                })}
              />
              {draft.on_hold ? (
                <div className="grid gap-3">
                  <Field label={tx("Не принимает с", "Pausiert seit")}>
                    <Input type="date" value={draft.hold_from ?? ""} onChange={(event) => onChange({ hold_from: event.target.value || null })} className={inputClass} />
                  </Field>
                  <Field label={tx("До какого числа", "Bis wann")}>
                    <Input type="date" min={draft.hold_from ?? undefined} value={draft.hold_until ?? ""} onChange={(event) => onChange({ hold_until: event.target.value || null })} className={inputClass} />
                  </Field>
                  <Field label={tx("Заметка", "Notiz")}>
                    <textarea value={draft.hold_note ?? ""} onChange={(event) => onChange({ hold_note: blankToNull(event.target.value) })} className={cn(inputClass, "h-24 resize-y py-2")} />
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
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy} onClick={onClose}>{tx("Отмена", "Abbrechen")}</Button>
            <Button type="submit" size="sm" className="h-8 rounded-lg" disabled={busy || !draft || !holdRangeValid}>
              {draft?.on_hold ? tx("Сохранить холд", "Hold speichern") : tx("Снять холд", "Hold entfernen")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PatientMedicationSection({
  items,
  providers,
  canManage,
  lang,
  onSave,
}: {
  items: ClinicalMedication[];
  providers: ProviderSummary[];
  canManage: boolean;
  lang: string;
  onSave: (next: ClinicalMedication[]) => Promise<unknown>;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const [holdEditor, setHoldEditor] = useState<HoldEditor | null>(null);
  const [holdBusy, setHoldBusy] = useState(false);

  async function submitHold() {
    if (!holdEditor) return;
    const next = holdEditor.medications.map((item, index) =>
      index === holdEditor.index
        ? trimDraftStrings({
            ...item,
            on_hold: holdEditor.draft.on_hold,
            hold_from: holdEditor.draft.on_hold ? holdEditor.draft.hold_from : null,
            hold_until: holdEditor.draft.on_hold ? holdEditor.draft.hold_until : null,
            hold_note: holdEditor.draft.on_hold ? holdEditor.draft.hold_note : null,
          })
        : item,
    );
    setHoldBusy(true);
    try {
      await onSave(next);
      setHoldEditor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setHoldBusy(false);
    }
  }

  return (
    <>
      <ClinicalListSection<ClinicalMedication>
        title={tx("Медикаменты", "Medikation")}
        items={items}
        blank={blankMedication}
        isValid={(medication) =>
          Boolean(
            medication.wirkstoff?.trim()
            && medication.einnahmeform
            && medication.form
            && medicationDateRangeValid(medication),
          )
        }
        canManage={canManage}
        tx={tx}
        groups={[
          { key: "dauer", label: tx("Постоянная", "Dauermedikation") },
          { key: "besondere", label: tx("В особое время", "Zu besonderen Zeiten anzuwendende Medikamente") },
          { key: "selbst", label: tx("Самолечение", "Selbstmedikation") },
        ]}
        groupOf={(medication) => medication.category}
        onSave={onSave}
        listView={({ indexed, groups, groupOf, renderActions }) => (
          <PatientMedicationTable
            indexed={indexed}
            groups={groups}
            groupOf={groupOf}
            canManage={canManage}
            tx={tx}
            renderActions={(item, index) => (
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn("size-7 rounded-md p-0", item.on_hold ? "text-emerald-700" : "text-amber-700")}
                  aria-label={item.on_hold ? tx("Снять с холда", "Hold entfernen") : tx("Поставить на холд", "Auf Hold setzen")}
                  title={item.on_hold ? tx("Снять с холда", "Hold entfernen") : tx("Поставить на холд", "Auf Hold setzen")}
                  disabled={holdBusy}
                  onClick={() => setHoldEditor({
                    index,
                    medication: item,
                    medications: indexed.map((entry) => entry.item),
                    draft: {
                      on_hold: Boolean(item.on_hold),
                      hold_from: item.hold_from ?? null,
                      hold_until: item.hold_until ?? null,
                      hold_note: item.hold_note ?? null,
                    },
                  })}
                >
                  {item.on_hold ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}
                </Button>
                {renderActions(item, index)}
              </div>
            )}
          />
        )}
        form={(draft, set) => (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Категория", "Kategorie")}>
                <NativeComboboxSelect value={draft.category} aria-label={tx("Категория", "Kategorie")} className={inputClass} onChange={(event) => set({ category: event.target.value as ClinicalMedication["category"] })}>
                  <option value="dauer">{tx("Постоянная", "Dauermedikation")}</option>
                  <option value="besondere">{tx("По особым показаниям", "Zu besonderen Zeiten")}</option>
                  <option value="selbst">{tx("Самолечение", "Selbstmedikation")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field required label={tx("Форма выпуска", "Darreichungsform")}>
                <NativeComboboxSelect value={draft.form ?? ""} required aria-label={tx("Форма выпуска", "Darreichungsform")} className={inputClass} onChange={(event) => set({ form: event.target.value || null })}>
                  <option value="">—</option>
                  {DARREICHUNGSFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  {draft.form && !DARREICHUNGSFORM_OPTIONS.some((option) => option.value === draft.form) ? <option value={draft.form}>{draft.form}</option> : null}
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field required label={tx("Способ применения", "Einnahmeform")}>
                <NativeComboboxSelect value={draft.einnahmeform ?? ""} required aria-label={tx("Способ применения", "Einnahmeform")} className={inputClass} onChange={(event) => set({ einnahmeform: event.target.value || null })}>
                  <option value="">—</option>
                  {EINNAHMEFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </NativeComboboxSelect>
              </Field>
              <Field label={tx("Статус", "Status")}>
                <NativeComboboxSelect value={draft.status} aria-label={tx("Статус", "Status")} className={inputClass} onChange={(event) => set({ status: event.target.value as ClinicalMedication["status"] })}>
                  <option value="aktiv">{tx("Активный", "Aktiv")}</option>
                  <option value="pausiert">{tx("Приостановлен", "Pausiert")}</option>
                  <option value="abgesetzt">{tx("Отменён", "Abgesetzt")}</option>
                  <option value="geplant">{tx("Запланирован", "Geplant")}</option>
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Торговое название", "Handelsname")}><Input value={draft.handelsname} onChange={(event) => set({ handelsname: event.target.value })} className={inputClass} /></Field>
              <Field required label={tx("Действующее вещество", "Wirkstoff")}><Input required value={draft.wirkstoff ?? ""} onChange={(event) => set({ wirkstoff: blankToNull(event.target.value) })} className={inputClass} /></Field>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Дозировка", "Stärke")}><Input value={draft.staerke ?? ""} onChange={(event) => set({ staerke: blankToNull(event.target.value) })} className={inputClass} /></Field>
              <Field label={tx("Единица", "Einheit")}><Input value={draft.einheit ?? ""} onChange={(event) => set({ einheit: blankToNull(event.target.value) })} className={inputClass} /></Field>
            </div>
            <div>
              <FieldLabel>{tx("Приём: Утро · День · Вечер · Ночь", "Einnahme: Morgens · Mittags · Abends · zur Nacht")}</FieldLabel>
              <div className="grid grid-cols-4 gap-2">
                {(["dose_morgens", "dose_mittags", "dose_abends", "dose_nachts"] as const).map((key, index) => (
                  <Input
                    key={key}
                    value={draft[key] ?? ""}
                    onChange={(event) => set({ [key]: blankToNull(event.target.value) } as Partial<ClinicalMedication>)}
                    className={cn(inputClass, "text-center")}
                    aria-label={[tx("Доза утром", "Dosis morgens"), tx("Доза в обед", "Dosis mittags"), tx("Доза вечером", "Dosis abends"), tx("Доза на ночь", "Dosis zur Nacht")][index]}
                    placeholder={["M", "Mi", "A", "N"][index]}
                  />
                ))}
              </div>
            </div>
            <Field label={tx("Причина", "Grund")}><Input value={draft.grund ?? ""} onChange={(event) => set({ grund: blankToNull(event.target.value) })} className={inputClass} /></Field>
            <Field label={tx("Указания", "Hinweise")}><Input value={draft.hinweis ?? ""} onChange={(event) => set({ hinweis: blankToNull(event.target.value) })} className={inputClass} /></Field>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label={tx("Дата назначения", "Verordnet am")}><Input type="date" value={draft.verordnet_am ?? ""} onChange={(event) => set({ verordnet_am: blankToNull(event.target.value) })} className={inputClass} /></Field>
              <Field label={tx("Приём с", "Einnahme von")}><Input type="date" value={draft.einnahme_von ?? ""} onChange={(event) => set({ einnahme_von: blankToNull(event.target.value) })} className={inputClass} /></Field>
              <Field label={tx("Приём до", "Einnahme bis")}><Input type="date" min={draft.einnahme_von ?? undefined} aria-invalid={!medicationDateRangeValid(draft)} value={draft.einnahme_bis ?? ""} onChange={(event) => set({ einnahme_bis: blankToNull(event.target.value) })} className={cn(inputClass, !medicationDateRangeValid(draft) && "border-destructive")} /></Field>
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
              <legend className="px-1 text-[11px] font-medium text-muted-foreground">{tx("Правовой статус", "Rechtlicher Status")}</legend>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <CheckboxField label={tx("Аптечный", "Apothekenpflichtig")} checked={draft.apothekenpflichtig} onChange={(checked) => set({ apothekenpflichtig: checked })} />
                <CheckboxField label={tx("Рецептурный", "Rezeptpflichtig")} checked={draft.rezeptpflichtig} onChange={(checked) => set({ rezeptpflichtig: checked })} />
                <CheckboxField label={tx("Наркотическое (BTM)", "Betäubungsmittel (BTM)")} checked={draft.btm} onChange={(checked) => set({ btm: checked })} />
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-border/60 p-2">
              <legend className="px-1 text-[11px] font-medium text-muted-foreground">{tx("Предупреждения", "Warnhinweise")}</legend>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <CheckboxField label={tx("Aut-Idem-блок", "Aut-Idem-Sperre")} checked={draft.aut_idem_sperre} onChange={(checked) => set({ aut_idem_sperre: checked })} />
                <CheckboxField label={tx("Огранич. отпуска", "Abgabebeschränkung")} checked={draft.abgabebeschraenkung} onChange={(checked) => set({ abgabebeschraenkung: checked })} />
                <CheckboxField label={tx("Прочие пометки", "Sonstige Vermerke")} checked={draft.sonstige_vermerke !== null} onChange={(checked) => set({ sonstige_vermerke: checked ? (draft.sonstige_vermerke ?? "") : null })} />
              </div>
              {draft.sonstige_vermerke !== null ? <Input value={draft.sonstige_vermerke} onChange={(event) => set({ sonstige_vermerke: event.target.value })} className={cn(inputClass, "mt-2")} /> : null}
            </fieldset>
            <ProviderDoctorFields value={draft} providers={providers} tx={tx} onChange={(attribution) => set(attribution as Partial<ClinicalMedication>)} />
          </div>
        )}
      />
      <MedicationHoldDialog
        editor={holdEditor}
        busy={holdBusy}
        tx={tx}
        onChange={(patch) => setHoldEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current)}
        onClose={() => {
          if (!holdBusy) setHoldEditor(null);
        }}
        onSubmit={() => void submitHold()}
      />
    </>
  );
}
