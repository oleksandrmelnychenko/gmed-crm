import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Globe2,
  LoaderCircle,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { getPatientLegalStatusSummary, normalizePatientLegalStatus } from "./patient-legal-status";

type PatientSummary = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender: string;
  nationality?: string | null;
  residence_country?: string | null;
  languages?: string[];
  phone_primary?: string | null;
  email?: string | null;
  insurance_provider?: string | null;
  insurance_type?: string | null;
  is_active: boolean;
  created_at: string;
};

type PatientDetail = PatientSummary & {
  updated_at?: string;
  phone_secondary?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  insurance_number?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  legal_status?: unknown;
  notes?: string | null;
};

type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

type ProviderOption = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
};

type PatientFilters = {
  search: string;
  activeOnly: string;
  providerId: string;
  doctorId: string;
};

type PatientFormState = {
  title: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  nationality: string;
  residenceCountry: string;
  languages: string;
  phonePrimary: string;
  phoneSecondary: string;
  email: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  insuranceProvider: string;
  insuranceNumber: string;
  insuranceType: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  notes: string;
};

type PatientPermissions = {
  canViewPage: boolean;
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
};

const DEFAULT_FILTERS: PatientFilters = {
  search: "",
  activeOnly: "true",
  providerId: "",
  doctorId: "",
};

