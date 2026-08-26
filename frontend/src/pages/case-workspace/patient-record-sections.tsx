import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import type { ColumnDef } from "@/components/data-table/types";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  type ClinicalDiagnosis,
  type ClinicalExamination,
  type ClinicalMedication,
  type ClinicalProcedure,
  type ClinicalVerlaufEntry,
  type ClinicalWarning,
  type AllDoctorOption,
  type PatientClinicalProfile,
  deletePatientNarrative,
  fetchAllDoctors,
  fetchNarrativeHistory,
  fetchPatientClinical,
  savePatientClinicalWarnings,
  savePatientDiagnoses,
  savePatientExaminations,
  savePatientMedications,
  savePatientNarrative,
  savePatientProcedures,
  savePatientVerlauf,
} from "@/pages/patients/data/patient-clinical";
import { AnamneseSection } from "@/pages/patients/ui/sections/anamnese-section";
import { DiagnosisTreeSection } from "@/pages/patients/ui/sections/diagnosis-tree";
import {
  PatientClinicalWarningSection,
  PatientMedicationSection,
} from "@/pages/patients/ui/sections/patient-clinical-entry-sections";
import {
  CLINICAL_PROVIDER_QUERY,
  clinicalMedicalProviderRows,
} from "@/pages/patients/ui/sections/patient-clinical-tab";
import { MedicationEvidenceReviewPanel } from "@/pages/patients/ui/sections/medication-evidence-review-panel";
import { MedicationIntelligencePanel } from "@/pages/patients/ui/sections/medication-intelligence-panel";
import { fetchProviders } from "@/pages/providers/data/provider-api";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { CaseItemList } from "./case-item-list";
import { useCaseWorkspace } from "./context";
import { Field, Panel, inputBaseClassName, nativeSelectClassName } from "./primitives";

type RecordScope = "episode" | "all";

type EpisodeEntry = { id?: string | null; case_id?: string | null };

/** New (id-less) entries created inside a case get attributed to that episode. */
function stampEpisode<T extends EpisodeEntry>(items: T[], caseUuid: string): T[] {
  return items.map((item) =>
    item.id ? item : { ...item, case_id: item.case_id ?? caseUuid },
  );
}

function inEpisode(item: EpisodeEntry, caseUuid: string): boolean {
  return item.case_id === caseUuid;
}

/**
 * Scope-filtered replace-all: the visible (episode) subset is edited, entries
 * outside the episode are carried through the save untouched.
 */
function mergeScoped<T extends EpisodeEntry>(
  full: readonly T[],
  nextScoped: T[],
  caseUuid: string,
): T[] {
  const hidden: T[] = [];
  for (const item of full) {
    if (!inEpisode(item, caseUuid)) {
      hidden.push(item);
    }
  }
  return [...hidden, ...nextScoped];
}

type PatientRecordState = {
  profile: PatientClinicalProfile | null;
  providers: ProviderSummary[];
  allDoctors: AllDoctorOption[];
  loading: boolean;
  error: string;
  busy: boolean;
};

function usePatientRecord(patientId: string | null) {
  const [state, setState] = useState<PatientRecordState>({
    profile: null,
    providers: [],
    allDoctors: [],
    loading: true,
    error: "",
    busy: false,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    const { signal } = controller;
    setState((current) => ({ ...current, loading: current.profile == null, error: "" }));
    Promise.all([
      fetchPatientClinical(patientId),
      fetchProviders(CLINICAL_PROVIDER_QUERY).catch(() => [] as ProviderSummary[]),
      fetchAllDoctors().catch(() => [] as AllDoctorOption[]),
    ])
      .then(([profile, providers, allDoctors]) => {
        if (signal.aborted) return;
        setState((current) => ({
          ...current,
          profile,
          providers: clinicalMedicalProviderRows(providers),
          allDoctors,
          loading: false,
        }));
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setState((current) => ({
          ...current,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        }));
      });
    return () => controller.abort();
  }, [patientId, version]);

  async function runSave(action: () => Promise<unknown>): Promise<boolean> {
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await action();
      setVersion((current) => current + 1);
      return true;
    } catch (err: unknown) {
      setState((current) => ({
        ...current,
        error: err instanceof Error ? err.message : String(err),
      }));
      return false;
    } finally {
      setState((current) => ({ ...current, busy: false }));
    }
  }

  return { ...state, runSave, reload: () => setVersion((current) => current + 1) };
}

