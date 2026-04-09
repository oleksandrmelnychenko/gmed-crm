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
  DialogContent,
  DialogDescription,
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
import { useAuth } from "@/lib/auth";
import type { CreateLeadBody, Lead, LeadsStats, MonthlyEntry, StatusCount } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type LeadListItem = Lead & {
  compliance_status?: string | null;
};

type LeadDetail = Lead & {
  languages?: string[];
  needs_medical?: string | null;
  needs_non_medical?: string | null;
  compliance_status: string;
  converted_patient_id?: string | null;
  notes?: string | null;
  updated_at?: string;
};

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
  languages: string;
  needsMedical: string;
  needsNonMedical: string;
  notes: string;
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

function leadPermissions(role?: string): LeadPermissions {
  return {
    canViewPage: role === "patient_manager" || role === "sales",
    canCreate: role === "patient_manager" || role === "sales",
    canConvert: role === "patient_manager",
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
    languages: "",
    needsMedical: "",
    needsNonMedical: "",
    notes: "",
  };
}

function nonempty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function parseLanguages(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => leadPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<LeadFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [version, setVersion] = useState(0);

  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load leads");
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
  }, [leadsPath, permissions.canViewPage, version]);

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
          setDetailError(fetchError instanceof Error ? fetchError.message : "Failed to load lead");
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
  }, [detailOpen, selectedLeadId, version]);

  function syncLeadQuery(leadId?: string) {
    const params = new URLSearchParams(searchParams);
    if (leadId) {
      params.set("lead", leadId);
    } else {
      params.delete("lead");
    }
    setSearchParams(params, { replace: true });
  }

  function reload() {
    setVersion((current) => current + 1);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    const payload: CreateLeadBody & {
      languages?: string[];
      needs_non_medical?: string | null;
      notes?: string | null;
    } = {
      first_name: createForm.firstName.trim(),
      last_name: createForm.lastName.trim(),
      email: nonempty(createForm.email),
      phone: nonempty(createForm.phone),
      source: nonempty(createForm.source),
      country: nonempty(createForm.country),
      languages: parseLanguages(createForm.languages),
      needs_medical: nonempty(createForm.needsMedical),
      needs_non_medical: nonempty(createForm.needsNonMedical),
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
        createFetchError instanceof Error ? createFetchError.message : "Failed to create lead"
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
    } finally {
      setActionBusy(null);
    }
  }

  async function convertLead(leadId: string) {
    setActionBusy(`convert:${leadId}`);
    try {
      await apiFetch(`/leads/${leadId}/convert`, { method: "POST" });
      reload();
    } finally {
      setActionBusy(null);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Leads workspace</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            This screen is limited to patient managers and sales because it drives intake
            qualification and conversion into patient records.
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
                  Intake and qualification
                </Badge>
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {permissions.canConvert ? "PM conversion control" : "Sales qualification view"}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Lead pipeline connected to patient conversion
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">
                Work the intake queue with real backend filters, qualification actions and direct
                conversion into patient records from the same workspace.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={reload}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              {permissions.canCreate ? (
                <Button
                  type="button"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={() => {
                    setCreateError("");
                    setCreateForm(blankLeadForm());
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  New lead
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Users}
              label="This month"
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
            <StatCard icon={CheckCircle2} label="Qualified" value={stats?.qualified_this_month ?? 0} tone="emerald" />
            <StatCard icon={UserPlus} label="Converted" value={stats?.converted_this_month ?? 0} tone="purple" />
            <StatCard icon={TrendingUp} label="All time" value={stats?.total_all ?? 0} tone="slate" />
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
                <h2 className="text-sm font-semibold text-slate-950">Filters</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Search by person or origin and narrow the queue by lifecycle stage.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <FilterField label="Search">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-10 rounded-xl bg-slate-50 pl-9"
                    placeholder="Name, phone, email, country"
                    value={filters.search}
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  />
                </div>
              </FilterField>

              <FilterField label="Status">
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Source">
                <Input value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
              </FilterField>

              <FilterField label="Country">
                <Input value={filters.country} onChange={(event) => setFilters((current) => ({ ...current, country: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
              </FilterField>

              <FilterField label="Archive visibility">
                <select
                  value={filters.includeArchived}
                  onChange={(event) => setFilters((current) => ({ ...current, includeArchived: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
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
                {loading ? "Syncing" : `${leads.length} records`}
              </div>
            </div>

            {error ? (
              <div className="mt-5">
                <Banner tone="error">{error}</Banner>
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
                  const canConvert = permissions.canConvert && lead.qualification_status === "qualified";
                  const canArchive =
                    lead.qualification_status !== "archived" && lead.qualification_status !== "converted";

                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setDetailOpen(true);
                        syncLeadQuery(lead.id);
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
                          <span>{lead.email || "No email yet"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="size-4 text-slate-400" />
                          <span>{lead.phone || "No phone yet"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="size-4 text-slate-400" />
                          <span>{lead.country || lead.source || "No source context yet"}</span>
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
                        {canConvert ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-2xl"
                            disabled={Boolean(actionBusy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void convertLead(lead.id);
                            }}
                          >
                            {actionBusy === `convert:${lead.id}` ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            Convert
                          </Button>
                        ) : null}
                        {canArchive ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="rounded-2xl text-rose-600 hover:text-rose-700"
                            disabled={Boolean(actionBusy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void updateStatus(lead.id, "archived");
                            }}
                          >
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </button>
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
              <LeadField label="First name *">
                <Input value={createForm.firstName} onChange={(event) => setCreateForm((current) => ({ ...current, firstName: event.target.value }))} required />
              </LeadField>
              <LeadField label="Last name *">
                <Input value={createForm.lastName} onChange={(event) => setCreateForm((current) => ({ ...current, lastName: event.target.value }))} required />
              </LeadField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label="Phone">
                <Input value={createForm.phone} onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))} />
              </LeadField>
              <LeadField label="Email">
                <Input type="email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} />
              </LeadField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label="Source">
                <Input value={createForm.source} onChange={(event) => setCreateForm((current) => ({ ...current, source: event.target.value }))} />
              </LeadField>
              <LeadField label="Country">
                <Input value={createForm.country} onChange={(event) => setCreateForm((current) => ({ ...current, country: event.target.value }))} />
              </LeadField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LeadField label="Languages">
                <Input value={createForm.languages} onChange={(event) => setCreateForm((current) => ({ ...current, languages: event.target.value }))} placeholder="German, Ukrainian, English" />
              </LeadField>
              <LeadField label="Medical needs">
                <Input value={createForm.needsMedical} onChange={(event) => setCreateForm((current) => ({ ...current, needsMedical: event.target.value }))} placeholder="Diagnostics, surgery, rehab" />
              </LeadField>
            </div>

            <LeadField label="Non-medical needs">
              <Input value={createForm.needsNonMedical} onChange={(event) => setCreateForm((current) => ({ ...current, needsNonMedical: event.target.value }))} placeholder="Hotel, transfer, visa, concierge" />
            </LeadField>

            <LeadField label="Notes">
              <textarea value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" rows={4} />
            </LeadField>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBusy}>
                {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {createBusy ? "Creating" : "Save lead"}
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
              {detail ? `${detail.first_name} ${detail.last_name}` : "Lead detail"}
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
                  <h3 className="text-sm font-semibold text-slate-950">Contact and origin</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard label="Email" value={detail.email || "Not set"} />
                    <DetailCard label="Phone" value={detail.phone || "Not set"} />
                    <DetailCard label="Source" value={detail.source || "Not set"} />
                    <DetailCard label="Country" value={detail.country || "Not set"} />
                  </div>
                </section>

                <section className={cardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Needs and context</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard label="Languages" value={detail.languages?.join(", ") || "Not set"} />
                    <DetailCard label="Medical needs" value={detail.needs_medical || "Not set"} />
                    <DetailCard label="Non-medical needs" value={detail.needs_non_medical || "Not set"} />
                    <DetailCard label="Converted patient" value={detail.converted_patient_id || "Not converted"} />
                  </div>
                  {detail.notes ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
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

function LeadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
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