const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function patientPermissions(role?: string): PatientPermissions {
  return {
    canViewPage: [
      "ceo",
      "patient_manager",
      "billing",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(role ?? ""),
    canCreateEdit: role === "ceo" || role === "patient_manager",
    canViewAssignments: [
      "ceo",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(role ?? ""),
    canManageAssignments:
      role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter",
  };
}

function blankPatientForm(): PatientFormState {
  return {
    title: "",
    firstName: "",
    lastName: "",
    birthDate: "",
    gender: "male",
    nationality: "",
    residenceCountry: "",
    languages: "",
    phonePrimary: "",
    phoneSecondary: "",
    email: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    addressCountry: "",
    insuranceProvider: "",
    insuranceNumber: "",
    insuranceType: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    notes: "",
  };
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseLanguages(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function patientToForm(detail: PatientDetail): PatientFormState {
  return {
    title: detail.title ?? "",
    firstName: detail.first_name ?? "",
    lastName: detail.last_name ?? "",
    birthDate: detail.birth_date ?? "",
    gender: detail.gender ?? "male",
    nationality: detail.nationality ?? "",
    residenceCountry: detail.residence_country ?? "",
    languages: detail.languages?.join(", ") ?? "",
    phonePrimary: detail.phone_primary ?? "",
    phoneSecondary: detail.phone_secondary ?? "",
    email: detail.email ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    insuranceProvider: detail.insurance_provider ?? "",
    insuranceNumber: detail.insurance_number ?? "",
    insuranceType: detail.insurance_type ?? "",
    emergencyContactName: detail.emergency_contact_name ?? "",
    emergencyContactPhone: detail.emergency_contact_phone ?? "",
    emergencyContactRelation: detail.emergency_contact_relation ?? "",
    notes: detail.notes ?? "",
  };
}

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
      month: "short",
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

function cardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  tone: "sky" | "emerald" | "amber" | "slate";
}) {
  const toneClass =
    tone === "sky"
      ? "bg-sky-100 text-sky-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : tone === "amber"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-700";

  return (
    <div className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
        <span className={cn("rounded-2xl p-2", toneClass)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-6">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const navigate = useNavigate();
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
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<PatientFormState>(blankPatientForm());

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [editForm, setEditForm] = useState<PatientFormState>(blankPatientForm());
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

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

  const totalPages = Math.max(1, Math.ceil(patients.length / PAGE_SIZE));
  const paginatedPatients = useMemo(
    () => patients.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [patients, page]
  );

  // Reset page when data changes
  useEffect(() => { setPage(0); }, [patients.length]);

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
    setEditError("");
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
          setEditForm(patientToForm(patientDetail));
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

  function openPatient(patientId: string) {
    navigate(`/patients/${patientId}`);
  }

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const created = await apiFetch<{ id: string }>("/patients", {
        method: "POST",
        body: JSON.stringify({
          title: toOptional(createForm.title),
          first_name: createForm.firstName.trim(),
          last_name: createForm.lastName.trim(),
          birth_date: createForm.birthDate,
          gender: createForm.gender,
          nationality: toOptional(createForm.nationality),
          residence_country: toOptional(createForm.residenceCountry),
          languages: parseLanguages(createForm.languages),
          phone_primary: toOptional(createForm.phonePrimary),
          phone_secondary: toOptional(createForm.phoneSecondary),
          email: toOptional(createForm.email),
          address_street: toOptional(createForm.addressStreet),
          address_city: toOptional(createForm.addressCity),
          address_zip: toOptional(createForm.addressZip),
          address_country: toOptional(createForm.addressCountry),
          insurance_provider: toOptional(createForm.insuranceProvider),
          insurance_number: toOptional(createForm.insuranceNumber),
          insurance_type: toOptional(createForm.insuranceType),
          emergency_contact_name: toOptional(createForm.emergencyContactName),
          emergency_contact_phone: toOptional(createForm.emergencyContactPhone),
          emergency_contact_relation: toOptional(createForm.emergencyContactRelation),
          notes: toOptional(createForm.notes),
        }),
      });
      setCreateOpen(false);
      setCreateForm(blankPatientForm());
      navigate(`/patients/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleUpdatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setEditBusy(true);
    setEditError("");

    try {
      await apiFetch(`/patients/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: toOptional(editForm.title),
          first_name: toOptional(editForm.firstName),
          last_name: toOptional(editForm.lastName),
          phone_primary: toOptional(editForm.phonePrimary),
          phone_secondary: toOptional(editForm.phoneSecondary),
          email: toOptional(editForm.email),
          nationality: toOptional(editForm.nationality),
          residence_country: toOptional(editForm.residenceCountry),
          languages: parseLanguages(editForm.languages),
          address_street: toOptional(editForm.addressStreet),
          address_city: toOptional(editForm.addressCity),
          address_zip: toOptional(editForm.addressZip),
          address_country: toOptional(editForm.addressCountry),
          insurance_provider: toOptional(editForm.insuranceProvider),
          insurance_number: toOptional(editForm.insuranceNumber),
          insurance_type: toOptional(editForm.insuranceType),
          emergency_contact_name: toOptional(editForm.emergencyContactName),
          emergency_contact_phone: toOptional(editForm.emergencyContactPhone),
          emergency_contact_relation: toOptional(editForm.emergencyContactRelation),
          notes: toOptional(editForm.notes),
        }),
      });
      refreshList();
      refreshDetail();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setEditBusy(false);
    }
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
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Patient registry
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            This workspace is available only to care and operations roles with patient access.
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.28),_transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] p-6 shadow-[0_32px_80px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700"
                >
                  {t.patients_title}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600"
                >
                  {permissions.canCreateEdit ? t.patients_registry_control : t.patients_readonly_view}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                {t.patients_subtitle}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="rounded-2xl size-10" onClick={refreshList}>
                <RefreshCw className="size-4" />
              </Button>
              {permissions.canCreateEdit ? (
                <Button
                  type="button"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={() => {
                    setCreateError("");
                    setCreateForm(blankPatientForm());
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t.patients_new}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={UserRound} label={t.patients_title} value={metrics.total.toString()} tone="sky" />
            <MetricCard icon={ShieldCheck} label={t.common_active} value={metrics.active.toString()} tone="emerald" />
            <MetricCard icon={UsersRound} label={t.insurance_private} value={metrics.privateCount.toString()} tone="amber" />
            <MetricCard icon={CalendarClock} label={t.insurance_self_pay} value={metrics.selfPay.toString()} tone="slate" />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.common_search}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.patients_subtitle}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-xl"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  syncQuery({ provider: null, doctor: null, patient: null });
                }}
                title={t.access_reset}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <Field label={t.common_search}>
                <Input
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, search: event.target.value }))
                  }
                  placeholder={t.common_search}
                  className="h-10 rounded-xl bg-slate-50"
                />
              </Field>

              <Field label={t.common_activity}>
                <ShadSelect value={filters.activeOnly} onValueChange={(v) => setFilters((current) => ({ ...current, activeOnly: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue>
                      {filters.activeOnly === "true" ? t.common_active
                        : filters.activeOnly === "false" ? t.common_inactive
                        : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t.providers_all}</SelectItem>
                    <SelectItem value="true">{t.common_active}</SelectItem>
                    <SelectItem value="false">{t.common_inactive}</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </Field>

              <Field label={t.common_provider}>
                <ShadSelect value={filters.providerId} onValueChange={(v) => {
                  const providerId = v ?? "";
                  setFilters((current) => ({ ...current, providerId, doctorId: "" }));
                  syncQuery({ provider: providerId || null, doctor: null });
                }}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue>
                      {filters.providerId
                        ? (providers.find((p) => p.id === filters.providerId)?.name ?? filters.providerId)
                        : t.providers_all}
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
              </Field>

              <Field label={t.common_doctor}>
                <ShadSelect value={filters.doctorId} onValueChange={(v) => {
                  const doctorId = v ?? "";
                  setFilters((current) => ({ ...current, doctorId }));
                  syncQuery({ doctor: doctorId || null });
                }} disabled={!filters.providerId}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue>
                      {filters.doctorId
                        ? (doctors.find((d) => d.id === filters.doctorId)?.name ?? filters.doctorId)
                        : t.providers_all}
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
              </Field>
            </div>
          </section>

          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.patients_title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.patients_subtitle}
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
                {listBusy ? t.patients_syncing : `${patients.length} ${t.patients_records}`}
              </div>
            </div>

            {listError ? (
              <div className="mt-5">
                <Banner tone="error">{listError}</Banner>
              </div>
            ) : null}

            {listBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.common_loading}
              </div>
            ) : patients.length === 0 ? (
              <div className="mt-5">
                <EmptyPanel
                  title={t.patients_no_match}
                  text={t.patients_no_match}
                />
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-4 xl:grid-cols-2 min-h-[320px] content-start">
                {paginatedPatients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => openPatient(patient.id)}
                    className="rounded-[1.6rem] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", patient.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600")}>
                            {patient.is_active ? t.common_active : t.common_inactive}
                          </span>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                            {genderLabel(patient.gender, tr)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                            {insuranceLabel(patient.insurance_type, tr)}
                          </Badge>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-slate-950">
                          {patientName(patient)}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">{patient.patient_id}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="size-4 text-slate-400" />
                        <span>{formatDate(patient.birth_date)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="size-4 text-slate-400" />
                        <span>{fieldValue(patient.phone_primary)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="size-4 text-slate-400" />
                        <span>{fieldValue(patient.email)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe2 className="size-4 text-slate-400" />
                        <span>{fieldValue(patient.languages)}</span>
                      </div>
                    </div>
                  </button>
                ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, patients.length)} / {patients.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="rounded-lg"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <Button
                        key={i}
                        type="button"
                        variant={i === page ? "default" : "outline"}
                        size="xs"
                        className="rounded-lg min-w-[28px]"
                        onClick={() => setPage(i)}
                      >
                        {i + 1}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="rounded-lg"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full !sm:max-w-[50vw]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>{t.patients_create}</SheetTitle>
            <SheetDescription>{t.patients_subtitle}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <form onSubmit={handleCreatePatient} className="space-y-6 pt-5">
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <PatientFormFields form={createForm} onChange={(field, value) => setCreateForm((current) => ({ ...current, [field]: value }))} includeBirthAndGender />
              <div className="flex justify-end gap-3 border-t border-border/70 pt-4">
                <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={createBusy}>
                  {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {createBusy ? t.patients_creating : t.patients_create}
                </Button>
              </div>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedId("");
            setDetail(null);
            setAssignments([]);
            setSelectedAssignee("");
            syncQuery({ patient: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[860px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>{detail ? patientName(detail) : t.patients_profile}</SheetTitle>
            <SheetDescription>
              {t.patients_subtitle}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {detailBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Loading patient
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error">{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <PatientOverviewSection
                  detail={detail}
                  onOpenCases={() => navigate(`/cases?patient=${detail.id}`)}
                  onOpenOrders={() => navigate(`/orders?patient=${detail.id}`)}
                  onOpenAppointments={() => navigate(`/appointments?patient=${detail.id}`)}
                  onOpenContracts={() => navigate(`/contracts?patient=${detail.id}`)}
                  onOpenDocuments={() => navigate(`/documents?patient=${detail.id}`)}
                />
                <PatientProfileSection
                  detail={detail}
                  form={editForm}
                  busy={editBusy}
                  error={editError}
                  canEdit={permissions.canCreateEdit}
                  onChange={(field, value) =>
                    setEditForm((current) => ({ ...current, [field]: value }))
                  }
                  onSubmit={handleUpdatePatient}
                />
                {permissions.canViewAssignments ? (
                  <AssignmentsSection
                    assignments={assignments}
                    assignableStaff={assignableStaff}
                    canManage={permissions.canManageAssignments}
                    assignmentBusy={assignmentBusy}
                    assignmentError={assignmentError}
                    selectedAssignee={selectedAssignee}
                    onAssigneeChange={setSelectedAssignee}
                    onAssign={handleAssignPatient}
                  />
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                Select a patient to open the profile sheet.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
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
}: {
  detail: PatientDetail;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <section className={cardClass("p-5")}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            detail.is_active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-100 text-slate-600"
          )}
        >
          {detail.is_active ? t.common_active : t.common_inactive}
        </span>
        <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
          {genderLabel(detail.gender, tr)}
        </Badge>
        <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
          {insuranceLabel(detail.insurance_type, tr)}
        </Badge>
      </div>

      <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">{patientName(detail)}</h2>
          <p className="mt-2 text-sm text-slate-600">{detail.patient_id}</p>
        </div>
        <div className="grid gap-2 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-slate-400" />
            <span>{formatDate(detail.birth_date, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-slate-400" />
            <span>{fieldValue(detail.phone_primary, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-slate-400" />
            <span>{fieldValue(detail.email, t.common_not_set)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenCases}>
          {t.cases_title}
        </Button>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenOrders}>
          {t.orders_title}
        </Button>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenAppointments}>
          {t.appointments_title}
        </Button>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenContracts}>
          Contracts
        </Button>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenDocuments}>
          Documents
        </Button>
      </div>
    </section>
  );
}

function PatientProfileSection({
  detail,
  form,
  busy,
  error,
  canEdit,
  onChange,
  onSubmit,
}: {
  detail: PatientDetail;
  form: PatientFormState;
  busy: boolean;
  error: string;
  canEdit: boolean;
  onChange: (field: keyof PatientFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const legalStatusSummary = getPatientLegalStatusSummary(
    normalizePatientLegalStatus(detail.legal_status)
  );

  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{t.patients_profile}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {t.patients_subtitle}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {t.users_created} {formatDateTime(detail.updated_at, t.common_not_set)}
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t.patients_birth_date}>
            <Input value={detail.birth_date ?? ""} disabled className="h-10 rounded-xl bg-slate-50" />
          </Field>
          <Field label={t.patients_gender}>
            <Input value={genderLabel(detail.gender, tr)} disabled className="h-10 rounded-xl bg-slate-50" />
          </Field>
          <Field label={t.patients_legal_status}>
            <Input
              value={legalStatusSummary}
              disabled
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
        </div>

        <PatientFormFields form={form} onChange={onChange} />

        {canEdit ? (
          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {busy ? t.patients_saving : t.patients_save}
            </Button>
          </div>
        ) : (
          <div className="border-t border-border/70 pt-4 text-sm text-slate-500">
            This role has read-only access to patient demographics and assignment context.
          </div>
        )}
      </form>
    </section>
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
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{t.patients_assign_owner}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {t.patients_subtitle}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {assignments.length} {t.patients_records}
        </div>
      </div>

      {assignmentError ? (
        <div className="mt-4">
          <Banner tone="error">{assignmentError}</Banner>
        </div>
      ) : null}

      {assignments.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.patients_no_assignments}
            text={t.patients_no_assignments}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {assignments.map((item) => (
            <div key={`${item.user_id}-${item.assigned_at}`} className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-base font-semibold text-slate-950">{item.user_name}</p>
                  <p className="mt-1 text-sm text-slate-600">{roleLabel(item.user_role, tr)}</p>
                </div>
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                  {item.revoked_at ? t.patients_revoked : t.common_active}
                </Badge>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
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
        <div className="mt-5 border-t border-border/70 pt-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t.patients_assign_owner}>
              <ShadSelect value={selectedAssignee} onValueChange={(v) => onAssigneeChange(v ?? "")}>
                <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
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
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={assignmentBusy || !selectedAssignee}
                onClick={onAssign}
              >
                {assignmentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t.patients_assign_owner}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.patients_title_field}>
          <Input
            value={form.title}
            onChange={(event) => onChange("title", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_first_name}>
          <Input
            value={form.firstName}
            onChange={(event) => onChange("firstName", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
        <Field label={t.patients_last_name}>
          <Input
            value={form.lastName}
            onChange={(event) => onChange("lastName", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
      </div>

      {includeBirthAndGender ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_birth_date}>
            <Input
              type="date"
              value={form.birthDate}
              onChange={(event) => onChange("birthDate", event.target.value)}
              className="h-10 rounded-xl bg-slate-50"
              required
            />
          </Field>
          <Field label={t.patients_gender}>
            <ShadSelect value={form.gender} onValueChange={(v) => onChange("gender", v ?? "male")}>
              <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
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

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.patients_nationality}>
          <Input
            value={form.nationality}
            onChange={(event) => onChange("nationality", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_residence_country}>
          <Input
            value={form.residenceCountry}
            onChange={(event) => onChange("residenceCountry", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <Field label={t.patients_languages}>
        <Input
          value={form.languages}
          onChange={(event) => onChange("languages", event.target.value)}
          className="h-10 rounded-xl bg-slate-50"
          placeholder={t.patients_languages}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.patients_phone_primary}>
          <Input
            value={form.phonePrimary}
            onChange={(event) => onChange("phonePrimary", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_phone_secondary}>
          <Input
            value={form.phoneSecondary}
            onChange={(event) => onChange("phoneSecondary", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <Field label={t.patients_address_street}>
        <Input
          value={form.addressStreet}
          onChange={(event) => onChange("addressStreet", event.target.value)}
          className="h-10 rounded-xl bg-slate-50"
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.patients_address_city}>
          <Input
            value={form.addressCity}
            onChange={(event) => onChange("addressCity", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_address_zip}>
          <Input
            value={form.addressZip}
            onChange={(event) => onChange("addressZip", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_address_country}>
          <Input
            value={form.addressCountry}
            onChange={(event) => onChange("addressCountry", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.patients_insurance_provider}>
          <Input
            value={form.insuranceProvider}
            onChange={(event) => onChange("insuranceProvider", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_insurance_number}>
          <Input
            value={form.insuranceNumber}
            onChange={(event) => onChange("insuranceNumber", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_insurance_type}>
          <ShadSelect value={form.insuranceType} onValueChange={(v) => onChange("insuranceType", v ?? "")}>
            <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
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

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.patients_emergency_name}>
          <Input
            value={form.emergencyContactName}
            onChange={(event) => onChange("emergencyContactName", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_emergency_phone}>
          <Input
            value={form.emergencyContactPhone}
            onChange={(event) => onChange("emergencyContactPhone", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.patients_emergency_relation}>
          <Input
            value={form.emergencyContactRelation}
            onChange={(event) => onChange("emergencyContactRelation", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <Field label={t.patients_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
        />
      </Field>
    </div>
  );
}
