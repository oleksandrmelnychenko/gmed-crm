import {
  memo,
  useEffect,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  CalendarClock,
  LoaderCircle,
  Mail,
  Phone,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
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
import {
  functionalLabelChipClass,
  humanizeFunctionalLabel,
  parseFunctionalLabels,
  formInputClassName,
} from "../shared/patient-form-primitives";
import { PatientFormFields } from "../shared/patient-form-fields";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

export type PatientDetailSheetProps = {
  open: boolean;
  detail: PatientDetail | null;
  detailBusy: boolean;
  detailError: string;
  dictionary: PatientsDictionary;
  detailControls: {
    canCreateEdit: boolean;
    canViewAssignments: boolean;
    canManageAssignments: boolean;
    hideFooterActions?: boolean;
    hideWorkspaceActions?: boolean;
  };
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
            className={cn("rounded-full", functionalLabelChipClass(label))}
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
            <NativeComboboxSelect value={selectedAssignee}
              onChange={(event) => onAssigneeChange(event.target.value ?? "")} className={cn("w-full", formInputClassName)}>
                {assignableStaff.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {getPatientRoleLabel(item.role, tr)}
                  </option>
                ))}
              </NativeComboboxSelect>
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
  detailControls,
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
}: PatientDetailSheetProps) {
  const {
    canCreateEdit,
    canViewAssignments,
    canManageAssignments,
    hideFooterActions = false,
    hideWorkspaceActions = false,
  } = detailControls;
  type PatientDetailSheetState = {
    form: PatientFormState;
    busy: boolean;
    error: string;
  };
  type PatientDetailSheetPatch =
    | Partial<PatientDetailSheetState>
    | ((current: PatientDetailSheetState) => Partial<PatientDetailSheetState>);
  const [detailSheetState, dispatchDetailSheetState] = useReducer(
    (
      state: PatientDetailSheetState,
      patch: PatientDetailSheetPatch,
    ): PatientDetailSheetState => ({
      ...state,
      ...(typeof patch === "function" ? patch(state) : patch),
    }),
    undefined,
    () => ({
      form: blankPatientForm(),
      busy: false,
      error: "",
    }),
  );
  const { form, busy, error } = detailSheetState;
  const setForm = (nextValue: SetStateAction<PatientFormState>) => {
    dispatchDetailSheetState((current) => ({
      form:
        typeof nextValue === "function"
          ? nextValue(current.form)
          : nextValue,
    }));
  };

  useEffect(() => {
    if (!open) {
      dispatchDetailSheetState({
        form: blankPatientForm(),
        busy: false,
        error: "",
      });
      return;
    }

    if (detail) {
      dispatchDetailSheetState({
        form: patientToForm(detail),
        error: "",
      });
    }
  }, [detail, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    dispatchDetailSheetState({
      busy: true,
      error: "",
    });

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
      dispatchDetailSheetState({
        error:
          submitError instanceof Error
            ? submitError.message
            : dictionary.common_failed_update,
      });
    } finally {
      dispatchDetailSheetState({ busy: false });
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      title={
        detail
          ? getPatientDisplayName(detail)
          : dictionary.patients_title || dictionary.patients_subtitle
      }
      width="detail-wide"
      onSubmit={detail ? handleSubmit : undefined}
      footer={
        detail && !hideFooterActions ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.common_cancel}
            </Button>
            {canCreateEdit ? (
              <Button
                type="submit"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                disabled={busy}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {busy ? dictionary.patients_saving : dictionary.patients_save}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {detailBusy ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {dictionary.common_loading}
        </div>
      ) : detail ? (
        <>
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
        </>
      ) : detailError ? (
        <Banner tone="error">{detailError}</Banner>
      ) : (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
          {dictionary.patients_subtitle}
        </div>
      )}
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientDetailSheet = memo(PatientDetailSheet);
