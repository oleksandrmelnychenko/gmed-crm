import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect, countryLabel } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";
import type {
  AllDoctorOption,
  ClinicalDiagnosis,
} from "@/pages/patients/data/patient-clinical";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Bilingual = (ru: string, de: string) => string;

type DiagnosisKind = "main" | "secondary" | "prozedur";

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";
const rootAddActionClass =
  "border border-orange-500 bg-orange-500 text-white shadow-sm hover:border-orange-600 hover:bg-orange-600 hover:text-white";
const childAddActionClass =
  "border border-border/70 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground";

/**
 * A working node mirrors `ClinicalDiagnosis` but always carries a stable client
 * id (`cid`) and a client parent reference (`parent_cid`) — the tree is rebuilt
 * from these so newly added nodes (without a server uuid) can still be nested.
 */
type WorkingNode = ClinicalDiagnosis & {
  cid: string;
  parent_cid: string | null;
};

let cidCounter = 0;
function nextCid(): string {
  cidCounter += 1;
  return `new-${cidCounter}`;
}

/**
 * Empty string -> null. Does NOT trim, so spaces stay typeable in controlled
 * inputs (trimming on every keystroke strips the just-typed trailing space).
 * Trimming happens once, on save, via {@link trimDraftStrings}.
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

/** Allowed child kinds for a given parent kind, per the nesting rules. */
function allowedChildKinds(kind: DiagnosisKind): DiagnosisKind[] {
  switch (kind) {
    case "main":
      return ["secondary", "prozedur"];
    case "secondary":
      return ["prozedur"];
    case "prozedur":
      return ["prozedur"];
    default:
      return [];
  }
}

function kindLabel(kind: DiagnosisKind, tx: Bilingual): string {
  switch (kind) {
    case "main":
      return tx("Основной", "Hauptdiagnose");
    case "secondary":
      return tx("Сопутствующий", "Nebendiagnose");
    case "prozedur":
      return tx("Процедура", "Prozedur");
    default:
      return kind;
  }
}

function kindPillClass(kind: DiagnosisKind): string {
  switch (kind) {
    case "main":
      return "border-sky-300 bg-sky-50 text-sky-700";
    case "secondary":
      return "border-violet-300 bg-violet-50 text-violet-700";
    case "prozedur":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    default:
      return "border-border bg-transparent text-muted-foreground";
  }
}

function diagnosisRowClass(kind: DiagnosisKind): string {
  switch (kind) {
    case "main":
      return "border-sky-300 bg-sky-50/40";
    case "secondary":
      return "border-violet-300 bg-violet-50/40";
    case "prozedur":
      return "border-emerald-300 bg-emerald-50/40";
    default:
      return "border-border/70";
  }
}

function childActionLabel(kind: DiagnosisKind, tx: Bilingual): string {
  switch (kind) {
    case "secondary":
      return tx("Поддиагноз", "Unterdiagnose");
    case "prozedur":
      return tx("Процедура к этому", "Prozedur dazu");
    default:
      return kindLabel(kind, tx);
  }
}

function certaintyLabel(
  certainty: ClinicalDiagnosis["certainty"],
  tx: Bilingual,
): string | null {
  switch (certainty) {
    case "verdacht":
      return "V.a.";
    case "bestaetigt":
      return tx("Подтверждён", "Bestätigt");
    case "zustand_nach":
      return "Z.n.";
    default:
      return null;
  }
}

function certaintyPillClass(certainty: ClinicalDiagnosis["certainty"]): string {
  switch (certainty) {
    case "verdacht":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "bestaetigt":
      return "border-teal-300 bg-teal-50 text-teal-800";
    case "zustand_nach":
      return "border-indigo-300 bg-indigo-50 text-indigo-800";
    default:
      return "border-border bg-transparent text-muted-foreground";
  }
}

function chronifizierungLabel(
  value: ClinicalDiagnosis["chronifizierung"],
  tx: Bilingual,
): string | null {
  switch (value) {
    case "akut":
      return tx("Острый", "Akut");
    case "chronisch":
      return tx("Хронический", "Chronisch");
    case "rezidivierend":
      return tx("Рецидивирующий", "Rezidivierend");
    default:
      return null;
  }
}

/** Certainty prefix shown in front of the label (V.a. / Z.n. / none). */
function certaintyPrefix(certainty: ClinicalDiagnosis["certainty"]): string {
  switch (certainty) {
    case "verdacht":
      return "V.a. ";
    case "zustand_nach":
      return "Z.n. ";
    default:
      return "";
  }
}

function displayLabel(node: WorkingNode): string {
  return `${certaintyPrefix(node.certainty)}${node.label}`.trim();
}

