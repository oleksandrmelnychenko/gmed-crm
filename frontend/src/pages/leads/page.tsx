import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useSecurePersistedState } from "@/lib/secure-persist";
import { useAuth } from "@/lib/auth";
import { formatUiText, useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import type { CreateLeadBody, LeadDetail, LeadsStats } from "@/lib/api/types";
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
  promoteLeadToConsole,
  resolveFailedLead,
  updateLeadGate,
  updateLeadStatus,
} from "./data/leads-api";
import {
  COMPLIANCE_OPTIONS,
  DEFAULT_FILTERS,
  LEGAL_SEX_OPTIONS,
  LEAD_TYPE_OPTIONS,
  STATUS_OPTIONS,
  blankFailedLeadResolutionForm,
  blankLeadForm,
  buildLeadsPath,
  complianceStatusLabel,
  computeLeadConversionGate,
  dashOrValue,
  failedOutcomeLabel,
  filterLeadsByContact,
  formatDate,
  formatDateTime,
  formatSize,
  leadLocationDetailedLabel,
  leadLocationLabel,
  leadSourceLabel,
  leadStageLabel,
  leadTypeFromLead,
  leadTypeLabel,
  leadReadinessCheckLabel,
  leadReadinessReasonLabel,
  leadInsuranceCoverageLabel,
  leadLanguageLabel,
  leadMedicalRecordsLabel,
  leadPreferredLocationLabel,
  leadProgramServiceLabel,
  leadTransitionKindLabel,
  leadVisitTimingLabel,
  legalSexLabel,
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
import { LeadWizard } from "./ui/lead-wizard";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const LEAD_DEFAULT_FROZEN_COLUMNS = ["lead"];
const LEAD_MAX_FROZEN_COLUMNS = 2;
const FAILED_OUTCOME_OPTIONS = ["archived", "delete_anonymized"] as const;
const ACTIVE_WIZARD_LEAD_STATUSES = new Set(["new", "in_progress", "qualified"]);
type LeadPaneTab = "overview" | "process" | "qualification" | "details";
type LeadTypeTone = "warning" | "brand" | "info" | "neutral";
const LEAD_REALTIME_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.promoted_to_console",
  "lead.converted",
  "lead.failed_resolved",
] as const;

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{title}</span>
    </span>
  );
}

function shouldOpenWizardFromRow(lead: LeadListItem, canConvert: boolean) {
  return canConvert &&
    leadTypeFromLead(lead) === "console" &&
    ACTIVE_WIZARD_LEAD_STATUSES.has(lead.qualification_status) &&
    (!lead.failed_outcome || lead.failed_outcome.status === "none");
}

function leadTypeTone(type: string): LeadTypeTone {
  if (type === "form") return "warning";
  if (type === "questionnaire") return "brand";
  if (type === "console") return "info";
  return "neutral";
}

function omitZeroPlaceholder(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^0+$/.test(trimmed) ? null : value;
}

function rawLeadPayloadText(detail: LeadDetail, key: string) {
  const rawPayload = detail.raw_payload;
  if (!rawPayload || typeof rawPayload !== "object" || !("payload" in rawPayload)) {
    return null;
  }
  const payload = (rawPayload as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDisplayDate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const dmy = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(trimmed);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  return trimmed;
}

function leadDetailDateOfBirth(detail: LeadDetail) {
  return detail.date_of_birth ?? normalizeDisplayDate(rawLeadPayloadText(detail, "dateOfBirth"));
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

type LeadsListState = {
  version: number;
  leads: LeadListItem[];
  loading: boolean;
  error: string;
  stats: LeadsStats | null;
};

type LeadsDetailState = {
  detailOpen: boolean;
  selectedLeadId: string;
  detail: LeadDetail | null;
  detailLoading: boolean;
  detailError: string;
};

type LeadsListPatch =
  | Partial<LeadsListState>
  | ((current: LeadsListState) => Partial<LeadsListState>);

type LeadsDetailPatch =
  | Partial<LeadsDetailState>
  | ((current: LeadsDetailState) => Partial<LeadsDetailState>);

type LeadsUiState = {
  successMessage: string;
  pendingConvertLead: LeadListItem | null;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: LeadForm;
  paneTab: LeadPaneTab;
  gateForm: LeadGateForm | null;
  gateBusy: boolean;
  failedLeadForm: FailedLeadResolutionForm;
  failedLeadBusy: boolean;
  actionBusy: string | null;
};

type LeadsUiPatch =
  | Partial<LeadsUiState>
  | ((current: LeadsUiState) => Partial<LeadsUiState>);

function leadsListReducer(
  state: LeadsListState,
  patch: LeadsListPatch,
): LeadsListState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function leadsDetailReducer(
  state: LeadsDetailState,
  patch: LeadsDetailPatch,
): LeadsDetailState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function leadsUiReducer(
  state: LeadsUiState,
  patch: LeadsUiPatch,
): LeadsUiState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createLeadsUiFieldPatch<K extends keyof LeadsUiState>(
  field: K,
  value: SetStateAction<LeadsUiState[K]>,
): LeadsUiPatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: LeadsUiState[K]) => LeadsUiState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<LeadsUiState>;
  };
}

