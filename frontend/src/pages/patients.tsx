import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  Filter,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Shield,
  type LucideIcon,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FormSection,
  FunctionalLabelChips,
  formInputClassName,
  humanizeFunctionalLabel,
  parseFunctionalLabels,
  textareaClassName,
} from "@/components/patient-form-primitives";
import { Banner, tokens } from "@/components/ui-shell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { getPatientLegalStatusSummary, normalizePatientLegalStatus } from "./patient-legal-status";
import {
  DEFAULT_PATIENT_FILTERS as DEFAULT_FILTERS,
  blankPatientForm,
  parseLanguages,
  patientPermissions,
  patientToForm,
  toOptional,
  type DoctorOption,
  type PatientAssignment,
  type PatientDetail,
  type PatientFilters,
  type PatientFormState,
  type PatientSummary,
  type PatientsDictionary,
  type ProviderOption,
  type StaffOption,
} from "./patients.helpers";

export type {
  PatientAssignment,
  PatientDetail,
  PatientsDictionary,
  StaffOption,
} from "./patients.helpers";

type CreatePatientSheetProps = {
  open: boolean;
  dictionary: PatientsDictionary;
  onOpenChange: (open: boolean) => void;
  onCreated: (patientId: string) => void;
};

function CreatePatientSheet({
  open,
  dictionary,
  onOpenChange,
  onCreated,
}: CreatePatientSheetProps) {
  const [form, setForm] = useState<PatientFormState>(blankPatientForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setForm(blankPatientForm());
      setBusy(false);
      setError("");
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const created = await apiFetch<{ id: string }>("/patients", {
        method: "POST",
        body: JSON.stringify({
          title: toOptional(form.title),
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          birth_date: form.birthDate,
          gender: form.gender,
          nationality: toOptional(form.nationality),
          residence_country: toOptional(form.residenceCountry),
          languages: parseLanguages(form.languages),
          functional_labels: parseFunctionalLabels(form.functionalLabels),
          phone_primary: toOptional(form.phonePrimary),
          phone_secondary: toOptional(form.phoneSecondary),
          email: toOptional(form.email),
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
        }),
      });
      onOpenChange(false);
      onCreated(created.id);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_create
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
            <SheetTitle>{dictionary.patients_create}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
            {error ? <Banner tone="error">{error}</Banner> : null}
            <PatientFormFields
              form={form}
              onChange={(field, value) =>
                setForm((current) => ({ ...current, [field]: value }))
              }
              includeBirthAndGender
            />
          </div>

          <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.common_cancel}
            </Button>
            <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? dictionary.patients_creating : dictionary.common_create}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const MemoizedCreatePatientSheet = memo(CreatePatientSheet);