function RecordBadge() {
  const { t } = useLang();
  return (
    <Badge
      variant="outline"
      className="rounded-full border-sky-200 bg-sky-50 text-[11px] font-medium text-sky-700"
    >
      {t.cases_workspace_record_badge}
    </Badge>
  );
}

function ScopeToggle({
  scope,
  onChange,
}: {
  scope: RecordScope;
  onChange: (next: RecordScope) => void;
}) {
  const { t } = useLang();
  const options: Array<{ key: RecordScope; label: string }> = [
    { key: "episode", label: t.cases_workspace_scope_episode },
    { key: "all", label: t.cases_workspace_scope_all },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border/70 bg-muted/30">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={scope === option.key}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            scope === option.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RecordLoading() {
  const { t } = useLang();
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-border/50 bg-card text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      {t.common_loading}
    </div>
  );
}

function useRecordContext() {
  const { detail, permissions } = useCaseWorkspace();
  const { lang } = useLang();
  const caseUuid = detail?.case_uuid ?? detail?.id ?? "";
  return {
    patientId: detail?.patient_id ?? null,
    caseUuid,
    caseCode: detail?.case_id ?? "",
    canEdit: permissions.canEdit,
    lang,
  };
}

export function CaseRecordAnamneseSection() {
  const { patientId, caseUuid, canEdit, lang } = useRecordContext();
  const record = usePatientRecord(patientId);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RecordBadge />
      </div>
      {record.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {record.error}
        </div>
      ) : null}
      <AnamneseSection
        active={record.profile?.narrative ?? null}
        canManage={canEdit}
        lang={lang}
        onSave={(narrative) =>
          record.runSave(() =>
            savePatientNarrative(patientId, {
              ...narrative,
              case_id: narrative.case_id ?? caseUuid,
            }),
          )
        }
        onDelete={(id) => record.runSave(() => deletePatientNarrative(patientId, id))}
        loadHistory={() => fetchNarrativeHistory(patientId)}
      />
    </div>
  );
}

export function CaseRecordDiagnosesSection() {
  const { patientId, caseUuid, canEdit, lang } = useRecordContext();
  const { t } = useLang();
  const record = usePatientRecord(patientId);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  const items = record.profile?.diagnoses ?? [];
  const episodeCount = items.filter((item) => inEpisode(item, caseUuid)).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RecordBadge />
        <span className="text-xs text-muted-foreground">
          {t.cases_workspace_scope_episode}: {episodeCount} · {t.cases_workspace_scope_all}: {items.length}
        </span>
      </div>
      {record.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {record.error}
        </div>
      ) : null}
      <DiagnosisTreeSection
        items={items}
        providers={record.providers}
        allDoctors={record.allDoctors}
        canManage={canEdit}
        lang={lang}
        onSave={(next: ClinicalDiagnosis[]) =>
          record.runSave(() =>
            savePatientDiagnoses(patientId, stampEpisode(next, caseUuid)),
          )
        }
      />
    </div>
  );
}

export function CaseRecordMedicationsSection() {
  const { patientId, caseUuid, canEdit, lang } = useRecordContext();
  const record = usePatientRecord(patientId);
  void caseUuid;
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  const medications = record.profile?.medications ?? [];
  const medicationRefreshKey = medications
    .map((medication) => [
      medication.id,
      medication.handelsname,
      medication.wirkstoff,
      medication.status,
    ].join(":"))
    .join("|");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RecordBadge />
      </div>
      {record.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {record.error}
        </div>
      ) : null}
      <PatientMedicationSection
        items={medications}
        providers={record.providers}
        canManage={canEdit}
        lang={lang}
        onSave={(next: ClinicalMedication[]) =>
          record.runSave(() => savePatientMedications(patientId, next))
        }
      />
      <MedicationIntelligencePanel
        patientId={patientId}
        refreshKey={medicationRefreshKey}
      />
      <MedicationEvidenceReviewPanel
        patientId={patientId}
        refreshKey={medicationRefreshKey}
      />
    </div>
  );
}