function useLeadsPageContent() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const leadColumnGroupLabels = useMemo(
    () => ({
      identity: t.lead_column_group_identity,
      qualification: t.lead_column_group_qualification,
      contact: t.lead_column_group_contact,
      origin: t.lead_column_group_origin,
      lifecycle: t.lead_column_group_lifecycle,
    }),
    [t],
  );
  const { staffGo } = useStaffNavigate();
  const [wizardLeadId, setWizardLeadId] = useState<string | null>(null);
  const failedLoadMessage = t.common_failed_load;
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => leadPermissions(user?.role), [user?.role]);
  type PersistedLeadFilters = Pick<LeadFilters, "status" | "leadType" | "source" | "country" | "includeArchived">;
  const [persistedLeadFilters, setPersistedLeadFilters] = useSecurePersistedState<PersistedLeadFilters>(
    "leads.filters",
    {
      status: DEFAULT_FILTERS.status,
      leadType: DEFAULT_FILTERS.leadType,
      source: DEFAULT_FILTERS.source,
      country: DEFAULT_FILTERS.country,
      includeArchived: DEFAULT_FILTERS.includeArchived,
    },
    {
      schemaVersion: 2,
      validate: (value): value is PersistedLeadFilters =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).status === "string" &&
        typeof (value as Record<string, unknown>).leadType === "string" &&
        typeof (value as Record<string, unknown>).source === "string" &&
        typeof (value as Record<string, unknown>).country === "string" &&
        typeof (value as Record<string, unknown>).includeArchived === "string",
    },
  );
  const [filters, setFiltersState] = useState<LeadFilters>(() => ({
    ...DEFAULT_FILTERS,
    status: persistedLeadFilters.status,
    leadType: persistedLeadFilters.leadType,
    source: persistedLeadFilters.source,
    country: persistedLeadFilters.country,
    includeArchived: persistedLeadFilters.includeArchived,
  }));
  const setFilters: typeof setFiltersState = useCallback(
    (value: LeadFilters | ((prev: LeadFilters) => LeadFilters)) => {
      setFiltersState((prev) => {
        const next = typeof value === "function" ? (value as (p: LeadFilters) => LeadFilters)(prev) : value;
        setPersistedLeadFilters({
          status: next.status,
          leadType: next.leadType,
          source: next.source,
          country: next.country,
          includeArchived: next.includeArchived,
        });
        return next;
      });
    },
    [setPersistedLeadFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const [listState, dispatchListState] = useReducer(
    leadsListReducer,
    undefined,
    () => ({
      version: 0,
      leads: [],
      loading: false,
      error: "",
      stats: null,
    }),
  );
  const {
    version,
    leads,
    loading,
    error,
    stats,
  } = listState;
  const setVersion = (nextValue: SetStateAction<number>) => {
    dispatchListState((current) => ({
      version:
        typeof nextValue === "function"
          ? nextValue(current.version)
          : nextValue,
    }));
  };
  const setError = (nextValue: SetStateAction<string>) => {
    dispatchListState((current) => ({
      error:
        typeof nextValue === "function"
          ? nextValue(current.error)
          : nextValue,
    }));
  };
  const [uiState, dispatchUiState] = useReducer(
    leadsUiReducer,
    undefined,
    (): LeadsUiState => ({
      successMessage: "",
      pendingConvertLead: null,
      createOpen: false,
      createBusy: false,
      createError: "",
      createForm: blankLeadForm(),
      paneTab: "overview",
      gateForm: null,
      gateBusy: false,
      failedLeadForm: blankFailedLeadResolutionForm(),
      failedLeadBusy: false,
      actionBusy: null,
    }),
  );
  const {
    successMessage,
    pendingConvertLead,
    createOpen,
    createBusy,
    createError,
    createForm,
    paneTab,
    gateForm,
    gateBusy,
    failedLeadForm,
    failedLeadBusy,
    actionBusy,
  } = uiState;
  const setLeadUiField = <K extends keyof LeadsUiState>(
    field: K,
    value: SetStateAction<LeadsUiState[K]>,
  ) => dispatchUiState(createLeadsUiFieldPatch(field, value));
  const setSuccessMessage = (value: SetStateAction<string>) =>
    setLeadUiField("successMessage", value);
  const setPendingConvertLead = (value: SetStateAction<LeadListItem | null>) =>
    setLeadUiField("pendingConvertLead", value);
  const setCreateOpen = (value: SetStateAction<boolean>) =>
    setLeadUiField("createOpen", value);
  const setCreateBusy = (value: SetStateAction<boolean>) =>
    setLeadUiField("createBusy", value);
  const setCreateError = (value: SetStateAction<string>) =>
    setLeadUiField("createError", value);
  const setCreateForm = (value: SetStateAction<LeadForm>) =>
    setLeadUiField("createForm", value);

  const [detailState, dispatchDetailState] = useReducer(
    leadsDetailReducer,
    undefined,
    () => ({
      detailOpen: false,
      selectedLeadId: "",
      detail: null,
      detailLoading: false,
      detailError: "",
    }),
  );
  const {
    detailOpen,
    selectedLeadId,
    detail,
    detailLoading,
    detailError,
  } = detailState;
  const setDetailOpen = (nextValue: SetStateAction<boolean>) => {
    dispatchDetailState((current) => ({
      detailOpen:
        typeof nextValue === "function"
          ? nextValue(current.detailOpen)
          : nextValue,
    }));
  };
  const setSelectedLeadId = (nextValue: SetStateAction<string>) => {
    dispatchDetailState((current) => ({
      selectedLeadId:
        typeof nextValue === "function"
          ? nextValue(current.selectedLeadId)
          : nextValue,
    }));
  };
  const setDetailError = (nextValue: SetStateAction<string>) => {
    dispatchDetailState((current) => ({
      detailError:
        typeof nextValue === "function"
          ? nextValue(current.detailError)
          : nextValue,
    }));
  };
  const setPaneTab = (value: SetStateAction<LeadPaneTab>) =>
    setLeadUiField("paneTab", value);
  const setGateForm = (value: SetStateAction<LeadGateForm | null>) =>
    setLeadUiField("gateForm", value);
  const setGateBusy = (value: SetStateAction<boolean>) =>
    setLeadUiField("gateBusy", value);
  const setFailedLeadForm = (value: SetStateAction<FailedLeadResolutionForm>) =>
    setLeadUiField("failedLeadForm", value);
  const setFailedLeadBusy = (value: SetStateAction<boolean>) =>
    setLeadUiField("failedLeadBusy", value);
  const setActionBusy = (value: SetStateAction<string | null>) =>
    setLeadUiField("actionBusy", value);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );
  const leadsPath = useMemo(() => buildLeadsPath(effectiveFilters), [effectiveFilters]);
  const filteredLeads = useMemo(
    () => filterLeadsByContact(leads, { email: filters.email, phone: filters.phone }),
    [filters.email, filters.phone, leads]
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
        id: "lead_type",
        label: t.lead_type,
        accessor: (row) => leadTypeFromLead(row),
        filterType: "enum",
        filterOptions: LEAD_TYPE_OPTIONS.map((type) => ({
          value: type,
          label: leadTypeLabel(type, t),
        })),
        group: "origin",
        sortable: true,
        width: 170,
        render: (row) => {
          const type = leadTypeFromLead(row);
          return (
            <StatusBadge tone={leadTypeTone(type)}>
              {leadTypeLabel(type, t)}
            </StatusBadge>
          );
        },
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.qualification_status,
        filterType: "enum",
        filterOptions: STATUS_OPTIONS.map((status) => ({
          value: status,
          label: statusLabel(status, t),
        })),
        group: "qualification",
        sortable: true,
        width: 180,
        render: (row) => (
          <StatusBadge tone={leadStatusTone(row.qualification_status)}>
            {statusLabel(row.qualification_status, t)}
          </StatusBadge>
        ),
      },
      {
        id: "received_at",
        label: t.lead_received_at,
        accessor: (row) => row.created_at,
        filterType: "date",
        group: "lifecycle",
        sortable: true,
        width: 170,
        render: (row) => (
          <time
            dateTime={row.created_at}
            className="whitespace-nowrap text-xs tabular-nums text-foreground"
          >
            {formatDateTime(row.created_at, locale, t.common_not_set)}
          </time>
        ),
      },
      {
        id: "compliance",
        label: t.lead_compliance_status,
        accessor: (row) => row.compliance_status ?? "",
        filterType: "enum",
        filterOptions: COMPLIANCE_OPTIONS.map((status) => ({
          value: status,
          label: complianceStatusLabel(status, t),
        })),
        group: "qualification",
        width: 170,
        render: (row) => (
          <StatusBadge tone={complianceTone(row.compliance_status)}>
            {complianceStatusLabel(row.compliance_status, t)}
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
        render: (row) => <span className="text-xs text-foreground">{leadSourceLabel(row.source, t)}</span>,
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
        id: "failed",
        label: t.lead_failed_outcome,
        accessor: (row) => row.failed_outcome?.status ?? "",
        filterType: "enum",
        filterOptions: FAILED_OUTCOME_OPTIONS.map((status) => ({
          value: status,
          label: failedOutcomeLabel(status, t),
        })),
        group: "lifecycle",
        width: 170,
        render: (row) =>
          row.failed_outcome?.status && row.failed_outcome.status !== "none" ? (
            <StatusBadge tone={failedOutcomeTone(row.failed_outcome.status)}>
              {failedOutcomeLabel(row.failed_outcome.status, t)}
            </StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
          ),
      },
    ],
    [
      locale,
      t,
    ]
  );

  useEffect(() => {
    const leadParam = searchParams.get("lead") ?? "";
    const leadView = searchParams.get("view") === "wizard" && permissions.canConvert
      ? "wizard"
      : "details";
    if (leadParam && leadView === "wizard") {
      setWizardLeadId(leadParam);
      dispatchDetailState({
        selectedLeadId: "",
        detailOpen: false,
        detail: null,
        detailError: "",
      });
      return;
    }

    setWizardLeadId(null);
    dispatchDetailState((current) => {
      if (!leadParam) {
        if (!current.detailOpen && !current.selectedLeadId) {
          return {};
        }
        return {
          selectedLeadId: "",
          detailOpen: false,
          detail: null,
          detailError: "",
        };
      }
      if (current.detailOpen && current.selectedLeadId === leadParam) {
        return {};
      }
      return {
        selectedLeadId: leadParam,
        detailOpen: true,
      };
    });
  }, [permissions.canConvert, searchParams]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    dispatchListState((current) => ({
      loading: current.leads.length === 0,
      error: "",
    }));

    void fetchLeads(leadsPath)
      .then((items) => {
        if (!cancelled) {
          startTransition(() =>
            dispatchListState({
              leads: items,
              loading: false,
            }),
          );
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          dispatchListState({
            error: fetchError instanceof Error ? fetchError.message : failedLoadMessage,
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [failedLoadMessage, leadsPath, permissions.canViewPage, version]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void fetchLeadStats().then(({ stats: statsPayload }) => {
      if (cancelled) return;
      startTransition(() => {
        dispatchListState({
          stats: statsPayload,
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage, version]);

  useEffect(() => {
    if (!detailOpen || !selectedLeadId) return;

    let cancelled = false;
    dispatchDetailState({
      detailLoading: true,
      detailError: "",
    });

    void fetchLeadDetail(selectedLeadId)
      .then((item) => {
        if (!cancelled) {
          startTransition(() =>
            dispatchDetailState({
              detail: item,
              detailLoading: false,
            }),
          );
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          dispatchDetailState({
            detailError: fetchError instanceof Error ? fetchError.message : failedLoadMessage,
            detailLoading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, failedLoadMessage, selectedLeadId, version]);

  useEffect(() => {
    if (!detail) {
      dispatchUiState({
        gateForm: null,
        failedLeadForm: blankFailedLeadResolutionForm(),
      });
      return;
    }
    dispatchUiState((current) => ({
      gateForm: leadToGateForm(detail),
      failedLeadForm: {
        resolution:
          current.failedLeadForm.resolution === "delete" &&
          user?.role !== "patient_manager" &&
          user?.role !== "ceo"
            ? "archive"
            : current.failedLeadForm.resolution,
        reason: detail.failed_outcome?.reason ?? "",
        note: detail.failed_outcome?.note ?? "",
      },
    }));
  }, [detail, user?.role]);

  function syncLeadQuery(
    leadId?: string,
    options: { replace?: boolean; view?: "details" | "wizard" } = {},
  ) {
    const params = new URLSearchParams(searchParams);
    if (leadId) {
      params.set("lead", leadId);
      if (options.view === "wizard") params.set("view", "wizard");
      else params.delete("view");
    } else {
      params.delete("lead");
      params.delete("view");
    }
    setSearchParams(params, { replace: options.replace ?? true });
  }

  function openLeadDetail(leadId: string) {
    setWizardLeadId(null);
    if (leadId !== selectedLeadId) {
      setPaneTab("overview");
    }
    setSelectedLeadId(leadId);
    setDetailOpen(true);
    syncLeadQuery(leadId, { replace: false });
  }

  function openLeadWizard(leadId: string) {
    setDetailOpen(false);
    setWizardLeadId(leadId);
    syncLeadQuery(leadId, { replace: false, view: "wizard" });
  }

  function openLeadFromRow(lead: LeadListItem) {
    if (shouldOpenWizardFromRow(lead, permissions.canConvert)) {
      openLeadWizard(lead.id);
      return;
    }
    openLeadDetail(lead.id);
  }

  function reload() {
    setVersion((current) => current + 1);
  }

  useDebouncedRealtimeSubscription(LEAD_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/leads");
    clearApiCache("/stats/leads");
    for (const event of events) {
      if (event.entity_type === "lead" && event.entity_id) {
        clearApiCache(`/leads/${event.entity_id}`);
      }
    }
    if (selectedLeadId) {
      clearApiCache(`/leads/${selectedLeadId}`);
    }
    if (wizardLeadId) {
      clearApiCache(`/leads/${wizardLeadId}`);
      return;
    }
    startTransition(() => {
      setVersion((current) => current + 1);
    });
  }, 250);

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

  async function promoteToConsole(leadId: string) {
    setActionBusy(`promote-console:${leadId}`);
    setError("");
    setDetailError("");
    setSuccessMessage("");
    try {
      await promoteLeadToConsole(leadId);
      clearApiCache("/leads");
      clearApiCache(`/leads/${leadId}`);
      setPaneTab("overview");
      setSuccessMessage(t.lead_promote_to_console_success);
      reload();
      if (permissions.canConvert) {
        openLeadWizard(leadId);
      }
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
        formatUiText(t.lead_convert_success_opening, {
          patientPid: result.patient_pid,
        }),
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
          {t.lead_access_restricted}
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
    filters.leadType !== "" ||
    filters.includeArchived !== "false";
  const detailLeadType = detail ? leadTypeFromLead(detail) : "console";
  const detailIsConsoleLead = detailLeadType === "console";
  const detailIsIntakeLead = Boolean(detail) && !detailIsConsoleLead;
  const detailCanPromoteToConsole =
    Boolean(detail) &&
    detailIsIntakeLead &&
    detail?.failed_outcome.status !== "delete_anonymized" &&
    !detail?.converted_patient_id;
  const detailWizardIncomplete =
    Boolean(detail) &&
    (!detail?.converted_patient_id || detail.wizard_state?.["phase"] !== "completed");

  const paneTabs: Array<{
    key: LeadPaneTab;
    label: string;
  }> = [
    { key: "overview", label: t.lead_tab_overview },
    { key: "process", label: t.lead_tab_process },
    { key: "qualification", label: t.lead_tab_qualification },
    { key: "details", label: t.lead_tab_details },
  ];

  const leadWorkflow = detail && detailIsConsoleLead
    ? (() => {
        const qualificationChecks = detail.readiness.checks.filter(
          (check) => check.blocking_for === "qualification",
        );
        const readyQualificationChecks = qualificationChecks.filter(
          (check) => check.passed,
        ).length;
        const leadQualified =
          detail.qualification_status === "qualified" ||
          detail.qualification_status === "converted";
        const leadConverted =
          Boolean(detail.converted_patient_id) ||
          detail.qualification_status === "converted";
        const failedResolved = detail.failed_outcome.status !== "none";
        const completedCount = [
          detail.readiness.qualification_ready,
          leadQualified,
          leadConverted,
        ].filter(Boolean).length;

        return {
          completedCount,
          totalCount: 3,
          readyQualificationChecks,
          qualificationChecksTotal: qualificationChecks.length,
          leadQualified,
          leadConverted,
          failedResolved,
        };
      })()
    : null;
  const detailConversionGate = detail && detailIsConsoleLead
    ? computeLeadConversionGate(
        {
          qualification_status: detail.qualification_status,
          conversion_ready: detail.readiness.conversion_ready,
        },
        { canConvert: permissions.canConvert },
      )
    : null;
  const detailConvertDisabledReason =
    detail && detail.failed_outcome.status !== "none"
      ? t.lead_workflow_locked
      : detailConversionGate && !detailConversionGate.canConvert
        ? detailConversionGate.disabledReason ??
          t.lead_workflow_complete_required_fields
        : undefined;

  const detailPaneNode: ReactNode = (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-4 pt-3 pb-2 pr-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-medium text-foreground">
            {detail ? `${detail.first_name} ${detail.last_name}` : t.leads_title}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {detail && permissions.canConvert && detailWizardIncomplete ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openLeadWizard(detail.id)}
              >
                <ClipboardCheck className="size-3.5" />
                {lang === "de" ? "Bearbeiten" : "Обработать"}
              </Button>
            ) : null}
            {detail && detailCanPromoteToConsole ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={Boolean(actionBusy)}
                title={t.lead_promote_to_console_description}
                onClick={() => void promoteToConsole(detail.id)}
              >
                {actionBusy === `promote-console:${detail.id}` ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {actionBusy === `promote-console:${detail.id}`
                  ? t.lead_promoting_to_console
                  : t.lead_promote_to_console}
              </Button>
            ) : detail && detailIsConsoleLead && permissions.canConvert && !leadWorkflow?.leadConverted ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={
                  Boolean(actionBusy) ||
                  !detailConversionGate?.canConvert ||
                  detail.failed_outcome.status !== "none"
                }
                title={detailConvertDisabledReason}
                onClick={() => setPendingConvertLead(detail)}
              >
                {actionBusy === `convert:${detail.id}` ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                {t.lead_convert_action}
              </Button>
            ) : null}
          </div>
        </div>
        {detailIsConsoleLead ? (
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
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 px-5 py-4">
        <div className="space-y-4 rounded-xl">
          {detailLoading ? (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {t.lead_loading_detail}
            </div>
          ) : detailError ? (
            <div className="pt-1">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : detail ? (
            detailIsIntakeLead ? (
              <div className="space-y-4">
                <section className={cardClass("p-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={leadTypeTone(detailLeadType)}>
                      {leadTypeLabel(detail, t)}
                    </StatusBadge>
                    <StatusBadge tone={leadStatusTone(detail.qualification_status)}>
                      {statusLabel(detail.qualification_status, t)}
                    </StatusBadge>
                    {detail.submitted_at ? (
                      <Badge variant="outline" className="rounded-full">
                        {t.lead_submitted_at} {formatDate(detail.submitted_at, locale, t.common_not_set)}
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-zinc-950">
                    {detail.first_name} {detail.last_name}
                  </h2>
                </section>

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_intake_sheet_title}</SectionTitle>
                  <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                    <DetailCard
                      label={t.lead_full_name}
                      value={dashOrValue(
                        [
                          detail.first_name,
                          detail.middle_name,
                          detail.last_name,
                          detail.suffix,
                        ]
                          .filter(Boolean)
                          .join(" "),
                        t,
                      )}
                    />
                    <DetailCard label={t.patients_email} value={detail.email || t.common_not_set} />
                    <DetailCard label={t.field_phone} value={detail.phone || t.common_not_set} />
                    <DetailCard label={t.leads_source} value={leadSourceLabel(detail.source, t)} />
                    {detailLeadType === "questionnaire" && detail.whatsapp_number ? (
                      <DetailCard label="WhatsApp" value={dashOrValue(detail.whatsapp_number, t)} />
                    ) : null}
                    {detailLeadType === "questionnaire" ? (
                      <DetailCard label={t.providers_country} value={dashOrValue(detail.country, t)} />
                    ) : null}
                    {detailLeadType === "questionnaire" ? (
                      <DetailCard label={t.field_birth_date} value={formatDate(leadDetailDateOfBirth(detail), locale, t.common_not_set)} />
                    ) : null}
                    {detailLeadType === "questionnaire" ? (
                      <DetailCard label={t.lead_legal_sex} value={legalSexLabel(detail.legal_sex, t)} />
                    ) : null}
                    {detailLeadType === "questionnaire" && detail.locale ? (
                      <DetailCard label={t.lead_locale} value={detail.locale} />
                    ) : null}
                    {detailLeadType === "questionnaire" && detail.flow ? (
                      <DetailCard label={t.lead_flow} value={detail.flow} />
                    ) : null}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void promoteToConsole(detail.id)}
                    >
                      {actionBusy === `promote-console:${detail.id}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                      {actionBusy === `promote-console:${detail.id}`
                        ? t.lead_promoting_to_console
                        : t.lead_promote_to_console}
                    </Button>
                  </div>
                </section>

                {detailLeadType === "form" ? (
                  <section className={cardClass("p-4")}>
                    {detail.message ? (
                      <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                        {detail.message}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">{t.common_not_set}</p>
                    )}
                  </section>
                ) : null}

                {detailLeadType === "questionnaire" ? (
                  <>
                    {(detail.street_address || detail.city || omitZeroPlaceholder(detail.state) || omitZeroPlaceholder(detail.zip_code)) ? (
                      <section className={cardClass("p-4")}>
                        <SectionTitle>{t.lead_section_address}</SectionTitle>
                        <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                          <DetailCard label={t.providers_street} value={dashOrValue(detail.street_address, t)} />
                          <DetailCard label={t.providers_city} value={dashOrValue(detail.city, t)} />
                          <DetailCard label={t.lead_state_region} value={dashOrValue(omitZeroPlaceholder(detail.state), t)} />
                          <DetailCard label={t.lead_zip_code} value={dashOrValue(omitZeroPlaceholder(detail.zip_code), t)} />
                        </div>
                      </section>
                    ) : null}

                    <section className={cardClass("p-4")}>
                      <SectionTitle>{t.lead_questionnaire_snapshot}</SectionTitle>
                      <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <DetailCard label={t.lead_primary_language} value={leadLanguageLabel(detail.primary_language, t)} />
                        <DetailCard label={t.lead_needs_interpreter} value={yesNo(detail.needs_interpreter, t)} />
                        <DetailCard label={t.lead_location} value={leadLocationLabel(detail.location, t)} />
                        <DetailCard label={t.lead_location_detailed} value={leadLocationDetailedLabel(detail.location_detailed, t)} />
                        <DetailCard label={t.lead_wants_membership} value={yesNo(detail.wants_membership, t)} />
                        <DetailCard label={t.lead_selected_program} value={leadProgramServiceLabel(detail.selected_program, t)} />
                        <DetailCard label={t.lead_can_travel} value={yesNo(detail.can_travel, t)} />
                        <DetailCard label={t.lead_has_medical_records} value={leadMedicalRecordsLabel(detail.has_medical_records, t)} />
                        <DetailCard label={t.lead_records_in_accepted_language} value={yesNo(detail.records_in_accepted_language, t)} />
                        <DetailCard label={t.lead_has_travel_documents} value={yesNo(detail.has_travel_documents, t)} />
                        <DetailCard label={t.lead_currently_in_treatment} value={yesNo(detail.currently_in_treatment, t)} />
                        <DetailCard label={t.lead_health_risk_for_travel} value={yesNo(detail.has_health_risk_for_travel, t)} />
                        <DetailCard
                          label={t.lead_services}
                          value={
                            detail.services && detail.services.length > 0
                              ? detail.services.map((service) => leadProgramServiceLabel(service, t)).join(", ")
                              : t.common_not_set
                          }
                        />
                        <DetailCard label={t.lead_has_insurance} value={yesNo(detail.has_insurance, t)} />
                        <DetailCard label={t.lead_insurance_covers_germany} value={leadInsuranceCoverageLabel(detail.insurance_covers_germany, t)} />
                        <DetailCard label={t.lead_preferred_location} value={leadPreferredLocationLabel(detail.preferred_location, t)} />
                        <DetailCard label={t.lead_visit_timing} value={leadVisitTimingLabel(detail.visit_timing, t)} />
                        <DetailCard label={t.lead_email_consent} value={yesNo(detail.email_consent, t)} />
                        <DetailCard label={t.lead_whatsapp_consent} value={yesNo(detail.whatsapp_consent, t)} />
                        <DetailCard label={t.lead_consent_automated_contact} value={yesNo(detail.consent_automated_contact, t)} />
                        <DetailCard label={t.lead_consent_healthcare} value={yesNo(detail.consent_healthcare, t)} />
                        <DetailCard label={t.lead_consent_opt_out} value={yesNo(detail.consent_opt_out, t)} />
                        <DetailCard label={t.lead_consent_privacy_practices} value={yesNo(detail.consent_privacy_practices, t)} />
                      </div>
                    </section>

                    {(detail.primary_concern_text || detail.additional_concerns || detail.message) ? (
                      <section className={cardClass("p-4")}>
                        <SectionTitle>{t.lead_section_health_concern}</SectionTitle>
                        {detail.primary_concern_text ? (
                          <div className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                            {detail.primary_concern_text}
                          </div>
                        ) : null}
                        {detail.additional_concerns ? (
                          <div className="mt-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                            {detail.additional_concerns}
                          </div>
                        ) : null}
                        {detail.message ? (
                          <div className="mt-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                            {detail.message}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </>
                ) : null}

                {detail.attachments && detail.attachments.length > 0 ? (
                  <section className={cardClass("p-4")}>
                    <SectionTitle>
                      {`${t.lead_attachments} (${detail.attachments.length})`}
                    </SectionTitle>
                    <ul className="mt-4 space-y-1.5">
                      {detail.attachments.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium text-zinc-800">{file.file_name}</div>
                            <div className="text-xs text-zinc-500">
                              {dashOrValue(file.content_type, t)} - {formatSize(file.size_bytes)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
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
                                    : t.lead_download_attachment_failed
                                );
                              }
                            }}
                          >
                            {t.lead_download_attachment}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : (
            <div className="space-y-5">
            {paneTab === "overview" ? (
              <>
                <section className={cardClass("p-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={leadStatusTone(detail.qualification_status)}>
                      {statusLabel(detail.qualification_status, t)}
                    </StatusBadge>
                    <StatusBadge tone={complianceTone(detail.compliance_status)}>
                      {`${t.lead_compliance_status}: ${complianceStatusLabel(detail.compliance_status, t)}`}
                    </StatusBadge>
                    {detail.failed_outcome.status !== "none" ? (
                      <StatusBadge tone={failedOutcomeTone(detail.failed_outcome.status)}>
                        {failedOutcomeLabel(detail.failed_outcome.status, t)}
                      </StatusBadge>
                    ) : null}
                    {detail.converted_patient_id ? (
                      <StatusBadge tone="success">{statusLabel("converted", t)}</StatusBadge>
                    ) : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-zinc-950">
                    {detail.first_name} {detail.last_name}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-600">
                    {t.users_created} {formatDate(detail.created_at, locale, t.common_not_set)}
                  </p>
                </section>

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_section_contact_origin}</SectionTitle>
                  <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                    <DetailCard label={t.patients_email} value={detail.email || t.common_not_set} />
                    <DetailCard label={t.field_phone} value={detail.phone || t.common_not_set} />
                    <DetailCard label={t.lead_type} value={leadTypeLabel(detail, t)} />
                    <DetailCard label={t.leads_source} value={leadSourceLabel(detail.source, t)} />
                    <DetailCard label={t.providers_country} value={detail.country || t.common_not_set} />
                    {detail.console_promoted_at ? (
                      <DetailCard
                        label={t.lead_console_promoted_at}
                        value={formatDate(detail.console_promoted_at, locale, t.common_not_set)}
                      />
                    ) : null}
                  </div>
                </section>

                {detail.intake_source === "visitor_facade" || detail.intake_source === "website_contact" ? (
                  <section className={cardClass("p-4")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          detail.intake_source === "website_contact"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-sky-200 bg-sky-50 text-sky-700",
                        )}
                      >
                        {detail.intake_source === "website_contact"
                          ? t.lead_from_website_contact_form
                          : t.lead_from_website_wizard}
                      </Badge>
                      {detail.flow ? (
                        <Badge variant="outline" className="rounded-full">
                          {t.lead_flow}: {detail.flow}
                        </Badge>
                      ) : null}
                      {detail.locale ? (
                        <Badge variant="outline" className="rounded-full">
                          {t.lead_locale}: {detail.locale}
                        </Badge>
                      ) : null}
                      {detail.submitted_at ? (
                        <span className="text-xs text-zinc-500">
                          {t.lead_submitted_at} {formatDate(detail.submitted_at, locale, t.common_not_set)}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_section_identity}</SectionTitle>
                  <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                    <DetailCard
                      label={t.lead_full_name}
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
                    <DetailCard label={t.field_birth_date} value={formatDate(leadDetailDateOfBirth(detail), locale, t.common_not_set)} />
                    <DetailCard label={t.lead_legal_sex} value={legalSexLabel(detail.legal_sex, t)} />
                    <DetailCard label={t.lead_primary_language} value={leadLanguageLabel(detail.primary_language, t)} />
                    <DetailCard label={t.lead_needs_interpreter} value={yesNo(detail.needs_interpreter, t)} />
                  </div>
                </section>

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_section_address}</SectionTitle>
                  <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                    <DetailCard label={t.providers_country} value={dashOrValue(detail.country, t)} />
                    <DetailCard label={t.providers_city} value={dashOrValue(detail.city, t)} />
                    <DetailCard label={t.lead_state_region} value={dashOrValue(omitZeroPlaceholder(detail.state), t)} />
                    <DetailCard label={t.lead_zip_code} value={dashOrValue(omitZeroPlaceholder(detail.zip_code), t)} />
                    <DetailCard label={t.providers_street} value={dashOrValue(detail.street_address, t)} />
                  </div>
                </section>
              </>
            ) : null}

            {paneTab === "process" ? (
              <>
                {leadWorkflow ? (
                  <section className={cardClass("p-4")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <SectionTitle>{t.lead_workflow_title}</SectionTitle>
                        <p className="mt-1 text-sm text-zinc-600">
                          {t.lead_workflow_description}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full">
                          {formatUiText(t.lead_workflow_progress, {
                            completed: String(leadWorkflow.completedCount),
                            total: String(leadWorkflow.totalCount),
                          })}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2.5 xl:grid-cols-2">
                      <WorkflowActionCard
                        icon={<ClipboardCheck className="size-4" />}
                        title={t.lead_workflow_complete_gate_title}
                        description={t.lead_workflow_complete_gate_description}
                        status={
                          detail.readiness.qualification_ready
                            ? t.lead_workflow_done
                            : formatUiText(t.lead_workflow_progress, {
                                completed: String(
                                  leadWorkflow.readyQualificationChecks,
                                ),
                                total: String(
                                  leadWorkflow.qualificationChecksTotal,
                                ),
                              })
                        }
                        tone={
                          detail.readiness.qualification_ready
                            ? "success"
                            : "warning"
                        }
                        action={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPaneTab("qualification")}
                          >
                            {t.lead_workflow_open_gate}
                            <ArrowRight className="size-3.5" />
                          </Button>
                        }
                      />

                      <WorkflowActionCard
                        icon={<ShieldCheck className="size-4" />}
                        title={t.lead_workflow_qualify_title}
                        description={t.lead_workflow_qualify_description}
                        status={
                          leadWorkflow.leadQualified
                            ? t.lead_workflow_done
                            : detail.readiness.qualification_ready
                              ? t.lead_workflow_available
                              : t.lead_workflow_blocked
                        }
                        tone={
                          leadWorkflow.leadQualified
                            ? "success"
                            : detail.readiness.qualification_ready
                              ? "info"
                              : "muted"
                        }
                        action={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              Boolean(actionBusy) ||
                              leadWorkflow.leadQualified ||
                              !detail.readiness.qualification_ready ||
                              detail.failed_outcome.status !== "none"
                            }
                            onClick={() => void updateStatus(detail.id, "qualified")}
                          >
                            {actionBusy === `status:${detail.id}:qualified` ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : null}
                            {t.lead_workflow_mark_qualified}
                          </Button>
                        }
                      />

                      <WorkflowActionCard
                        icon={<UserPlus className="size-4" />}
                        title={t.lead_workflow_convert_title}
                        description={t.lead_workflow_convert_description}
                        status={
                          leadWorkflow.leadConverted
                            ? t.lead_workflow_done
                            : detail.readiness.conversion_ready
                              ? t.lead_workflow_available
                              : t.lead_workflow_blocked
                        }
                        tone={
                          leadWorkflow.leadConverted
                            ? "success"
                            : detail.readiness.conversion_ready
                              ? "info"
                              : "muted"
                        }
                        action={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              Boolean(actionBusy) ||
                              !permissions.canConvert ||
                              leadWorkflow.leadConverted ||
                              !detail.readiness.conversion_ready ||
                              detail.failed_outcome.status !== "none"
                            }
                            onClick={() => setPendingConvertLead(detail)}
                          >
                            {t.lead_convert_action}
                            <ArrowRight className="size-3.5" />
                          </Button>
                        }
                      />

                      <WorkflowActionCard
                        icon={<FileCheck2 className="size-4" />}
                        title={t.lead_workflow_failed_title}
                        description={t.lead_workflow_failed_description}
                        status={
                          leadWorkflow.failedResolved
                            ? t.lead_workflow_done
                            : leadWorkflow.leadConverted
                              ? t.lead_workflow_locked
                              : t.lead_workflow_available
                        }
                        tone={
                          leadWorkflow.failedResolved
                            ? "success"
                            : leadWorkflow.leadConverted
                              ? "muted"
                              : "warning"
                        }
                        action={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              leadWorkflow.failedResolved ||
                              leadWorkflow.leadConverted
                            }
                            onClick={() => setPaneTab("qualification")}
                          >
                            {t.lead_workflow_open_failed}
                            <ArrowRight className="size-3.5" />
                          </Button>
                        }
                      />
                    </div>
                  </section>
                ) : null}

                <section className={cardClass("p-4")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <SectionTitle>{t.lead_section_process_readiness}</SectionTitle>
                      <p className="mt-1 text-sm text-zinc-600">
                        {t.lead_process_readiness_description}
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
                        {detail.readiness.qualification_ready
                          ? t.lead_qualification_ready
                          : t.lead_qualification_blocked}
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
                        {detail.readiness.conversion_ready
                          ? t.lead_conversion_ready
                          : t.lead_conversion_blocked}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    {detail.readiness.checks.map((check) => (
                      <div
                        key={check.key}
                        className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-foreground">
                            {leadReadinessCheckLabel(check, t)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t.lead_blocks} {leadStageLabel(check.blocking_for, t)}
                          </p>
                        </div>
                        <span className="h-px min-w-6 flex-1 bg-border/70" />
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-full",
                            check.passed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700",
                          )}
                        >
                          {check.passed ? t.lead_ok : t.lead_missing}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {detail.readiness.blocking_reasons.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                      <p className="text-sm font-semibold text-rose-700">
                        {t.lead_blocking_reasons}
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-rose-700">
                        {detail.readiness.blocking_reasons.map((reason) => (
                          <li key={reason}>- {leadReadinessReasonLabel(reason, t)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section className={cardClass("p-4")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <SectionTitle>{t.lead_section_lifecycle}</SectionTitle>
                      <p className="mt-1 text-sm text-zinc-600">
                        {t.lead_lifecycle_description}
                      </p>
                    </div>
                    <StatusBadge tone="neutral">
                      {`${t.lead_current_stage}: ${leadStageLabel(detail.lifecycle.current_stage, t)}`}
                    </StatusBadge>
                  </div>

                  <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                    <DetailCard
                      label={t.lead_current_stage}
                      value={leadStageLabel(detail.lifecycle.current_stage, t)}
                    />
                    <DetailCard
                      label={t.lead_entered_at}
                      value={formatDate(detail.lifecycle.stage_entered_at, locale, t.common_not_set)}
                    />
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {detail.lifecycle.history.map((event) => (
                      <div
                        key={[
                          event.created_at,
                          event.from_stage ?? "",
                          event.to_stage,
                          event.transition_kind,
                          event.note ?? "",
                        ].join("|")}
                        className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-zinc-900">
                              {event.from_stage
                                ? `${leadStageLabel(event.from_stage, t)} -> ${leadStageLabel(event.to_stage, t)}`
                                : leadStageLabel(event.to_stage, t)}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-500">
                              {leadTransitionKindLabel(event.transition_kind, t)}
                            </p>
                          </div>
                          <span className="text-xs text-zinc-500">
                            {formatDate(event.created_at, locale, t.common_not_set)}
                          </span>
                        </div>
                        {event.note ? (
                          <p className="mt-2 text-sm text-zinc-600">{event.note}</p>
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
                  <section className={cardClass("p-4")}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <SectionTitle>{t.lead_qualification_gate_data}</SectionTitle>
                        <p className="mt-1 text-sm text-zinc-600">
                          {t.lead_qualification_gate_description}
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
                          label={t.lead_primary_language}
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
                          label={t.field_birth_date}
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
                        <LeadField label={t.lead_legal_sex} htmlFor="lead-gate-legal-sex">
                          <NativeComboboxSelect
                            value={gateForm.legalSex || "__unset__"}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      legalSex:
                                        event.target.value && event.target.value !== "__unset__"
                                          ? event.target.value
                                          : "",
                                    }
                                  : current
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="__unset__">{t.common_not_set}</option>
                            {LEGAL_SEX_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {legalSexLabel(option, t)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </LeadField>
                        <LeadField
                          label={t.lead_compliance_status}
                          htmlFor="lead-gate-compliance-status"
                        >
                          <NativeComboboxSelect
                            value={gateForm.complianceStatus}
                            onChange={(event) =>
                              setGateForm((current) =>
                                current
                                  ? { ...current, complianceStatus: event.target.value }
                                  : current
                              )
                            }
                            className={selectClassName}
                          >
                            {COMPLIANCE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {complianceStatusLabel(option, t)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
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
                        <label className={cn("flex items-start gap-3 rounded-lg px-4 py-3 text-sm text-foreground", tokens.surface.mutedCard)}>
                          <input
                            type="checkbox"
                            className={checkboxClass}
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
                          <span>{t.lead_healthcare_consent_available}</span>
                        </label>
                        <label className={cn("flex items-start gap-3 rounded-lg px-4 py-3 text-sm text-foreground", tokens.surface.mutedCard)}>
                          <input
                            type="checkbox"
                            className={checkboxClass}
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
                          <span>{t.lead_privacy_practices_accepted}</span>
                        </label>
                      </div>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={gateBusy}>
                          {gateBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          {t.lead_save_gate_data}
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}

                {detail.converted_patient_id ? null : (
                  <section className={cardClass("p-4")}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <SectionTitle>{t.lead_failed_resolution_title}</SectionTitle>
                        <p className="mt-1 text-sm text-zinc-600">
                          {t.lead_failed_resolution_description}
                        </p>
                      </div>
                      {detail.failed_outcome.status !== "none" ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            detail.failed_outcome.status === "delete_anonymized"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-zinc-200 bg-zinc-100 text-zinc-700"
                          )}
                        >
                          {failedOutcomeLabel(detail.failed_outcome.status, t)}
                        </Badge>
                      ) : null}
                    </div>

                    {detail.failed_outcome.status !== "none" ? (
                      <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <DetailCard
                          label={t.lead_resolution}
                          value={failedOutcomeLabel(detail.failed_outcome.status, t)}
                        />
                        <DetailCard
                          label={t.lead_processed_at}
                          value={
                            formatDate(detail.failed_outcome.processed_at, locale, t.common_not_set)
                          }
                        />
                        <DetailCard
                          label={t.lead_failed_from}
                          value={leadStageLabel(detail.failed_outcome.from_status, t)}
                        />
                        <DetailCard
                          label={t.lead_failure_reason}
                          value={detail.failed_outcome.reason || t.common_not_set}
                        />
                      </div>
                    ) : null}

                    {detail.failed_outcome.status === "none" ? (
                      <form className="mt-4 space-y-4" onSubmit={handleResolveFailedLead}>
                        <div className="grid gap-4 md:grid-cols-2">
                          <LeadField label={t.lead_resolution} htmlFor="lead-failed-resolution">
                            <NativeComboboxSelect
                              value={failedLeadForm.resolution}
                              onChange={(event) =>
                                setFailedLeadForm((current) => ({
                                  ...current,
                                  resolution: event.target.value === "delete" ? "delete" : "archive",
                                }))
                              }
                            className={selectClassName}
                          >
                            <option value="archive">{t.lead_archive}</option>
                            {user?.role === "patient_manager" || user?.role === "ceo" ? (
                              <option value="delete">{t.lead_delete_and_anonymize}</option>
                            ) : null}
                          </NativeComboboxSelect>
                          </LeadField>
                          <LeadField label={t.lead_failure_reason} htmlFor="lead-failed-reason">
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

                        <LeadField label={t.lead_internal_note} htmlFor="lead-failed-note">
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
                            {t.lead_delete_warning}
                          </Banner>
                        ) : null}

                        <div className="flex justify-end">
                          <Button type="submit" disabled={failedLeadBusy}>
                            {failedLeadBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {t.lead_save_failed_resolution}
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
                  <section className={cardClass("p-4")}>
                    <SectionTitle>{t.lead_section_eligibility_path}</SectionTitle>
                    <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <DetailCard label={t.lead_location} value={leadLocationLabel(detail.location, t)} />
                      <DetailCard label={t.lead_location_detailed} value={leadLocationDetailedLabel(detail.location_detailed, t)} />
                      <DetailCard label={t.lead_wants_membership} value={yesNo(detail.wants_membership, t)} />
                      <DetailCard
                        label={t.lead_selected_program}
                        value={leadProgramServiceLabel(detail.selected_program, t)}
                      />
                      <DetailCard label={t.lead_can_travel} value={yesNo(detail.can_travel, t)} />
                      <DetailCard label={t.lead_has_medical_records} value={leadMedicalRecordsLabel(detail.has_medical_records, t)} />
                      <DetailCard label={t.lead_records_in_accepted_language} value={yesNo(detail.records_in_accepted_language, t)} />
                      <DetailCard label={t.lead_has_travel_documents} value={yesNo(detail.has_travel_documents, t)} />
                    </div>
                  </section>
                ) : null}

                {(detail.currently_in_treatment !== null ||
                  detail.has_health_risk_for_travel !== null ||
                  detail.primary_concern_text ||
                  detail.additional_concerns) ? (
                  <section className={cardClass("p-4")}>
                    <SectionTitle>{t.lead_section_health_concern}</SectionTitle>
                    <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <DetailCard label={t.lead_currently_in_treatment} value={yesNo(detail.currently_in_treatment, t)} />
                      <DetailCard label={t.lead_health_risk_for_travel} value={yesNo(detail.has_health_risk_for_travel, t)} />
                    </div>
                    {detail.primary_concern_text ? (
                      <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                        {detail.primary_concern_text}
                      </div>
                    ) : null}
                    {detail.additional_concerns ? (
                      <div className="mt-3 rounded-2xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                        {detail.additional_concerns}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {(detail.services?.length ||
                  detail.has_insurance !== null ||
                  detail.insurance_covers_germany) ? (
                  <section className={cardClass("p-4")}>
                    <SectionTitle>{t.lead_section_services_insurance}</SectionTitle>
                    <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <DetailCard
                        label={t.lead_services}
                        value={
                          detail.services && detail.services.length > 0
                            ? detail.services
                                .map((service) => leadProgramServiceLabel(service, t))
                                .join(", ")
                            : t.common_not_set
                        }
                      />
                      <DetailCard label={t.lead_has_insurance} value={yesNo(detail.has_insurance, t)} />
                      <DetailCard label={t.lead_insurance_covers_germany} value={leadInsuranceCoverageLabel(detail.insurance_covers_germany, t)} />
                    </div>
                  </section>
                ) : null}

                {(detail.preferred_location ||
                  detail.visit_timing ||
                  detail.message) ? (
                  <section className={cardClass("p-4")}>
                    <SectionTitle>{t.lead_section_wrap_up}</SectionTitle>
                    <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <DetailCard label={t.lead_preferred_location} value={leadPreferredLocationLabel(detail.preferred_location, t)} />
                      <DetailCard label={t.lead_visit_timing} value={leadVisitTimingLabel(detail.visit_timing, t)} />
                    </div>
                    {detail.message ? (
                      <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                        {detail.message}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {detail.intake_source === "visitor_facade" ? (
                  <section className={cardClass("p-4")}>
                    <SectionTitle>{t.lead_section_consents}</SectionTitle>
                    <div className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <DetailCard label={t.lead_consent_automated_contact} value={yesNo(detail.consent_automated_contact, t)} />
                      <DetailCard label={t.lead_consent_healthcare} value={yesNo(detail.consent_healthcare, t)} />
                      <DetailCard label={t.lead_consent_opt_out} value={yesNo(detail.consent_opt_out, t)} />
                      <DetailCard label={t.lead_consent_privacy_practices} value={yesNo(detail.consent_privacy_practices, t)} />
                      <DetailCard label={t.lead_email_consent} value={yesNo(detail.email_consent, t)} />
                      <DetailCard label={t.lead_whatsapp_consent} value={yesNo(detail.whatsapp_consent, t)} />
                    </div>
                  </section>
                ) : null}

                <section className={cardClass("p-4")}>
                  <SectionTitle>
                    {`${t.lead_attachments} (${detail.attachments?.length ?? 0})`}
                  </SectionTitle>
                  {detail.attachments && detail.attachments.length > 0 ? (
                    <ul className="mt-4 space-y-1.5">
                      {detail.attachments.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium text-zinc-800">{file.file_name}</div>
                            <div className="text-xs text-zinc-500">
                              {dashOrValue(file.content_type, t)} - {formatSize(file.size_bytes)}
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
                                    : t.lead_download_attachment_failed
                                );
                              }
                            }}
                          >
                            {t.lead_download_attachment}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-zinc-500">{t.lead_no_files_uploaded}</p>
                  )}
                  {detail.notes ? (
                    <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700">
                      <div className="mb-1 text-xs uppercase tracking-wide text-zinc-400">{t.lead_internal_note}</div>
                      {detail.notes}
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
            </div>
            )
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
              {t.lead_select_from_queue}
            </div>
          )}
        </div>
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
                  {t.leads_new}
                </Button>
              ) : null}
            </>
          }
        />

        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
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
            description={statusLabel("qualified", t)}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={UserPlus}
            label={t.leads_convert}
            value={String(stats?.converted_this_month ?? 0)}
            description={statusLabel("converted", t)}
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

        {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}
        {successMessage ? <SuccessBanner>{successMessage}</SuccessBanner> : null}

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

            <NativeComboboxSelect
              value={filters.status || "__all__"}
              onChange={(event) => {
                const status = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                setFilters((current) => ({
                  ...current,
                  status,
                  includeArchived: status === "archived" ? "true" : current.includeArchived,
                }));
              }}
              className={cn(selectClassName, "h-8 w-[190px] bg-background text-[13px]")}
            >
              <option value="__all__">{t.users_status}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, t)}
                </option>
              ))}
            </NativeComboboxSelect>

            <NativeComboboxSelect
              value={filters.leadType || "__all__"}
              onChange={(event) => {
                const leadType = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                setFilters((current) => ({ ...current, leadType }));
              }}
              className={cn(selectClassName, "h-8 w-[170px] bg-background text-[13px]")}
            >
              <option value="__all__">{t.lead_type}</option>
              {LEAD_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {leadTypeLabel(type, t)}
                </option>
              ))}
            </NativeComboboxSelect>

            <NativeComboboxSelect
              value={filters.includeArchived || "false"}
              onChange={(event) => {
                const includeArchived = event.target.value === "true" ? "true" : "false";
                setFilters((current) => ({
                  ...current,
                  includeArchived,
                  status:
                    includeArchived === "false" && current.status === "archived"
                      ? ""
                      : current.status,
                }));
              }}
              className={cn(selectClassName, "h-8 w-[170px] bg-background text-[13px]")}
            >
              <option value="false">
                {t.lead_filter_active_leads}
              </option>
              <option value="true">
                {t.lead_filter_with_archive}
              </option>
            </NativeComboboxSelect>

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={t.common_refresh}
                aria-label={t.common_refresh}
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
            defaultDensity="comfortable"
            defaultFrozenColumns={LEAD_DEFAULT_FROZEN_COLUMNS}
            dictionary={t as unknown as Record<string, string>}
            groupLabels={leadColumnGroupLabels}
            loading={loading}
            maxFrozenColumns={LEAD_MAX_FROZEN_COLUMNS}
            toolbarClassName="border-b border-border/70 bg-card px-3 py-2"
            activeRowId={wizardLeadId || selectedLeadId || null}
            onRowClick={openLeadFromRow}
            rowAccent={(row) => leadRowAccent(row.qualification_status)}
            emptyState={
              <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
                <div className="text-sm font-medium text-foreground">{t.lead_empty_title}</div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.lead_empty_description}
                </p>
              </div>
            }
          />
        </AdminTableCard>

        <Sheet
          open={detailOpen}
          onOpenChange={(open) => {
            setDetailOpen(open);
            if (!open) syncLeadQuery(undefined, { replace: false });
          }}
        >
          <SheetContent
            side="right"
            className="w-full max-w-none gap-0 border-l border-border p-0 sm:max-w-3xl xl:max-w-4xl"
          >
            {detailPaneNode}
          </SheetContent>
        </Sheet>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full gap-0 border-l border-border p-0 sm:max-w-2xl">
          <form onSubmit={handleCreate} className="flex h-full flex-col">
            <AdminSheetScaffold
              title={t.leads_new}
              description={t.lead_create_description}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              <div className="space-y-4 rounded-xl">
                {createError ? <ShellBanner tone="error">{createError}</ShellBanner> : null}

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_section_identity}</SectionTitle>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
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
                </section>

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.lead_section_contact_origin}</SectionTitle>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
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
                </section>

                <section className={cardClass("p-4")}>
                  <SectionTitle>{t.patients_notes}</SectionTitle>
                  <div className="mt-5">
                    <textarea
                      aria-label={t.patients_notes}
                      value={createForm.notes}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, notes: event.target.value }))
                      }
                      className={cn(textareaClassName, "min-h-[104px]")}
                      rows={4}
                    />
                  </div>
                </section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <LeadWizard
        leadId={wizardLeadId}
        open={wizardLeadId !== null}
        onOpenChange={(open) => {
          if (open) return;
          setWizardLeadId(null);
          syncLeadQuery(undefined, { replace: false });
          reload();
        }}
        onArchived={() => {
          setWizardLeadId(null);
          syncLeadQuery(undefined, { replace: false });
          setSuccessMessage(lang === "de" ? "Lead archiviert." : "Лид архивирован.");
          reload();
        }}
        onShowDetails={(leadId) => openLeadDetail(leadId)}
        onConverted={(patientId) => {
          setWizardLeadId(null);
          staffGo(`/patients/${patientId}`);
        }}
        onOrderCreated={(orderId) => {
          setWizardLeadId(null);
          staffGo(`/orders/${orderId}`);
        }}
      />

      <Dialog
        open={pendingConvertLead !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConvertLead(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.lead_convert_dialog_title}</DialogTitle>
            <DialogDescription>
              {pendingConvertLead ? (
                <>
                  {t.lead_convert_dialog_start}{" "}
                  <span className="font-medium text-zinc-900">
                    {pendingConvertLead.first_name} {pendingConvertLead.last_name}
                  </span>
                  {t.lead_convert_dialog_end}{" "}
                  <span className="font-mono text-xs">{statusLabel("converted", t)}</span>.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={Boolean(actionBusy)}>
                  {t.common_cancel}
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
              {t.lead_create_patient}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeadsPage(...args: Parameters<typeof useLeadsPageContent>) {
  return useLeadsPageContent(...args);
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
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{children}</span>
    </h3>
  );
}

function DetailCard({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-6 flex-1 self-center bg-border/70" />
      <span className="min-w-0 max-w-[48%] break-words text-right text-sm font-semibold leading-snug text-foreground">
        {value}
      </span>
    </div>
  );
}

function WorkflowActionCard({
  icon,
  title,
  description,
  status,
  tone,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  tone: "success" | "warning" | "info" | "muted";
  action: ReactNode;
}) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    info: "border-sky-200 bg-sky-50 text-sky-700",
    muted: "border-zinc-200 bg-zinc-50 text-zinc-600",
  }[tone];

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-zinc-900">{title}</p>
              <p className="mt-1 text-sm leading-5 text-zinc-600">{description}</p>
            </div>
            <Badge variant="outline" className={cn("rounded-full", toneClass)}>
              {status}
            </Badge>
          </div>
          <div className="mt-3 flex justify-end">{action}</div>
        </div>
      </div>
    </div>
  );
}
