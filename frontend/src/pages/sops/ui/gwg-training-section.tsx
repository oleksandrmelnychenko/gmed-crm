/**
 * "GwG-Unterweisung (§ 6 Abs. 2 GwG)" in "SOP и обучение": the CEO documents
 * the yearly AML instruction and the reliability check per employee; the
 * generated sheet and its signed scan live in the personnel file. An employee
 * with a personnel file sees the own records. See
 * docs/architecture/gwg-staff-training_ua.md.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, FileText, History, LoaderCircle, Upload } from "lucide-react";

import { AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Banner, SuccessBanner, checkboxClass, inputClass, tokens } from "@/components/ui-shell";
import { formatAppDate, appDateKey } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { formatUiText, useLang, type Translations } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { personnelApi } from "@/pages/personnel/api";
import { FilePreviewDialog, errorMessage } from "@/pages/personnel/personnel-ui";

import { gwgTrainingApi } from "../data/gwg-training-api";
import {
  GWG_INSTRUCTION_CODES,
  defaultTrainingForm,
  gwgStatusTone,
  sortForAttention,
  trainingFormErrors,
  trainingPayload,
  type GwgOwnTrainings,
  type GwgTrainingEmployee,
  type GwgTrainingForm,
  type GwgTrainingFormError,
  type GwgTrainingOverview,
  type GwgTrainingRecord,
  type GwgTrainingStatus,
} from "../model/gwg-training";

const STATUS_KEYS: Record<GwgTrainingStatus, keyof Translations> = {
  none: "sops_gwg_status_none",
  unsigned: "sops_gwg_status_unsigned",
  signed: "sops_gwg_status_signed",
};

const ERROR_KEYS: Record<GwgTrainingFormError, keyof Translations> = {
  date: "sops_gwg_error_date",
  delivered_by_other: "sops_gwg_error_delivered_by_other",
  form: "sops_gwg_error_form",
  form_other: "sops_gwg_error_form_other",
  instructions: "sops_gwg_error_instructions",
  reliability: "sops_gwg_error_reliability",
  reliability_other: "sops_gwg_error_reliability_other",
};

function text(t: Translations, key: keyof Translations): string {
  const value = t[key];
  return typeof value === "string" ? value : String(key);
}

function dateOrDash(value: string | null | undefined): string {
  return value ? formatAppDate(value) || value : "—";
}

type PreviewTarget = { id: string; fileName: string; mimeType: string };

function StatusBadge({ status, t }: { status: GwgTrainingStatus; t: Translations }) {
  return (
    <Badge variant="outline" className={cn("rounded-full", gwgStatusTone(status))}>
      {text(t, STATUS_KEYS[status])}
    </Badge>
  );
}

function DueBadge({ t }: { t: Translations }) {
  return (
    <Badge variant="outline" className="gap-1 rounded-full bg-rose-100 text-rose-700 hover:bg-rose-100">
      <AlertTriangle aria-hidden className="size-3" />
      {t.sops_gwg_due}
    </Badge>
  );
}

/** Open / upload buttons of one record. */
function RecordActions({
  record,
  t,
  canWrite,
  busy,
  onOpen,
  onUpload,
}: {
  record: GwgTrainingRecord;
  t: Translations;
  canWrite: boolean;
  busy: boolean;
  onOpen: (target: PreviewTarget) => void;
  onUpload?: (record: GwgTrainingRecord) => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-lg px-2.5"
        onClick={() =>
          onOpen({ id: record.document_id, fileName: record.document_file_name, mimeType: record.document_mime_type })
        }
      >
        <FileText aria-hidden className="size-3.5" />
        {t.sops_gwg_action_open_pdf}
      </Button>
      {record.signed_document_id ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-2.5"
          onClick={() =>
            onOpen({
              id: record.signed_document_id ?? "",
              fileName: record.signed_file_name ?? "",
              mimeType: record.signed_mime_type ?? "application/pdf",
            })
          }
        >
          <FileText aria-hidden className="size-3.5" />
          {t.sops_gwg_action_open_signed}
        </Button>
      ) : null}
      {canWrite && onUpload && !record.signed_document_id ? (
        <Button
          type="button"
          size="sm"
          data-action="write"
          className="h-8 gap-1.5 rounded-lg px-2.5"
          disabled={busy}
          onClick={() => onUpload(record)}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload aria-hidden className="size-3.5" />}
          {t.sops_gwg_action_upload_signed}
        </Button>
      ) : null}
    </>
  );
}