export function CaseRecordAllergiesSection() {
  const { patientId, canEdit, lang } = useRecordContext();
  const record = usePatientRecord(patientId);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  const saveKind = (kind: "allergie" | "cave") => (next: ClinicalWarning[]) =>
    record.runSave(() => savePatientClinicalWarnings(patientId, kind, next));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RecordBadge />
      </div>
      {record.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {record.error}
        </div>
      ) : null}
      <PatientClinicalWarningSection
        kind="allergie"
        items={record.profile?.allergien ?? []}
        canManage={canEdit}
        lang={lang}
        onSave={saveKind("allergie")}
      />
      <PatientClinicalWarningSection
        kind="cave"
        items={record.profile?.cave ?? []}
        canManage={canEdit}
        lang={lang}
        onSave={saveKind("cave")}
      />
    </div>
  );
}

const EXAMINATION_KINDS = [
  "sonography",
  "lab",
  "histology",
  "ecg",
  "microbiology",
  "radiology",
  "exam",
  "other",
] as const;

function examinationKindLabel(kind: string, tx: (ru: string, de: string) => string) {
  const labels: Record<string, [string, string]> = {
    sonography: ["Сонография", "Sonographie"],
    lab: ["Лаборатория", "Labor"],
    histology: ["Гистология", "Histologie"],
    ecg: ["ЭКГ", "EKG"],
    microbiology: ["Микробиология", "Mikrobiologie"],
    radiology: ["Радиология", "Radiologie"],
    exam: ["Осмотр", "Untersuchung"],
    other: ["Другое", "Sonstiges"],
  };
  const label = labels[kind];
  return label ? tx(label[0], label[1]) : kind;
}

type ScopedListSectionProps<T extends EpisodeEntry> = {
  title: string;
  description: string;
  full: readonly T[];
  save: (next: T[]) => Promise<boolean>;
  busy: boolean;
  error: string;
  canEdit: boolean;
  caseUuid: string;
  caseCode: string;
  blankItem: T;
  isValid: (form: T) => boolean;
  missingPrimaryMessage: string;
  sheetTitle: { create: string; edit: string };
  emptyTitle: string;
  addFirstLabel: string;
  columns: ColumnDef<T>[];
  formContent: (args: {
    form: T;
    updateField: <K extends keyof T>(field: K, value: T[K]) => void;
    disabled: boolean;
  }) => ReactNode;
};

/**
 * Patient-record list projected into the episode: default scope shows only
 * entries attributed to this case; edits always re-save the full record with
 * out-of-scope entries carried through untouched.
 */