/** Build a working node carrying a blank `ClinicalDiagnosis` of the given kind. */
function blankNode(kind: DiagnosisKind, parentCid: string | null): WorkingNode {
  return {
    cid: nextCid(),
    parent_cid: parentCid,
    id: null,
    parent_id: null,
    kind,
    label: "",
    certainty: kind === "prozedur" ? null : "bestaetigt",
    chronifizierung: null,
    icd_code: null,
    ops_code: null,
    diagnosed_on: null,
    note: null,
    source_mode: "intern",
    provider_id: null,
    provider_name: null,
    doctor_id: null,
    doctor_name: null,
    doctor_title: null,
    doctor_fachbereich: null,
    external_clinic: null,
    external_doctor: null,
    external_country: null,
    treating_doctor_id: null,
    treating_doctor_name: null,
    treating_doctor_title: null,
    treating_none: false,
  };
}

/** Map the flat props payload into working nodes (cid = id, parent_cid = parent_id). */
function nodesFromItems(items: ClinicalDiagnosis[]): WorkingNode[] {
  return items.map((item) => ({
    ...item,
    cid: item.id ?? nextCid(),
    parent_cid: item.parent_id ?? null,
    id: item.id ?? null,
    parent_id: item.parent_id ?? null,
  }));
}

/** Flatten the tree depth-first, parents strictly before their children. */
function flattenDepthFirst(nodes: WorkingNode[]): ClinicalDiagnosis[] {
  const childrenByParent = new Map<string | null, WorkingNode[]>();
  for (const node of nodes) {
    const list = childrenByParent.get(node.parent_cid) ?? [];
    list.push(node);
    childrenByParent.set(node.parent_cid, list);
  }

  const ordered: ClinicalDiagnosis[] = [];
  const visit = (parentCid: string | null) => {
    for (const node of childrenByParent.get(parentCid) ?? []) {
      // The contract's ClinicalDiagnosis carries cid/parent_cid, so each working
      // node is wire-ready as-is; the backend maps cid -> uuid on save.
      ordered.push(node);
      visit(node.cid);
    }
  };
  visit(null);
  return ordered;
}

/** Collect a node and all of its descendants (used by delete). */
function descendantCids(nodes: WorkingNode[], rootCid: string): Set<string> {
  const childrenByParent = new Map<string | null, WorkingNode[]>();
  for (const node of nodes) {
    const list = childrenByParent.get(node.parent_cid) ?? [];
    list.push(node);
    childrenByParent.set(node.parent_cid, list);
  }
  const collected = new Set<string>([rootCid]);
  const visit = (cid: string) => {
    for (const child of childrenByParent.get(cid) ?? []) {
      collected.add(child.cid);
      visit(child.cid);
    }
  };
  visit(rootCid);
  return collected;
}

