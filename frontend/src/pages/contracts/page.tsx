import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  FileBadge2,
  FileSpreadsheet,
  LoaderCircle,
  type LucideIcon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
  AdminToolbar,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  PageHeader,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { Banner as ShellBanner } from "@/components/record-workspace/recipes";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  contractStatusClassName,
  quoteStatusClassName,
} from "./appearance/status-appearance";
import {
  CONTRACT_STATUSES,
  DEFAULT_AGENCY_SERVICE_FILTERS,
  DEFAULT_CONTRACT_FILTERS,
  DEFAULT_QUOTE_FILTERS,
  QUOTE_STATUSES,
  agencyServiceToForm,
  blankAgencyServiceForm,
  blankContractForm,
  blankQuoteForm,
  buildAgencyServicesPath,
  buildContractsPath,
  buildQuotesPath,
  buildSearchParams,
  contractToStatusForm,
  contractsPermissions,
  enumLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  orderOptionLabel,
  patientOptionLabel,
  quoteToStatusForm,
  toOptional,
  valueToInput,
} from "./model/contracts-model";
import {
  createContract,
  createQuote,
  fetchAgencyServices,
  fetchContract,
  fetchContracts,
  fetchContractsLookups,
  fetchQuoteWorkspace,
  fetchQuotes,
  saveAgencyService,
  updateContractStatus,
  updateQuoteStatus,
} from "./data/contracts-api";
import type {
  AgencyServiceFilters,
  AgencyServiceFormState,
  AgencyServiceItem,
  ContractFilters,
  ContractFormState,
  ContractItem,
  ContractStatus,
  ContractStatusFormState,
  ContractsTab,
  OrderOption,
  PatientOption,
  QuoteFilters,
  QuoteFormState,
  QuoteItem,
  QuoteLineItemRow,
  QuoteStatus,
  QuoteStatusFormState,
  QuoteVersionItem,
} from "./model/types";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const CONTRACT_REALTIME_EVENTS = [
  "framework_contract.created",
  "framework_contract.status_changed",
  "quote.created",
  "quote.status_changed",
] as const;

const CONTRACT_STATUS_LABEL_KEYS = {
  draft: "revenue_contract_status_draft",
  sent: "revenue_contract_status_sent",
  signed: "revenue_contract_status_signed",
  expired: "revenue_contract_status_expired",
  terminated: "revenue_contract_status_terminated",
} satisfies Partial<Record<string, TranslationKey>>;

const QUOTE_STATUS_LABEL_KEYS = {
  draft: "revenue_quote_status_draft",
  sent: "revenue_quote_status_sent",
  accepted: "revenue_quote_status_accepted",
  rejected: "revenue_quote_status_rejected",
  expired: "revenue_quote_status_expired",
} satisfies Partial<Record<string, TranslationKey>>;

const QUOTE_VERSION_REASON_LABEL_KEYS = {
  initial_snapshot: "revenue_quotes_version_snapshot",
  status_update: "revenue_quotes_version_status_update",
} satisfies Partial<Record<string, TranslationKey>>;

function contractMetricCard(
  label: ReactNode,
  value: ReactNode,
  description: ReactNode,
  icon: LucideIcon,
  options?: { groupedLast?: boolean },
) {
  const Icon = icon;

  return (
    <article className="relative min-h-[44px] min-w-[190px] px-3 py-1">
      {!options?.groupedLast ? (
        <span className="absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-1 xl:block">
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
        </span>
      ) : null}
      <div className="flex items-baseline gap-2">
        <Icon className="size-4.5 shrink-0 text-muted-foreground/55" />
        <p className="text-2xl font-semibold leading-[0.75] text-foreground">
          {value}
        </p>
      </div>
      <p className="mt-[4px] line-clamp-2 text-[11px] leading-tight text-muted-foreground/75">
        {description}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-tight text-muted-foreground">
        {label}
      </p>
    </article>
  );
}