function ScopedListSection<T extends EpisodeEntry>({
  title,
  description,
  full,
  save,
  busy,
  error,
  canEdit,
  caseUuid,
  caseCode,
  blankItem,
  isValid,
  missingPrimaryMessage,
  sheetTitle,
  emptyTitle,
  addFirstLabel,
  columns,
  formContent,
}: ScopedListSectionProps<T>) {
  const { t } = useLang();
  const [scope, setScope] = useState<RecordScope>("episode");
  const visible = scope === "episode"
    ? full.filter((item) => inEpisode(item, caseUuid))
    : [...full];

  const effectiveColumns: ColumnDef<T>[] =
    scope === "all"
      ? [
          ...columns,
          {
            id: "episode",
            label: t.cases_clinical_case_id,
            accessor: (item) => (inEpisode(item, caseUuid) ? caseCode : ""),
            filterType: "enum",
            filterOptions: () => [{ value: caseCode, label: caseCode }],
            sortable: true,
            width: 150,
            render: (item) =>
              inEpisode(item, caseUuid) ? (
                <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700">
                  {caseCode}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
        ]
      : columns;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RecordBadge />
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>
      <CaseItemList<T>
        title={title}
        description={description}
        items={visible}
        blankItem={{ ...blankItem, case_id: caseUuid }}
        cloneItem={(item) => ({ ...item })}
        isValid={isValid}
        save={(nextVisible) => {
          const next = scope === "episode"
            ? mergeScoped(full, nextVisible, caseUuid)
            : nextVisible;
          return save(stampEpisode(next, caseUuid));
        }}
        busy={busy}
        sectionError={error}
        canEdit={canEdit}
        sheetTitle={sheetTitle}
        emptyTitle={scope === "episode" ? t.cases_workspace_scope_empty_episode : emptyTitle}
        addFirstLabel={addFirstLabel}
        missingPrimaryMessage={missingPrimaryMessage}
        columns={effectiveColumns}
        formContent={formContent}
      />
    </div>
  );
}

const BLANK_EXAMINATION: ClinicalExamination = {
  kind: null,
  title: "",
  performed_on: null,
  status: "final",
  result: null,
  note: null,
  provider_id: null,
  provider_name: null,
  doctor_id: null,
  doctor_name: null,
  doctor_title: null,
  doctor_fachbereich: null,
};

export function CaseRecordBefundeSection() {
  const { patientId, caseUuid, caseCode, canEdit, lang } = useRecordContext();
  const { t } = useLang();
  const record = usePatientRecord(patientId);
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  return (
    <ScopedListSection<ClinicalExamination>
      title={t.cases_workspace_section_befunde}
      description={tx(
        "Обследования и результаты из карты пациента.",
        "Befunde und Ergebnisse aus der Patientenakte.",
      )}
      full={record.profile?.examinations ?? []}
      save={(next) => record.runSave(() => savePatientExaminations(patientId, next))}
      busy={record.busy}
      error={record.error}
      canEdit={canEdit}
      caseUuid={caseUuid}
      caseCode={caseCode}
      blankItem={BLANK_EXAMINATION}
      isValid={(form) => form.title.trim().length > 0}
      missingPrimaryMessage={tx("Укажите название", "Bitte Titel angeben")}
      sheetTitle={{
        create: tx("Новое обследование", "Neuer Befund"),
        edit: tx("Изменить обследование", "Befund bearbeiten"),
      }}
      emptyTitle={tx("Обследований пока нет.", "Noch keine Befunde.")}
      addFirstLabel={t.cases_workspace_item_add}
      columns={[
        {
          id: "title",
          label: tx("Название", "Titel"),
          accessor: (item) => item.title,
          filterType: "text",
          searchable: true,
          sortable: true,
          required: true,
          width: 300,
          render: (item) => (
            <span className="block max-w-[300px] truncate text-xs font-medium text-foreground">
              {item.title}
            </span>
          ),
        },
        {
          id: "kind",
          label: tx("Вид", "Art"),
          accessor: (item) => (item.kind ? examinationKindLabel(item.kind, tx) : ""),
          filterType: "enum",
          filterOptions: () =>
            EXAMINATION_KINDS.map((kind) => ({
              value: examinationKindLabel(kind, tx),
              label: examinationKindLabel(kind, tx),
            })),
          sortable: true,
          width: 160,
          render: (item) =>
            item.kind ? (
              <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                {examinationKindLabel(item.kind, tx)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
        },
        {
          id: "performed_on",
          label: tx("Дата", "Datum"),
          accessor: (item) => item.performed_on ?? "",
          filterType: "date",
          sortable: true,
          width: 130,
          render: (item) => (
            <span className="whitespace-nowrap font-mono text-xs text-foreground">
              {item.performed_on ?? "—"}
            </span>
          ),
        },
        {
          id: "status",
          label: tx("Статус", "Status"),
          accessor: (item) =>
            item.status === "pending" ? tx("Ожидается", "Ausstehend") : tx("Финальный", "Final"),
          filterType: "enum",
          filterOptions: () => [
            { value: tx("Финальный", "Final"), label: tx("Финальный", "Final") },
            { value: tx("Ожидается", "Ausstehend"), label: tx("Ожидается", "Ausstehend") },
          ],
          sortable: true,
          width: 130,
          render: (item) => (
            <span
              className={cn(
                "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                item.status === "pending"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              {item.status === "pending" ? tx("Ожидается", "Ausstehend") : tx("Финальный", "Final")}
            </span>
          ),
        },
        {
          id: "result",
          label: tx("Результат", "Ergebnis"),
          accessor: (item) => item.result ?? "",
          filterType: "text",
          searchable: true,
          width: 320,
          render: (item) => (
            <span className="block max-w-[320px] truncate text-xs text-foreground">
              {item.result?.trim() || "—"}
            </span>
          ),
        },
      ]}
      formContent={({ form, updateField, disabled }) => (
        <Panel title={t.cases_workspace_section_befunde}>
          <Field label={tx("Название", "Titel")} required>
            <Input
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Вид", "Art")}>
            <NativeComboboxSelect
              value={form.kind ?? ""}
              onChange={(event) =>
                updateField(
                  "kind",
                  (event.target.value || null) as ClinicalExamination["kind"],
                )
              }
              className={nativeSelectClassName}
              disabled={disabled}
            >
              <option value="">{t.common_not_set}</option>
              {EXAMINATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {examinationKindLabel(kind, tx)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tx("Дата", "Datum")}>
            <Input
              type="date"
              value={form.performed_on ?? ""}
              onChange={(event) => updateField("performed_on", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Статус", "Status")}>
            <NativeComboboxSelect
              value={form.status}
              onChange={(event) =>
                updateField("status", event.target.value as ClinicalExamination["status"])
              }
              className={nativeSelectClassName}
              disabled={disabled}
            >
              <option value="final">{tx("Финальный", "Final")}</option>
              <option value="pending">{tx("Ожидается", "Ausstehend")}</option>
            </NativeComboboxSelect>
          </Field>
          <Field label={tx("Результат", "Ergebnis")}>
            <Input
              value={form.result ?? ""}
              onChange={(event) => updateField("result", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Заметка", "Notiz")}>
            <Input
              value={form.note ?? ""}
              onChange={(event) => updateField("note", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </Panel>
      )}
    />
  );
}

const BLANK_PROCEDURE: ClinicalProcedure = {
  label: "",
  ops_code: null,
  performed_on: null,
  note: null,
  provider_id: null,
  provider_name: null,
  doctor_id: null,
  doctor_name: null,
  doctor_title: null,
  doctor_fachbereich: null,
};

export function CaseRecordProceduresSection() {
  const { patientId, caseUuid, caseCode, canEdit, lang } = useRecordContext();
  const { t } = useLang();
  const record = usePatientRecord(patientId);
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  return (
    <ScopedListSection<ClinicalProcedure>
      title={t.cases_workspace_section_procedures}
      description={tx(
        "Терапия и вмешательства из карты пациента.",
        "Therapie und Eingriffe aus der Patientenakte.",
      )}
      full={record.profile?.procedures ?? []}
      save={(next) => record.runSave(() => savePatientProcedures(patientId, next))}
      busy={record.busy}
      error={record.error}
      canEdit={canEdit}
      caseUuid={caseUuid}
      caseCode={caseCode}
      blankItem={BLANK_PROCEDURE}
      isValid={(form) => form.label.trim().length > 0}
      missingPrimaryMessage={tx("Укажите описание", "Bitte Beschreibung angeben")}
      sheetTitle={{
        create: tx("Новая процедура", "Neuer Eingriff"),
        edit: tx("Изменить процедуру", "Eingriff bearbeiten"),
      }}
      emptyTitle={tx("Процедур пока нет.", "Noch keine Eingriffe.")}
      addFirstLabel={t.cases_workspace_item_add}
      columns={[
        {
          id: "label",
          label: tx("Описание", "Beschreibung"),
          accessor: (item) => item.label,
          filterType: "text",
          searchable: true,
          sortable: true,
          required: true,
          width: 360,
          render: (item) => (
            <span className="block max-w-[360px] truncate text-xs font-medium text-foreground">
              {item.label}
            </span>
          ),
        },
        {
          id: "ops_code",
          label: tx("Код OPS", "OPS-Code"),
          accessor: (item) => item.ops_code ?? "",
          filterType: "text",
          sortable: true,
          width: 140,
          render: (item) => (
            <span className="whitespace-nowrap font-mono text-xs text-foreground">
              {item.ops_code?.trim() || "—"}
            </span>
          ),
        },
        {
          id: "performed_on",
          label: tx("Дата", "Datum"),
          accessor: (item) => item.performed_on ?? "",
          filterType: "date",
          sortable: true,
          width: 130,
          render: (item) => (
            <span className="whitespace-nowrap font-mono text-xs text-foreground">
              {item.performed_on ?? "—"}
            </span>
          ),
        },
        {
          id: "note",
          label: tx("Заметка", "Notiz"),
          accessor: (item) => item.note ?? "",
          filterType: "text",
          searchable: true,
          width: 320,
          render: (item) => (
            <span className="block max-w-[320px] truncate text-xs text-foreground">
              {item.note?.trim() || "—"}
            </span>
          ),
        },
      ]}
      formContent={({ form, updateField, disabled }) => (
        <Panel title={t.cases_workspace_section_procedures}>
          <Field label={tx("Описание", "Beschreibung")} required>
            <Input
              value={form.label}
              onChange={(event) => updateField("label", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Код OPS", "OPS-Code")}>
            <Input
              value={form.ops_code ?? ""}
              onChange={(event) => updateField("ops_code", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Дата", "Datum")}>
            <Input
              type="date"
              value={form.performed_on ?? ""}
              onChange={(event) => updateField("performed_on", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Заметка", "Notiz")}>
            <Input
              value={form.note ?? ""}
              onChange={(event) => updateField("note", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </Panel>
      )}
    />
  );
}

const BLANK_VERLAUF: ClinicalVerlaufEntry = {
  occurred_on: null,
  note: "",
  provider_id: null,
  provider_name: null,
  doctor_id: null,
  doctor_name: null,
  doctor_title: null,
  doctor_fachbereich: null,
};

export function CaseRecordVerlaufSection() {
  const { patientId, caseUuid, caseCode, canEdit, lang } = useRecordContext();
  const { t } = useLang();
  const record = usePatientRecord(patientId);
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  if (!patientId) return null;
  if (record.loading) return <RecordLoading />;
  return (
    <ScopedListSection<ClinicalVerlaufEntry>
      title={t.cases_workspace_section_verlauf}
      description={tx(
        "Клиническая динамика из карты пациента.",
        "Klinischer Verlauf aus der Patientenakte.",
      )}
      full={record.profile?.verlauf ?? []}
      save={(next) => record.runSave(() => savePatientVerlauf(patientId, next))}
      busy={record.busy}
      error={record.error}
      canEdit={canEdit}
      caseUuid={caseUuid}
      caseCode={caseCode}
      blankItem={BLANK_VERLAUF}
      isValid={(form) => form.note.trim().length > 0}
      missingPrimaryMessage={tx("Укажите запись", "Bitte Eintrag angeben")}
      sheetTitle={{
        create: tx("Новая запись", "Neuer Eintrag"),
        edit: tx("Изменить запись", "Eintrag bearbeiten"),
      }}
      emptyTitle={tx("Записей пока нет.", "Noch keine Einträge.")}
      addFirstLabel={t.cases_workspace_item_add}
      columns={[
        {
          id: "occurred_on",
          label: tx("Дата", "Datum"),
          accessor: (item) => item.occurred_on ?? "",
          filterType: "date",
          sortable: true,
          width: 130,
          render: (item) => (
            <span className="whitespace-nowrap font-mono text-xs text-foreground">
              {item.occurred_on ?? "—"}
            </span>
          ),
        },
        {
          id: "note",
          label: tx("Запись", "Eintrag"),
          accessor: (item) => item.note,
          filterType: "text",
          searchable: true,
          sortable: true,
          required: true,
          width: 560,
          render: (item) => (
            <span className="block max-w-[560px] truncate text-xs text-foreground">
              {item.note}
            </span>
          ),
        },
      ]}
      formContent={({ form, updateField, disabled }) => (
        <Panel title={t.cases_workspace_section_verlauf}>
          <Field label={tx("Дата", "Datum")}>
            <Input
              type="date"
              value={form.occurred_on ?? ""}
              onChange={(event) => updateField("occurred_on", event.target.value || null)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tx("Запись", "Eintrag")} required>
            <textarea
              value={form.note}
              onChange={(event) => updateField("note", event.target.value)}
              className={cn(inputBaseClassName, "min-h-24")}
              rows={4}
              disabled={disabled}
            />
          </Field>
        </Panel>
      )}
    />
  );
}