/** The employees with their last instruction, status and due warning. */
export function GwgTrainingTable({
  employees,
  t,
  canWrite,
  busyRecordId,
  onConduct,
  onOpen,
  onUpload,
  onHistory,
}: {
  employees: GwgTrainingEmployee[];
  t: Translations;
  canWrite: boolean;
  busyRecordId: string | null;
  onConduct: (employee: GwgTrainingEmployee) => void;
  onOpen: (target: PreviewTarget) => void;
  onUpload: (record: GwgTrainingRecord) => void;
  onHistory: (employee: GwgTrainingEmployee) => void;
}) {
  if (employees.length === 0) {
    return (
      <div className={cn("rounded-xl px-6 py-8 text-center text-sm text-muted-foreground", tokens.surface.dashed)}>
        {t.sops_gwg_empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-card">
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">{t.sops_gwg_column_employee}</th>
            <th className="px-3 py-2 font-medium">{t.sops_gwg_column_position}</th>
            <th className="px-3 py-2 font-medium">{t.sops_gwg_column_last}</th>
            <th className="px-3 py-2 font-medium">{t.sops_gwg_column_status}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const last = employee.records[0];
            return (
              <tr
                key={employee.employee_id}
                data-testid="gwg-training-row"
                className="border-b border-border/50 align-top last:border-b-0"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-foreground">{employee.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.sops_gwg_employment_start}: {dateOrDash(employee.employment_start)}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-foreground">
                  {last?.position || employee.default_position || "—"}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  <div className="text-foreground">{dateOrDash(employee.last_instructed_on)}</div>
                  {employee.next_due_on ? (
                    <div className="text-muted-foreground">
                      {formatUiText(t.sops_gwg_next_due, { date: dateOrDash(employee.next_due_on) })}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={employee.status} t={t} />
                    {employee.due ? <DueBadge t={t} /> : null}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canWrite ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={employee.due ? "default" : "outline"}
                        data-action="write"
                        className="h-8 rounded-lg px-2.5"
                        onClick={() => onConduct(employee)}
                      >
                        {t.sops_gwg_action_conduct}
                      </Button>
                    ) : null}
                    {last ? (
                      <RecordActions
                        record={last}
                        t={t}
                        canWrite={canWrite}
                        busy={busyRecordId === last.id}
                        onOpen={onOpen}
                        onUpload={onUpload}
                      />
                    ) : null}
                    {employee.records.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 rounded-lg px-2.5"
                        onClick={() => onHistory(employee)}
                      >
                        <History aria-hidden className="size-3.5" />
                        {t.sops_gwg_action_history}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One record in a history list (CEO sheet and the employee's own view). */
function RecordList({
  records,
  t,
  canWrite,
  busyRecordId,
  onOpen,
  onUpload,
  empty,
}: {
  records: GwgTrainingRecord[];
  t: Translations;
  canWrite: boolean;
  busyRecordId: string | null;
  onOpen: (target: PreviewTarget) => void;
  onUpload?: (record: GwgTrainingRecord) => void;
  empty: string;
}) {
  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {records.map((record) => (
        <li
          key={record.id}
          data-testid="gwg-training-record"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              {dateOrDash(record.instructed_on)}
              <StatusBadge status={record.status} t={t} />
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {record.signed_file_name || record.document_file_name}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <RecordActions
              record={record}
              t={t}
              canWrite={canWrite}
              busy={busyRecordId === record.id}
              onOpen={onOpen}
              onUpload={onUpload}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Check({
  checked,
  label,
  onChange,
  name,
  type = "checkbox",
}: {
  checked: boolean;
  label: ReactNode;
  onChange: (checked: boolean) => void;
  name?: string;
  type?: "checkbox" | "radio";
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
      <input
        type={type}
        name={name}
        className={cn(checkboxClass, "mt-0.5")}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card p-4">
      <h3 className={tokens.text.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

/** The fields of the instruction form, in the order of the sheet. */
export function GwgTrainingFormFields({
  form,
  employee,
  managementName,
  t,
  onChange,
}: {
  form: GwgTrainingForm;
  employee: GwgTrainingEmployee;
  managementName: string;
  t: Translations;
  onChange: (patch: Partial<GwgTrainingForm>) => void;
}) {
  const toggleInstruction = (code: (typeof GWG_INSTRUCTION_CODES)[number], checked: boolean) =>
    onChange({
      instructions: checked
        ? GWG_INSTRUCTION_CODES.filter((value) => value === code || form.instructions.includes(value))
        : form.instructions.filter((value) => value !== code),
    });
  return (
    <div className="space-y-4">
      <FormSection title={employee.display_name}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label={t.sops_gwg_position}>
            <Input
              value={form.position}
              onChange={(event) => onChange({ position: event.target.value })}
              className={inputClass}
            />
          </Labeled>
          <Labeled label={t.sops_gwg_department}>
            <Input
              value={form.department}
              onChange={(event) => onChange({ department: event.target.value })}
              className={inputClass}
            />
          </Labeled>
        </div>
        <p className="text-xs text-muted-foreground">
          {t.sops_gwg_employment_start}: {dateOrDash(employee.employment_start)}
        </p>
      </FormSection>

      <FormSection title={t.sops_gwg_section_instruction}>
        <Labeled label={t.sops_gwg_instructed_on}>
          <Input
            type="date"
            value={form.instructedOn}
            onChange={(event) => onChange({ instructedOn: event.target.value })}
            className={inputClass}
          />
        </Labeled>
        <div className="space-y-2">
          <span className={tokens.text.label}>{t.sops_gwg_delivered_by}</span>
          <Check
            type="radio"
            name="gwg-delivered-by"
            checked={form.deliveredBy === "internal"}
            label={t.sops_gwg_delivered_internal}
            onChange={() => onChange({ deliveredBy: "internal" })}
          />
          <Check
            type="radio"
            name="gwg-delivered-by"
            checked={form.deliveredBy === "other"}
            label={t.sops_gwg_delivered_other}
            onChange={() => onChange({ deliveredBy: "other" })}
          />
          {form.deliveredBy === "other" ? (
            <Input
              aria-label={t.sops_gwg_details}
              placeholder={t.sops_gwg_details}
              value={form.deliveredByOther}
              onChange={(event) => onChange({ deliveredByOther: event.target.value })}
              className={inputClass}
            />
          ) : null}
        </div>
        <div className="space-y-2">
          <span className={tokens.text.label}>{t.sops_gwg_form_label}</span>
          <Check
            checked={form.formOral}
            label={t.sops_gwg_form_oral}
            onChange={(checked) => onChange({ formOral: checked })}
          />
          <Check
            checked={form.formMaterial}
            label={t.sops_gwg_form_material}
            onChange={(checked) => onChange({ formMaterial: checked })}
          />
          <Check
            checked={form.formOther}
            label={t.sops_gwg_form_other}
            onChange={(checked) => onChange({ formOther: checked })}
          />
          {form.formOther ? (
            <Input
              aria-label={`${t.sops_gwg_form_other}: ${t.sops_gwg_details}`}
              placeholder={t.sops_gwg_details}
              value={form.formOtherText}
              onChange={(event) => onChange({ formOtherText: event.target.value })}
              className={inputClass}
            />
          ) : null}
        </div>
      </FormSection>

      <FormSection title={t.sops_gwg_section_instructions}>
        <div className="space-y-2">
          {GWG_INSTRUCTION_CODES.map((code) => (
            <Check
              key={code}
              checked={form.instructions.includes(code)}
              label={text(t, `sops_gwg_instruction_${code}` as keyof Translations)}
              onChange={(checked) => toggleInstruction(code, checked)}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title={t.sops_gwg_section_reliability}>
        <div className="space-y-2">
          <Check
            type="radio"
            name="gwg-reliability"
            checked={form.reliability === "long_standing"}
            label={t.sops_gwg_reliability_long_standing}
            onChange={() => onChange({ reliability: "long_standing" })}
          />
          <Check
            type="radio"
            name="gwg-reliability"
            checked={form.reliability === "new_employee"}
            label={t.sops_gwg_reliability_new_employee}
            onChange={() => onChange({ reliability: "new_employee" })}
          />
          {form.reliability === "new_employee" ? (
            <div className="space-y-2 pl-6">
              <Check
                checked={form.reliabilityInterview}
                label={t.sops_gwg_reliability_interview}
                onChange={(checked) => onChange({ reliabilityInterview: checked })}
              />
              <Check
                checked={form.reliabilityCertificate}
                label={t.sops_gwg_reliability_certificate}
                onChange={(checked) => onChange({ reliabilityCertificate: checked })}
              />
              <Check
                checked={form.reliabilityOther}
                label={t.sops_gwg_reliability_other}
                onChange={(checked) => onChange({ reliabilityOther: checked })}
              />
              {form.reliabilityOther ? (
                <Input
                  aria-label={`${t.sops_gwg_reliability_other}: ${t.sops_gwg_details}`}
                  placeholder={t.sops_gwg_details}
                  value={form.reliabilityOtherText}
                  onChange={(event) => onChange({ reliabilityOtherText: event.target.value })}
                  className={inputClass}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatUiText(t.sops_gwg_reliability_monitoring, { name: managementName || "—" })}
        </p>
      </FormSection>
    </div>
  );
}

function SectionHeader({ title, intro, accessory }: { title: string; intro: string; accessory?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className={tokens.text.sectionTitle}>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
            <span>{title}</span>
          </span>
        </h2>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">{intro}</p>
      </div>
      {accessory}
    </div>
  );
}

function GwgTrainingManager() {
  const { user } = useAuth();
  const { t } = useLang();
  const canWrite = hasCapability(user, "personnel.upload");
  const [data, setData] = useState<GwgTrainingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formFor, setFormFor] = useState<GwgTrainingEmployee | null>(null);
  const [form, setForm] = useState<GwgTrainingForm | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<GwgTrainingRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await gwgTrainingApi.overview();
      setData(overview);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason, t.sops_gwg_error_load));
    } finally {
      setLoading(false);
    }
  }, [t.sops_gwg_error_load]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = data?.today ?? appDateKey();
  const employees = sortForAttention(data?.employees ?? []);
  const dueCount = employees.filter((employee) => employee.due).length;
  const historyEmployee = employees.find((employee) => employee.employee_id === historyFor) ?? null;
  const errors = form ? trainingFormErrors(form, today) : [];

  function openForm(employee: GwgTrainingEmployee) {
    setFormFor(employee);
    setForm(defaultTrainingForm(employee, today));
    setShowErrors(false);
    setSaveError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await gwgTrainingApi.create(trainingPayload(form));
      setFormFor(null);
      setForm(null);
      setNotice(t.sops_gwg_notice_created);
      await load();
    } catch (reason) {
      setSaveError(errorMessage(reason, t.sops_gwg_error_save));
    } finally {
      setSaving(false);
    }
  }

  function pickSignedCopy(record: GwgTrainingRecord) {
    uploadTarget.current = record;
    fileInput.current?.click();
  }

  async function uploadSignedCopy(file: File | undefined) {
    const record = uploadTarget.current;
    uploadTarget.current = null;
    if (!file || !record) return;
    setBusyRecordId(record.id);
    setError("");
    setNotice("");
    try {
      await gwgTrainingApi.uploadSigned(record.id, file);
      setNotice(t.sops_gwg_notice_signed);
      await load();
    } catch (reason) {
      setError(errorMessage(reason, t.sops_gwg_error_upload));
    } finally {
      setBusyRecordId(null);
    }
  }

  return (
    <section
      data-testid="gwg-training-section"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
    >
      <SectionHeader
        title={t.sops_gwg_title}
        intro={t.sops_gwg_intro}
        accessory={
          dueCount > 0 ? (
            <Badge variant="outline" className="rounded-full bg-rose-100 text-rose-700 hover:bg-rose-100">
              {formatUiText(t.sops_gwg_due_count, { count: dueCount })}
            </Badge>
          ) : undefined
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t.common_loading}
        </div>
      ) : data ? (
        <GwgTrainingTable
          employees={employees}
          t={t}
          canWrite={canWrite}
          busyRecordId={busyRecordId}
          onConduct={openForm}
          onOpen={setPreview}
          onUpload={pickSignedCopy}
          onHistory={(employee) => setHistoryFor(employee.employee_id)}
        />
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/bmp,image/tiff"
        className="hidden"
        data-testid="gwg-training-signed-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void uploadSignedCopy(file);
        }}
      />

      <Sheet open={Boolean(formFor && form)} onOpenChange={(open) => (!open ? setFormFor(null) : undefined)}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          {formFor && form ? (
            <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
              <AdminSheetScaffold
                title={`${t.sops_gwg_form_title}: ${formFor.display_name}`}
                footer={
                  <SheetFormFooter
                    cancelLabel={t.common_cancel}
                    submitLabel={t.sops_gwg_save}
                    submitting={saving}
                    error={saveError || undefined}
                    onCancel={() => setFormFor(null)}
                  />
                }
              >
                <p className="text-sm text-muted-foreground">{t.sops_gwg_form_hint}</p>
                {showErrors && errors.length > 0 ? (
                  <Banner tone="error">
                    <ul className="list-disc pl-4">
                      {errors.map((code) => (
                        <li key={code}>{text(t, ERROR_KEYS[code])}</li>
                      ))}
                    </ul>
                  </Banner>
                ) : null}
                <GwgTrainingFormFields
                  form={form}
                  employee={formFor}
                  managementName={data?.management_name ?? ""}
                  t={t}
                  onChange={(patch) => setForm((current) => (current ? { ...current, ...patch } : current))}
                />
              </AdminSheetScaffold>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(historyEmployee)} onOpenChange={(open) => (!open ? setHistoryFor(null) : undefined)}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          {historyEmployee ? (
            <AdminSheetScaffold title={`${t.sops_gwg_history_title}: ${historyEmployee.display_name}`}>
              <RecordList
                records={historyEmployee.records}
                t={t}
                canWrite={canWrite}
                busyRecordId={busyRecordId}
                onOpen={setPreview}
                onUpload={pickSignedCopy}
                empty={t.sops_gwg_history_empty}
              />
            </AdminSheetScaffold>
          ) : null}
        </SheetContent>
      </Sheet>

      <FilePreviewDialog
        open={Boolean(preview)}
        fileName={preview?.fileName ?? ""}
        mimeType={preview?.mimeType ?? ""}
        load={() => personnelApi.documentFile(preview?.id ?? "", true)}
        onClose={() => setPreview(null)}
        note={t.personnel_access_logged}
      />
    </section>
  );
}

function GwgOwnTrainingsView() {
  const { t } = useLang();
  const [data, setData] = useState<GwgOwnTrainings | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    gwgTrainingApi
      .mine()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, t.sops_gwg_error_load));
      });
    return () => {
      cancelled = true;
    };
  }, [t.sops_gwg_error_load]);

  if (!data && !error) return null;
  return (
    <section
      data-testid="gwg-training-own"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
    >
      <SectionHeader
        title={t.sops_gwg_my_title}
        intro={t.sops_gwg_my_intro}
        accessory={
          data && data.records.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={data.status} t={t} />
              {data.due ? <DueBadge t={t} /> : null}
            </div>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {data ? (
        <RecordList
          records={data.records}
          t={t}
          canWrite={false}
          busyRecordId={null}
          onOpen={setPreview}
          empty={t.sops_gwg_my_empty}
        />
      ) : null}
      <FilePreviewDialog
        open={Boolean(preview)}
        fileName={preview?.fileName ?? ""}
        mimeType={preview?.mimeType ?? ""}
        load={() => personnelApi.documentFile(preview?.id ?? "", true)}
        onClose={() => setPreview(null)}
        note={t.personnel_access_logged}
      />
    </section>
  );
}

/**
 * The CEO (personnel capabilities) manages every employee's records; an
 * employee with a personnel file sees the own ones; everyone else nothing.
 */
export function GwgTrainingSection() {
  const { user } = useAuth();
  if (hasCapability(user, "personnel.view")) return <GwgTrainingManager />;
  if (user?.has_personnel_file) return <GwgOwnTrainingsView />;
  return null;
}
