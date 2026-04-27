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
  CheckCircle2,
  Filter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { SplitView } from "@/components/data-table/split-view";
import type { ColumnDef } from "@/components/data-table/types";
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
} from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import type { CreateLeadBody, LeadDetail, LeadsStats, MonthlyEntry, StatusCount } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  complianceTone,
  failedOutcomeTone,
  leadRowAccent,
  leadStatusTone,
} from "./appearance/status-appearance";
import {
  convertLead,
  createLead,
  downloadLeadAttachment,
  fetchLeadDetail,
  fetchLeadStats,
  fetchLeads,
  resolveFailedLead,
  updateLeadGate,
  updateLeadStatus,
} from "./data/leads-api";
import {
  COMPLIANCE_OPTIONS,
  DEFAULT_FILTERS,
  LEGAL_SEX_OPTIONS,
  STATUS_OPTIONS,
  blankFailedLeadResolutionForm,
  blankLeadForm,
  buildLeadsPath,
  computeLeadConversionGate,
  dashOrValue,
  filterLeadsByContact,
  formatDate,
  formatSize,
  leadPermissions,
  leadToGateForm,
  nonempty,
  statusLabel,
  yesNo,
} from "./model/leads-model";
import type {
  FailedLeadResolutionForm,
  LeadFilters,
  LeadForm,
  LeadGateForm,
  LeadListItem,
} from "./model/types";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const LEAD_DEFAULT_FROZEN_COLUMNS = ["lead"];
const LEAD_MAX_FROZEN_COLUMNS = 2;
const LEAD_COLUMN_GROUPS = {
  identity: "Identity",
  qualification: "Qualification",
  contact: "Contact",
  origin: "Origin",
  lifecycle: "Lifecycle",
};
const FAILED_OUTCOME_OPTIONS = ["archived", "delete_anonymized"] as const;
type LeadPaneTab = "overview" | "process" | "qualification" | "details";
const LEAD_REALTIME_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "lead.failed_resolved",
] as const;

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function cardClass(extra?: string) {
  return cn("rounded-xl border border-border bg-card", extra);
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warning" | "success";
  children: ReactNode;
}) {
  if (tone === "success") {
    return <SuccessBanner>{children}</SuccessBanner>;
  }
  return <ShellBanner tone={tone}>{children}</ShellBanner>;
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
  const [paneTab, setPaneTab] = useState<LeadPaneTab>("overview");
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
  const filteredLeads = useMemo(
    () => filterLeadsByContact(leads, { email: filters.email, phone: filters.phone }),
    [filters.email, filters.phone, leads]
  );
  const maxMonthly = useMemo(() => Math.max(1, ...monthly.map((item) => item.count)), [monthly]);
  const totalByStatus = useMemo(
    () => byStatus.reduce((acc, item) => acc + item.count, 0),
    [byStatus]
  );
  const leadColumns = useMemo<ColumnDef<LeadListItem>[]>(
    () => [
      {
        id: "lead",
        label: t.leads_title,
        accessor: (row) => `${row.first_name} ${row.last_name}`.trim(),
        filterType: "text",
        group: "identity",
        sortable: true,
        width: 260,
        pinned: "left",
        render: (row) => <span className="text-sm font-medium text-foreground">{`${row.first_name} ${row.last_name}`.trim()}</span>,
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.qualification_status,
        filterType: "enum",
        filterOptions: STATUS_OPTIONS.map((status) => ({
          value: status,
          label: statusLabel(status),
        })),
        group: "qualification",
        sortable: true,
        width: 180,
        render: (row) => (
          <StatusBadge tone={leadStatusTone(row.qualification_status)}>
            {statusLabel(row.qualification_status)}
          </StatusBadge>
        ),
      },
      {
        id: "compliance",
        label: "Compliance",
        accessor: (row) => row.compliance_status ?? "",
        filterType: "enum",
        filterOptions: COMPLIANCE_OPTIONS.map((status) => ({
          value: status,
          label: statusLabel(status),
        })),
        group: "qualification",
        width: 170,
        render: (row) => (
          <StatusBadge tone={complianceTone(row.compliance_status)}>
            {row.compliance_status ? statusLabel(row.compliance_status) : t.common_not_set}
          </StatusBadge>
        ),
      },
      {
        id: "email",
        label: t.patients_email,
        accessor: (row) => row.email ?? "",
        filterType: "text",
        group: "contact",
        width: 240,
        render: (row) => <span className="text-xs text-foreground">{row.email || t.common_not_set}</span>,
      },
      {
        id: "phone",
        label: t.field_phone,
        accessor: (row) => row.phone ?? "",
        filterType: "text",
        group: "contact",
        width: 180,
        render: (row) => <span className="text-xs text-foreground">{row.phone || t.common_not_set}</span>,
      },
      {
        id: "source",
        label: t.leads_source,
        accessor: (row) => row.source ?? "",
        filterType: "text",
        group: "origin",
        width: 180,
        render: (row) => <span className="text-xs text-foreground">{row.source || t.common_not_set}</span>,
      },
      {
        id: "country",
        label: t.providers_country,
        accessor: (row) => row.country ?? "",
        filterType: "text",
        group: "origin",
        width: 150,
        render: (row) => <span className="text-xs text-foreground">{row.country || t.common_not_set}</span>,
      },
      {
        id: "created",
        label: "Date",
        accessor: (row) => row.created_at,
        filterType: "date",
        group: "lifecycle",
        sortable: true,
        width: 130,
        render: (row) => <span className="text-xs text-foreground">{formatDate(row.created_at)}</span>,
      },
      {
        id: "failed",
        label: "Failed",
        accessor: (row) => row.failed_outcome?.status ?? "",
        filterType: "enum",
        filterOptions: FAILED_OUTCOME_OPTIONS.map((status) => ({
          value: status,
          label: statusLabel(status),
        })),
        group: "lifecycle",
        width: 170,
        render: (row) =>
          row.failed_outcome?.status && row.failed_outcome.status !== "none" ? (
            <StatusBadge tone={failedOutcomeTone(row.failed_outcome.status)}>
              {statusLabel(row.failed_outcome.status)}
            </StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
    ],
    [
      t.common_not_set,
      t.field_phone,
      t.leads_source,
      t.leads_title,
      t.patients_email,
      t.providers_country,
      t.users_status,
    ]
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

    void fetchLeads(leadsPath)
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

    void fetchLeadStats().then(({ stats: statsPayload, monthly: monthlyPayload, byStatus: statusPayload }) => {
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

    void fetchLeadDetail(selectedLeadId)
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
    if (leadId !== selectedLeadId) {
      setPaneTab("overview");
    }
    setSelectedLeadId(leadId);
    setDetailOpen(true);
    syncLeadQuery(leadId);
  }

  function reload() {
    setVersion((current) => current + 1);
  }

  useRealtimeSubscription(LEAD_REALTIME_EVENTS, (event) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/leads");
    clearApiCache("/stats/leads");
    clearApiCache("/stats/leads/monthly");
    clearApiCache("/stats/leads/by-status");
    if (event.entity_type === "lead" && event.entity_id) {
      clearApiCache(`/leads/${event.entity_id}`);
    }
    if (selectedLeadId && selectedLeadId !== event.entity_id) {
      clearApiCache(`/leads/${selectedLeadId}`);
    }
    startTransition(() => {
      setVersion((current) => current + 1);
    });
  });

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
      await createLead(payload);
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
      await updateLeadStatus(leadId, status);
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
      const result = await convertLead(leadId);
      // Close the dialog first so the success banner and the navigation
      // are not visually occluded by the modal overlay.
      setPendingConvertLead(null);
      setSuccessMessage(
        `Patient ${result.patient_pid} created. Opening detail view...`,
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
      await updateLeadGate(selectedLeadId, {
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
      await resolveFailedLead(selectedLeadId, {
        resolution: failedLeadForm.resolution,
        reason: failedLeadForm.reason.trim(),
        note: nonempty(failedLeadForm.note),
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
      <div className="rounded-xl">
        <ShellBanner tone="warning" withIcon>
          {l(
            "Dieser Bereich ist auf Patientenmanager und Sales beschraenkt.",
            "Section is limited to patient managers and sales.",
            "This screen is limited to patient managers and sales.",
          )}
        </ShellBanner>
      </div>
    );
  }

  const growthPct = stats?.growth_pct ?? 0;
  const growthAbs = stats?.growth_abs ?? 0;
  const growthSign = growthPct >= 0 ? "+" : "";
  const anyQuickFilterActive =
    filters.search.trim() !== "" ||
    filters.status !== "" ||
    filters.includeArchived !== "false";
  const archiveFilterLabel =
    filters.includeArchived === "true"
      ? l("Mit Archiv", "С архивом", "With archive")
      : l("Aktive Leads", "Активные лиды", "Active leads");

  const paneTabs: Array<{
    key: LeadPaneTab;
    label: string;
  }> = [
    { key: "overview", label: l("Огляд", "Обзор", "Overview") },
    { key: "process", label: l("Процес", "Процесс", "Process") },
    { key: "qualification", label: l("Кваліфікація", "Квалификация", "Qualification") },
    { key: "details", label: l("Деталі", "Детали", "Details") },
  ];

  const detailPaneNode: ReactNode = (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-4 pt-3 pb-2">
        <h2 className="text-base font-medium text-foreground">
          {detail ? `${detail.first_name} ${detail.last_name}` : t.leads_title}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1">
          {paneTabs.map((tab) => {
            const isActive = paneTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPaneTab(tab.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {detailLoading ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            Loading lead
          </div>
        ) : detailError ? (
          <div className="pt-1">
            <Banner tone="error">{detailError}</Banner>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            {paneTab === "overview" ? (
              <>
                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={leadStatusTone(detail.qualification_status)}>
                      {statusLabel(detail.qualification_status)}
                    </StatusBadge>
                    <StatusBadge tone={complianceTone(detail.compliance_status)}>
                      {`Compliance ${detail.compliance_status ?? t.common_not_set}`}
                    </StatusBadge>
                    {detail.failed_outcome.status !== "none" ? (
                      <StatusBadge tone={failedOutcomeTone(detail.failed_outcome.status)}>
                        {detail.failed_outcome.status === "delete_anonymized"
                          ? "Deleted payload"
                          : "Failed lead archived"}
                      </StatusBadge>
                    ) : null}
                    {detail.converted_patient_id ? (
                      <StatusBadge tone="success">Converted</StatusBadge>
                    ) : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-slate-950">
                    {detail.first_name} {detail.last_name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">Created {formatDate(detail.created_at)}</p>
                </section>

                <section className={cardClass("p-5")}>
                  <SectionTitle>Contact and origin</SectionTitle>
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
                  <SectionTitle>Identity</SectionTitle>
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
                  <SectionTitle>Address</SectionTitle>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailCard label="Country" value={dashOrValue(detail.country)} />
                    <DetailCard label="City" value={dashOrValue(detail.city)} />
                    <DetailCard label="State / region" value={dashOrValue(detail.state)} />
                    <DetailCard label="Zip code" value={dashOrValue(detail.zip_code)} />
                    <DetailCard label="Street" value={dashOrValue(detail.street_address)} />
                  </div>
                </section>
              </>
            ) : null}

            {paneTab === "process" ? (
              <>
                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <SectionTitle>Process readiness</SectionTitle>
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
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <SectionTitle>Lead lifecycle</SectionTitle>
                      <p className="mt-1 text-sm text-slate-600">
                        Sequential lifecycle history for qualification, failed-lead handling and conversion.
                      </p>
                    </div>
                    <StatusBadge tone="neutral">
                      {`Current stage ${detail.lifecycle.current_stage}`}
                    </StatusBadge>
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
              </>
            ) : null}

            {paneTab === "qualification" ? (
              <>
                {gateForm && detail.failed_outcome.status === "none" ? (
                  <section className={cardClass("p-5")}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <SectionTitle>Qualification gate data</SectionTitle>
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
                            className={shellInputClassName}
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
                            className={shellInputClassName}
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
                            className={shellInputClassName}
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
                            className={shellInputClassName}
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
                            className={shellInputClassName}
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
                          <ShadSelect
                            value={gateForm.legalSex || "__unset__"}
                            onValueChange={(value) =>
                              setGateForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      legalSex:
                                        value && value !== "__unset__" ? value : "",
                                    }
                                  : current
                              )
                            }
                          >
                            <SelectTrigger className={selectClassName}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unset__">{t.common_not_set}</SelectItem>
                              {LEGAL_SEX_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </ShadSelect>
                        </LeadField>
                        <LeadField
                          label="Compliance status"
                          htmlFor="lead-gate-compliance-status"
                        >
                          <ShadSelect
                            value={gateForm.complianceStatus}
                            onValueChange={(value) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, complianceStatus: value ?? "" }
                                  : current
                              )
                            }
                          >
                            <SelectTrigger className={selectClassName}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {COMPLIANCE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </ShadSelect>
                        </LeadField>
                        <LeadField label={t.patients_notes} htmlFor="lead-gate-notes">
                          <Input
                            id="lead-gate-notes"
                            className={shellInputClassName}
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
                        <SectionTitle>Failed-lead resolution</SectionTitle>
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
                            <ShadSelect
                              value={failedLeadForm.resolution}
                              onValueChange={(value) =>
                                setFailedLeadForm((current) => ({
                                  ...current,
                                  resolution: (value === "delete" ? "delete" : "archive"),
                                }))
                              }
                            >
                              <SelectTrigger className={selectClassName}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="archive">Archive</SelectItem>
                                {user?.role === "patient_manager" || user?.role === "ceo" ? (
                                  <SelectItem value="delete">Delete and anonymize</SelectItem>
                                ) : null}
                              </SelectContent>
                            </ShadSelect>
                          </LeadField>
                          <LeadField label="Failure reason" htmlFor="lead-failed-reason">
                            <Input
                              id="lead-failed-reason"
                              className={shellInputClassName}
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
                            className={cn(textareaClassName, "min-h-[96px]")}
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
              </>
            ) : null}

            {paneTab === "details" ? (
              <>
                {(detail.location ||
                  detail.location_detailed ||
                  detail.wants_membership !== null ||
                  detail.can_travel !== null ||
                  detail.has_medical_records ||
                  detail.has_travel_documents !== null) ? (
                  <section className={cardClass("p-5")}>
                    <SectionTitle>Eligibility & path</SectionTitle>
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
                    <SectionTitle>Health & concern</SectionTitle>
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
                    <SectionTitle>Services & insurance</SectionTitle>
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
                    <SectionTitle>Wrap up</SectionTitle>
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
                    <SectionTitle>Consents</SectionTitle>
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
                  <SectionTitle>
                    {`Attachments (${detail.attachments?.length ?? 0})`}
                  </SectionTitle>
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
                              {dashOrValue(file.content_type)} - {formatSize(file.size_bytes)}
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
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
            Select a lead from the queue.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={t.leads_title}
          description={t.leads_subtitle}
          actions={
            <>
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
            </>
          }
        />

        <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-card px-4 py-3">
          <AdminInlineMetric
            icon={Users}
            label={t.leads_title}
            value={String(stats?.total_this_month ?? 0)}
            description={`${growthSign}${growthPct}% (${growthSign}${growthAbs})`}
            tone="sky"
          />
          <AdminInlineMetric
            icon={CheckCircle2}
            label={t.users_status}
            value={String(stats?.qualified_this_month ?? 0)}
            description={statusLabel("qualified")}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={UserPlus}
            label={t.leads_convert}
            value={String(stats?.converted_this_month ?? 0)}
            description={statusLabel("converted")}
            tone="amber"
          />
          <AdminInlineMetric
            icon={TrendingUp}
            label={t.common_active}
            value={String(stats?.total_all ?? 0)}
            description={t.common_archive}
            tone="slate"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.75rem] border border-border/70 bg-card p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)] lg:col-span-2">
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

          <div className="rounded-[1.75rem] border border-border/70 bg-card p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
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

        {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}
        {successMessage ? <SuccessBanner>{successMessage}</SuccessBanner> : null}

        <SplitView
          active={detailOpen}
          pane={detailPaneNode}
          onClose={() => {
            setDetailOpen(false);
            syncLeadQuery();
          }}
        >
        <AdminTableCard
          title={titleWithDot(t.leads_title)}
          count={filteredLeads.length}
        >
          <div className="relative z-30 flex flex-wrap items-center gap-1.5 border-b border-border/70 bg-card px-3 py-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className={cn(shellInputClassName, "h-8 rounded-lg bg-background pl-8 text-[13px]")}
                placeholder={t.common_search}
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setFilters((current) => ({ ...current, search: "" }));
                    (event.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>

            <ShadSelect
              value={filters.status || "__all__"}
              onValueChange={(value) => {
                const status = value && value !== "__all__" ? value : "";
                setFilters((current) => ({
                  ...current,
                  status,
                  includeArchived: status === "archived" ? "true" : current.includeArchived,
                }));
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-[190px] bg-background text-[13px]">
                <Filter className="mr-1 size-3.5 text-muted-foreground" />
                <SelectValue>
                  {filters.status ? statusLabel(filters.status) : t.users_status}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t.providers_all}</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>

            <ShadSelect
              value={filters.includeArchived || "false"}
              onValueChange={(value) => {
                const includeArchived = value === "true" ? "true" : "false";
                setFilters((current) => ({
                  ...current,
                  includeArchived,
                  status:
                    includeArchived === "false" && current.status === "archived"
                      ? ""
                      : current.status,
                }));
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-[170px] bg-background text-[13px]">
                <SelectValue>{archiveFilterLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">
                  {l("Aktive Leads", "Активные лиды", "Active leads")}
                </SelectItem>
                <SelectItem value="true">
                  {l("Mit Archiv", "С архивом", "With archive")}
                </SelectItem>
              </SelectContent>
            </ShadSelect>

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={l("Aktualisieren", "Обновить", "Refresh")}
                aria-label={l("Aktualisieren", "Обновить", "Refresh")}
                onClick={reload}
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
              {anyQuickFilterActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  <X className="size-3.5" />
                  {t.common_reset}
                </Button>
              ) : null}
            </div>
          </div>

          <DataTableSurface
            rows={filteredLeads}
            columns={leadColumns}
            rowId={(row) => row.id}
            defaultDensity="compact"
            defaultFrozenColumns={LEAD_DEFAULT_FROZEN_COLUMNS}
            dictionary={t as unknown as Record<string, string>}
            groupLabels={LEAD_COLUMN_GROUPS}
            loading={loading}
            maxFrozenColumns={LEAD_MAX_FROZEN_COLUMNS}
            toolbarClassName="border-b border-border/70 bg-card px-3 py-2"
            activeRowId={selectedLeadId || null}
            onRowClick={(row) => openLeadDetail(row.id)}
            rowAccent={(row) => leadRowAccent(row.qualification_status)}
            rowActionsLabel={t.users_actions ?? "Actions"}
            rowActionsWidth={224}
            rowActions={(row) => {
              const canQualify =
                row.qualification_status === "new" || row.qualification_status === "in_progress";
              const {
                canConvertRole,
                canConvert,
                disabledReason: convertDisabledReason,
              } = computeLeadConversionGate(row, {
                canConvert: permissions.canConvert,
              });
              const canResolveFailed =
                row.qualification_status !== "converted" &&
                row.failed_outcome?.status !== "delete_anonymized";

              return (
                <>
                  {canQualify ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md px-2 text-[11px]"
                      disabled={Boolean(actionBusy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void updateStatus(row.id, "qualified");
                      }}
                    >
                      {actionBusy === `status:${row.id}:qualified` ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : null}
                      Qualify
                    </Button>
                  ) : null}
                  {canConvertRole ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md px-2 text-[11px]"
                      disabled={Boolean(actionBusy) || !canConvert}
                      title={convertDisabledReason ?? undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingConvertLead(row);
                      }}
                    >
                      {actionBusy === `convert:${row.id}` ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : null}
                      Convert
                    </Button>
                  ) : null}
                  {canResolveFailed ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-md px-2 text-[11px]"
                      disabled={
                        Boolean(actionBusy) ||
                        row.failed_outcome?.status === "delete_anonymized"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        openLeadDetail(row.id);
                      }}
                    >
                      Resolve
                    </Button>
                  ) : null}
                </>
              );
            }}
            emptyState={
              <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
                <div className="text-sm font-medium text-foreground">No leads found</div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Adjust filters or create a new lead from the right-side flow.
                </p>
              </div>
            }
          />
        </AdminTableCard>
        </SplitView>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form onSubmit={handleCreate} className="flex h-full flex-col">
            <AdminSheetScaffold
              title={l("Neuer Lead", "Новый лид", "New lead")}
              description="Capture intake data and keep qualification flow consistent."
              footer={(
                <SheetFormFooter
                  cancelLabel={l("Abbrechen", "Отмена", "Cancel")}
                  submitLabel={t.common_save}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              {createError ? <ShellBanner tone="error">{createError}</ShellBanner> : null}

              <div className="grid gap-4 md:grid-cols-2">
                <LeadField label={t.patients_first_name}>
                  <Input
                    className={shellInputClassName}
                    value={createForm.firstName}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, firstName: event.target.value }))
                    }
                    required
                  />
                </LeadField>
                <LeadField label={t.patients_last_name}>
                  <Input
                    className={shellInputClassName}
                    value={createForm.lastName}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, lastName: event.target.value }))
                    }
                    required
                  />
                </LeadField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <LeadField label={t.field_phone}>
                  <Input
                    className={shellInputClassName}
                    value={createForm.phone}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                </LeadField>
                <LeadField label={t.patients_email}>
                  <Input
                    type="email"
                    className={shellInputClassName}
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </LeadField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <LeadField label={t.leads_source}>
                  <Input
                    className={shellInputClassName}
                    value={createForm.source}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, source: event.target.value }))
                    }
                  />
                </LeadField>
                <LeadField label={t.providers_country}>
                  <Input
                    className={shellInputClassName}
                    value={createForm.country}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, country: event.target.value }))
                    }
                  />
                </LeadField>
              </div>

              <LeadField label={t.patients_notes}>
                <textarea
                  value={createForm.notes}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  className={cn(textareaClassName, "min-h-[104px]")}
                  rows={4}
                />
              </LeadField>
            </AdminSheetScaffold>
          </form>
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
            <DialogTitle>{l("Lead in Patienten umwandeln?", "Convert lead to patient?", "Convert lead to patient?")}</DialogTitle>
            <DialogDescription>
              {pendingConvertLead ? (
                <>
                  {l("Dadurch wird eine Patientenakte fuer", "This creates a patient record for", "This will create a patient record for")}{" "}
                  <span className="font-medium text-slate-900">
                    {pendingConvertLead.first_name} {pendingConvertLead.last_name}
                  </span>
                  {l(
                    ", Sie als Patientenmanager zuweisen und die standardmaessige Workflow-Checkliste vorbereiten. Der Lead selbst wechselt in den Status",
                    ", assign patient manager ownership and prepare the default workflow checklist. The lead then moves to status",
                    ", assign you as the patient manager, and bootstrap the default workflow checklist. The lead itself moves to the",
                  )}{" "}
                  <span className="font-mono text-xs">{l("converted", "converted", "converted")}</span>{" "}
                  {l(
                    "umgeschaltet. Diese Aktion kann nicht rueckgaengig gemacht werden.",
                    "this action cannot be undone.",
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
                  {l("Abbrechen", "Cancel", "Cancel")}
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
              {l("Patient anlegen", "Create patient", "Create patient")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LeadField({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={tokens.text.label}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{children}</span>
    </h3>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
      <p className={tokens.text.eyebrow}>{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </div>
  );
}
