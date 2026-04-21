import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { convertLead as apiConvertLead, downloadLeadAttachment } from "@/lib/api/leads";
import { computeLeadConversionGate } from "./leads.helpers";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import type {
  CreateLeadBody,
  Lead,
  LeadDetail,
  LeadsStats,
  MonthlyEntry,
  StatusCount,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

type LeadListItem = Lead;

type LeadFilters = {
  search: string;
  status: string;
  source: string;
  country: string;
  includeArchived: string;
};

type LeadForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  country: string;
  notes: string;
};

type LeadGateForm = {
  email: string;
  phone: string;
  country: string;
  primaryLanguage: string;
  dateOfBirth: string;
  legalSex: string;
  complianceStatus: string;
  consentHealthcare: boolean;
  consentPrivacyPractices: boolean;
  notes: string;
};

type FailedLeadResolutionForm = {
  resolution: "archive" | "delete";
  reason: string;
  note: string;
};

type LeadPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canConvert: boolean;
};

const DEFAULT_FILTERS: LeadFilters = {
  search: "",
  status: "",
  source: "",
  country: "",
  includeArchived: "false",
};

const STATUS_OPTIONS = [
  "new",
  "in_progress",
  "qualified",
  "not_qualified",
  "converted",
  "archived",
] as const;

const STATUS_VARIANTS: Record<string, string> = {
  new: "border-blue-200 bg-blue-50 text-blue-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  qualified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  not_qualified: "border-rose-200 bg-rose-50 text-rose-700",
  converted: "border-purple-200 bg-purple-50 text-purple-700",
  archived: "border-slate-200 bg-slate-100 text-slate-600",
};

const COMPLIANCE_OPTIONS = [
  "pending",
  "documents_sent",
  "signed",
  "rejected",
] as const;

const LEGAL_SEX_OPTIONS = [
  "female",
  "male",
  "diverse",
  "no_entry",
] as const;

function leadPermissions(role?: string): LeadPermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager" || role === "sales",
    canCreate: role === "ceo" || role === "patient_manager" || role === "sales",
    canConvert: role === "ceo" || role === "patient_manager",
  };
}

function blankLeadForm(): LeadForm {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "",
    country: "",
    notes: "",
  };
}

function blankFailedLeadResolutionForm(): FailedLeadResolutionForm {
  return {
    resolution: "archive",
    reason: "",
    note: "",
  };
}

function leadToGateForm(detail: LeadDetail): LeadGateForm {
  return {
    email: detail.email ?? "",
    phone: detail.phone ?? "",
    country: detail.country ?? "",
    primaryLanguage: detail.primary_language ?? "",
    dateOfBirth: detail.date_of_birth ?? "",
    legalSex: detail.legal_sex ?? "",
    complianceStatus: detail.compliance_status ?? "pending",
    consentHealthcare: detail.consent_healthcare,
    consentPrivacyPractices: detail.consent_privacy_practices,
    notes: detail.notes ?? "",
  };
}

function nonempty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function dashOrValue(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildLeadsPath(filters: LeadFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.source.trim()) params.set("source", filters.source.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.includeArchived) params.set("include_archived", filters.includeArchived);
  const query = params.toString();
  return query ? `/leads?${query}` : "/leads";
}