// A label that wraps its control, so the visible caption is also the control's
// accessible name (implicit association — no id juggling).
function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Provider-scoped doctor attribution (mirrors ProviderDoctorFields in the clinical tab). */
function ProviderDoctorFields({
  draft,
  providers,
  onChange,
  tx,
}: {
  draft: WorkingNode;
  providers: ProviderSummary[];
  onChange: (patch: Partial<WorkingNode>) => void;
  tx: Bilingual;
}) {
  const [doctorsState, setDoctorsState] = useState<{ providerId: string | null; list: DoctorOption[] }>(
    { providerId: null, list: [] },
  );

  useEffect(() => {
    let active = true;
    const providerId = draft.provider_id;
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
  }, [draft.provider_id]);

  const doctors = doctorsState.providerId === draft.provider_id ? doctorsState.list : [];

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <Field label={tx("Провайдер", "Anbieter")}>
        <NativeComboboxSelect
          value={draft.provider_id ?? ""}
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
          value={draft.doctor_id ?? ""}
          disabled={!draft.provider_id}
          aria-label={tx("Врач", "Arzt")}
          className={inputClass}
          onChange={(event) => {
            const id = event.target.value || null;
            const doctor = doctors.find((d) => d.id === id);
            onChange({
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

/** Read-only "Verordnet von" attribution line for a node row. */
function attributionLine(node: WorkingNode, lang: string): string | null {
  if (node.source_mode === "extern") {
    const country = countryLabel(node.external_country, lang);
    const parts = [node.external_doctor, node.external_clinic, country || null].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  const doctor = [node.doctor_title, node.doctor_name].filter(Boolean).join(" ").trim();
  const parts = [doctor || null, node.provider_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

type EditingState = { mode: "add" | "edit"; draft: WorkingNode };

function DiagnosisRow({
  node,
  depth,
  childrenByParent,
  canManage,
  lang,
  tx,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: WorkingNode;
  depth: number;
  childrenByParent: Map<string | null, WorkingNode[]>;
  canManage: boolean;
  lang: string;
  tx: Bilingual;
  onAddChild: (parent: WorkingNode, kind: DiagnosisKind) => void;
  onEdit: (node: WorkingNode) => void;
  onDelete: (node: WorkingNode) => void;
}) {
  const children = childrenByParent.get(node.cid) ?? [];
  const chron = chronifizierungLabel(node.chronifizierung, tx);
  const certainty = node.kind === "prozedur" ? null : certaintyLabel(node.certainty, tx);
  const attribution = attributionLine(node, lang);
  const childKinds = allowedChildKinds(node.kind);
  const code = node.kind === "prozedur" ? node.ops_code : node.icd_code;

  return (
    <div className="relative">
      {depth > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -left-4 top-5 h-px w-4 bg-border/70"
        />
      ) : null}
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border px-3 py-2",
          diagnosisRowClass(node.kind),
        )}
      >
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", kindPillClass(node.kind))}
            >
              {kindLabel(node.kind, tx)}
            </span>
            {certainty ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  certaintyPillClass(node.certainty),
                )}
              >
                {certainty}
              </span>
            ) : null}
            <span className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
              {node.label}
            </span>
            {code ? (
              <span className="min-w-0 max-w-full break-words font-mono text-[11px] text-muted-foreground">
                ({code})
              </span>
            ) : null}
            {chron ? (
              <span className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
                {chron}
              </span>
            ) : null}
            {node.diagnosed_on ? (
              <span className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
                {node.diagnosed_on}
              </span>
            ) : null}
          </div>
          {node.note ? (
            <p className="min-w-0 max-w-full break-words text-[11px] text-muted-foreground">{node.note}</p>
          ) : null}
          {attribution ? (
            <p className="mt-0.5 min-w-0 max-w-full break-words text-[11px] text-muted-foreground">
              {tx("Назначил", "Verordnet von")}: {attribution}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {childKinds.map((childKind) => (
              <Button
                key={childKind}
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7 rounded-md px-2 text-[11px]", childAddActionClass)}
                title={`${childActionLabel(childKind, tx)} ${tx("под", "unter")}: ${displayLabel(node)}`}
                onClick={() => onAddChild(node, childKind)}
              >
                <Plus className="size-3.5" />
                {childActionLabel(childKind, tx)}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-7 rounded-md p-0"
              aria-label={tx("Редактировать", "Bearbeiten")}
              title={tx("Редактировать", "Bearbeiten")}
              onClick={() => onEdit(node)}
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
              onClick={() => onDelete(node)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      {children.length > 0 ? (
        <div className="relative mt-2 ml-4 space-y-2 border-l border-border/70 pl-4">
          {children.map((child) => (
            <DiagnosisRow
              key={child.cid}
              node={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              canManage={canManage}
              lang={lang}
              tx={tx}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosisForm({
  draft,
  providers,
  allDoctors,
  lang,
  tx,
  parentLabel,
  set,
}: {
  draft: WorkingNode;
  providers: ProviderSummary[];
  allDoctors: AllDoctorOption[];
  lang: string;
  tx: Bilingual;
  parentLabel: string | null;
  set: (patch: Partial<WorkingNode>) => void;
}) {
  const isDiagnosis = draft.kind === "main" || draft.kind === "secondary";

  return (
    <div className="space-y-3">
      {parentLabel ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {tx("Запись будет вложена под", "Eintrag wird untergeordnet zu")}:{" "}
          <span className="font-medium">{parentLabel}</span>
        </div>
      ) : null}

      <Field label={tx("Диагноз", "Diagnose")}>
        <Input
          value={draft.label}
          onChange={(e) => set({ label: e.target.value })}
          className={inputClass}
          placeholder={
            draft.kind === "prozedur"
              ? tx("напр. Appendektomie", "z. B. Appendektomie")
              : tx("напр. Akute Appendizitis", "z. B. Akute Appendizitis")
          }
        />
      </Field>

      {isDiagnosis ? (
        <div className="grid gap-2 md:grid-cols-2">
          <Field label={tx("Достоверность", "Sicherheit")}>
            <NativeComboboxSelect
              value={draft.certainty ?? ""}
              aria-label={tx("Достоверность", "Sicherheit")}
              className={inputClass}
              onChange={(e) =>
                set({ certainty: (e.target.value || null) as ClinicalDiagnosis["certainty"] })
              }
            >
              <option value="verdacht">V.a. ({tx("подозрение", "Verdacht")})</option>
              <option value="bestaetigt">{tx("Подтверждён", "Bestätigt")}</option>
              <option value="zustand_nach">Z.n. ({tx("состояние после", "Zustand nach")})</option>
            </NativeComboboxSelect>
          </Field>
          <Field label={tx("Хронификация", "Chronifizierung")}>
            <NativeComboboxSelect
              value={draft.chronifizierung ?? ""}
              aria-label={tx("Хронификация", "Chronifizierung")}
              className={inputClass}
              onChange={(e) =>
                set({
                  chronifizierung: (e.target.value || null) as ClinicalDiagnosis["chronifizierung"],
                })
              }
            >
              <option value="">—</option>
              <option value="akut">{tx("Острый", "Akut")}</option>
              <option value="chronisch">{tx("Хронический", "Chronisch")}</option>
              <option value="rezidivierend">{tx("Рецидивирующий", "Rezidivierend")}</option>
            </NativeComboboxSelect>
          </Field>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        {isDiagnosis ? (
          <Field label="ICD-10">
            <Input
              value={draft.icd_code ?? ""}
              onChange={(e) => set({ icd_code: blankToNull(e.target.value) })}
              className={inputClass}
              placeholder="K35.8"
            />
          </Field>
        ) : null}
        {draft.kind === "prozedur" ? (
          <Field label="OPS">
            <Input
              value={draft.ops_code ?? ""}
              onChange={(e) => set({ ops_code: blankToNull(e.target.value) })}
              className={inputClass}
              placeholder="5-470.10"
            />
          </Field>
        ) : null}
        <Field label={tx("Дата", "Datum")}>
          <Input
            type="date"
            value={draft.diagnosed_on ?? ""}
            onChange={(e) => set({ diagnosed_on: blankToNull(e.target.value) })}
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

      {isDiagnosis ? (
        <div className="space-y-2 rounded-lg border border-border/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tx("Лечащий врач", "Behandelnder Arzt")}
          </p>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-border"
              checked={draft.treating_none}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? {
                        treating_none: true,
                        treating_doctor_id: null,
                        treating_doctor_name: null,
                        treating_doctor_title: null,
                      }
                    : { treating_none: false },
                )
              }
            />
            {tx("Лечение не у нас", "keine Behandlung hier")}
          </label>
          {!draft.treating_none ? (
            <Field label={tx("Лечащий врач", "Behandelnder Arzt")}>
              <NativeComboboxSelect
                value={draft.treating_doctor_id ?? ""}
                aria-label={tx("Лечащий врач", "Behandelnder Arzt")}
                className={inputClass}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const doctor = allDoctors.find((d) => d.id === id);
                  set({
                    treating_doctor_id: id,
                    treating_doctor_name: doctor?.name ?? null,
                    treating_doctor_title: doctor?.title ?? null,
                  });
                }}
              >
                <option value="">—</option>
                {allDoctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {[
                      [doctor.title, doctor.name].filter(Boolean).join(" "),
                      doctor.provider_name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {tx("Кто поставил/провёл", "Wer gestellt/durchgeführt")}
        </p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-border"
            checked={draft.source_mode === "intern"}
            onChange={(e) =>
              set(
                e.target.checked
                  ? {
                      source_mode: "intern",
                      external_clinic: null,
                      external_doctor: null,
                      external_country: null,
                    }
                  : {
                      source_mode: "extern",
                      provider_id: null,
                      provider_name: null,
                      doctor_id: null,
                      doctor_name: null,
                      doctor_title: null,
                      doctor_fachbereich: null,
                    },
              )
            }
          />
          {tx("Из нашей базы", "Aus unserer Basis")}
        </label>
        {draft.source_mode === "intern" ? (
          <ProviderDoctorFields draft={draft} providers={providers} tx={tx} onChange={set} />
        ) : (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={tx("Клиника", "Klinik")}>
                <Input
                  value={draft.external_clinic ?? ""}
                  onChange={(e) => set({ external_clinic: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label={tx("Врач", "Arzt")}>
                <Input
                  value={draft.external_doctor ?? ""}
                  onChange={(e) => set({ external_doctor: blankToNull(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={tx("Страна", "Land")}>
              <CountrySelect
                value={draft.external_country}
                lang={lang}
                aria-label={tx("Страна", "Land")}
                className={inputClass}
                onChange={(code) => set({ external_country: code })}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

export function DiagnosisTreeSection({
  items,
  providers,
  allDoctors,
  canManage,
  lang,
  onSave,
}: {
  items: ClinicalDiagnosis[];
  providers: ProviderSummary[];
  allDoctors: AllDoctorOption[];
  canManage: boolean;
  lang: string;
  onSave: (next: ClinicalDiagnosis[]) => Promise<unknown>;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [nodes, setNodes] = useState<WorkingNode[]>(() => nodesFromItems(items));
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-derive from props when they change, but never mid-edit: a realtime
  // refresh landing while the sheet is open would otherwise swap the baseline.
  useEffect(() => {
    if (!editing) setNodes(nodesFromItems(items));
  }, [items, editing]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, WorkingNode[]>();
    for (const node of nodes) {
      const list = map.get(node.parent_cid) ?? [];
      list.push(node);
      map.set(node.parent_cid, list);
    }
    return map;
  }, [nodes]);

  const roots = childrenByParent.get(null) ?? [];

  const set = (patch: Partial<WorkingNode>) =>
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));

  function openAddRoot(kind: Extract<DiagnosisKind, "main" | "secondary">) {
    setEditing({ mode: "add", draft: blankNode(kind, null) });
  }

  function openAddChild(parent: WorkingNode, kind: DiagnosisKind) {
    setEditing({ mode: "add", draft: blankNode(kind, parent.cid) });
  }

  function openEdit(node: WorkingNode) {
    setEditing({ mode: "edit", draft: { ...node } });
  }

  async function persist(next: WorkingNode[]) {
    setBusy(true);
    try {
      const flat = flattenDepthFirst(next);
      await onSave(flat);
      setNodes(next);
      setEditing(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  function deleteNode(node: WorkingNode) {
    const toRemove = descendantCids(nodes, node.cid);
    void persist(nodes.filter((n) => !toRemove.has(n.cid)));
  }

  function submitDraft() {
    if (!editing) return;
    const draft = trimDraftStrings(editing.draft);
    if (draft.label.trim() === "") return;
    if (draft.source_mode === "extern" && !draft.external_country) return;

    const exists = nodes.some((n) => n.cid === draft.cid);
    const next = exists
      ? nodes.map((n) => (n.cid === draft.cid ? draft : n))
      : [...nodes, draft];
    void persist(next);
  }

  const canSave = editing
    ? editing.draft.label.trim() !== "" &&
      (editing.draft.source_mode !== "extern" || Boolean(editing.draft.external_country))
    : false;
  const editingParent =
    editing?.draft.parent_cid != null
      ? nodes.find((node) => node.cid === editing.draft.parent_cid) ?? null
      : null;
  const editingParentLabel = editingParent ? displayLabel(editingParent) : null;

  return (
    <section className="rounded-xl border border-border/70">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{tx("Диагнозы", "Diagnosen")}</h3>
        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("h-8 rounded-lg", rootAddActionClass)}
              onClick={() => openAddRoot("main")}
            >
              <Plus className="size-3.5" />
              {tx("Добавить основной", "Hauptdiagnose hinzufügen")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("h-8 rounded-lg", rootAddActionClass)}
              onClick={() => openAddRoot("secondary")}
            >
              <Plus className="size-3.5" />
              {tx("Добавить сопутствующий", "Nebendiagnose hinzufügen")}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="space-y-2 p-3">
        {roots.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {tx("Пока нет диагнозов", "Noch keine Diagnosen")}
          </p>
        ) : (
          roots.map((node) => (
            <DiagnosisRow
              key={node.cid}
              node={node}
              depth={0}
              childrenByParent={childrenByParent}
              canManage={canManage}
              lang={lang}
              tx={tx}
              onAddChild={openAddChild}
              onEdit={openEdit}
              onDelete={deleteNode}
            />
          ))
        )}

        <PatientSheetScaffold
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          width="form-heavy"
          title={
            editing?.mode === "add"
              ? editingParentLabel
                ? `${tx("Добавить вложенный", "Untergeordnet hinzufügen")}: ${
                    editing ? kindLabel(editing.draft.kind, tx) : ""
                  }`
                : `${tx("Добавить", "Hinzufügen")}: ${
                    editing ? kindLabel(editing.draft.kind, tx) : ""
                  }`
              : `${tx("Редактировать", "Bearbeiten")}: ${editing ? kindLabel(editing.draft.kind, tx) : ""}`
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
                disabled={busy || !canSave}
                onClick={submitDraft}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </>
          }
        >
          {editing ? (
            <DiagnosisForm
              draft={editing.draft}
              providers={providers}
              allDoctors={allDoctors}
              lang={lang}
              tx={tx}
              parentLabel={editingParentLabel}
              set={set}
            />
          ) : null}
        </PatientSheetScaffold>
      </div>
    </section>
  );
}