type PatientDetailSheetProps = {
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
      await apiFetch(`/patients/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      onRefresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_update
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
              <SheetTitle>{patientName(detail)}</SheetTitle>
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

function buildPatientsPath(filters: PatientFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.activeOnly === "true") params.set("active_only", "true");
  else params.set("active_only", "false");
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  const query = params.toString();
  return query ? `/patients?${query}` : "/patients";
}

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo":
      return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(
        targetRole
      );
    case "patient_manager":
      return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter":
      return targetRole === "interpreter";
    default:
      return false;
  }
}

function formatDate(value?: string | null, fallback = "Not set") {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null, fallback = "Not set") {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function genderLabel(value: string | null | undefined, tr: Record<string, string>) {
  switch (value) {
    case "male": return tr.gender_male;
    case "female": return tr.gender_female;
    case "diverse": return tr.gender_diverse;
    default: return tr.common_not_set;
  }
}

function insuranceLabel(value: string | null | undefined, tr: Record<string, string>) {
  switch (value) {
    case "private": return tr.insurance_private;
    case "public": return tr.insurance_public;
    case "self_pay": return tr.insurance_self_pay;
    case "foreign": return tr.insurance_foreign;
    default: return tr.common_not_set;
  }
}

function roleLabel(value: string | null | undefined, tr: Record<string, string>) {
  if (!value) return tr.common_unknown;
  return tr[`role_${value}`] ?? value.replaceAll("_", " ");
}

function patientName(patient: PatientSummary | PatientDetail) {
  const title = patient.title ? `${patient.title} ` : "";
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  if (!name) return patient.patient_id;
  return `${title}${name}`.trim();
}

function fieldValue(value: string | string[] | null | undefined, fallback = "Not set") {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : fallback;
  }
  return value && value.trim() ? value : fallback;
}

function useOutsideClose(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

function PopoverShell({ children, refEl }: { children: ReactNode; refEl: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={refEl}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-30 mt-1 w-[240px] rounded-lg border border-border bg-popover p-2 shadow-md"
    >
      {children}
    </div>
  );
}

function PopoverFooter({
  onClear,
  onClose,
  clearDisabled,
  tr,
}: {
  onClear: () => void;
  onClose: () => void;
  clearDisabled: boolean;
  tr: Record<string, string>;
}) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <button
        type="button"
        onClick={onClear}
        disabled={clearDisabled}
        className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
      >
        {tr.common_reset}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="text-[12px] text-foreground hover:text-[var(--brand)]"
      >
        {tr.common_confirm ?? "OK"}
      </button>
    </div>
  );
}

function ColumnFilterSelectPopover({
  value,
  onChange,
  onClear,
  onClose,
  options,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  options: { value: string; label: string }[];
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  return (
    <PopoverShell refEl={ref}>
      <div className="flex flex-col gap-0.5">
        {options.map((opt) => {
          const checked = value === opt.value;
          return (
            <button
              key={opt.value || "__all__"}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] text-left transition-colors",
                checked ? "bg-[var(--brand-soft)] text-[var(--brand)] font-medium" : "hover:bg-muted"
              )}
            >
              <span>{opt.label}</span>
              {checked ? <span className="text-[var(--brand)]">✓</span> : null}
            </button>
          );
        })}
      </div>
      <PopoverFooter onClear={onClear} onClose={onClose} clearDisabled={value === ""} tr={tr} />
    </PopoverShell>
  );
}

function ColumnFilterDateRangePopover({
  value,
  onChange,
  onClear,
  onClose,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  const [from, to] = value.split("..");
  const update = (nextFrom: string, nextTo: string) => {
    if (!nextFrom && !nextTo) onChange("");
    else onChange(`${nextFrom}..${nextTo}`);
  };
  return (
    <PopoverShell refEl={ref}>
      <div className="flex flex-col gap-2">
        <Input
          type="date"
          value={from ?? ""}
          onChange={(e) => update(e.target.value, to ?? "")}
          className="h-9 text-[13px] rounded-md bg-card"
        />
        <Input
          type="date"
          value={to ?? ""}
          onChange={(e) => update(from ?? "", e.target.value)}
          className="h-9 text-[13px] rounded-md bg-card"
        />
      </div>
      <PopoverFooter onClear={onClear} onClose={onClose} clearDisabled={value === ""} tr={tr} />
    </PopoverShell>
  );
}

function ColumnFilterPopover({
  value,
  onChange,
  onClear,
  onClose,
  placeholder,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  placeholder: string;
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-border bg-popover p-2 shadow-md"
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-[13px] rounded-md bg-card normal-case tracking-normal"
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onClear}
          disabled={value.trim() === ""}
          className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          {tr.common_reset}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-foreground hover:text-[var(--brand)]"
        >
          {tr.common_confirm ?? "OK"}
        </button>
      </div>
    </div>
  );
}

function KpiInlineStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: "sky" | "emerald" | "amber" | "slate";
}) {
  const toneClass = {
    sky: "bg-sky-100 text-sky-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

  return (
    <div className="flex min-w-[170px] items-center gap-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl",
          toneClass
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <p className="mt-1 text-[20px] font-semibold tracking-tight text-foreground leading-none">
          {value}
        </p>
      </div>
    </div>
  );
}

type ColumnFilterKind = "text" | "select" | "daterange" | "none";

const COLUMN_META: Record<
  "status" | "no" | "patient" | "birth" | "phone" | "email" | "insurance",
  { labelKey: string; widthClass?: string; sortable?: boolean; filter: ColumnFilterKind }
> = {
  status: { labelKey: "patients_col_status", widthClass: "w-[120px]", sortable: true, filter: "select" },
  no: { labelKey: "patients_col_no", widthClass: "w-[56px]", sortable: true, filter: "text" },
  patient: { labelKey: "patients_col_patient", sortable: true, filter: "text" },
  birth: { labelKey: "patients_birth_date", widthClass: "w-[120px]", sortable: true, filter: "daterange" },
  phone: { labelKey: "patients_phone_primary", widthClass: "w-[140px]", sortable: true, filter: "text" },
  email: { labelKey: "patients_email", sortable: true, filter: "text" },
  insurance: { labelKey: "patients_insurance_type", widthClass: "w-[130px]", sortable: true, filter: "select" },
};

type ColumnMetaKey = keyof typeof COLUMN_META;

function patientColumnText(p: PatientSummary, key: ColumnMetaKey, tr: Record<string, string>): string {
  switch (key) {
    case "status":
      return p.is_active ? (tr.common_active ?? "active") : (tr.common_inactive ?? "inactive");
    case "no":
      return p.patient_id ?? "";
    case "patient":
      return [p.last_name, p.first_name, p.title, p.patient_id].filter(Boolean).join(" ");
    case "birth":
      return p.birth_date ?? "";
    case "phone":
      return p.phone_primary ?? "";
    case "email":
      return p.email ?? "";
    case "insurance":
      return [p.insurance_type, p.insurance_provider].filter(Boolean).join(" ");
  }
}

function comparePatientsByColumn(a: PatientSummary, b: PatientSummary, key: ColumnMetaKey): number {
  switch (key) {
    case "status":
      return Number(b.is_active) - Number(a.is_active);
    case "no":
      return (a.patient_id ?? "").localeCompare(b.patient_id ?? "", undefined, { numeric: true });
    case "patient": {
      const an = `${a.last_name ?? ""} ${a.first_name ?? ""}`.trim().toLowerCase();
      const bn = `${b.last_name ?? ""} ${b.first_name ?? ""}`.trim().toLowerCase();
      return an.localeCompare(bn);
    }
    case "birth":
      return (a.birth_date ?? "").localeCompare(b.birth_date ?? "");
    case "phone":
      return (a.phone_primary ?? "").localeCompare(b.phone_primary ?? "");
    case "email":
      return (a.email ?? "").localeCompare(b.email ?? "");
    case "insurance":
      return (a.insurance_type ?? "").localeCompare(b.insurance_type ?? "");
  }
}

function PatientCell({
  colKey,
  patient,
  rowNumber,
  tr,
}: {
  colKey: keyof typeof COLUMN_META;
  patient: PatientSummary;
  rowNumber: number;
  tr: Record<string, string>;
}) {
  switch (colKey) {
    case "status":
      return (
        <td className="px-3 py-2.5">
          <StatusPill active={patient.is_active} tr={tr} />
        </td>
      );
    case "no":
      return (
        <td className="px-3 py-2.5 text-muted-foreground font-mono text-[12px] tabular-nums">
          {rowNumber}
        </td>
      );
    case "patient":
      return (
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-7 rounded-full bg-muted text-[11px] font-medium text-foreground shrink-0">
              {patientName(patient)
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? "")
                .join("")}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate">
                {patientName(patient)}
              </div>
              <div className="text-[11.5px] text-muted-foreground truncate">
                {genderLabel(patient.gender, tr)}
                {patient.functional_labels?.length
                  ? ` · ${patient.functional_labels.map(humanizeFunctionalLabel).join(", ")}`
                  : ""}
              </div>
            </div>
          </div>
        </td>
      );
    case "birth":
      return (
        <td className="px-3 py-2.5 text-muted-foreground">
          {formatDate(patient.birth_date, "—")}
        </td>
      );
    case "phone":
      return (
        <td className="px-3 py-2.5 text-muted-foreground">
          {patient.phone_primary ?? "—"}
        </td>
      );
    case "email":
      return (
        <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[200px]">
          {patient.email ?? "—"}
        </td>
      );
    case "insurance":
      return (
        <td className="px-3 py-2.5 text-muted-foreground">
          {insuranceLabel(patient.insurance_type, tr)}
        </td>
      );
  }
}

function StatusPill({ active, tr }: { active: boolean; tr: Record<string, string> }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium",
        active
          ? "bg-emerald-50 text-emerald-700"
          : "bg-neutral-100 text-neutral-600"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-neutral-400"
        )}
      />
      {active ? tr.common_active : tr.common_inactive}
    </span>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const { t } = useLang();
  if (totalPages <= 1) return <div />;

  const pageBtnClass =
    "size-7 inline-flex items-center justify-center rounded-md text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none";

  const pagesToShow = buildPageSequence(page, totalPages);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={pageBtnClass}
        disabled={page === 0}
        onClick={() => onPage(0)}
        title={t.pagination_first}
      >
        <ChevronsLeft className="size-3.5" />
      </button>
      <button
        type="button"
        className={pageBtnClass}
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
        title={t.pagination_previous}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      {pagesToShow.map((entry, idx) =>
        entry === "…" ? (
          <span key={`gap-${idx}`} className="px-1 text-muted-foreground">…</span>
        ) : (
          <button
            key={entry}
            type="button"
            onClick={() => onPage(entry)}
            className={cn(
              "size-7 inline-flex items-center justify-center rounded-md text-[12.5px] transition-colors",
              entry === page
                ? "bg-[var(--brand)] text-white font-medium"
                : "text-foreground hover:bg-muted"
            )}
          >
            {entry + 1}
          </button>
        )
      )}
      <button
        type="button"
        className={pageBtnClass}
        disabled={page >= totalPages - 1}
        onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
        title={t.pagination_next}
      >
        <ChevronRight className="size-3.5" />
      </button>
      <button
        type="button"
        className={pageBtnClass}
        disabled={page >= totalPages - 1}
        onClick={() => onPage(totalPages - 1)}
        title={t.pagination_last}
      >
        <ChevronsRight className="size-3.5" />
      </button>
    </div>
  );
}

function buildPageSequence(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const pages: (number | "…")[] = [];
  const windowSize = 1;
  const first = 0;
  const last = total - 1;

  pages.push(first);
  if (current - windowSize > first + 1) pages.push("…");
  for (
    let i = Math.max(first + 1, current - windowSize);
    i <= Math.min(last - 1, current + windowSize);
    i++
  ) {
    pages.push(i);
  }
  if (current + windowSize < last - 1) pages.push("…");
  pages.push(last);
  return pages;
}

export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => patientPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<PatientFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [showStats, setShowStats] = useState(true);
  const [goToInput, setGoToInput] = useState("");

  type ColumnKey = "status" | "no" | "patient" | "birth" | "phone" | "email" | "insurance";
  const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
    "no",
    "status",
    "patient",
    "birth",
    "phone",
    "email",
    "insurance",
  ];
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_COLUMN_ORDER);
  const [draggingKey, setDraggingKey] = useState<ColumnKey | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<ColumnKey | null>(null);

  type SortDir = "asc" | "desc";
  const [sortBy, setSortBy] = useState<{ key: ColumnKey; dir: SortDir } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>({
    status: "",
    no: "",
    patient: "",
    birth: "",
    phone: "",
    email: "",
    insurance: "",
  });
  const [filterOpen, setFilterOpen] = useState<ColumnKey | null>(null);

  function toggleSort(key: ColumnKey) {
    setSortBy((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function setColumnFilter(key: ColumnKey, value: string) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function handleColumnDragStart(key: ColumnKey) {
    setDraggingKey(key);
  }

  function handleColumnDragOver(event: React.DragEvent, key: ColumnKey) {
    event.preventDefault();
    if (draggingKey && key !== draggingKey) setDropTargetKey(key);
  }

  function handleColumnDrop(target: ColumnKey) {
    if (!draggingKey || draggingKey === target) {
      setDraggingKey(null);
      setDropTargetKey(null);
      return;
    }
    setColumnOrder((current) => {
      const next = current.filter((k) => k !== draggingKey);
      const insertAt = next.indexOf(target);
      next.splice(insertAt, 0, draggingKey);
      return next;
    });
    setDraggingKey(null);
    setDropTargetKey(null);
  }

  function handleColumnDragEnd() {
    setDraggingKey(null);
    setDropTargetKey(null);
  }

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );
  const patientsPath = useMemo(() => buildPatientsPath(effectiveFilters), [effectiveFilters]);
  const assignableStaff = useMemo(
    () => staff.filter((member) => canAssignTarget(user?.role, member.role)),
    [staff, user?.role]
  );
  const commonFailedLoad = t.common_failed_load;
  const metrics = useMemo(() => {
    return patients.reduce(
      (acc, patient) => {
        acc.total += 1;
        if (patient.is_active) acc.active += 1;
        if (patient.insurance_type === "private") acc.privateCount += 1;
        if (patient.insurance_type === "self_pay") acc.selfPay += 1;
        return acc;
      },
      { total: 0, active: 0, privateCount: 0, selfPay: 0 }
    );
  }, [patients]);

  const sortedAndFilteredPatients = useMemo(() => {
    type CompiledFilter =
      | { kind: "status"; value: string }
      | { kind: "insurance"; value: string }
      | { kind: "birth"; from: string; to: string }
      | { kind: "text"; key: ColumnKey; needle: string };

    const compiled: CompiledFilter[] = [];
    for (const [rawKey, rawValue] of Object.entries(columnFilters) as [ColumnKey, string][]) {
      const raw = rawValue.trim();
      if (!raw) continue;
      if (rawKey === "status") {
        compiled.push({ kind: "status", value: raw });
      } else if (rawKey === "insurance") {
        compiled.push({ kind: "insurance", value: raw });
      } else if (rawKey === "birth") {
        const [from = "", to = ""] = raw.split("..");
        compiled.push({ kind: "birth", from, to });
      } else {
        compiled.push({ kind: "text", key: rawKey, needle: raw.toLowerCase() });
      }
    }

    const filtered = compiled.length === 0
      ? patients
      : patients.filter((p) => {
          for (const f of compiled) {
            if (f.kind === "status") {
              if (f.value === "active" && !p.is_active) return false;
              if (f.value === "inactive" && p.is_active) return false;
            } else if (f.kind === "insurance") {
              if ((p.insurance_type ?? "") !== f.value) return false;
            } else if (f.kind === "birth") {
              const bd = p.birth_date ?? "";
              if (f.from && (bd === "" || bd < f.from)) return false;
              if (f.to && (bd === "" || bd > f.to)) return false;
            } else {
              const haystack = patientColumnText(p, f.key, tr).toLowerCase();
              if (!haystack.includes(f.needle)) return false;
            }
          }
          return true;
        });

    if (!sortBy) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = comparePatientsByColumn(a, b, sortBy.key);
      return sortBy.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [patients, columnFilters, sortBy, tr]);

  const totalPages = Math.max(1, Math.ceil(sortedAndFilteredPatients.length / pageSize));
  const paginatedPatients = useMemo(
    () => sortedAndFilteredPatients.slice(page * pageSize, (page + 1) * pageSize),
    [sortedAndFilteredPatients, page, pageSize]
  );

  // Reset page when data changes
  useEffect(() => { setPage(0); }, [patients.length, pageSize]);

  function syncQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void apiFetch<ProviderOption[]>("/providers")
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setProviders(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";

    setFilters((current) => {
      if (
        current.providerId === providerParam &&
        current.doctorId === doctorParam
      ) {
        return current;
      }
      return {
        ...current,
        providerId: providerParam,
        doctorId: doctorParam,
      };
    });

    if (patientParam && patientParam !== selectedId) {
      setSelectedId(patientParam);
      setDetailOpen(true);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    if (!filters.providerId) {
      setDoctors([]);
      if (filters.doctorId) {
        setFilters((current) => ({ ...current, doctorId: "" }));
      }
      return;
    }

    let cancelled = false;
    void apiFetch<DoctorOption[]>(`/providers/${filters.providerId}/doctors`)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setDoctors(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDoctors([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters.doctorId, filters.providerId]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    // Only show loading spinner on first load, not on filter changes
    if (patients.length === 0) setListBusy(true);
    setListError("");

    void apiFetch<PatientSummary[]>(patientsPath)
      .then((items) => {
        if (!cancelled) {
          const filtered = filters.activeOnly === "false"
            ? items.filter((p) => !p.is_active)
            : items;
          startTransition(() => setPatients(filtered));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : commonFailedLoad);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    commonFailedLoad,
    filters.activeOnly,
    patients.length,
    patientsPath,
    permissions.canViewPage,
    listVersion,
  ]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;

    let cancelled = false;
    setDetailBusy(true);
    setDetailError("");
    setAssignmentError("");

    const detailPromise = apiFetch<PatientDetail>(`/patients/${selectedId}`);
    const assignmentsPromise = permissions.canViewAssignments
      ? apiFetch<PatientAssignment[]>(`/patients/${selectedId}/assignments`).catch(() => [])
      : Promise.resolve([] as PatientAssignment[]);
    const staffPromise = permissions.canManageAssignments
      ? apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => [])
      : Promise.resolve([] as StaffOption[]);

    void Promise.all([detailPromise, assignmentsPromise, staffPromise])
      .then(([patientDetail, assignmentItems, staffItems]) => {
        if (cancelled) return;
        startTransition(() => {
          setDetail(patientDetail);
          setAssignments(assignmentItems);
          setStaff(staffItems);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : commonFailedLoad);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    detailOpen,
    selectedId,
    detailVersion,
    commonFailedLoad,
    permissions.canManageAssignments,
    permissions.canViewAssignments,
  ]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
  }

  function handleDetailOpenChange(open: boolean) {
    setDetailOpen(open);
    if (!open) {
      setSelectedId("");
      setDetail(null);
      setAssignments([]);
      setSelectedAssignee("");
      syncQuery({ patient: null });
    }
  }

  function handlePatientCreated(patientId: string) {
    staffGo(`/patients/${patientId}`);
  }

  function handleDetailSaved() {
    refreshList();
    refreshDetail();
  }

  function openPatient(patientId: string) {
    staffGo(`/patients/${patientId}`);
  }

  async function handleAssignPatient() {
    if (!detail || !selectedAssignee) return;

    setAssignmentBusy(true);
    setAssignmentError("");

    try {
      await apiFetch(`/patients/${detail.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ user_id: selectedAssignee }),
      });
      setSelectedAssignee("");
      refreshDetail();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : t.common_failed_assign);
    } finally {
      setAssignmentBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section
          className={cn("rounded-xl p-8", tokens.surface.softCard)}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Patient registry
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            This workspace is available only to staff roles with patient access.
          </p>
        </section>
      </div>
    );
  }

  const anyFilterActive =
    filters.search.trim() !== "" ||
    filters.activeOnly !== "true" ||
    filters.providerId !== "" ||
    filters.doctorId !== "";

  return (
    <>
      <div className="space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight">
              {t.patients_title}
            </h1>
            {permissions.canCreateEdit ? (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                {t.patients_new}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Top toolbar */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder={t.common_search}
              className="h-8 pl-8 text-[13px] w-[220px] rounded-lg bg-card"
            />
          </div>

          <ShadSelect
            value={filters.activeOnly}
            onValueChange={(v) =>
              setFilters((current) => ({ ...current, activeOnly: v ?? "" }))
            }
          >
            <SelectTrigger size="sm" className="h-8 text-[13px] bg-card">
              <Filter className="size-3.5 mr-1 text-muted-foreground" />
              <SelectValue>
                {filters.activeOnly === "true"
                  ? t.common_active
                  : filters.activeOnly === "false"
                    ? t.common_inactive
                    : t.providers_all}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              <SelectItem value="true">{t.common_active}</SelectItem>
              <SelectItem value="false">{t.common_inactive}</SelectItem>
            </SelectContent>
          </ShadSelect>

          <ShadSelect
            value={filters.providerId}
            onValueChange={(v) => {
              const providerId = v ?? "";
              setFilters((current) => ({ ...current, providerId, doctorId: "" }));
              syncQuery({ provider: providerId || null, doctor: null });
            }}
          >
            <SelectTrigger size="sm" className="h-8 text-[13px] bg-card w-[260px]">
              <SelectValue>
                {filters.providerId
                  ? (providers.find((p) => p.id === filters.providerId)?.name ?? filters.providerId)
                  : t.common_provider}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}{provider.address_city ? ` · ${provider.address_city}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </ShadSelect>

          <ShadSelect
            value={filters.doctorId}
            onValueChange={(v) => {
              const doctorId = v ?? "";
              setFilters((current) => ({ ...current, doctorId }));
              syncQuery({ doctor: doctorId || null });
            }}
            disabled={!filters.providerId}
          >
            <SelectTrigger size="sm" className="h-8 text-[13px] bg-card w-[220px]">
              <SelectValue>
                {filters.doctorId
                  ? (doctors.find((d) => d.id === filters.doctorId)?.name ?? filters.doctorId)
                  : t.common_doctor}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              {doctors.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.title ? `${doctor.title} ` : ""}{doctor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </ShadSelect>

          <label className="flex items-center gap-2 h-8 px-2.5 rounded-lg cursor-pointer text-[12.5px] text-muted-foreground select-none">
            <span>{t.common_show_stats}</span>
            <button
              type="button"
              onClick={() => setShowStats((v) => !v)}
              className={cn(
                "relative inline-flex h-[18px] w-[30px] rounded-full transition-colors",
                showStats ? "bg-[var(--brand)]" : "bg-neutral-300"
              )}
              aria-pressed={showStats}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-[14px] rounded-full bg-white shadow-sm transition-transform",
                  showStats ? "translate-x-[14px]" : "translate-x-0.5"
                )}
              />
            </button>
          </label>

          {anyFilterActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                syncQuery({ provider: null, doctor: null, patient: null });
              }}
            >
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={t.common_export}
              aria-label={t.common_export}
              className="rounded-lg bg-card text-emerald-700 hover:text-emerald-800"
            >
              <FileSpreadsheet className="size-4" />
            </Button>
          </div>
        </div>

        {/* KPI row */}
        {showStats && (
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <KpiInlineStat
              icon={UsersRound}
              tone="sky"
              label={t.patients_title}
              value={metrics.total}
            />
            <KpiInlineStat
              icon={BadgeCheck}
              tone="emerald"
              label={t.common_active}
              value={metrics.active}
            />
            <KpiInlineStat
              icon={Shield}
              tone="slate"
              label={t.insurance_private}
              value={metrics.privateCount}
            />
            <KpiInlineStat
              icon={Wallet}
              tone="amber"
              label={t.insurance_self_pay}
              value={metrics.selfPay}
            />
          </div>
        )}

        {/* Error banner */}
        {listError ? <Banner tone="error">{listError}</Banner> : null}

        {/* Table card */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  {columnOrder.map((key) => {
                    const meta = COLUMN_META[key];
                    const isDragging = draggingKey === key;
                    const isDropTarget = dropTargetKey === key && draggingKey && dropTargetKey !== draggingKey;
                    const isSorted = sortBy?.key === key;
                    const SortIcon = isSorted ? (sortBy?.dir === "asc" ? ArrowUp : ArrowDown) : null;
                    const filterValue = columnFilters[key];
                    const filterActive = filterValue.trim() !== "";
                    const isFilterOpen = filterOpen === key;
                    return (
                      <th
                        key={key}
                        draggable
                        onDragStart={() => handleColumnDragStart(key)}
                        onDragOver={(e) => handleColumnDragOver(e, key)}
                        onDrop={() => handleColumnDrop(key)}
                        onDragEnd={handleColumnDragEnd}
                        className={cn(
                          "px-3 py-2.5 font-medium select-none relative",
                          meta.widthClass,
                          isSorted && "text-foreground",
                          isDragging && "opacity-50",
                          isDropTarget && "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (meta.sortable && !draggingKey) toggleSort(key);
                            }}
                            disabled={!meta.sortable}
                            className={cn(
                              "flex items-center gap-1 min-w-0 text-left",
                              meta.sortable && "cursor-pointer hover:text-foreground"
                            )}
                            title={meta.sortable ? (tr[meta.labelKey] ?? meta.labelKey) : ""}
                          >
                            <span className="truncate">{tr[meta.labelKey] ?? meta.labelKey}</span>
                            {SortIcon ? <SortIcon className="size-3 text-[var(--brand)] shrink-0" /> : null}
                          </button>
                          {meta.filter !== "none" ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterOpen(isFilterOpen ? null : key);
                              }}
                              title={t.common_search}
                              className={cn(
                                "inline-flex items-center justify-center size-5 rounded transition-colors shrink-0",
                                filterActive
                                  ? "text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                                  : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
                              )}
                            >
                              <Filter className="size-3" />
                            </button>
                          ) : null}
                        </div>
                        {isFilterOpen && meta.filter === "text" ? (
                          <ColumnFilterPopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            placeholder={tr[meta.labelKey] ?? meta.labelKey}
                            tr={tr}
                          />
                        ) : null}
                        {isFilterOpen && meta.filter === "select" ? (
                          <ColumnFilterSelectPopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            options={
                              key === "status"
                                ? [
                                    { value: "", label: t.providers_all },
                                    { value: "active", label: t.common_active },
                                    { value: "inactive", label: t.common_inactive },
                                  ]
                                : [
                                    { value: "", label: t.providers_all },
                                    { value: "private", label: t.insurance_private },
                                    { value: "public", label: t.insurance_public },
                                    { value: "self_pay", label: t.insurance_self_pay },
                                    { value: "foreign", label: t.insurance_foreign },
                                  ]
                            }
                            tr={tr}
                          />
                        ) : null}
                        {isFilterOpen && meta.filter === "daterange" ? (
                          <ColumnFilterDateRangePopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            tr={tr}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                  <th className="w-8 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {listBusy ? (
                  <tr>
                    <td colSpan={columnOrder.length + 1} className="py-16 text-center text-muted-foreground">
                      <LoaderCircle className="inline-block mr-2 size-4 animate-spin align-text-bottom" />
                      {t.common_loading}
                    </td>
                  </tr>
                ) : paginatedPatients.length === 0 ? (
                  <tr>
                    <td colSpan={columnOrder.length + 1} className="py-16 text-center text-muted-foreground text-[13px]">
                      {t.patients_no_match}
                    </td>
                  </tr>
                ) : (
                  paginatedPatients.map((patient, idx) => {
                    const rowNumber = page * pageSize + idx + 1;
                    return (
                      <tr
                        key={patient.id}
                        className="group/row border-t border-border transition-colors hover:bg-muted/40 cursor-pointer relative"
                        onClick={() => openPatient(patient.id)}
                      >
                        {columnOrder.map((key) => (
                          <PatientCell
                            key={key}
                            colKey={key}
                            patient={patient}
                            rowNumber={rowNumber}
                            tr={tr}
                          />
                        ))}
                        <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="size-7 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/row:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border text-[12.5px] flex-wrap">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{t.pagination_per_page}</span>
              <ShadSelect
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger size="sm" className="h-7 w-[70px] text-[12.5px]">
                  <SelectValue>{pageSize}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>

            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPage={setPage}
            />

            <form
              className="flex items-center gap-2 text-muted-foreground"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(goToInput);
                if (!Number.isFinite(n) || n < 1) return;
                setPage(Math.min(totalPages - 1, Math.max(0, n - 1)));
                setGoToInput("");
              }}
            >
              <span>{t.pagination_go_to_page}</span>
              <Input
                value={goToInput}
                onChange={(e) => setGoToInput(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder=""
                className="h-7 w-14 text-[12.5px] text-center"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12.5px] text-foreground hover:bg-muted transition-colors"
              >
                {t.pagination_go}
                <ChevronRight className="size-3" />
              </button>
            </form>
          </div>
        </div>
      </div>

      <MemoizedCreatePatientSheet
        open={createOpen}
        dictionary={tr}
        onOpenChange={handleCreateOpenChange}
        onCreated={handlePatientCreated}
      />

      <MemoizedPatientDetailSheet
        open={detailOpen}
        detail={detail}
        detailBusy={detailBusy}
        detailError={detailError}
        dictionary={tr}
        canCreateEdit={permissions.canCreateEdit}
        canViewAssignments={permissions.canViewAssignments}
        canManageAssignments={permissions.canManageAssignments}
        assignments={assignments}
        assignableStaff={assignableStaff}
        selectedAssignee={selectedAssignee}
        assignmentBusy={assignmentBusy}
        assignmentError={assignmentError}
        onAssigneeChange={setSelectedAssignee}
        onAssign={handleAssignPatient}
        onOpenChange={handleDetailOpenChange}
        onRefresh={handleDetailSaved}
        onOpenCases={() => detail ? staffGo(`/cases?patient=${detail.id}`) : undefined}
        onOpenOrders={() => detail ? staffGo(`/orders?patient=${detail.id}`) : undefined}
        onOpenAppointments={() => detail ? staffGo(`/appointments?patient=${detail.id}`) : undefined}
        onOpenContracts={() => detail ? staffGo(`/contracts?patient=${detail.id}`) : undefined}
        onOpenDocuments={() => detail ? staffGo(`/documents?patient=${detail.id}`) : undefined}
      />
    </>
  );
}

function PatientOverviewSection({
  detail,
  onOpenCases,
  onOpenOrders,
  onOpenAppointments,
  onOpenContracts,
  onOpenDocuments,
  hideActions = false,
}: {
  detail: PatientDetail;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
  hideActions?: boolean;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <section
      className={cn("rounded-xl p-3.5 space-y-3", tokens.surface.softCard)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]",
            detail.is_active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-border bg-muted text-muted-foreground"
          )}
        >
          {detail.is_active ? t.common_active : t.common_inactive}
        </span>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {genderLabel(detail.gender, tr)}
        </Badge>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {insuranceLabel(detail.insurance_type, tr)}
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
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{patientName(detail)}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{detail.patient_id}</p>
        </div>
        <div className="grid gap-1 text-[12.5px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-3.5 text-muted-foreground/70" />
            <span>{formatDate(detail.birth_date, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 text-muted-foreground/70" />
            <span>{fieldValue(detail.phone_primary, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="size-3.5 text-muted-foreground/70" />
            <span>{fieldValue(detail.email, t.common_not_set)}</span>
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

function PatientProfileSection({
  detail,
  form,
  canEdit,
  onChange,
}: {
  detail: PatientDetail;
  form: PatientFormState;
  canEdit: boolean;
  onChange: (field: keyof PatientFormState, value: string) => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  const legalStatusSummary = getPatientLegalStatusSummary(
    normalizePatientLegalStatus(detail.legal_status)
  );

  return (
    <div className="space-y-3">
      <FormSection title={l("Identifikation", "Идентификация", "Identification")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_birth_date}>
            <Input value={detail.birth_date ?? ""} disabled className={formInputClassName} />
          </Field>
          <Field label={t.patients_gender}>
            <Input value={genderLabel(detail.gender, tr)} disabled className={formInputClassName} />
          </Field>
          <Field label={t.patients_legal_status}>
            <Input value={legalStatusSummary} disabled className={formInputClassName} />
          </Field>
        </div>
      </FormSection>

      <PatientFormFields form={form} onChange={onChange} />

      {!canEdit ? (
        <p className="text-[12px] text-muted-foreground italic">
          {l(
            "Diese Rolle hat nur Lesezugriff auf Patientendemografie.",
            "Эта роль имеет доступ только для чтения.",
            "This role has read-only access to patient demographics."
          )}
        </p>
      ) : null}
    </div>
  );
}

function AssignmentsSection({
  assignments,
  assignableStaff,
  canManage,
  assignmentBusy,
  assignmentError,
  selectedAssignee,
  onAssigneeChange,
  onAssign,
}: {
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  canManage: boolean;
  assignmentBusy: boolean;
  assignmentError: string;
  selectedAssignee: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <FormSection title={t.patients_assign_owner}>
      {assignmentError ? <Banner tone="error">{assignmentError}</Banner> : null}

      {assignments.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">
          {t.patients_no_assignments}
        </p>
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
                  <p className="text-[12px] text-muted-foreground">{roleLabel(item.user_role, tr)}</p>
                </div>
                <Badge variant="outline" className="rounded-full border-border bg-card text-foreground shrink-0">
                  {item.revoked_at ? t.patients_revoked : t.common_active}
                </Badge>
              </div>
              <div className="mt-2 grid gap-0.5 text-[11.5px] text-muted-foreground md:grid-cols-2">
                <div>{t.patients_assigned_by} {formatDateTime(item.assigned_at, t.common_not_set)}</div>
                <div>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</div>
                {item.revoked_at ? <div>Revoked {formatDateTime(item.revoked_at, t.common_not_set)}</div> : null}
                <div>{item.user_active ? t.patients_user_active : t.patients_user_inactive}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] pt-1">
          <Field label={t.patients_assign_owner}>
            <ShadSelect value={selectedAssignee} onValueChange={(v) => onAssigneeChange(v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>
                  {selectedAssignee
                    ? (() => { const s = assignableStaff.find((i) => i.id === selectedAssignee); return s ? `${s.name} · ${roleLabel(s.role, tr)}` : selectedAssignee; })()
                    : t.patients_assign_owner}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignableStaff.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {roleLabel(item.role, tr)}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </Field>
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
    </FormSection>
  );
}

function PatientFormFields({
  form,
  onChange,
  includeBirthAndGender = false,
}: {
  form: PatientFormState;
  onChange: (field: keyof PatientFormState, value: string) => void;
  includeBirthAndGender?: boolean;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  return (
    <div className="space-y-3">
      <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_title_field}>
            <Input
              value={form.title}
              onChange={(event) => onChange("title", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_first_name}>
            <Input
              value={form.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
          <Field label={t.patients_last_name}>
            <Input
              value={form.lastName}
              onChange={(event) => onChange("lastName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
        </div>

        {includeBirthAndGender ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patients_birth_date}>
              <Input
                type="date"
                value={form.birthDate}
                onChange={(event) => onChange("birthDate", event.target.value)}
                className={formInputClassName}
                required
              />
            </Field>
            <Field label={t.patients_gender}>
              <ShadSelect value={form.gender} onValueChange={(v) => onChange("gender", v ?? "male")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {genderLabel(form.gender, tr)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t.gender_male}</SelectItem>
                  <SelectItem value="female">{t.gender_female}</SelectItem>
                  <SelectItem value="diverse">{t.gender_diverse}</SelectItem>
                </SelectContent>
              </ShadSelect>
            </Field>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t.patients_nationality}>
            <Input
              value={form.nationality}
              onChange={(event) => onChange("nationality", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_residence_country}>
            <Input
              value={form.residenceCountry}
              onChange={(event) => onChange("residenceCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>

        <Field label={t.patients_languages}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className={formInputClassName}
            placeholder={t.patients_languages}
          />
        </Field>

        <Field label={l("Funktionslabels", "Функциональные метки", "Functional labels")}>
          <FunctionalLabelChips
            value={form.functionalLabels}
            onChange={(next) => onChange("functionalLabels", next)}
          />
        </Field>
      </FormSection>

      <FormSection title={l("Kontakt", "Контакты", "Contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_phone_primary}>
            <Input
              value={form.phonePrimary}
              onChange={(event) => onChange("phonePrimary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_phone_secondary}>
            <Input
              value={form.phoneSecondary}
              onChange={(event) => onChange("phoneSecondary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Adresse", "Адрес", "Address")}>
        <Field label={t.patients_address_street}>
          <Input
            value={form.addressStreet}
            onChange={(event) => onChange("addressStreet", event.target.value)}
            className={formInputClassName}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_address_city}>
            <Input
              value={form.addressCity}
              onChange={(event) => onChange("addressCity", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_zip}>
            <Input
              value={form.addressZip}
              onChange={(event) => onChange("addressZip", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_country}>
            <Input
              value={form.addressCountry}
              onChange={(event) => onChange("addressCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_insurance_provider}>
            <Input
              value={form.insuranceProvider}
              onChange={(event) => onChange("insuranceProvider", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_insurance_number}>
            <Input
              value={form.insuranceNumber}
              onChange={(event) => onChange("insuranceNumber", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_insurance_type}>
            <ShadSelect value={form.insuranceType} onValueChange={(v) => onChange("insuranceType", v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>
                  {insuranceLabel(form.insuranceType, tr)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.common_not_set}</SelectItem>
                <SelectItem value="private">{t.insurance_private}</SelectItem>
                <SelectItem value="public">{t.insurance_public}</SelectItem>
                <SelectItem value="self_pay">{t.insurance_self_pay}</SelectItem>
                <SelectItem value="foreign">{t.insurance_foreign}</SelectItem>
              </SelectContent>
            </ShadSelect>
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_emergency_name}>
            <Input
              value={form.emergencyContactName}
              onChange={(event) => onChange("emergencyContactName", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_phone}>
            <Input
              value={form.emergencyContactPhone}
              onChange={(event) => onChange("emergencyContactPhone", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_relation}>
            <Input
              value={form.emergencyContactRelation}
              onChange={(event) => onChange("emergencyContactRelation", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={t.patients_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
        />
      </FormSection>
    </div>
  );
}