function statusBadge(status: string) {
  return cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
    STATUS_VARIANTS[status] ?? STATUS_VARIANTS.archived
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function cardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warning" | "success";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700"
      )}
    >
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  footer,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  footer?: ReactNode;
  tone: "sky" | "emerald" | "purple" | "slate";
}) {
  const iconBg =
    tone === "sky"
      ? "bg-sky-100 text-sky-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : tone === "purple"
          ? "bg-purple-100 text-purple-700"
          : "bg-slate-100 text-slate-700";

  return (
    <div className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
        <span className={cn("rounded-2xl p-2", iconBg)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}

export function LeadsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const { staffGo } = useStaffNavigate();
  const failedLoadMessage = t.common_failed_load;
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => leadPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<LeadFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [version, setVersion] = useState(0);

  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // When a PM clicks "Convert" on the card we open a confirmation modal
  // keyed on the lead id, instead of firing POST immediately. The actual
  // convert call happens in `confirmConvertLead` below.
  const [pendingConvertLead, setPendingConvertLead] = useState<LeadListItem | null>(null);

  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [byStatus, setByStatus] = useState<StatusCount[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<LeadForm>(blankLeadForm());

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [gateForm, setGateForm] = useState<LeadGateForm | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [failedLeadForm, setFailedLeadForm] = useState<FailedLeadResolutionForm>(
    blankFailedLeadResolutionForm()
  );
  const [failedLeadBusy, setFailedLeadBusy] = useState(false);

  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );
  const leadsPath = useMemo(() => buildLeadsPath(effectiveFilters), [effectiveFilters]);
  const maxMonthly = useMemo(() => Math.max(1, ...monthly.map((item) => item.count)), [monthly]);
  const totalByStatus = useMemo(
    () => byStatus.reduce((acc, item) => acc + item.count, 0),
    [byStatus]
  );

  useEffect(() => {
    const leadParam = searchParams.get("lead") ?? "";
    if (!leadParam) return;
    if (leadParam !== selectedLeadId) {
      setSelectedLeadId(leadParam);
    }
    if (!detailOpen) {
      setDetailOpen(true);
    }
  }, [detailOpen, searchParams, selectedLeadId]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    void apiFetch<LeadListItem[]>(leadsPath)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setLeads(items));
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : failedLoadMessage);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [failedLoadMessage, leadsPath, permissions.canViewPage, version]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void Promise.all([
      apiFetch<LeadsStats>("/stats/leads").catch(() => null),
      apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => []),
      apiFetch<StatusCount[]>("/stats/leads/by-status").catch(() => []),
    ]).then(([statsPayload, monthlyPayload, statusPayload]) => {
      if (cancelled) return;
      startTransition(() => {
        setStats(statsPayload);
        setMonthly(monthlyPayload);
        setByStatus(statusPayload);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage, version]);

  useEffect(() => {
    if (!detailOpen || !selectedLeadId) return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");

    void apiFetch<LeadDetail>(`/leads/${selectedLeadId}`)
      .then((item) => {
        if (!cancelled) {
          startTransition(() => setDetail(item));
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setDetailError(fetchError instanceof Error ? fetchError.message : failedLoadMessage);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, failedLoadMessage, selectedLeadId, version]);

  useEffect(() => {
    if (!detail) {
      setGateForm(null);
      setFailedLeadForm(blankFailedLeadResolutionForm());
      return;
    }
    setGateForm(leadToGateForm(detail));
    setFailedLeadForm((current) => ({
      resolution:
        current.resolution === "delete" &&
        user?.role !== "patient_manager" &&
        user?.role !== "ceo"
          ? "archive"
          : current.resolution,
      reason: detail.failed_outcome?.reason ?? "",
      note: detail.failed_outcome?.note ?? "",
    }));
  }, [detail, user?.role]);

  function syncLeadQuery(leadId?: string) {
    const params = new URLSearchParams(searchParams);
    if (leadId) {
      params.set("lead", leadId);
    } else {
      params.delete("lead");
    }
    setSearchParams(params, { replace: true });
  }

  function openLeadDetail(leadId: string) {
    setSelectedLeadId(leadId);
    setDetailOpen(true);
    syncLeadQuery(leadId);
  }

  function reload() {
    setVersion((current) => current + 1);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    const payload: CreateLeadBody = {
      first_name: createForm.firstName.trim(),
      last_name: createForm.lastName.trim(),
      email: nonempty(createForm.email),
      phone: nonempty(createForm.phone),
      source: nonempty(createForm.source),
      country: nonempty(createForm.country),
      notes: nonempty(createForm.notes),
    };

    try {
      await apiFetch("/leads", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      setCreateForm(blankLeadForm());
      reload();
    } catch (createFetchError) {
      setCreateError(
        createFetchError instanceof Error ? createFetchError.message : t.common_failed_create
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function updateStatus(leadId: string, status: string) {
    setActionBusy(`status:${leadId}:${status}`);
    try {
      await apiFetch(`/leads/${leadId}/qualify`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      reload();
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t.common_failed_update;
      setError(message);
      setDetailError(message);
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmConvertLead(leadId: string) {
    setActionBusy(`convert:${leadId}`);
    setError("");
    setSuccessMessage("");
    try {
      const result = await apiConvertLead(leadId);
      // Close the dialog first so the success banner and the navigation
      // are not visually occluded by the modal overlay.
      setPendingConvertLead(null);
      setSuccessMessage(
        `Patient ${result.patient_pid} created. Opening detail view…`,
      );
      reload();
      // Give the banner a beat to register before routing away.
      window.setTimeout(() => {
        staffGo(`/patients/${result.patient_id}`);
      }, 400);
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t.common_failed_update;
      setError(message);
      setDetailError(message);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSaveGateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLeadId || !gateForm) return;

    setGateBusy(true);
    setDetailError("");
    try {
      await apiFetch(`/leads/${selectedLeadId}/update`, {
        method: "POST",
        body: JSON.stringify({
          email: nonempty(gateForm.email),
          phone: nonempty(gateForm.phone),
          country: nonempty(gateForm.country),
          primary_language: nonempty(gateForm.primaryLanguage),
          date_of_birth: nonempty(gateForm.dateOfBirth),
          legal_sex: nonempty(gateForm.legalSex),
          compliance_status: nonempty(gateForm.complianceStatus),
          consent_healthcare: gateForm.consentHealthcare,
          consent_privacy_practices: gateForm.consentPrivacyPractices,
          notes: nonempty(gateForm.notes),
        }),
      });
      reload();
    } catch (saveError) {
      setDetailError(
        saveError instanceof Error ? saveError.message : t.common_failed_update
      );
    } finally {
      setGateBusy(false);
    }
  }

  async function handleResolveFailedLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLeadId) return;

    setFailedLeadBusy(true);
    setDetailError("");

    try {
      await apiFetch(`/leads/${selectedLeadId}/failed-flow`, {
        method: "POST",
        body: JSON.stringify({
          resolution: failedLeadForm.resolution,
          reason: failedLeadForm.reason.trim(),
          note: nonempty(failedLeadForm.note),
        }),
      });
      reload();
    } catch (resolveError) {
      setDetailError(
        resolveError instanceof Error ? resolveError.message : t.common_failed_update
      );
    } finally {
      setFailedLeadBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {l("Lead-Bereich", "Раздел лидов", "Leads workspace")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            {l(
              "Dieser Bereich ist auf Patientenmanager und Sales beschränkt, weil er die Intake-Qualifizierung und die Umwandlung in Patientenakten steuert.",
              "Этот экран доступен только менеджерам пациентов и sales, потому что он управляет квалификацией входящих обращений и конверсией в карточки пациентов.",
              "This screen is limited to patient managers and sales because it drives intake qualification and conversion into patient records.",
            )}
          </p>
        </section>
      </div>
    );
  }

  const growthPositive = (stats?.growth_pct ?? 0) >= 0;
  const growthSign = growthPositive ? "+" : "";

  return (
    <>
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.28),_transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] p-6 shadow-[0_32px_80px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  {l("Intake und Qualifizierung", "Приём и квалификация", "Intake and qualification")}
                </Badge>
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {permissions.canConvert ? t.leads_title : t.leads_subtitle}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                {l(
                  "Lead-Pipeline mit direkter Patientenkonvertierung",
                  "Пайплайн лидов с прямой конверсией в пациента",
                  "Lead pipeline connected to patient conversion",
                )}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">
                {l(
                  "Bearbeiten Sie die Intake-Warteschlange mit echten Backend-Filtern, Qualifizierungsaktionen und direkter Umwandlung in Patientenakten aus demselben Bereich.",
                  "Работайте с очередью входящих обращений через реальные backend-фильтры, действия квалификации и прямую конверсию в карточки пациентов из того же раздела.",
                  "Work the intake queue with real backend filters, qualification actions and direct conversion into patient records from the same workspace.",
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={reload}>
                <RefreshCw className="size-4" />
                {l("Aktualisieren", "Обновить", "Refresh")}
              </Button>
              {permissions.canCreate ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-3.5"
                  onClick={() => {
                    setCreateError("");
                    setCreateForm(blankLeadForm());
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {l("Neuer Lead", "Новый лид", "New lead")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Users}
              label={t.common_active}
              value={stats?.total_this_month ?? 0}
              tone="sky"
              footer={
                <span className={cn("flex items-center gap-1 text-xs font-medium", growthPositive ? "text-emerald-600" : "text-rose-600")}>
                  {growthPositive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {growthSign}
                  {stats?.growth_pct ?? 0}% ({growthSign}
                  {stats?.growth_abs ?? 0}) vs last
                </span>
              }
            />
            <StatCard icon={CheckCircle2} label={t.users_status} value={stats?.qualified_this_month ?? 0} tone="emerald" />
            <StatCard icon={UserPlus} label={t.leads_convert} value={stats?.converted_this_month ?? 0} tone="purple" />
            <StatCard icon={TrendingUp} label={t.common_active} value={stats?.total_all ?? 0} tone="slate" />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className={cardClass("p-5 lg:col-span-2")}>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Monthly growth</h2>
            <div className="flex h-48 items-end gap-2">
              {monthly.map((item) => {
                const pct = (item.count / maxMonthly) * 100;
                const label = item.month.split("-").pop() ?? "";
                return (
                  <div key={item.month} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-medium text-slate-600">{item.count}</span>
                    <div className="w-full rounded-t-md bg-sky-500 transition-all" style={{ height: `${pct}%`, minHeight: 4 }} />
                    <span className="text-[10px] text-slate-400">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={cardClass("p-5")}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">By status</h2>
            <p className="mb-4 text-3xl font-bold text-slate-950">{totalByStatus}</p>
            <div className="space-y-3">
              {byStatus.map((item) => {
                const pct = totalByStatus > 0 ? Math.round((item.count / totalByStatus) * 100) : 0;
                return (
                  <div key={item.status} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>{item.status}</span>
                      <span className="font-medium">{item.count}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.common_search}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Search by person or origin and narrow the queue by lifecycle stage.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <FilterField label={t.common_search}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-10 rounded-xl bg-slate-50 pl-9"
                    placeholder={t.common_search}
                    value={filters.search}
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  />
                </div>
              </FilterField>

              <FilterField label={t.users_status}>
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">{t.providers_all}</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label={t.leads_source}>
                <Input value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
              </FilterField>

              <FilterField label={t.providers_country}>
                <Input value={filters.country} onChange={(event) => setFilters((current) => ({ ...current, country: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
              </FilterField>

              <FilterField label={t.common_archive}>
                <select
                  value={filters.includeArchived}
                  onChange={(event) => setFilters((current) => ({ ...current, includeArchived: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="false">Hide archived</option>
                  <option value="true">Include archived</option>
                </select>
              </FilterField>
            </div>
          </section>

          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">Lead queue</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Open a lead to review the intake payload and trigger the next workflow action.
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
                {loading ? t.patients_syncing : `${leads.length} records`}
              </div>
            </div>

            {error ? (
              <div className="mt-5">
                <Banner tone="error">{error}</Banner>
              </div>
            ) : null}

            {successMessage ? (
              <div className="mt-5">
                <Banner tone="success">{successMessage}</Banner>
              </div>
            ) : null}

            {loading ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Loading leads
              </div>
            ) : leads.length === 0 ? (
              <div className="mt-5">
                <Banner tone="warning">No leads matched the current filter set.</Banner>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {leads.map((lead) => {
                  const canQualify =
                    lead.qualification_status === "new" || lead.qualification_status === "in_progress";
                  const {
                    canConvertRole,
                    canConvert,
                    disabledReason: convertDisabledReason,
                  } = computeLeadConversionGate(lead, {
                    canConvert: permissions.canConvert,
                  });
                  const canResolveFailed =
                    lead.qualification_status !== "converted" &&
                    lead.failed_outcome?.status !== "delete_anonymized";

                  return (
                    <div
                      key={lead.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open lead ${lead.first_name} ${lead.last_name}`}
                      onClick={() => {
                        openLeadDetail(lead.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLeadDetail(lead.id);
                        }
                      }}
                      className="rounded-[1.6rem] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={statusBadge(lead.qualification_status)}>
                              {lead.qualification_status}
                            </span>
                            {lead.compliance_status ? (
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                                Compliance {lead.compliance_status}
                              </Badge>
                            ) : null}
                            {lead.failed_outcome?.status &&
                            lead.failed_outcome.status !== "none" ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full",
                                  lead.failed_outcome.status === "delete_anonymized"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-slate-200 bg-slate-100 text-slate-700"
                                )}
                              >
                                {lead.failed_outcome.status === "delete_anonymized"
                                  ? "Deleted payload"
                                  : "Failed lead archived"}
                              </Badge>
                            ) : null}
                          </div>
                          <h3 className="mt-3 text-lg font-semibold text-slate-950">
                            {lead.first_name} {lead.last_name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">{formatDate(lead.created_at)}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Mail className="size-4 text-slate-400" />
                          <span>{lead.email || t.common_not_set}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="size-4 text-slate-400" />
                          <span>{lead.phone || t.common_not_set}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="size-4 text-slate-400" />
                          <span>{lead.country || lead.source || t.common_not_set}</span>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap justify-end gap-2">
                        {canQualify ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-2xl"
                            disabled={Boolean(actionBusy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void updateStatus(lead.id, "qualified");
                            }}
                          >
                            {actionBusy === `status:${lead.id}:qualified` ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            Qualify
                          </Button>
                        ) : null}
                        {canConvertRole ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-2xl"
                            disabled={Boolean(actionBusy) || !canConvert}
                            title={convertDisabledReason ?? undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingConvertLead(lead);
                            }}
                          >
                            {actionBusy === `convert:${lead.id}` ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            Convert
                          </Button>
                        ) : null}
                        {canResolveFailed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="rounded-2xl text-rose-600 hover:text-rose-700"
                            disabled={Boolean(actionBusy) || lead.failed_outcome?.status === "delete_anonymized"}
                            onClick={(event) => {
                              event.stopPropagation();
                              openLeadDetail(lead.id);
                            }}
                          >
                            Resolve failed
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create lead</DialogTitle>
            <DialogDescription>
              Capture intake data once and keep the qualification flow consistent from the first touch.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            {createError ? <Banner tone="error">{createError}</Banner> : null}

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label={t.patients_first_name}>
                <Input value={createForm.firstName} onChange={(event) => setCreateForm((current) => ({ ...current, firstName: event.target.value }))} required />
              </LeadField>
              <LeadField label={t.patients_last_name}>
                <Input value={createForm.lastName} onChange={(event) => setCreateForm((current) => ({ ...current, lastName: event.target.value }))} required />
              </LeadField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label={t.field_phone}>
                <Input value={createForm.phone} onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))} />
              </LeadField>
              <LeadField label={t.patients_email}>
                <Input type="email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} />
              </LeadField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label={t.leads_source}>
                <Input value={createForm.source} onChange={(event) => setCreateForm((current) => ({ ...current, source: event.target.value }))} />
              </LeadField>
              <LeadField label={t.providers_country}>
                <Input value={createForm.country} onChange={(event) => setCreateForm((current) => ({ ...current, country: event.target.value }))} />
              </LeadField>
            </div>

            <LeadField label={t.patients_notes}>
              <textarea value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[104px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30" rows={4} />
            </LeadField>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" disabled={createBusy}>
                {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {createBusy ? t.patients_creating : t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            syncLeadQuery();
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>
              {detail ? `${detail.first_name} ${detail.last_name}` : t.leads_title}
            </SheetTitle>
            <SheetDescription>
              Review intake data, qualification state and patient conversion readiness.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Loading lead
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error">{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusBadge(detail.qualification_status)}>
                      {detail.qualification_status}
                    </span>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      Compliance {detail.compliance_status}
                    </Badge>
                    {detail.failed_outcome.status !== "none" ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          detail.failed_outcome.status === "delete_anonymized"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        )}
                      >
                        {detail.failed_outcome.status === "delete_anonymized"
                          ? "Deleted payload"
                          : "Failed lead archived"}
                      </Badge>
                    ) : null}
                    {detail.converted_patient_id ? (
                      <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                        Converted
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-slate-950">
                    {detail.first_name} {detail.last_name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">Created {formatDate(detail.created_at)}</p>
                </section>

                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">
                        Process readiness
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Qualification and conversion are now blocked by explicit gate checks.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          detail.readiness.qualification_ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        )}
                      >
                        Qualification {detail.readiness.qualification_ready ? "ready" : "blocked"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          detail.readiness.conversion_ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        )}
                      >
                        Conversion {detail.readiness.conversion_ready ? "ready" : "blocked"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {detail.readiness.checks.map((check) => (
                      <div
                        key={check.key}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{check.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                              Blocks {check.blocking_for}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              check.passed
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-rose-200 bg-rose-50 text-rose-700"
                            )}
                          >
                            {check.passed ? "ok" : "missing"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>

                  {detail.readiness.blocking_reasons.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                      <p className="text-sm font-semibold text-rose-700">
                        Blocking reasons
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-rose-700">
                        {detail.readiness.blocking_reasons.map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">Lead lifecycle</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Sequential lifecycle history for qualification, failed-lead handling and conversion.
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      Current stage {detail.lifecycle.current_stage}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <DetailCard
                      label="Current stage"
                      value={detail.lifecycle.current_stage}
                    />
                    <DetailCard
                      label="Entered at"
                      value={detail.lifecycle.stage_entered_at ? formatDate(detail.lifecycle.stage_entered_at) : "Not set"}
                    />
                  </div>

                  <div className="mt-4 space-y-3">
                    {detail.lifecycle.history.map((event, index) => (
                      <div
                        key={`${event.created_at}-${event.to_stage}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {event.from_stage ? `${event.from_stage} -> ${event.to_stage}` : event.to_stage}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                              {event.transition_kind}
                            </p>
                          </div>
                          <span className="text-xs text-slate-500">
                            {formatDate(event.created_at)}
                          </span>
                        </div>
                        {event.note ? (
                          <p className="mt-2 text-sm text-slate-600">{event.note}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                {gateForm && detail.failed_outcome.status === "none" ? (
                  <section className={cardClass("p-5")}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Qualification gate data
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Fill missing compliance and identity fields directly from the lead workspace.
                        </p>
                      </div>
                    </div>

                    <form className="mt-4 space-y-4" onSubmit={handleSaveGateForm}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <LeadField label={t.patients_email} htmlFor="lead-gate-email">
                          <Input
                            id="lead-gate-email"
                            value={gateForm.email}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, email: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                        <LeadField label={t.field_phone} htmlFor="lead-gate-phone">
                          <Input
                            id="lead-gate-phone"
                            value={gateForm.phone}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, phone: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                        <LeadField label={t.providers_country} htmlFor="lead-gate-country">
                          <Input
                            id="lead-gate-country"
                            value={gateForm.country}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, country: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                        <LeadField
                          label="Primary language"
                          htmlFor="lead-gate-primary-language"
                        >
                          <Input
                            id="lead-gate-primary-language"
                            value={gateForm.primaryLanguage}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, primaryLanguage: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                        <LeadField
                          label="Date of birth"
                          htmlFor="lead-gate-date-of-birth"
                        >
                          <Input
                            id="lead-gate-date-of-birth"
                            type="date"
                            value={gateForm.dateOfBirth}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, dateOfBirth: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                        <LeadField label="Legal sex" htmlFor="lead-gate-legal-sex">
                          <select
                            id="lead-gate-legal-sex"
                            value={gateForm.legalSex}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, legalSex: event.target.value }
                                  : current
                              )
                            }
                            className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                          >
                            <option value="">{t.common_not_set}</option>
                            {LEGAL_SEX_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </LeadField>
                        <LeadField
                          label="Compliance status"
                          htmlFor="lead-gate-compliance-status"
                        >
                          <select
                            id="lead-gate-compliance-status"
                            value={gateForm.complianceStatus}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, complianceStatus: event.target.value }
                                  : current
                              )
                            }
                            className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                          >
                            {COMPLIANCE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </LeadField>
                        <LeadField label={t.patients_notes} htmlFor="lead-gate-notes">
                          <Input
                            id="lead-gate-notes"
                            value={gateForm.notes}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, notes: event.target.value }
                                  : current
                              )
                            }
                          />
                        </LeadField>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={gateForm.consentHealthcare}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      consentHealthcare: event.target.checked,
                                    }
                                  : current
                              )
                            }
                          />
                          <span>Healthcare consent available</span>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={gateForm.consentPrivacyPractices}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      consentPrivacyPractices: event.target.checked,
                                    }
                                  : current
                              )
                            }
                          />
                          <span>Privacy practices accepted</span>
                        </label>
                      </div>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={gateBusy}>
                          {gateBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          Save gate data
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}

                {detail.converted_patient_id ? null : (
                  <section className={cardClass("p-5")}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Failed-lead resolution
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Use the controlled archive or delete-anonymize flow instead of setting archived directly.
                        </p>
                      </div>
                      {detail.failed_outcome.status !== "none" ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            detail.failed_outcome.status === "delete_anonymized"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-slate-200 bg-slate-100 text-slate-700"
                          )}
                        >
                          {detail.failed_outcome.status}
                        </Badge>
                      ) : null}
                    </div>

                    {detail.failed_outcome.status !== "none" ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <DetailCard
                          label="Resolution"
                          value={detail.failed_outcome.status}
                        />
                        <DetailCard
                          label="Processed at"
                          value={
                            detail.failed_outcome.processed_at
                              ? formatDate(detail.failed_outcome.processed_at)
                              : "Not set"
                          }
                        />
                        <DetailCard
                          label="Failed from"
                          value={detail.failed_outcome.from_status || t.common_not_set}
                        />
                        <DetailCard
                          label="Reason"
                          value={detail.failed_outcome.reason || t.common_not_set}
                        />
                      </div>
                    ) : null}

                    {detail.failed_outcome.status === "none" ? (
                      <form className="mt-4 space-y-4" onSubmit={handleResolveFailedLead}>
                        <div className="grid gap-4 md:grid-cols-2">
                          <LeadField label="Resolution" htmlFor="lead-failed-resolution">
                            <select
                              id="lead-failed-resolution"
                              value={failedLeadForm.resolution}
                              onChange={(event) =>
                                setFailedLeadForm((current) => ({
                                  ...current,
                                  resolution: event.target.value as "archive" | "delete",
                                }))
                              }
                              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                            >
                              <option value="archive">Archive</option>
                              {user?.role === "patient_manager" || user?.role === "ceo" ? (
                                <option value="delete">Delete and anonymize</option>
                              ) : null}
                            </select>
                          </LeadField>
                          <LeadField label="Failure reason" htmlFor="lead-failed-reason">
                            <Input
                              id="lead-failed-reason"
                              value={failedLeadForm.reason}
                              onChange={(event) =>
                                setFailedLeadForm((current) => ({
                                  ...current,
                                  reason: event.target.value,
                                }))
                              }
                              required
                            />
                          </LeadField>
                        </div>

                        <LeadField label="Internal note" htmlFor="lead-failed-note">
                          <textarea
                            id="lead-failed-note"
                            value={failedLeadForm.note}
                            onChange={(event) =>
                              setFailedLeadForm((current) => ({
                                ...current,
                                note: event.target.value,
                              }))
                            }
                            className="min-h-[96px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                            rows={4}
                          />
                        </LeadField>

                        {failedLeadForm.resolution === "delete" ? (
                          <Banner tone="warning">
                            Delete keeps the lead row for audit trail, but removes personal payload and attachments.
                          </Banner>
                        ) : null}

                        <div className="flex justify-end">
                          <Button type="submit" disabled={failedLeadBusy}>
                            {failedLeadBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            Save failed-lead resolution
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                )}

                <section className={cardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Contact and origin</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard label={t.patients_email} value={detail.email || t.common_not_set} />
                    <DetailCard label={t.field_phone} value={detail.phone || t.common_not_set} />
                    <DetailCard label={t.leads_source} value={detail.source || t.common_not_set} />
                    <DetailCard label={t.providers_country} value={detail.country || t.common_not_set} />
                  </div>
                </section>

                {detail.intake_source === "visitor_facade" ? (
                  <section className={cardClass("p-5")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                        From website wizard
                      </Badge>
                      {detail.flow ? (
                        <Badge variant="outline" className="rounded-full">
                          Flow: {detail.flow}
                        </Badge>
                      ) : null}
                      {detail.locale ? (
                        <Badge variant="outline" className="rounded-full">
                          Locale: {detail.locale}
                        </Badge>
                      ) : null}
                      {detail.submitted_at ? (
                        <span className="text-xs text-slate-500">
                          Submitted {formatDate(detail.submitted_at)}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section className={cardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Identity</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard
                      label="Full name"
                      value={dashOrValue(
                        [
                          detail.first_name,
                          detail.middle_name,
                          detail.last_name,
                          detail.suffix,
                        ]
                          .filter(Boolean)
                          .join(" ")
                      )}
                    />
                    <DetailCard label="Date of birth" value={dashOrValue(detail.date_of_birth)} />
                    <DetailCard label="Legal sex" value={dashOrValue(detail.legal_sex)} />
                    <DetailCard label="Primary language" value={dashOrValue(detail.primary_language)} />
                    <DetailCard label="Needs interpreter" value={yesNo(detail.needs_interpreter)} />
                  </div>
                </section>

                <section className={cardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Address</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard label="Country" value={dashOrValue(detail.country)} />
                    <DetailCard label="City" value={dashOrValue(detail.city)} />
                    <DetailCard label="State / region" value={dashOrValue(detail.state)} />
                    <DetailCard label="Zip code" value={dashOrValue(detail.zip_code)} />
                    <DetailCard label="Street" value={dashOrValue(detail.street_address)} />
                  </div>
                </section>

                {(detail.location ||
                  detail.location_detailed ||
                  detail.wants_membership !== null ||
                  detail.can_travel !== null ||
                  detail.has_medical_records ||
                  detail.has_travel_documents !== null) ? (
                  <section className={cardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">Eligibility & path</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <DetailCard label="Location" value={dashOrValue(detail.location)} />
                      <DetailCard label="Location detailed" value={dashOrValue(detail.location_detailed)} />
                      <DetailCard label="Wants membership" value={yesNo(detail.wants_membership)} />
                      <DetailCard label="Selected program" value={dashOrValue(detail.selected_program)} />
                      <DetailCard label="Can travel" value={yesNo(detail.can_travel)} />
                      <DetailCard label="Has medical records" value={dashOrValue(detail.has_medical_records)} />
                      <DetailCard label="Records in accepted language" value={yesNo(detail.records_in_accepted_language)} />
                      <DetailCard label="Has travel documents" value={yesNo(detail.has_travel_documents)} />
                    </div>
                  </section>
                ) : null}

                {(detail.currently_in_treatment !== null ||
                  detail.has_health_risk_for_travel !== null ||
                  detail.primary_concern_text ||
                  detail.additional_concerns) ? (
                  <section className={cardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">Health & concern</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <DetailCard label="Currently in treatment" value={yesNo(detail.currently_in_treatment)} />
                      <DetailCard label="Health risk for travel" value={yesNo(detail.has_health_risk_for_travel)} />
                    </div>
                    {detail.primary_concern_text ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 whitespace-pre-wrap">
                        {detail.primary_concern_text}
                      </div>
                    ) : null}
                    {detail.additional_concerns ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 whitespace-pre-wrap">
                        {detail.additional_concerns}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {(detail.services?.length ||
                  detail.has_insurance !== null ||
                  detail.insurance_covers_germany) ? (
                  <section className={cardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">Services & insurance</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <DetailCard
                        label="Services"
                        value={detail.services && detail.services.length > 0 ? detail.services.join(", ") : t.common_not_set}
                      />
                      <DetailCard label="Has insurance" value={yesNo(detail.has_insurance)} />
                      <DetailCard label="Insurance covers Germany" value={dashOrValue(detail.insurance_covers_germany)} />
                    </div>
                  </section>
                ) : null}

                {(detail.preferred_location ||
                  detail.visit_timing ||
                  detail.message) ? (
                  <section className={cardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">Wrap up</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <DetailCard label="Preferred location" value={dashOrValue(detail.preferred_location)} />
                      <DetailCard label="Visit timing" value={dashOrValue(detail.visit_timing)} />
                    </div>
                    {detail.message ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 whitespace-pre-wrap">
                        {detail.message}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {detail.intake_source === "visitor_facade" ? (
                  <section className={cardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">Consents</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <DetailCard label="Automated contact" value={yesNo(detail.consent_automated_contact)} />
                      <DetailCard label="Healthcare" value={yesNo(detail.consent_healthcare)} />
                      <DetailCard label="Opt out" value={yesNo(detail.consent_opt_out)} />
                      <DetailCard label="Privacy practices" value={yesNo(detail.consent_privacy_practices)} />
                      <DetailCard label="Email consent" value={yesNo(detail.email_consent)} />
                      <DetailCard label="WhatsApp consent" value={yesNo(detail.whatsapp_consent)} />
                    </div>
                  </section>
                ) : null}

                <section className={cardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">
                    Attachments ({detail.attachments?.length ?? 0})
                  </h3>
                  {detail.attachments && detail.attachments.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {detail.attachments.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium text-slate-800">{file.file_name}</div>
                            <div className="text-xs text-slate-500">
                              {dashOrValue(file.content_type)} · {formatSize(file.size_bytes)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              if (!detail) return;
                              try {
                                const blob = await downloadLeadAttachment(detail.id, file.id);
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = file.file_name;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                URL.revokeObjectURL(url);
                              } catch (downloadErr) {
                                setDetailError(
                                  downloadErr instanceof Error
                                    ? downloadErr.message
                                    : "Failed to download attachment"
                                );
                              }
                            }}
                          >
                            Download
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">No files uploaded.</p>
                  )}
                  {detail.notes ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                      <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Internal notes</div>
                      {detail.notes}
                    </div>
                  ) : null}
                </section>
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                Select a lead from the queue.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={pendingConvertLead !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConvertLead(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{l("Lead in Patienten umwandeln?", "Преобразовать лида в пациента?", "Convert lead to patient?")}</DialogTitle>
            <DialogDescription>
              {pendingConvertLead ? (
                <>
                  {l("Dadurch wird eine Patientenakte für", "Будет создана карточка пациента для", "This will create a patient record for")}{" "}
                  <span className="font-medium text-slate-900">
                    {pendingConvertLead.first_name} {pendingConvertLead.last_name}
                  </span>
                  {l(
                    ", Sie als Patientenmanager zuweisen und die standardmäßige Workflow-Checkliste vorbereiten. Der Lead selbst wechselt in den Status",
                    ", вам будет назначена роль менеджера пациента, и будет создан стандартный workflow-checklist. Сам лид перейдёт в статус",
                    ", assign you as the patient manager, and bootstrap the default workflow checklist. The lead itself moves to the",
                  )}{" "}
                  <span className="font-mono text-xs">{l("converted", "converted", "converted")}</span>{" "}
                  {l(
                    "umgeschaltet. Diese Aktion kann nicht rückgängig gemacht werden.",
                    "и это действие нельзя отменить.",
                    "state. This action cannot be undone.",
                  )}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={Boolean(actionBusy)}>
                  {l("Abbrechen", "Отмена", "Cancel")}
                </Button>
              }
            />
            <Button
              type="button"
              disabled={Boolean(actionBusy) || pendingConvertLead === null}
              onClick={() => {
                if (pendingConvertLead) {
                  void confirmConvertLead(pendingConvertLead.id);
                }
              }}
            >
              {pendingConvertLead && actionBusy === `convert:${pendingConvertLead.id}` ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : null}
              {l("Patient anlegen", "Создать пациента", "Create patient")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function LeadField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
