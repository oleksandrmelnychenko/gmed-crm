import {
  memo,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarClock,
  LoaderCircle,
  Mail,
  Phone,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Banner, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { updatePatient } from "../../data/patient-mutations";
import { getPatientLegalStatusSummary, normalizePatientLegalStatus } from "../../model/legal-status";
import {
  getPatientDisplayName,
  getPatientFieldValue,
  getPatientGenderLabel,
  getPatientInsuranceLabel,
  getPatientRoleLabel,
  formatPatientDate,
  formatPatientDateTime,
} from "../../model/list-formatters";
import {
  blankPatientForm,
  parseLanguages,
  patientToForm,
  toOptional,
  type PatientAssignment,
  type PatientDetail,
  type PatientFormState,
  type PatientsDictionary,
  type StaffOption,
} from "../../model/list-model";
import { parseFunctionalLabels, formInputClassName, humanizeFunctionalLabel } from "../shared/patient-form-primitives";
import { PatientFormFields } from "../shared/patient-form-fields";

export type PatientDetailSheetProps = {
  open: boolean;
  detail: PatientDetail | null;
  detailBusy: boolean;
  detailError: string;
  dictionary: PatientsDictionary;
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  selectedAssignee: string;
  assignmentBusy: boolean;
  assignmentError: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
  hideFooterActions?: boolean;
  hideWorkspaceActions?: boolean;
};

type PatientOverviewSectionProps = {
  detail: PatientDetail;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
  hideActions?: boolean;
};

function PatientOverviewSection({
  detail,
  onOpenCases,
  onOpenOrders,
  onOpenAppointments,
  onOpenContracts,
  onOpenDocuments,
  hideActions = false,
}: PatientOverviewSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <section className={cn("rounded-xl p-3.5 space-y-3", tokens.surface.softCard)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]",
            detail.is_active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {detail.is_active ? t.common_active : t.common_inactive}
        </span>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {getPatientGenderLabel(detail.gender, tr)}
        </Badge>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {getPatientInsuranceLabel(detail.insurance_type, tr)}
        </Badge>
        {detail.functional_labels?.map((label) => (
          <Badge
            key={`${detail.id}-${label}`}
            variant="outline"
            className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
          >
            {humanizeFunctionalLabel(label)}
          </Badge>
        ))}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {getPatientDisplayName(detail)}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{detail.patient_id}</p>
        </div>
        <div className="grid gap-1 text-[12.5px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-3.5 text-muted-foreground/70" />
            <span>{formatPatientDate(detail.birth_date, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 text-muted-foreground/70" />
            <span>{getPatientFieldValue(detail.phone_primary, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="size-3.5 text-muted-foreground/70" />
            <span>{getPatientFieldValue(detail.email, t.common_not_set)}</span>
          </div>
        </div>
      </div>

      {!hideActions ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenCases}>
            {t.cases_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenOrders}>
            {t.orders_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenAppointments}>
            {t.appointments_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenContracts}>
            {t.nav_contracts}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenDocuments}>
            {t.nav_documents}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type PatientProfileSectionProps = {
  detail: PatientDetail;
  form: PatientFormState;
  canEdit: boolean;
  onChange: (field: keyof PatientFormState, value: string) => void;
};

function PatientProfileSection({
  detail,
  form,
  canEdit,
  onChange,
}: PatientProfileSectionProps) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  const legalStatusSummary = getPatientLegalStatusSummary(
    normalizePatientLegalStatus(detail.legal_status),
  );

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5">
        <div className="text-sm font-semibold text-foreground">
          {l("Identifikation", "Идентификация", "Identification")}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-muted-foreground">{t.patients_birth_date}</div>
            <Input value={detail.birth_date ?? ""} disabled className={formInputClassName} />
          </div>
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-muted-foreground">{t.patients_gender}</div>
            <Input value={getPatientGenderLabel(detail.gender, tr)} disabled className={formInputClassName} />
          </div>
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-muted-foreground">{t.patients_legal_status}</div>
            <Input value={legalStatusSummary} disabled className={formInputClassName} />
          </div>
        </div>
      </section>

      <PatientFormFields form={form} onChange={onChange} />

      {!canEdit ? (
        <p className="text-[12px] text-muted-foreground italic">
          {l(
            "Diese Rolle hat nur Lesezugriff auf Patientendemografie.",
            "Эта роль имеет доступ только для чтения.",
            "This role has read-only access to patient demographics.",
          )}
        </p>
      ) : null}
    </div>
  );
}

type AssignmentsSectionProps = {
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  canManage: boolean;
  assignmentBusy: boolean;
  assignmentError: string;
  selectedAssignee: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
};

function AssignmentsSection({
  assignments,
  assignableStaff,
  canManage,
  assignmentBusy,
  assignmentError,
  selectedAssignee,
  onAssigneeChange,
  onAssign,
}: AssignmentsSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5">
      <div className="text-sm font-semibold text-foreground">{t.patients_assign_owner}</div>

      {assignmentError ? <Banner tone="error">{assignmentError}</Banner> : null}

      {assignments.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">{t.patients_no_assignments}</p>
      ) : (
        <div className="space-y-2">
          {assignments.map((item) => (
            <div
              key={`${item.user_id}-${item.assigned_at}`}
              className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{item.user_name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {getPatientRoleLabel(item.user_role, tr)}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full border-border bg-card text-foreground shrink-0">
                  {item.revoked_at ? t.patients_revoked : t.common_active}
                </Badge>
              </div>
              <div className="mt-2 grid gap-0.5 text-[11.5px] text-muted-foreground md:grid-cols-2">
                <div>{t.patients_assigned_by} {formatPatientDateTime(item.assigned_at, t.common_not_set)}</div>
                <div>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</div>
                {item.revoked_at ? (
                  <div>Revoked {formatPatientDateTime(item.revoked_at, t.common_not_set)}</div>
                ) : null}
                <div>{item.user_active ? t.patients_user_active : t.patients_user_inactive}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] pt-1">
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-muted-foreground">{t.patients_assign_owner}</div>
            <ShadSelect value={selectedAssignee} onValueChange={(v) => onAssigneeChange(v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>
                  {selectedAssignee
                    ? (() => {
                        const selected = assignableStaff.find((item) => item.id === selectedAssignee);
                        return selected
                          ? `${selected.name} · ${getPatientRoleLabel(selected.role, tr)}`
                          : selectedAssignee;
                      })()
                    : t.patients_assign_owner}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignableStaff.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {getPatientRoleLabel(item.role, tr)}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="h-9 rounded-lg gap-1.5 px-3.5"
              disabled={assignmentBusy || !selectedAssignee}
              onClick={onAssign}
            >
              {assignmentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.patients_assign_owner}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PatientDetailSheet({
  open,
  detail,
  detailBusy,
  detailError,
  dictionary,
  canCreateEdit,
  canViewAssignments,
  canManageAssignments,
  assignments,
  assignableStaff,
  selectedAssignee,
  assignmentBusy,
  assignmentError,
  onAssigneeChange,
  onAssign,
  onOpenChange,
  onRefresh,
  onOpenCases,
  onOpenOrders,
  onOpenAppointments,
  onOpenContracts,
  onOpenDocuments,
  hideFooterActions = false,
  hideWorkspaceActions = false,
}: PatientDetailSheetProps) {
  const [form, setForm] = useState<PatientFormState>(blankPatientForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setForm(blankPatientForm());
      setBusy(false);
      setError("");
      return;
    }

    if (detail) {
      setForm(patientToForm(detail));
      setError("");
    }
  }, [detail, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setBusy(true);
    setError("");

    try {
      await updatePatient(detail.id, {
        title: toOptional(form.title),
        first_name: toOptional(form.firstName),
        last_name: toOptional(form.lastName),
        phone_primary: toOptional(form.phonePrimary),
        phone_secondary: toOptional(form.phoneSecondary),
        email: toOptional(form.email),
        nationality: toOptional(form.nationality),
        residence_country: toOptional(form.residenceCountry),
        languages: parseLanguages(form.languages),
        functional_labels: parseFunctionalLabels(form.functionalLabels),
        address_street: toOptional(form.addressStreet),
        address_city: toOptional(form.addressCity),
        address_zip: toOptional(form.addressZip),
        address_country: toOptional(form.addressCountry),
        insurance_provider: toOptional(form.insuranceProvider),
        insurance_number: toOptional(form.insuranceNumber),
        insurance_type: toOptional(form.insuranceType),
        emergency_contact_name: toOptional(form.emergencyContactName),
        emergency_contact_phone: toOptional(form.emergencyContactPhone),
        emergency_contact_relation: toOptional(form.emergencyContactRelation),
        notes: toOptional(form.notes),
      });
      onRefresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_update,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[860px]">
        {detailBusy ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {dictionary.common_loading}
          </div>
        ) : detail ? (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
              <SheetTitle>{getPatientDisplayName(detail)}</SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
              {detailError ? <Banner tone="error">{detailError}</Banner> : null}
              {error ? <Banner tone="error">{error}</Banner> : null}
              <PatientOverviewSection
                detail={detail}
                onOpenCases={onOpenCases}
                onOpenOrders={onOpenOrders}
                onOpenAppointments={onOpenAppointments}
                onOpenContracts={onOpenContracts}
                onOpenDocuments={onOpenDocuments}
                hideActions={hideWorkspaceActions}
              />
              <PatientProfileSection
                detail={detail}
                form={form}
                canEdit={canCreateEdit}
                onChange={(field, value) =>
                  setForm((current) => ({ ...current, [field]: value }))
                }
              />
              {canViewAssignments ? (
                <AssignmentsSection
                  assignments={assignments}
                  assignableStaff={assignableStaff}
                  canManage={canManageAssignments}
                  assignmentBusy={assignmentBusy}
                  assignmentError={assignmentError}
                  selectedAssignee={selectedAssignee}
                  onAssigneeChange={onAssigneeChange}
                  onAssign={onAssign}
                />
              ) : null}
            </div>

            {!hideFooterActions ? (
              <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => onOpenChange(false)}
                >
                  {dictionary.common_cancel}
                </Button>
                {canCreateEdit ? (
                  <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {busy ? dictionary.patients_saving : dictionary.patients_save}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </form>
        ) : detailError ? (
          <div className="p-4">
            <Banner tone="error">{detailError}</Banner>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {dictionary.patients_subtitle}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export const MemoizedPatientDetailSheet = memo(PatientDetailSheet);