export function ContractsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = contractsPermissions(user?.role);
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = useMemo(
    () => ({
      accessDenied: t.revenue_contracts_access_denied,
      workspaceTitle: t.revenue_contracts_workspace_title,
      refresh: t.revenue_contracts_refresh,
      newContract: t.revenue_contracts_new_contract,
      newQuote: t.revenue_contracts_new_quote,
      contractsTab: t.revenue_contracts_tab_contracts,
      quotesTab: t.revenue_contracts_tab_quotes,
      contractStatsDescription: t.revenue_contracts_stats_signed_sent,
      quoteStatsDescription: t.revenue_contracts_stats_accepted,
      agencyServiceTitle: t.revenue_agency_service_title,
      agencyServiceDescription: t.revenue_agency_service_description,
      agencyServiceSearchPlaceholder: t.revenue_agency_service_search_placeholder,
      activeOnly: t.revenue_agency_service_active_only,
      allStatuses: t.revenue_agency_service_all_statuses,
      inactiveOnly: t.revenue_agency_service_inactive_only,
      catalogItems: t.revenue_agency_service_catalog_items,
      activeLabel: t.revenue_agency_service_active_metric,
      priced: t.revenue_agency_service_priced_metric,
      noCatalogItems: t.revenue_agency_service_empty_title,
      noCatalogItemsDescription: t.revenue_agency_service_empty_description,
      activeState: t.revenue_agency_service_active_state,
      inactiveState: t.revenue_agency_service_inactive_state,
      unitPrice: t.revenue_agency_service_unit_price,
      unit: t.revenue_agency_service_unit,
      updated: t.revenue_agency_service_updated,
      editCatalogItem: t.revenue_agency_service_edit_title,
      newCatalogItem: t.revenue_agency_service_new_title,
      catalogHelp: t.revenue_agency_service_help,
      serviceKey: t.revenue_agency_service_service_key,
      serviceName: t.revenue_agency_service_service_name,
      unitLabel: t.revenue_agency_service_unit_label,
      currency: t.revenue_agency_service_currency,
      vatPercent: t.revenue_agency_service_vat_percent,
      description: t.revenue_agency_service_description_label,
      itemIsActive: t.revenue_agency_service_active_hint,
      saveCatalogItem: t.revenue_agency_service_save,
      createCatalogItem: t.revenue_agency_service_create,
      createContractDescription: t.revenue_contracts_create_description,
      selectPatient: t.revenue_contracts_select_patient,
      createContract: t.revenue_contracts_create,
      createQuoteDescription: t.revenue_quotes_create_description,
      loadingOrders: t.revenue_quotes_loading_orders,
      selectOrder: t.revenue_quotes_select_order,
      chooseOrder: t.revenue_quotes_choose_order,
      createQuote: t.revenue_quotes_create,
      contractSheetDescription: t.revenue_contracts_sheet_description,
      contractOverviewDescription: t.revenue_contracts_overview_description,
      linkedContractDescription: t.revenue_contracts_linked_description,
      orders: t.revenue_contracts_orders,
      documents: t.revenue_contracts_documents,
      saveContract: t.revenue_contracts_save,
      quoteSheetDescription: t.revenue_quotes_sheet_description,
      quoteOverviewDescription: t.revenue_quotes_overview_description,
      vatTotal: t.revenue_quotes_vat_total,
      grossTotal: t.revenue_quotes_gross_total,
      snapshotVersion: t.revenue_quotes_snapshot_version,
      linkedQuoteDescription: t.revenue_quotes_linked_description,
      order: t.revenue_quotes_order,
      invoices: t.revenue_quotes_invoices,
      quoteLifecycle: t.revenue_quotes_lifecycle,
      quoteLifecycleDescription: t.revenue_quotes_lifecycle_description,
      saveQuote: t.revenue_quotes_save,
      lineItems: t.revenue_quotes_line_items,
      lineItemsDescription: t.revenue_quotes_line_items_description,
      noLineItems: t.revenue_quotes_empty_line_items,
      noLineItemsDescription: t.revenue_quotes_empty_line_items_description,
      quantity: t.revenue_common_quantity,
      net: t.revenue_common_net,
      gross: t.revenue_common_gross,
      versionHistory: t.revenue_quotes_version_history,
      versionHistoryDescription: t.revenue_quotes_version_history_description,
      noVersions: t.revenue_quotes_empty_versions,
      noVersionsDescription: t.revenue_quotes_empty_versions_description,
      version: t.revenue_quotes_version,
      snapshotFallback: t.revenue_quotes_version_snapshot,
      lineItemsCount: t.revenue_quotes_line_items_count,
      updatedAt: t.revenue_common_updated_at,
    }),
    [t],
  );
  const contractStatusLabel = useCallback(
    (status: string) => formatEnumLabelFromKeys(status, CONTRACT_STATUS_LABEL_KEYS, t),
    [t],
  );
  const quoteStatusLabel = useCallback(
    (status: string) => formatEnumLabelFromKeys(status, QUOTE_STATUS_LABEL_KEYS, t),
    [t],
  );
  const roleLabel = useCallback(
    (roleValue: string) => {
      const translatedRole = tr[`role_${roleValue}`];
      return enumLabel(
        roleValue,
        translatedRole ? { [roleValue]: translatedRole } : {},
        t,
      );
    },
    [t, tr],
  );
  const quoteVersionChangeReasonLabel = useCallback(
    (reason: string | null | undefined) => {
      if (!reason) return text.snapshotFallback;
      return formatEnumLabelFromKeys(reason, QUOTE_VERSION_REASON_LABEL_KEYS, t);
    },
    [t, text.snapshotFallback],
  );

  const initialTab =
    searchParams.get("tab") === "quotes" || searchParams.has("quote") || searchParams.has("order")
      ? "quotes"
      : "contracts";
  const initialPatientId = searchParams.get("patient") ?? "";
  const initialOrderId = searchParams.get("order") ?? "";
  const initialContractId = searchParams.get("contract") ?? "";
  const initialQuoteId = searchParams.get("quote") ?? "";

  const [activeTab, setActiveTab] = useState<ContractsTab>(initialTab);
  const [contractFilters, setContractFilters] = useState<ContractFilters>({
    ...DEFAULT_CONTRACT_FILTERS,
    patientId: initialPatientId,
  });
  const [quoteFilters, setQuoteFilters] = useState<QuoteFilters>({
    ...DEFAULT_QUOTE_FILTERS,
    patientId: initialPatientId,
    orderId: initialOrderId,
  });
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [agencyServices, setAgencyServices] = useState<AgencyServiceItem[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [agencyServicesLoading, setAgencyServicesLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [agencyServicesError, setAgencyServicesError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState(initialContractId);
  const [selectedQuoteId, setSelectedQuoteId] = useState(initialQuoteId);
  const [contractDetail, setContractDetail] = useState<ContractItem | null>(null);
  const [quoteDetail, setQuoteDetail] = useState<QuoteItem | null>(null);
  const [quoteVersions, setQuoteVersions] = useState<QuoteVersionItem[]>([]);
  const [contractDetailLoading, setContractDetailLoading] = useState(false);
  const [quoteDetailLoading, setQuoteDetailLoading] = useState(false);
  const [quoteVersionsLoading, setQuoteVersionsLoading] = useState(false);
  const [contractDetailError, setContractDetailError] = useState<string | null>(null);
  const [quoteDetailError, setQuoteDetailError] = useState<string | null>(null);
  const [quoteVersionsError, setQuoteVersionsError] = useState<string | null>(null);
  const [contractsReloadToken, setContractsReloadToken] = useState(0);
  const [quotesReloadToken, setQuotesReloadToken] = useState(0);
  const [agencyServicesReloadToken, setAgencyServicesReloadToken] = useState(0);
  const [agencyServiceSheetOpen, setAgencyServiceSheetOpen] = useState(false);
  const [createContractOpen, setCreateContractOpen] = useState(false);
  const [createQuoteOpen, setCreateQuoteOpen] = useState(false);
  const [createContractForm, setCreateContractForm] = useState<ContractFormState>(
    blankContractForm(initialPatientId),
  );
  const [createQuoteForm, setCreateQuoteForm] = useState<QuoteFormState>(
    blankQuoteForm(initialOrderId),
  );
  const [createContractBusy, setCreateContractBusy] = useState(false);
  const [createQuoteBusy, setCreateQuoteBusy] = useState(false);
  const [createContractError, setCreateContractError] = useState<string | null>(null);
  const [createQuoteError, setCreateQuoteError] = useState<string | null>(null);
  const [agencyServiceFilters, setAgencyServiceFilters] = useState<AgencyServiceFilters>(
    DEFAULT_AGENCY_SERVICE_FILTERS,
  );
  const [agencyServiceForm, setAgencyServiceForm] = useState<AgencyServiceFormState>(
    blankAgencyServiceForm(t.revenue_unit_default),
  );
  const [agencyServiceBusy, setAgencyServiceBusy] = useState(false);
  const [agencyServiceFormError, setAgencyServiceFormError] = useState<string | null>(null);
  const [contractStatusForm, setContractStatusForm] = useState<ContractStatusFormState>(
    contractToStatusForm({
      id: "",
      patient_id: "",
      patient_name: "",
      patient_pid: "",
      contract_number: "",
      status: "draft",
      signed_at: null,
      valid_from: null,
      valid_to: null,
      conditions: null,
      created_at: "",
      updated_at: "",
    }),
  );
  const [quoteStatusForm, setQuoteStatusForm] = useState<QuoteStatusFormState>({
    status: "draft",
    paidAmount: "",
    notes: "",
  });
  const [contractStatusBusy, setContractStatusBusy] = useState(false);
  const [quoteStatusBusy, setQuoteStatusBusy] = useState(false);
  const [contractStatusError, setContractStatusError] = useState<string | null>(null);
  const [quoteStatusError, setQuoteStatusError] = useState<string | null>(null);

  const deferredContractSearch = useDeferredValue(contractFilters.search);
  const deferredQuoteSearch = useDeferredValue(quoteFilters.search);
  const deferredAgencyServiceSearch = useDeferredValue(agencyServiceFilters.search);

  useDebouncedRealtimeSubscription(CONTRACT_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/framework-contracts");
    clearApiCache("/quotes");
    clearApiCache("/orders");

    for (const event of events) {
      if (event.entity_type === "framework_contract" && event.entity_id) {
        clearApiCache(`/framework-contracts/${event.entity_id}`);
      }
      if (event.entity_type === "quote" && event.entity_id) {
        clearApiCache(`/quotes/${event.entity_id}`);
        clearApiCache(`/quotes/${event.entity_id}/versions`);
      }

      const orderId =
        typeof event.payload?.order_id === "string" ? event.payload.order_id : "";
      if (orderId) {
        clearApiCache(`/orders/${orderId}`);
      }
    }
    if (selectedContractId) {
      clearApiCache(`/framework-contracts/${selectedContractId}`);
    }
    if (selectedQuoteId) {
      clearApiCache(`/quotes/${selectedQuoteId}`);
      clearApiCache(`/quotes/${selectedQuoteId}/versions`);
    }

    startTransition(() => {
      setContractsReloadToken((current) => current + 1);
      setQuotesReloadToken((current) => current + 1);
    });
  }, 250);

  const contractQuery = useMemo(
    () => ({ ...contractFilters, search: deferredContractSearch }),
    [contractFilters, deferredContractSearch],
  );
  const quoteQuery = useMemo(
    () => ({ ...quoteFilters, search: deferredQuoteSearch }),
    [quoteFilters, deferredQuoteSearch],
  );
  const agencyServiceQuery = useMemo(
    () => ({ ...agencyServiceFilters, search: deferredAgencyServiceSearch }),
    [agencyServiceFilters, deferredAgencyServiceSearch],
  );

  const syncQuery = (patch: Record<string, string | null | undefined>) => {
    setSearchParams((current) => buildSearchParams(current, patch), { replace: true });
  };

  const filteredOrderOptions = useMemo(() => {
    if (!quoteFilters.patientId) return orders;
    return orders.filter((order) => order.patient_id === quoteFilters.patientId);
  }, [orders, quoteFilters.patientId]);

  const contractStats = useMemo(() => {
    const signed = contracts.filter((item) => item.status === "signed").length;
    const sent = contracts.filter((item) => item.status === "sent").length;
    return { total: contracts.length, signed, sent };
  }, [contracts]);

  const quoteStats = useMemo(() => {
    const accepted = quotes.filter((item) => item.status === "accepted").length;
    const gross = quotes.reduce((sum, item) => sum + Number(item.total_gross ?? 0), 0);
    const paid = quotes.reduce((sum, item) => sum + Number(item.paid_amount ?? 0), 0);
    return { total: quotes.length, accepted, gross, paid };
  }, [quotes]);

  const agencyServiceStats = useMemo(() => {
    const active = agencyServices.filter((item) => item.is_active).length;
    const priced = agencyServices.filter((item) => Number(item.unit_price ?? 0) > 0).length;
    return { total: agencyServices.length, active, priced };
  }, [agencyServices]);

  const selectedCreateOrder = useMemo(
    () => orders.find((order) => order.id === createQuoteForm.orderId) ?? null,
    [orders, createQuoteForm.orderId],
  );

  const agencyServiceColumns = useMemo<ColumnDef<AgencyServiceItem>[]>(
    () => [
      {
        id: "service_key",
        label: text.serviceKey,
        accessor: (row) => row.service_key,
        sortable: true,
        required: true,
        width: 180,
        render: (row) => <span className="font-mono text-xs">{row.service_key}</span>,
      },
      {
        id: "service_name",
        label: text.serviceName,
        accessor: (row) => row.service_name,
        sortable: true,
        required: true,
        width: 260,
      },
      {
        id: "description",
        label: text.description,
        accessor: (row) => row.description ?? "",
        width: 320,
        render: (row) => (
          <span className="block max-w-[320px] truncate text-sm text-foreground">
            {row.description?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "unit_price",
        label: text.unitPrice,
        accessor: (row) => Number(row.unit_price ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.unit_price),
      },
      {
        id: "unit_label",
        label: text.unit,
        accessor: (row) => row.unit_label,
        width: 120,
      },
      {
        id: "vat_rate",
        label: text.vatPercent,
        accessor: (row) => valueToInput(row.vat_rate),
        width: 120,
        render: (row) => `${valueToInput(row.vat_rate) || "0"}%`,
      },
      {
        id: "is_active",
        label: t.users_status,
        accessor: (row) => (row.is_active ? "active" : "inactive"),
        width: 140,
        render: (row) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              row.is_active
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-100 text-slate-600",
            )}
          >
            {row.is_active ? text.activeState : text.inactiveState}
          </Badge>
        ),
      },
      {
        id: "updated_at",
        label: text.updated,
        accessor: (row) => row.updated_at ?? "",
        sortable: true,
        width: 180,
        render: (row) => (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(row.updated_at, locale, t.common_not_set)}
          </span>
        ),
      },
    ],
    [locale, t.common_not_set, t.users_status, text],
  );

  const contractTableColumns = useMemo<ColumnDef<ContractItem>[]>(
    () => [
      {
        id: "contract_number",
        label: t.contracts_framework,
        accessor: (row) => row.contract_number,
        sortable: true,
        required: true,
        width: 180,
        render: (row) => <span className="font-mono text-xs">{row.contract_number}</span>,
      },
      {
        id: "patient_name",
        label: t.contracts_patient,
        accessor: (row) => row.patient_name,
        sortable: true,
        required: true,
        width: 240,
      },
      {
        id: "patient_pid",
        label: "PID",
        accessor: (row) => row.patient_pid,
        sortable: true,
        width: 140,
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 150,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", contractStatusClassName(row.status))}>
            {contractStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: "valid_from",
        label: t.providers_service_valid_from,
        accessor: (row) => row.valid_from ?? "",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.valid_from, locale, t.common_not_set),
      },
      {
        id: "valid_to",
        label: t.providers_service_valid_to,
        accessor: (row) => row.valid_to ?? "",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.valid_to, locale, t.common_not_set),
      },
      {
        id: "signed_at",
        label: t.contracts_signed_at,
        accessor: (row) => row.signed_at ?? "",
        sortable: true,
        width: 180,
        render: (row) => formatDateTime(row.signed_at, locale, t.common_not_set),
      },
      {
        id: "updated_at",
        label: text.updatedAt,
        accessor: (row) => row.updated_at,
        sortable: true,
        width: 180,
        render: (row) => formatDateTime(row.updated_at, locale, t.common_not_set),
      },
    ],
    [
      locale,
      t.common_not_set,
      t.contracts_framework,
      t.contracts_patient,
      t.contracts_signed_at,
      t.providers_service_valid_from,
      t.providers_service_valid_to,
      t.users_status,
      text.updatedAt,
      contractStatusLabel,
    ],
  );

  const quoteTableColumns = useMemo<ColumnDef<QuoteItem>[]>(
    () => [
      {
        id: "quote_number",
        label: text.quotesTab,
        accessor: (row) => row.quote_number,
        sortable: true,
        required: true,
        width: 180,
        render: (row) => <span className="font-mono text-xs">{row.quote_number}</span>,
      },
      {
        id: "patient_name",
        label: t.contracts_patient,
        accessor: (row) => row.patient_name,
        sortable: true,
        required: true,
        width: 220,
      },
      {
        id: "order_number",
        label: t.orders_title,
        accessor: (row) => row.order_number,
        sortable: true,
        width: 160,
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 150,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(row.status))}>
            {quoteStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: "total_gross",
        label: text.grossTotal,
        accessor: (row) => Number(row.total_gross ?? 0),
        sortable: true,
        width: 150,
        render: (row) => formatCurrency(row.total_gross),
      },
      {
        id: "valid_until",
        label: t.providers_service_valid_to,
        accessor: (row) => row.valid_until ?? "",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.valid_until, locale, t.common_not_set),
      },
      {
        id: "paid_amount",
        label: t.invoices_paid,
        accessor: (row) => Number(row.paid_amount ?? 0),
        sortable: true,
        width: 150,
        render: (row) => formatCurrency(row.paid_amount),
      },
      {
        id: "updated_at",
        label: text.updatedAt,
        accessor: (row) => row.updated_at,
        sortable: true,
        width: 180,
        render: (row) => formatDateTime(row.updated_at, locale, t.common_not_set),
      },
    ],
    [
      locale,
      t.common_not_set,
      t.contracts_patient,
      t.invoices_paid,
      t.orders_title,
      t.providers_service_valid_to,
      t.users_status,
      text.grossTotal,
      text.quotesTab,
      text.updatedAt,
      quoteStatusLabel,
    ],
  );

  const quoteLineItemRows = useMemo<QuoteLineItemRow[]>(
    () =>
      (quoteDetail?.line_items ?? []).map((line, index) => ({
        ...line,
        id: `${index}-${line.description}-${line.quantity}-${line.unit_price}`,
      })),
    [quoteDetail?.line_items],
  );

  const quoteLineItemColumns = useMemo<ColumnDef<QuoteLineItemRow>[]>(
    () => [
      {
        id: "description",
        label: text.description,
        accessor: (row) => row.description,
        sortable: true,
        required: true,
        width: 320,
      },
      {
        id: "quantity",
        label: text.quantity,
        accessor: (row) => Number(row.quantity ?? 0),
        sortable: true,
        width: 90,
      },
      {
        id: "unit_price",
        label: text.unitPrice,
        accessor: (row) => Number(row.unit_price ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.unit_price),
      },
      {
        id: "vat_rate",
        label: t.invoices_vat,
        accessor: (row) => Number(row.vat_rate ?? 0),
        sortable: true,
        width: 110,
        render: (row) => `${row.vat_rate}%`,
      },
      {
        id: "line_net",
        label: text.net,
        accessor: (row) => Number(row.line_net ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.line_net),
      },
      {
        id: "line_vat",
        label: text.vatTotal,
        accessor: (row) => Number(row.line_vat ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.line_vat),
      },
      {
        id: "line_gross",
        label: text.gross,
        accessor: (row) => Number(row.line_gross ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.line_gross),
      },
      {
        id: "passthrough",
        label: t.orders_cost_pass_through_badge,
        accessor: (row) => (row.is_cost_passthrough ? "yes" : "no"),
        width: 180,
        render: (row) =>
          row.is_cost_passthrough ? (
            <Badge variant="outline" className="rounded-full border-orange-200 bg-orange-50 text-orange-700">
              {t.orders_cost_pass_through_badge}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "notes",
        label: t.contracts_notes,
        accessor: (row) => row.notes ?? "",
        width: 280,
        render: (row) => (
          <span className="block max-w-[280px] truncate text-sm text-foreground">
            {row.notes?.trim() || t.common_not_set}
          </span>
        ),
      },
    ],
    [
      t.common_not_set,
      t.contracts_notes,
      t.invoices_vat,
      t.orders_cost_pass_through_badge,
      text.description,
      text.gross,
      text.net,
      text.quantity,
      text.unitPrice,
      text.vatTotal,
    ],
  );

  const quoteVersionColumns = useMemo<ColumnDef<QuoteVersionItem>[]>(
    () => [
      {
        id: "version_number",
        label: text.version,
        accessor: (row) => row.version_number,
        sortable: true,
        required: true,
        width: 120,
        render: (row) => <span className="font-mono text-xs">v{row.version_number}</span>,
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 150,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(row.status))}>
            {quoteStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: "total_gross",
        label: text.gross,
        accessor: (row) => Number(row.total_gross ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.total_gross),
      },
      {
        id: "paid_amount",
        label: t.invoices_paid,
        accessor: (row) => Number(row.paid_amount ?? 0),
        sortable: true,
        width: 140,
        render: (row) => formatCurrency(row.paid_amount),
      },
      {
        id: "valid_until",
        label: t.providers_service_valid_to,
        accessor: (row) => row.valid_until ?? "",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.valid_until, locale, t.common_not_set),
      },
      {
        id: "paid_at",
        label: t.invoices_paid_at,
        accessor: (row) => row.paid_at ?? "",
        sortable: true,
        width: 170,
        render: (row) => formatDateTime(row.paid_at, locale, t.common_not_set),
      },
      {
        id: "line_item_count",
        label: text.lineItemsCount,
        accessor: (row) => row.line_item_count,
        sortable: true,
        width: 120,
      },
      {
        id: "change_reason",
        label: t.contracts_notes,
        accessor: (row) => row.change_reason ?? "",
        width: 280,
        render: (row) => (
          <span className="block max-w-[280px] truncate text-sm text-foreground">
            {quoteVersionChangeReasonLabel(row.change_reason)}
          </span>
        ),
      },
      {
        id: "created_by_name",
        label: t.users_created,
        accessor: (row) => row.created_by_name,
        width: 200,
        render: (row) => <span className="text-sm text-foreground">{row.created_by_name}</span>,
      },
      {
        id: "created_by_role",
        label: t.users_role,
        accessor: (row) => row.created_by_role,
        width: 170,
        render: (row) => <span className="text-xs text-foreground">{roleLabel(row.created_by_role)}</span>,
      },
      {
        id: "created_at",
        label: text.updatedAt,
        accessor: (row) => row.created_at,
        sortable: true,
        width: 180,
        render: (row) => formatDateTime(row.created_at, locale, t.common_not_set),
      },
    ],
    [
      locale,
      t.common_not_set,
      t.contracts_notes,
      t.invoices_paid,
      t.invoices_paid_at,
      t.providers_service_valid_to,
      t.users_created,
      t.users_role,
      t.users_status,
      text.gross,
      text.lineItemsCount,
      text.updatedAt,
      text.version,
      quoteVersionChangeReasonLabel,
      quoteStatusLabel,
      roleLabel,
    ],
  );

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsError(null);
      try {
        const { patients: patientsResult, orders: ordersResult } =
          await fetchContractsLookups();
        if (ignore) return;
        setPatients(patientsResult);
        setOrders(ordersResult);
      } catch (error) {
        if (ignore) return;
        setOptionsError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setOptionsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      ignore = true;
    };
  }, [t.common_error]);

  useEffect(() => {
    let ignore = false;
    async function loadContracts() {
      setContractsLoading(true);
      setContractsError(null);
      try {
        const data = await fetchContracts(buildContractsPath(contractQuery));
        if (!ignore) setContracts(data);
      } catch (error) {
        if (!ignore) setContractsError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setContractsLoading(false);
      }
    }
    void loadContracts();
    return () => {
      ignore = true;
    };
  }, [contractQuery, contractsReloadToken, t.common_error]);

  useEffect(() => {
    let ignore = false;
    async function loadQuotes() {
      setQuotesLoading(true);
      setQuotesError(null);
      try {
        const data = await fetchQuotes(buildQuotesPath(quoteQuery));
        if (!ignore) setQuotes(data);
      } catch (error) {
        if (!ignore) setQuotesError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setQuotesLoading(false);
      }
    }
    void loadQuotes();
    return () => {
      ignore = true;
    };
  }, [quoteQuery, quotesReloadToken, t.common_error]);

  useEffect(() => {
    let ignore = false;
    async function loadAgencyServices() {
      setAgencyServicesLoading(true);
      setAgencyServicesError(null);
      try {
        const data = await fetchAgencyServices(buildAgencyServicesPath(agencyServiceQuery));
        if (!ignore) setAgencyServices(data);
      } catch (error) {
        if (!ignore) {
          setAgencyServicesError(
            error instanceof Error ? error.message : t.common_error,
          );
        }
      } finally {
        if (!ignore) setAgencyServicesLoading(false);
      }
    }
    void loadAgencyServices();
    return () => {
      ignore = true;
    };
  }, [agencyServiceQuery, agencyServicesReloadToken, t.common_error]);

  useEffect(() => {
    if (!selectedContractId) {
      setContractDetail(null);
      setContractDetailError(null);
      return;
    }
    let ignore = false;
    async function loadContractDetail() {
      setContractDetailLoading(true);
      setContractDetailError(null);
      try {
        const data = await fetchContract(selectedContractId);
        if (ignore) return;
        setContractDetail(data);
        setContractStatusForm(contractToStatusForm(data));
      } catch (error) {
        if (!ignore) {
          setContractDetailError(error instanceof Error ? error.message : t.common_error);
        }
      } finally {
        if (!ignore) setContractDetailLoading(false);
      }
    }
    void loadContractDetail();
    return () => {
      ignore = true;
    };
  }, [selectedContractId, contractsReloadToken, t.common_error]);

  useEffect(() => {
    if (!selectedQuoteId) {
      setQuoteDetail(null);
      setQuoteVersions([]);
      setQuoteDetailError(null);
      setQuoteVersionsError(null);
      return;
    }
    let ignore = false;
    async function loadQuoteDetail() {
      setQuoteDetailLoading(true);
      setQuoteVersionsLoading(true);
      setQuoteDetailError(null);
      setQuoteVersionsError(null);
      try {
        const { quote: data, versions } = await fetchQuoteWorkspace(selectedQuoteId);
        if (ignore) return;
        setQuoteDetail(data);
        setQuoteVersions(versions);
        setQuoteStatusForm(quoteToStatusForm(data));
      } catch (error) {
        if (!ignore) {
          const message = error instanceof Error ? error.message : t.common_error;
          setQuoteDetailError(message);
          setQuoteVersionsError(message);
        }
      } finally {
        if (!ignore) {
          setQuoteDetailLoading(false);
          setQuoteVersionsLoading(false);
        }
      }
    }
    void loadQuoteDetail();
    return () => {
      ignore = true;
    };
  }, [selectedQuoteId, quotesReloadToken, t.common_error]);

  async function handleCreateContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateContractBusy(true);
    setCreateContractError(null);
    try {
      let conditions: Record<string, unknown> | undefined;
      const rawConditions = createContractForm.conditionsText.trim();
      if (rawConditions) {
        conditions = JSON.parse(rawConditions) as Record<string, unknown>;
      }
      const payload = {
        patient_id: createContractForm.patientId,
        status: createContractForm.status,
        valid_from: toOptional(createContractForm.validFrom),
        valid_to: toOptional(createContractForm.validTo),
        signed_at: toOptional(createContractForm.signedAt)
          ? new Date(createContractForm.signedAt).toISOString()
          : null,
        conditions,
      };
      const result = await createContract(payload);
      setCreateContractOpen(false);
      setCreateContractForm(blankContractForm(contractFilters.patientId));
      setContractsReloadToken((current) => current + 1);
      openContract(result.id);
    } catch (error) {
      setCreateContractError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreateContractBusy(false);
    }
  }

  async function handleCreateQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createQuoteForm.orderId) {
      setCreateQuoteError(text.selectOrder);
      return;
    }
    setCreateQuoteBusy(true);
    setCreateQuoteError(null);
    try {
      const result = await createQuote(createQuoteForm.orderId, {
        valid_until: toOptional(createQuoteForm.validUntil),
        notes: toOptional(createQuoteForm.notes),
      });
      setCreateQuoteOpen(false);
      setCreateQuoteForm(blankQuoteForm(quoteFilters.orderId));
      setQuotesReloadToken((current) => current + 1);
      openQuote(result.id);
    } catch (error) {
      setCreateQuoteError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreateQuoteBusy(false);
    }
  }

  async function handleSaveAgencyService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAgencyServiceBusy(true);
    setAgencyServiceFormError(null);
    try {
      const payload = {
        service_key: agencyServiceForm.serviceKey,
        service_name: agencyServiceForm.serviceName,
        description: toOptional(agencyServiceForm.description),
        unit_label: toOptional(agencyServiceForm.unitLabel),
        unit_price: Number(agencyServiceForm.unitPrice),
        currency: toOptional(agencyServiceForm.currency),
        vat_rate: toOptional(agencyServiceForm.vatRate)
          ? Number(agencyServiceForm.vatRate)
          : null,
        is_active: agencyServiceForm.isActive,
        valid_from: agencyServiceForm.validFrom,
        valid_to: toOptional(agencyServiceForm.validTo),
      };

      await saveAgencyService(agencyServiceForm.id, payload);
      setAgencyServiceSheetOpen(false);
      setAgencyServiceForm(blankAgencyServiceForm(t.revenue_unit_default));
      setAgencyServicesReloadToken((current) => current + 1);
    } catch (error) {
      setAgencyServiceFormError(
        error instanceof Error ? error.message : t.common_error,
      );
    } finally {
      setAgencyServiceBusy(false);
    }
  }

  function handleEditAgencyService(service: AgencyServiceItem) {
    setAgencyServiceFormError(null);
    setAgencyServiceForm(agencyServiceToForm(service));
    setAgencyServiceSheetOpen(true);
  }

  function resetAgencyServiceForm() {
    setAgencyServiceFormError(null);
    setAgencyServiceForm(blankAgencyServiceForm(t.revenue_unit_default));
  }

  function openNewAgencyServiceSheet() {
    resetAgencyServiceForm();
    setAgencyServiceSheetOpen(true);
  }

  function closeAgencyServiceSheet() {
    resetAgencyServiceForm();
    setAgencyServiceSheetOpen(false);
  }

  async function handleSaveContractStatus() {
    if (!selectedContractId) return;
    setContractStatusBusy(true);
    setContractStatusError(null);
    try {
      let conditions: Record<string, unknown> | undefined;
      const rawConditions = contractStatusForm.conditionsText.trim();
      if (rawConditions) {
        conditions = JSON.parse(rawConditions) as Record<string, unknown>;
      }
      await updateContractStatus(selectedContractId, {
        status: contractStatusForm.status,
        valid_from: toOptional(contractStatusForm.validFrom),
        valid_to: toOptional(contractStatusForm.validTo),
        signed_at: toOptional(contractStatusForm.signedAt)
          ? new Date(contractStatusForm.signedAt).toISOString()
          : null,
        conditions,
      });
      setContractsReloadToken((current) => current + 1);
    } catch (error) {
      setContractStatusError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setContractStatusBusy(false);
    }
  }

  async function handleSaveQuoteStatus() {
    if (!selectedQuoteId) return;
    setQuoteStatusBusy(true);
    setQuoteStatusError(null);
    try {
      await updateQuoteStatus(selectedQuoteId, {
        status: quoteStatusForm.status,
        paid_amount: toOptional(quoteStatusForm.paidAmount)
          ? Number(quoteStatusForm.paidAmount)
          : null,
        notes: toOptional(quoteStatusForm.notes),
      });
      setQuotesReloadToken((current) => current + 1);
    } catch (error) {
      setQuoteStatusError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setQuoteStatusBusy(false);
    }
  }

  function openContract(contractId: string) {
    setActiveTab("contracts");
    setSelectedQuoteId("");
    setSelectedContractId(contractId);
    syncQuery({ tab: "contracts", contract: contractId, quote: null });
  }

  function openQuote(quoteId: string) {
    setActiveTab("quotes");
    setSelectedContractId("");
    setSelectedQuoteId(quoteId);
    syncQuery({ tab: "quotes", quote: quoteId, contract: null });
  }

  if (!permissions.canViewPage) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-800 shadow-sm">
        {text.accessDenied}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={text.workspaceTitle}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg px-3.5"
                onClick={() => {
                  setContractsReloadToken((current) => current + 1);
                  setQuotesReloadToken((current) => current + 1);
                  setAgencyServicesReloadToken((current) => current + 1);
                }}
              >
                <RefreshCw className="size-4" />
                {text.refresh}
              </Button>
              {permissions.canManageCatalog ? (
                <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={openNewAgencyServiceSheet}>
                  <Plus className="size-4" />
                  {text.newCatalogItem}
                </Button>
              ) : null}
              {permissions.canCreateContract ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg px-3.5"
                  onClick={() => {
                    setCreateContractError(null);
                    setCreateContractForm(blankContractForm(contractFilters.patientId));
                    setCreateContractOpen(true);
                  }}
                >
                  <FileBadge2 className="size-4" />
                  {text.newContract}
                </Button>
              ) : null}
              {permissions.canCreateQuote ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-3.5"
                  onClick={() => {
                    setCreateQuoteError(null);
                    setCreateQuoteForm(blankQuoteForm(quoteFilters.orderId));
                    setCreateQuoteOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {text.newQuote}
                </Button>
              ) : null}
            </>
          }
        />

        <section className="grid overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 md:grid-cols-2 xl:grid-cols-4">
          {contractMetricCard(
            t.contracts_title,
            String(contractStats.total),
            `${contractStats.signed} / ${contractStats.sent} ${text.contractStatsDescription}`,
            ShieldCheck,
          )}
          {contractMetricCard(
            text.quotesTab,
            String(quoteStats.total),
            `${quoteStats.accepted} ${text.quoteStatsDescription}`,
            FileSpreadsheet,
          )}
          {contractMetricCard(
            t.contracts_total,
            formatCurrency(quoteStats.gross),
            t.contracts_subtitle,
            Wallet,
          )}
          {contractMetricCard(
            t.invoices_paid_at,
            formatCurrency(quoteStats.paid),
            t.invoices_subtitle,
            CalendarClock,
            { groupedLast: true },
          )}
        </section>

        {optionsError ? <ShellBanner tone="error">{optionsError}</ShellBanner> : null}

        <AdminTableCard
          title={titleWithDot(text.agencyServiceTitle)}
          description={text.agencyServiceDescription}
          count={agencyServices.length}
          accessory={
            <Badge variant="outline" className="rounded-full">
              {agencyServiceStats.active} / {agencyServiceStats.total}
            </Badge>
          }
        >
          <div className="space-y-4 border-b border-border px-4 py-4">
            <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={agencyServiceFilters.search}
                  onChange={(event) =>
                    startTransition(() =>
                      setAgencyServiceFilters((current) => ({
                        ...current,
                        search: event.target.value,
                      })),
                    )
                  }
                  className={cn(shellInputClassName, "pl-9")}
                  placeholder={text.agencyServiceSearchPlaceholder}
                />
              </div>
              <NativeComboboxSelect
                value={agencyServiceFilters.activeOnly || "__all__"}
                onChange={(event) =>
                  setAgencyServiceFilters((current) => ({
                    ...current,
                    activeOnly:
                      event.target.value && event.target.value !== "__all__"
                        ? event.target.value
                        : "",
                  }))
                }
                className={cn(selectClassName, "w-[180px] min-w-[180px]")}
              >
                <option value="true">{text.activeOnly}</option>
                <option value="__all__">{text.allStatuses}</option>
                <option value="false">{text.inactiveOnly}</option>
              </NativeComboboxSelect>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg px-3.5"
                onClick={() => setAgencyServiceFilters(DEFAULT_AGENCY_SERVICE_FILTERS)}
              >
                {t.access_reset}
              </Button>
            </AdminToolbar>

            <div className="grid gap-3 sm:grid-cols-3">
              <MiniMetric label={text.catalogItems} value={String(agencyServiceStats.total)} />
              <MiniMetric label={text.activeLabel} value={String(agencyServiceStats.active)} />
              <MiniMetric label={text.priced} value={String(agencyServiceStats.priced)} />
            </div>

            {agencyServicesError ? <ShellBanner tone="error">{agencyServicesError}</ShellBanner> : null}
          </div>

          <DataTableSurface
            rows={agencyServices}
            columns={agencyServiceColumns}
            rowId={(row) => row.id}
            defaultDensity="compact"
            dictionary={t as unknown as Record<string, string>}
            loading={agencyServicesLoading}
            activeRowId={agencyServiceForm.id || null}
            onRowClick={permissions.canManageCatalog ? handleEditAgencyService : undefined}
            rowAccent={(row) => {
              if (row.id === agencyServiceForm.id) return "bg-sky-500";
              return row.is_active ? "bg-emerald-500" : "bg-slate-300";
            }}
            emptyState={
              <EmptyState
                title={text.noCatalogItems}
                description={text.noCatalogItemsDescription}
                action={
                  permissions.canManageCatalog ? (
                    <Button type="button" className="h-9 rounded-lg px-3.5" onClick={openNewAgencyServiceSheet}>
                      <Plus className="size-4" />
                      {text.createCatalogItem}
                    </Button>
                  ) : null
                }
              />
            }
          />
        </AdminTableCard>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const next = value as ContractsTab;
            setActiveTab(next);
            syncQuery({
              tab: next,
              contract: next === "contracts" ? selectedContractId : null,
              quote: next === "quotes" ? selectedQuoteId : null,
            });
          }}
          className="gap-4"
        >
          <TabsList className="h-auto rounded-xl border border-border bg-card p-1">
            <TabsTrigger
              value="contracts"
              className="rounded-lg px-3 py-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <span>{text.contractsTab}</span>
              <Badge variant="outline" className="ml-2 rounded-full text-[11px]">
                {contracts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="quotes"
              className="rounded-lg px-3 py-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <span>{text.quotesTab}</span>
              <Badge variant="outline" className="ml-2 rounded-full text-[11px]">
                {quotes.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contracts" className="space-y-4">
            <AdminTableCard title={titleWithDot(text.contractsTab)} description={t.contracts_subtitle} count={contracts.length}>
              <div className="space-y-4 border-b border-border px-4 py-4">
                <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={contractFilters.search}
                      onChange={(event) =>
                        startTransition(() =>
                          setContractFilters((current) => ({ ...current, search: event.target.value })),
                        )
                      }
                      className={cn(shellInputClassName, "pl-9")}
                      placeholder={t.common_search}
                    />
                  </div>
                  <NativeComboboxSelect
                    value={contractFilters.patientId || "__all__"}
                    onChange={(event) => {
                      const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                      setContractFilters((current) => ({ ...current, patientId }));
                      syncQuery({ patient: patientId || null });
                    }}
                    className={cn(selectClassName, "w-[260px] min-w-[260px]")}
                  >
                    <option value="__all__">
                      {t.revenue_filter_all_patients}
                    </option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patientOptionLabel(patient)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  <NativeComboboxSelect
                    value={contractFilters.status || "__all__"}
                    onChange={(event) =>
                      setContractFilters((current) => ({
                        ...current,
                        status:
                          event.target.value && event.target.value !== "__all__"
                            ? event.target.value
                            : "",
                      }))
                    }
                    className={cn(selectClassName, "w-[180px] min-w-[180px]")}
                  >
                    <option value="__all__">{t.providers_all}</option>
                    {CONTRACT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {contractStatusLabel(status)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3.5"
                    onClick={() => {
                      setContractFilters({
                        ...DEFAULT_CONTRACT_FILTERS,
                        patientId: searchParams.get("patient") ?? "",
                      });
                    }}
                  >
                    {t.access_reset}
                  </Button>
                </AdminToolbar>
                {contractsError ? <ShellBanner tone="error">{contractsError}</ShellBanner> : null}
              </div>

              <DataTableSurface
                rows={contracts}
                columns={contractTableColumns}
                rowId={(row) => row.id}
                defaultDensity="compact"
                dictionary={t as unknown as Record<string, string>}
                loading={contractsLoading}
                activeRowId={selectedContractId || null}
                onRowClick={(row) => openContract(row.id)}
                rowAccent={(row) => (row.id === selectedContractId ? "bg-sky-500" : null)}
                emptyState={
                  <EmptyState
                    title={t.common_not_set}
                    description={t.contracts_subtitle}
                    action={
                      permissions.canCreateContract ? (
                        <Button
                          type="button"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() => {
                            setCreateContractError(null);
                            setCreateContractForm(blankContractForm(contractFilters.patientId));
                            setCreateContractOpen(true);
                          }}
                        >
                          <Plus className="size-4" />
                          {text.createContract}
                        </Button>
                      ) : null
                    }
                  />
                }
              />
            </AdminTableCard>
          </TabsContent>

          <TabsContent value="quotes" className="space-y-4">
            <AdminTableCard title={titleWithDot(text.quotesTab)} description={t.contracts_subtitle} count={quotes.length}>
              <div className="space-y-4 border-b border-border px-4 py-4">
                <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
                  <div className="relative min-w-[240px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={quoteFilters.search}
                      onChange={(event) =>
                        startTransition(() =>
                          setQuoteFilters((current) => ({ ...current, search: event.target.value })),
                        )
                      }
                      className={cn(shellInputClassName, "pl-9")}
                      placeholder={t.common_search}
                    />
                  </div>
                  <NativeComboboxSelect
                    value={quoteFilters.patientId || "__all__"}
                    onChange={(event) => {
                      const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                      setQuoteFilters((current) => ({
                        ...current,
                        patientId,
                        orderId:
                          patientId &&
                          current.orderId &&
                          orders.some((order) => order.id === current.orderId && order.patient_id === patientId)
                            ? current.orderId
                            : patientId
                              ? ""
                              : current.orderId,
                      }));
                      syncQuery({ patient: patientId || null, order: null });
                    }}
                    className={cn(selectClassName, "w-[260px] min-w-[260px]")}
                  >
                    <option value="__all__">
                      {t.revenue_filter_all_patients}
                    </option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patientOptionLabel(patient)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  <NativeComboboxSelect
                    value={quoteFilters.orderId || "__all__"}
                    onChange={(event) => {
                      const orderId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                      setQuoteFilters((current) => ({ ...current, orderId }));
                      syncQuery({ order: orderId || null });
                    }}
                    className={cn(selectClassName, "w-[260px] min-w-[260px]")}
                  >
                    <option value="__all__">
                      {t.revenue_filter_all_orders}
                    </option>
                    {filteredOrderOptions.map((order) => (
                      <option key={order.id} value={order.id}>
                        {orderOptionLabel(order)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  <NativeComboboxSelect
                    value={quoteFilters.status || "__all__"}
                    onChange={(event) =>
                      setQuoteFilters((current) => ({
                        ...current,
                        status:
                          event.target.value && event.target.value !== "__all__"
                            ? event.target.value
                            : "",
                      }))
                    }
                    className={cn(selectClassName, "w-[180px] min-w-[180px]")}
                  >
                    <option value="__all__">{t.providers_all}</option>
                    {QUOTE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {quoteStatusLabel(status)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3.5"
                    onClick={() => {
                      setQuoteFilters({
                        ...DEFAULT_QUOTE_FILTERS,
                        patientId: searchParams.get("patient") ?? "",
                        orderId: searchParams.get("order") ?? "",
                      });
                    }}
                  >
                    {t.access_reset}
                  </Button>
                </AdminToolbar>
                {quotesError ? <ShellBanner tone="error">{quotesError}</ShellBanner> : null}
              </div>

              <DataTableSurface
                rows={quotes}
                columns={quoteTableColumns}
                rowId={(row) => row.id}
                defaultDensity="compact"
                dictionary={t as unknown as Record<string, string>}
                loading={quotesLoading}
                activeRowId={selectedQuoteId || null}
                onRowClick={(row) => openQuote(row.id)}
                rowAccent={(row) => (row.id === selectedQuoteId ? "bg-sky-500" : null)}
                emptyState={
                  <EmptyState
                    title={t.common_not_set}
                    description={t.contracts_subtitle}
                    action={
                      permissions.canCreateQuote ? (
                        <Button
                          type="button"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() => {
                            setCreateQuoteError(null);
                            setCreateQuoteForm(blankQuoteForm(quoteFilters.orderId));
                            setCreateQuoteOpen(true);
                          }}
                        >
                          <Plus className="size-4" />
                          {text.createQuote}
                        </Button>
                      ) : null
                    }
                  />
                }
              />
            </AdminTableCard>
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={agencyServiceSheetOpen} onOpenChange={(open) => (!open ? closeAgencyServiceSheet() : setAgencyServiceSheetOpen(true))}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full flex-col" onSubmit={handleSaveAgencyService}>
            <AdminSheetScaffold
              title={agencyServiceForm.id ? text.editCatalogItem : text.newCatalogItem}
              description={text.catalogHelp}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={agencyServiceForm.id ? text.saveCatalogItem : text.createCatalogItem}
                  submitting={agencyServiceBusy}
                  onCancel={closeAgencyServiceSheet}
                />
              }
            >
              {agencyServiceFormError ? <ShellBanner tone="error">{agencyServiceFormError}</ShellBanner> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={text.serviceKey}>
                  <Input
                    required
                    className={shellInputClassName}
                    value={agencyServiceForm.serviceKey}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, serviceKey: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.serviceName}>
                  <Input
                    required
                    className={shellInputClassName}
                    value={agencyServiceForm.serviceName}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, serviceName: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.unitLabel}>
                  <Input
                    className={shellInputClassName}
                    value={agencyServiceForm.unitLabel}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, unitLabel: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.currency}>
                  <Input
                    className={shellInputClassName}
                    value={agencyServiceForm.currency}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, currency: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.unitPrice}>
                  <Input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    className={shellInputClassName}
                    value={agencyServiceForm.unitPrice}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, unitPrice: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.vatPercent}>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className={shellInputClassName}
                    value={agencyServiceForm.vatRate}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, vatRate: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.providers_service_valid_from}>
                  <Input
                    required
                    type="date"
                    className={shellInputClassName}
                    value={agencyServiceForm.validFrom}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, validFrom: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.providers_service_valid_to}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={agencyServiceForm.validTo}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, validTo: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.description} className="sm:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={agencyServiceForm.description}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </Field>
                <label
                  className={cn(
                    "sm:col-span-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground",
                    tokens.surface.mutedCard,
                  )}
                >
                  <input
                    type="checkbox"
                    checked={agencyServiceForm.isActive}
                    onChange={(event) =>
                      setAgencyServiceForm((current) => ({ ...current, isActive: event.target.checked }))
                    }
                    className={checkboxClass}
                  />
                  {text.itemIsActive}
                </label>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={createContractOpen} onOpenChange={setCreateContractOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full flex-col" onSubmit={handleCreateContract}>
            <AdminSheetScaffold
              title={text.newContract}
              description={text.createContractDescription}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={text.createContract}
                  submitting={createContractBusy}
                  onCancel={() => setCreateContractOpen(false)}
                />
              }
            >
              {createContractError ? <ShellBanner tone="error">{createContractError}</ShellBanner> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.contracts_patient}>
                  <NativeComboboxSelect
                    value={createContractForm.patientId || "__empty__"}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({
                        ...current,
                        patientId:
                          event.target.value && event.target.value !== "__empty__"
                            ? event.target.value
                            : "",
                      }))
                    }
                    className={selectClassName}
                  >
                    <option value="__empty__">{text.selectPatient}</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patientOptionLabel(patient)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field label={t.users_status}>
                  <NativeComboboxSelect
                    value={createContractForm.status}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({
                        ...current,
                        status: event.target.value as ContractStatus,
                      }))
                    }
                    className={selectClassName}
                  >
                    {CONTRACT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {contractStatusLabel(status)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field label={t.providers_service_valid_from}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={createContractForm.validFrom}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({ ...current, validFrom: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.providers_service_valid_to}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={createContractForm.validTo}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({ ...current, validTo: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.contracts_signed_at} className="sm:col-span-2">
                  <Input
                    type="datetime-local"
                    className={shellInputClassName}
                    value={createContractForm.signedAt}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({ ...current, signedAt: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.contracts_notes} className="sm:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={createContractForm.conditionsText}
                    onChange={(event) =>
                      setCreateContractForm((current) => ({
                        ...current,
                        conditionsText: event.target.value,
                      }))
                    }
                    placeholder='{"language":"de","jurisdiction":"DE"}'
                  />
                </Field>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={createQuoteOpen} onOpenChange={setCreateQuoteOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full flex-col" onSubmit={handleCreateQuote}>
            <AdminSheetScaffold
              title={text.newQuote}
              description={text.createQuoteDescription}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={text.createQuote}
                  submitting={createQuoteBusy}
                  submitDisabled={!createQuoteForm.orderId}
                  onCancel={() => setCreateQuoteOpen(false)}
                />
              }
            >
              {createQuoteError ? <ShellBanner tone="error">{createQuoteError}</ShellBanner> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.orders_title} className="sm:col-span-2">
                  <NativeComboboxSelect
                    value={createQuoteForm.orderId || "__empty__"}
                    onChange={(event) =>
                      setCreateQuoteForm((current) => ({
                        ...current,
                        orderId:
                          event.target.value && event.target.value !== "__empty__"
                            ? event.target.value
                            : "",
                      }))
                    }
                    disabled={optionsLoading}
                    className={selectClassName}
                  >
                    <option value="__empty__">
                      {optionsLoading ? text.loadingOrders : text.selectOrder}
                    </option>
                    {filteredOrderOptions.map((order) => (
                      <option key={order.id} value={order.id}>
                        {orderOptionLabel(order)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field label={t.providers_service_valid_to}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={createQuoteForm.validUntil}
                    onChange={(event) =>
                      setCreateQuoteForm((current) => ({ ...current, validUntil: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t.orders_title}>
                  <Input
                    readOnly
                    className={cn(shellInputClassName, !selectedCreateOrder && "text-muted-foreground")}
                    value={
                      selectedCreateOrder
                        ? `${selectedCreateOrder.order_number} - ${selectedCreateOrder.patient_pid} - ${formatCurrency(selectedCreateOrder.total_estimated)}`
                        : text.chooseOrder
                    }
                  />
                </Field>
                <Field label={t.contracts_notes} className="sm:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={createQuoteForm.notes}
                    onChange={(event) =>
                      setCreateQuoteForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder={t.patients_notes}
                  />
                </Field>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(selectedContractId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedContractId("");
            setContractDetail(null);
            setContractDetailError(null);
            syncQuery({ contract: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={contractDetail ? `${contractDetail.contract_number} / ${contractDetail.patient_name}` : t.contracts_framework}
            description={text.contractSheetDescription}
          >
            {contractDetailLoading ? (
              <LoadingState label={t.common_loading} />
            ) : contractDetailError ? (
              <ShellBanner tone="error">{contractDetailError}</ShellBanner>
            ) : !contractDetail ? (
              <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
            ) : (
              <>
                <AdminTableCard
                  title={titleWithDot(t.contracts_title)}
                  description={text.contractOverviewDescription}
                  accessory={
                    <Badge variant="outline" className={cn("rounded-full", contractStatusClassName(contractDetail.status))}>
                      {contractStatusLabel(contractDetail.status)}
                    </Badge>
                  }
                >
                  <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.contracts_patient} value={`${contractDetail.patient_name} (${contractDetail.patient_pid})`} />
                    <DetailField label={t.patients_created} value={formatDateTime(contractDetail.created_at, locale, t.common_not_set)} />
                    <DetailField label={text.updatedAt} value={formatDateTime(contractDetail.updated_at, locale, t.common_not_set)} />
                    <DetailField label={t.contracts_signed_at} value={formatDateTime(contractDetail.signed_at, locale, t.common_not_set)} />
                    <DetailField label={t.providers_service_valid_from} value={formatDate(contractDetail.valid_from, locale, t.common_not_set)} />
                    <DetailField label={t.providers_service_valid_to} value={formatDate(contractDetail.valid_to, locale, t.common_not_set)} />
                    <DetailField
                      label={t.contracts_notes}
                      value={
                        contractDetail.conditions && Object.keys(contractDetail.conditions).length > 0
                          ? JSON.stringify(contractDetail.conditions, null, 2)
                          : t.common_not_set
                      }
                    />
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(t.providers_linked_patients)} description={text.linkedContractDescription}>
                  <div className="flex flex-wrap gap-2 p-4">
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/patients?patient=${contractDetail.patient_id}`)}>
                      {t.contracts_patient}
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/orders?patient=${contractDetail.patient_id}`)}>
                      {text.orders}
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/documents?patient=${contractDetail.patient_id}`)}>
                      {text.documents}
                    </Button>
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(t.contracts_status)} description={t.contracts_subtitle}>
                  <div className="space-y-4 p-4">
                    {contractStatusError ? <ShellBanner tone="error">{contractStatusError}</ShellBanner> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t.users_status}>
                        <NativeComboboxSelect
                          value={contractStatusForm.status}
                          onChange={(event) =>
                            setContractStatusForm((current) => ({
                              ...current,
                              status: event.target.value as ContractStatus,
                            }))
                          }
                          className={selectClassName}
                        >
                          {CONTRACT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {contractStatusLabel(status)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </Field>
                      <Field label={t.contracts_signed_at}>
                        <Input
                          type="datetime-local"
                          className={shellInputClassName}
                          value={contractStatusForm.signedAt}
                          onChange={(event) =>
                            setContractStatusForm((current) => ({ ...current, signedAt: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t.providers_service_valid_from}>
                        <Input
                          type="date"
                          className={shellInputClassName}
                          value={contractStatusForm.validFrom}
                          onChange={(event) =>
                            setContractStatusForm((current) => ({ ...current, validFrom: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t.providers_service_valid_to}>
                        <Input
                          type="date"
                          className={shellInputClassName}
                          value={contractStatusForm.validTo}
                          onChange={(event) =>
                            setContractStatusForm((current) => ({ ...current, validTo: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t.contracts_notes} className="sm:col-span-2">
                        <textarea
                          className={textareaClassName}
                          value={contractStatusForm.conditionsText}
                          onChange={(event) =>
                            setContractStatusForm((current) => ({
                              ...current,
                              conditionsText: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <SheetActionsFooter>
                      <Button
                        type="button"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() => void handleSaveContractStatus()}
                        disabled={contractStatusBusy || !permissions.canManageContract}
                      >
                        {contractStatusBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {text.saveContract}
                      </Button>
                    </SheetActionsFooter>
                  </div>
                </AdminTableCard>
              </>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(selectedQuoteId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedQuoteId("");
            setQuoteDetail(null);
            setQuoteDetailError(null);
            syncQuery({ quote: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={quoteDetail ? `${quoteDetail.quote_number} / ${quoteDetail.patient_name}` : text.quotesTab}
            description={text.quoteSheetDescription}
          >
            {quoteDetailLoading ? (
              <LoadingState label={t.common_loading} />
            ) : quoteDetailError ? (
              <ShellBanner tone="error">{quoteDetailError}</ShellBanner>
            ) : !quoteDetail ? (
              <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
            ) : (
              <>
                <AdminTableCard
                  title={titleWithDot(text.quotesTab)}
                  description={text.quoteOverviewDescription}
                  accessory={
                    <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(quoteDetail.status))}>
                      {quoteStatusLabel(quoteDetail.status)}
                    </Badge>
                  }
                >
                  <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.contracts_patient} value={`${quoteDetail.patient_name} (${quoteDetail.patient_pid})`} />
                    <DetailField label={t.orders_title} value={quoteDetail.order_number} />
                    <DetailField label={t.providers_service_valid_to} value={formatDate(quoteDetail.valid_until, locale, t.common_not_set)} />
                    <DetailField label={t.invoices_paid_at} value={formatDateTime(quoteDetail.paid_at, locale, t.common_not_set)} />
                    <DetailField label={t.invoices_subtotal} value={formatCurrency(quoteDetail.total_net)} />
                    <DetailField label={text.vatTotal} value={formatCurrency(quoteDetail.total_vat)} />
                    <DetailField label={text.grossTotal} value={formatCurrency(quoteDetail.total_gross)} />
                    <DetailField label={t.invoices_paid} value={formatCurrency(quoteDetail.paid_amount)} />
                    <DetailField
                      label={text.snapshotVersion}
                      value={
                        quoteDetail.current_version_number
                          ? `${quoteDetail.current_version_number} / ${quoteDetail.version_count ?? quoteDetail.current_version_number}`
                          : "0"
                      }
                    />
                    <DetailField label={t.contracts_notes} value={quoteDetail.notes || t.common_not_set} />
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(t.providers_linked_patients)} description={text.linkedQuoteDescription}>
                  <div className="flex flex-wrap gap-2 p-4">
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/patients?patient=${quoteDetail.patient_id}`)}>
                      {t.contracts_patient}
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/orders?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>
                      {text.order}
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/invoices?quote=${quoteDetail.id}&order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>
                      {text.invoices}
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={() => staffGo(`/documents?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>
                      {text.documents}
                    </Button>
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.quoteLifecycle)} description={text.quoteLifecycleDescription}>
                  <div className="space-y-4 p-4">
                    {quoteStatusError ? <ShellBanner tone="error">{quoteStatusError}</ShellBanner> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t.users_status}>
                        <NativeComboboxSelect
                          value={quoteStatusForm.status}
                          onChange={(event) =>
                            setQuoteStatusForm((current) => ({
                              ...current,
                              status: event.target.value as QuoteStatus,
                            }))
                          }
                          className={selectClassName}
                        >
                          {QUOTE_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {quoteStatusLabel(status)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </Field>
                      <Field label={t.invoices_paid_at}>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={shellInputClassName}
                          value={quoteStatusForm.paidAmount}
                          onChange={(event) =>
                            setQuoteStatusForm((current) => ({ ...current, paidAmount: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t.contracts_notes} className="sm:col-span-2">
                        <textarea
                          className={textareaClassName}
                          value={quoteStatusForm.notes}
                          onChange={(event) =>
                            setQuoteStatusForm((current) => ({ ...current, notes: event.target.value }))
                          }
                        />
                      </Field>
                    </div>
                    <SheetActionsFooter>
                      <Button
                        type="button"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() => void handleSaveQuoteStatus()}
                        disabled={quoteStatusBusy || !permissions.canManageQuote}
                      >
                        {quoteStatusBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {text.saveQuote}
                      </Button>
                    </SheetActionsFooter>
                  </div>
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.lineItems)} description={text.lineItemsDescription}>
                  <DataTableSurface
                    rows={quoteLineItemRows}
                    columns={quoteLineItemColumns}
                    rowId={(row) => row.id}
                    defaultDensity="compact"
                    dictionary={t as unknown as Record<string, string>}
                    rowAccent={(row) => (row.is_cost_passthrough ? "bg-amber-500" : null)}
                    emptyState={<EmptyState title={text.noLineItems} description={text.noLineItemsDescription} />}
                  />
                </AdminTableCard>

                <AdminTableCard title={titleWithDot(text.versionHistory)} description={text.versionHistoryDescription}>
                  {quoteVersionsError ? <div className="p-4"><ShellBanner tone="error">{quoteVersionsError}</ShellBanner></div> : null}
                  <DataTableSurface
                    rows={quoteVersions}
                    columns={quoteVersionColumns}
                    rowId={(row) => row.id}
                    defaultDensity="compact"
                    dictionary={t as unknown as Record<string, string>}
                    loading={quoteVersionsLoading}
                    emptyState={<EmptyState title={text.noVersions} description={text.noVersionsDescription} />}
                  />
                </AdminTableCard>
              </>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  const rendered =
    typeof value === "string" && value.includes("{") && value.includes("}")
      ? (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-foreground">
            {value}
          </pre>
        )
      : (
          <div className="text-sm text-foreground">{value}</div>
        );

  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2">{rendered}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
      <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
