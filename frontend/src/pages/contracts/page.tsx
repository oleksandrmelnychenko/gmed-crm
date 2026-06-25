import {
  startTransition,
  useCallback,
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
  ArrowUpRight,
  FileBadge2,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AdminSheetScaffold,
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
import { clearApiCache } from "@/lib/api";
import { deNormalize } from "@/components/data-table/search";
import {
  agencyServiceDescriptionLabel,
  agencyServiceNameLabel,
  agencyServiceUnitLabel,
} from "@/lib/agency-service-labels";
import { useAuth } from "@/lib/auth";
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
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
  contractActionErrorMessage,
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
  validateContractStatusForm,
  validateCreateContractForm,
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
const CONTRACT_SEARCH_DEBOUNCE_MS = 220;

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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => globalThis.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function ContractSummaryLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span className="max-w-[48%] text-right text-sm font-semibold leading-tight text-foreground">{value}</span>
    </div>
  );
}

interface ContractsWorkspaceState {
  contracts: ContractItem[];
  quotes: QuoteItem[];
  agencyServices: AgencyServiceItem[];
  patients: PatientOption[];
  orders: OrderOption[];
  contractsLoading: boolean;
  quotesLoading: boolean;
  agencyServicesLoading: boolean;
  optionsLoading: boolean;
  contractsError: string | null;
  quotesError: string | null;
  agencyServicesError: string | null;
  optionsError: string | null;
  selectedContractId: string;
  selectedQuoteId: string;
  contractDetail: ContractItem | null;
  quoteDetail: QuoteItem | null;
  quoteVersions: QuoteVersionItem[];
  contractDetailLoading: boolean;
  quoteDetailLoading: boolean;
  quoteVersionsLoading: boolean;
  contractDetailError: string | null;
  quoteDetailError: string | null;
  quoteVersionsError: string | null;
  contractsReloadToken: number;
  quotesReloadToken: number;
  agencyServicesReloadToken: number;
}

interface ContractsUiState {
  contractFilters: ContractFilters;
  quoteFilters: QuoteFilters;
  agencyServiceSheetOpen: boolean;
  createContractOpen: boolean;
  createQuoteOpen: boolean;
  createContractForm: ContractFormState;
  createQuoteForm: QuoteFormState;
  createContractBusy: boolean;
  createQuoteBusy: boolean;
  createContractError: string | null;
  createQuoteError: string | null;
  agencyServiceFilters: AgencyServiceFilters;
  agencyServiceForm: AgencyServiceFormState;
  agencyServiceBusy: boolean;
  agencyServiceFormError: string | null;
  contractStatusForm: ContractStatusFormState;
  quoteStatusForm: QuoteStatusFormState;
  contractStatusBusy: boolean;
  quoteStatusBusy: boolean;
  contractStatusError: string | null;
  quoteStatusError: string | null;
}

type ContractsWorkspaceAction =
  | Partial<ContractsWorkspaceState>
  | ((current: ContractsWorkspaceState) => Partial<ContractsWorkspaceState>);

type ContractsUiAction =
  | Partial<ContractsUiState>
  | ((current: ContractsUiState) => Partial<ContractsUiState>);

function contractsWorkspaceReducer(
  current: ContractsWorkspaceState,
  action: ContractsWorkspaceAction,
): ContractsWorkspaceState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function contractsUiReducer(
  current: ContractsUiState,
  action: ContractsUiAction,
): ContractsUiState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function resolveStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createContractsUiFieldPatch<K extends keyof ContractsUiState>(
  field: K,
  nextValue: SetStateAction<ContractsUiState[K]>,
): ContractsUiAction {
  return (current) => ({
    [field]: resolveStateAction(nextValue, current[field]),
  } as Partial<ContractsUiState>);
}

function useContractsPageContent() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
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
      patientId: t.revenue_common_patient_id,
      basicData: t.revenue_common_basic_data,
      validityPeriod: t.revenue_common_validity_period,
      pricing: t.finance_catalog_package_pricing,
      description: t.revenue_agency_service_description_label,
      descriptionStatus: t.revenue_agency_service_description_status,
      itemIsActive: t.revenue_agency_service_active_hint,
      saveCatalogItem: t.revenue_agency_service_save,
      createCatalogItem: t.revenue_agency_service_create,
      contractPatientStatus: t.revenue_contracts_section_patient_status,
      contractDates: t.revenue_contracts_section_contract_dates,
      contractConditions: t.revenue_contracts_section_conditions,
      contractLinkedPatientCard: t.revenue_contracts_linked_patient_card_description,
      contractLinkedOrdersCard: t.revenue_contracts_linked_orders_card_description,
      contractLinkedDocumentsCard: t.revenue_contracts_linked_documents_card_description,
      createContractDescription: t.revenue_contracts_create_description,
      selectPatient: t.revenue_contracts_select_patient,
      createContract: t.revenue_contracts_create,
      quoteOrderSection: t.revenue_quotes_section_order,
      quoteNotesSection: t.revenue_quotes_section_notes,
      quoteLinkedPatientCard: t.revenue_quotes_linked_patient_card_description,
      quoteLinkedOrderCard: t.revenue_quotes_linked_order_card_description,
      quoteLinkedInvoicesCard: t.revenue_quotes_linked_invoices_card_description,
      quoteLinkedDocumentsCard: t.revenue_quotes_linked_documents_card_description,
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

  const initialPatientId = searchParams.get("patient") ?? "";
  const initialOrderId = searchParams.get("order") ?? "";
  const initialContractId = searchParams.get("contract") ?? "";
  const initialQuoteId = searchParams.get("quote") ?? "";

  const [contractsUiState, dispatchContractsUiState] = useReducer(
    contractsUiReducer,
    undefined,
    (): ContractsUiState => ({
      contractFilters: {
        ...DEFAULT_CONTRACT_FILTERS,
        patientId: initialPatientId,
      },
      quoteFilters: {
        ...DEFAULT_QUOTE_FILTERS,
        patientId: initialPatientId,
        orderId: initialOrderId,
      },
      agencyServiceSheetOpen: false,
      createContractOpen: false,
      createQuoteOpen: false,
      createContractForm: blankContractForm(initialPatientId),
      createQuoteForm: blankQuoteForm(initialOrderId),
      createContractBusy: false,
      createQuoteBusy: false,
      createContractError: null,
      createQuoteError: null,
      agencyServiceFilters: DEFAULT_AGENCY_SERVICE_FILTERS,
      agencyServiceForm: blankAgencyServiceForm(t.revenue_unit_default),
      agencyServiceBusy: false,
      agencyServiceFormError: null,
      contractStatusForm: contractToStatusForm({
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
      quoteStatusForm: {
        status: "draft",
        paidAmount: "",
        notes: "",
      },
      contractStatusBusy: false,
      quoteStatusBusy: false,
      contractStatusError: null,
      quoteStatusError: null,
    }),
  );
  const {
    agencyServiceBusy,
    agencyServiceFilters,
    agencyServiceForm,
    agencyServiceFormError,
    agencyServiceSheetOpen,
    contractFilters,
    contractStatusBusy,
    contractStatusError,
    contractStatusForm,
    createContractBusy,
    createContractError,
    createContractForm,
    createContractOpen,
    createQuoteBusy,
    createQuoteError,
    createQuoteForm,
    createQuoteOpen,
    quoteFilters,
    quoteStatusBusy,
    quoteStatusError,
    quoteStatusForm,
  } = contractsUiState;
  const setContractsUiField = <K extends keyof ContractsUiState>(
    field: K,
    nextValue: SetStateAction<ContractsUiState[K]>,
  ) => dispatchContractsUiState(createContractsUiFieldPatch(field, nextValue));
  const setContractFilters = (nextValue: SetStateAction<ContractFilters>) =>
    setContractsUiField("contractFilters", nextValue);
  const setQuoteFilters = (nextValue: SetStateAction<QuoteFilters>) =>
    setContractsUiField("quoteFilters", nextValue);
  const [contractsWorkspaceState, dispatchContractsWorkspaceState] = useReducer(
    contractsWorkspaceReducer,
    {
      contracts: [],
      quotes: [],
      agencyServices: [],
      patients: [],
      orders: [],
      contractsLoading: false,
      quotesLoading: false,
      agencyServicesLoading: false,
      optionsLoading: false,
      contractsError: null,
      quotesError: null,
      agencyServicesError: null,
      optionsError: null,
      selectedContractId: initialContractId,
      selectedQuoteId: initialQuoteId,
      contractDetail: null,
      quoteDetail: null,
      quoteVersions: [],
      contractDetailLoading: false,
      quoteDetailLoading: false,
      quoteVersionsLoading: false,
      contractDetailError: null,
      quoteDetailError: null,
      quoteVersionsError: null,
      contractsReloadToken: 0,
      quotesReloadToken: 0,
      agencyServicesReloadToken: 0,
    },
  );
  const {
    agencyServices,
    agencyServicesError,
    agencyServicesLoading,
    agencyServicesReloadToken,
    contractDetail,
    contractDetailError,
    contractDetailLoading,
    contracts,
    contractsError,
    contractsLoading,
    contractsReloadToken,
    optionsError,
    optionsLoading,
    orders,
    patients,
    quoteDetail,
    quoteDetailError,
    quoteDetailLoading,
    quoteVersions,
    quoteVersionsError,
    quoteVersionsLoading,
    quotes,
    quotesError,
    quotesLoading,
    quotesReloadToken,
    selectedContractId,
    selectedQuoteId,
  } = contractsWorkspaceState;
  const setContracts = (nextValue: SetStateAction<ContractItem[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      contracts: resolveStateAction(nextValue, current.contracts),
    }));
  const setQuotes = (nextValue: SetStateAction<QuoteItem[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      quotes: resolveStateAction(nextValue, current.quotes),
    }));
  const setAgencyServices = (nextValue: SetStateAction<AgencyServiceItem[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      agencyServices: resolveStateAction(nextValue, current.agencyServices),
    }));
  const setPatients = (nextValue: SetStateAction<PatientOption[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      patients: resolveStateAction(nextValue, current.patients),
    }));
  const setOrders = (nextValue: SetStateAction<OrderOption[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      orders: resolveStateAction(nextValue, current.orders),
    }));
  const setContractsLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractsLoading: resolveStateAction(nextValue, current.contractsLoading),
    }));
  const setQuotesLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      quotesLoading: resolveStateAction(nextValue, current.quotesLoading),
    }));
  const setAgencyServicesLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      agencyServicesLoading: resolveStateAction(nextValue, current.agencyServicesLoading),
    }));
  const setOptionsLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      optionsLoading: resolveStateAction(nextValue, current.optionsLoading),
    }));
  const setContractsError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractsError: resolveStateAction(nextValue, current.contractsError),
    }));
  const setQuotesError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      quotesError: resolveStateAction(nextValue, current.quotesError),
    }));
  const setAgencyServicesError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      agencyServicesError: resolveStateAction(nextValue, current.agencyServicesError),
    }));
  const setOptionsError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      optionsError: resolveStateAction(nextValue, current.optionsError),
    }));
  const setSelectedContractId = (nextValue: SetStateAction<string>) =>
    dispatchContractsWorkspaceState((current) => ({
      selectedContractId: resolveStateAction(nextValue, current.selectedContractId),
    }));
  const setSelectedQuoteId = (nextValue: SetStateAction<string>) =>
    dispatchContractsWorkspaceState((current) => ({
      selectedQuoteId: resolveStateAction(nextValue, current.selectedQuoteId),
    }));
  const setContractDetail = (nextValue: SetStateAction<ContractItem | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractDetail: resolveStateAction(nextValue, current.contractDetail),
    }));
  const setQuoteDetail = (nextValue: SetStateAction<QuoteItem | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteDetail: resolveStateAction(nextValue, current.quoteDetail),
    }));
  const setQuoteVersions = (nextValue: SetStateAction<QuoteVersionItem[]>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteVersions: resolveStateAction(nextValue, current.quoteVersions),
    }));
  const setContractDetailLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractDetailLoading: resolveStateAction(nextValue, current.contractDetailLoading),
    }));
  const setQuoteDetailLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteDetailLoading: resolveStateAction(nextValue, current.quoteDetailLoading),
    }));
  const setQuoteVersionsLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteVersionsLoading: resolveStateAction(nextValue, current.quoteVersionsLoading),
    }));
  const setContractDetailError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractDetailError: resolveStateAction(nextValue, current.contractDetailError),
    }));
  const setQuoteDetailError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteDetailError: resolveStateAction(nextValue, current.quoteDetailError),
    }));
  const setQuoteVersionsError = (nextValue: SetStateAction<string | null>) =>
    dispatchContractsWorkspaceState((current) => ({
      quoteVersionsError: resolveStateAction(nextValue, current.quoteVersionsError),
    }));
  const setContractsReloadToken = (nextValue: SetStateAction<number>) =>
    dispatchContractsWorkspaceState((current) => ({
      contractsReloadToken: resolveStateAction(nextValue, current.contractsReloadToken),
    }));
  const setQuotesReloadToken = (nextValue: SetStateAction<number>) =>
    dispatchContractsWorkspaceState((current) => ({
      quotesReloadToken: resolveStateAction(nextValue, current.quotesReloadToken),
    }));
  const setAgencyServicesReloadToken = (nextValue: SetStateAction<number>) =>
    dispatchContractsWorkspaceState((current) => ({
      agencyServicesReloadToken: resolveStateAction(nextValue, current.agencyServicesReloadToken),
    }));
  const setAgencyServiceSheetOpen = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("agencyServiceSheetOpen", nextValue);
  const setCreateContractOpen = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("createContractOpen", nextValue);
  const setCreateQuoteOpen = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("createQuoteOpen", nextValue);
  const setCreateContractForm = (
    nextValue: SetStateAction<ContractFormState>,
  ) => setContractsUiField("createContractForm", nextValue);
  const setCreateQuoteForm = (nextValue: SetStateAction<QuoteFormState>) =>
    setContractsUiField("createQuoteForm", nextValue);
  const setCreateContractBusy = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("createContractBusy", nextValue);
  const setCreateQuoteBusy = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("createQuoteBusy", nextValue);
  const setCreateContractError = (
    nextValue: SetStateAction<string | null>,
  ) => setContractsUiField("createContractError", nextValue);
  const setCreateQuoteError = (nextValue: SetStateAction<string | null>) =>
    setContractsUiField("createQuoteError", nextValue);
  const setAgencyServiceFilters = (
    nextValue: SetStateAction<AgencyServiceFilters>,
  ) => setContractsUiField("agencyServiceFilters", nextValue);
  const setAgencyServiceForm = (
    nextValue: SetStateAction<AgencyServiceFormState>,
  ) => setContractsUiField("agencyServiceForm", nextValue);
  const setAgencyServiceBusy = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("agencyServiceBusy", nextValue);
  const setAgencyServiceFormError = (
    nextValue: SetStateAction<string | null>,
  ) => setContractsUiField("agencyServiceFormError", nextValue);
  const setContractStatusForm = (
    nextValue: SetStateAction<ContractStatusFormState>,
  ) => setContractsUiField("contractStatusForm", nextValue);
  const setQuoteStatusForm = (
    nextValue: SetStateAction<QuoteStatusFormState>,
  ) => setContractsUiField("quoteStatusForm", nextValue);
  const setContractStatusBusy = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("contractStatusBusy", nextValue);
  const setQuoteStatusBusy = (nextValue: SetStateAction<boolean>) =>
    setContractsUiField("quoteStatusBusy", nextValue);
  const setContractStatusError = (
    nextValue: SetStateAction<string | null>,
  ) => setContractsUiField("contractStatusError", nextValue);
  const setQuoteStatusError = (nextValue: SetStateAction<string | null>) =>
    setContractsUiField("quoteStatusError", nextValue);

  const debouncedContractSearch = useDebouncedValue(
    contractFilters.search,
    CONTRACT_SEARCH_DEBOUNCE_MS,
  );
  const debouncedQuoteSearch = useDebouncedValue(
    quoteFilters.search,
    CONTRACT_SEARCH_DEBOUNCE_MS,
  );
  const debouncedAgencyServiceSearch = useDebouncedValue(
    agencyServiceFilters.search,
    CONTRACT_SEARCH_DEBOUNCE_MS,
  );

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
    () => ({
      patientId: contractFilters.patientId,
      status: contractFilters.status,
      search: debouncedContractSearch,
    }),
    [contractFilters.patientId, contractFilters.status, debouncedContractSearch],
  );
  const quoteQuery = useMemo(
    () => ({
      patientId: quoteFilters.patientId,
      orderId: quoteFilters.orderId,
      status: quoteFilters.status,
      search: debouncedQuoteSearch,
    }),
    [quoteFilters.patientId, quoteFilters.orderId, quoteFilters.status, debouncedQuoteSearch],
  );
  const agencyServiceQuery = useMemo(
    () => ({
      activeOnly: agencyServiceFilters.activeOnly,
      // Agency-service names are localized in the UI but stored in English, so the server
      // cannot match the visible label. Load all (active) rows and filter client-side over
      // the localized labels — see filteredAgencyServices.
      search: "",
    }),
    [agencyServiceFilters.activeOnly],
  );

  const syncQuery = (
    patch: Record<string, string | null | undefined>,
    options: { replace?: boolean } = {},
  ) => {
    setSearchParams((current) => buildSearchParams(current, patch), {
      replace: options.replace ?? true,
    });
  };

  const filteredOrderOptions = useMemo(() => {
    if (!quoteFilters.patientId) return orders;
    return orders.filter((order) => order.patient_id === quoteFilters.patientId);
  }, [orders, quoteFilters.patientId]);

  const agencyServiceStats = useMemo(() => {
    const active = agencyServices.filter((item) => item.is_active).length;
    const priced = agencyServices.filter((item) => Number(item.unit_price ?? 0) > 0).length;
    return { total: agencyServices.length, active, priced };
  }, [agencyServices]);

  const contractParam = searchParams.get("contract") ?? "";
  const quoteParam = searchParams.get("quote") ?? "";

  useEffect(() => {
    if (contractParam) {
      if (selectedContractId !== contractParam) setSelectedContractId(contractParam);
      if (selectedQuoteId) setSelectedQuoteId("");
      return;
    }
    if (quoteParam) {
      if (selectedQuoteId !== quoteParam) setSelectedQuoteId(quoteParam);
      if (selectedContractId) setSelectedContractId("");
      return;
    }
    if (selectedContractId) setSelectedContractId("");
    if (selectedQuoteId) setSelectedQuoteId("");
  }, [
    contractParam,
    quoteParam,
    selectedContractId,
    selectedQuoteId,
    setSelectedContractId,
    setSelectedQuoteId,
  ]);

  // Client-side search over the LOCALIZED labels (German-folded), since the server only
  // knows the stored English names.
  const filteredAgencyServices = useMemo(() => {
    const needle = deNormalize(debouncedAgencyServiceSearch.trim());
    if (!needle) return agencyServices;
    return agencyServices.filter((row) => {
      const haystack = deNormalize(
        [
          agencyServiceNameLabel(row.service_key, row.service_name, t),
          agencyServiceDescriptionLabel(row.service_key, row.description, t),
          agencyServiceUnitLabel(row.unit_label, t),
          row.service_key,
          row.service_name,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return haystack.includes(needle);
    });
  }, [agencyServices, debouncedAgencyServiceSearch, t]);

  const selectedCreateOrder = useMemo(
    () => orders.find((order) => order.id === createQuoteForm.orderId) ?? null,
    [orders, createQuoteForm.orderId],
  );
  const createContractValidationMessages = useMemo(
    () => ({
      invalidConditionsJson:
        lang === "de"
          ? `${t.contracts_notes}: Bitte geben Sie gültiges JSON ein.`
          : `${t.contracts_notes}: введите корректный JSON.`,
      invalidDate:
        lang === "de"
          ? "Bitte prüfen Sie die Datumsfelder im Vertrag."
          : "Проверьте даты в договоре.",
      invalidDateTime:
        lang === "de"
          ? `${t.contracts_signed_at}: Bitte geben Sie Datum und Uhrzeit korrekt ein.`
          : `${t.contracts_signed_at}: укажите корректные дату и время.`,
      invalidPatient:
        lang === "de"
          ? `${t.contracts_patient}: Bitte wählen Sie einen gültigen Patienten aus.`
          : `${t.contracts_patient}: выберите корректного пациента.`,
      invalidStatus:
        lang === "de"
          ? `${t.users_status}: Bitte wählen Sie einen gültigen Status aus.`
          : `${t.users_status}: выберите корректный статус.`,
      patientRequired: `${t.contracts_patient}: ${t.cf_required}`,
      requiredFields:
        lang === "de"
          ? "Bitte füllen Sie die Pflichtfelder im Vertrag aus."
          : "Заполните обязательные поля договора.",
      sessionExpired:
        t.uiText.contracts_session_expired_retry ?? t.common_error,
      validFromRequired: `${t.providers_service_valid_from}: ${t.cf_required}`,
      validToBeforeValidFrom:
        lang === "de"
          ? `${t.providers_service_valid_to}: darf nicht vor ${t.providers_service_valid_from} liegen.`
          : `${t.providers_service_valid_to}: дата не может быть раньше поля «${t.providers_service_valid_from}».`,
    }),
    [
      lang,
      t.cf_required,
      t.common_error,
      t.contracts_notes,
      t.contracts_patient,
      t.contracts_signed_at,
      t.providers_service_valid_from,
      t.providers_service_valid_to,
      t.uiText.contracts_session_expired_retry,
      t.users_status,
    ],
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
        accessor: (row) => agencyServiceNameLabel(row.service_key, row.service_name, t),
        sortable: true,
        required: true,
        width: 260,
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {agencyServiceNameLabel(row.service_key, row.service_name, t)}
          </span>
        ),
      },
      {
        id: "description",
        label: text.description,
        accessor: (row) => agencyServiceDescriptionLabel(row.service_key, row.description, t),
        width: 320,
        render: (row) => (
          <span className="block max-w-[320px] truncate text-sm text-foreground">
            {agencyServiceDescriptionLabel(row.service_key, row.description, t)}
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
        accessor: (row) => agencyServiceUnitLabel(row.unit_label, t),
        width: 120,
        render: (row) => (
          <span className="text-sm text-foreground">
            {agencyServiceUnitLabel(row.unit_label, t)}
          </span>
        ),
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
                : "border-zinc-200 bg-zinc-100 text-zinc-600",
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
    [locale, t, text],
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
        label: text.patientId,
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
        accessor: (row) => agencyServiceNameLabel(undefined, row.description, t),
        render: (row) => (
          <span className="text-sm text-foreground">
            {agencyServiceNameLabel(undefined, row.description, t)}
          </span>
        ),
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
      t,
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
        render: (row) => (
          <span className="font-mono text-xs">
            {t.uiText.common_version_prefix}
            {row.version_number}
          </span>
        ),
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

  const startOptionsLoad = useCallback(() => {
    setOptionsLoading(true);
    setOptionsError(null);
  }, []);

  const applyContractOptions = useCallback((result: Awaited<ReturnType<typeof fetchContractsLookups>>) => {
    setPatients(result.patients);
    setOrders(result.orders);
  }, []);

  const failOptionsLoad = useCallback((error: unknown) => {
    setOptionsError(error instanceof Error ? error.message : t.common_error);
  }, [t.common_error]);

  const finishOptionsLoad = useCallback(() => {
    setOptionsLoading(false);
  }, []);

  const startContractsLoad = useCallback(() => {
    setContractsLoading(true);
    setContractsError(null);
  }, []);

  const applyContracts = useCallback((data: Awaited<ReturnType<typeof fetchContracts>>) => {
    setContracts(data);
  }, []);

  const failContractsLoad = useCallback((error: unknown) => {
    setContractsError(error instanceof Error ? error.message : t.common_error);
  }, [t.common_error]);

  const finishContractsLoad = useCallback(() => {
    setContractsLoading(false);
  }, []);

  const startQuotesLoad = useCallback(() => {
    setQuotesLoading(true);
    setQuotesError(null);
  }, []);

  const applyQuotes = useCallback((data: Awaited<ReturnType<typeof fetchQuotes>>) => {
    setQuotes(data);
  }, []);

  const failQuotesLoad = useCallback((error: unknown) => {
    setQuotesError(error instanceof Error ? error.message : t.common_error);
  }, [t.common_error]);

  const finishQuotesLoad = useCallback(() => {
    setQuotesLoading(false);
  }, []);

  const startAgencyServicesLoad = useCallback(() => {
    setAgencyServicesLoading(true);
    setAgencyServicesError(null);
  }, []);

  const applyAgencyServices = useCallback((data: Awaited<ReturnType<typeof fetchAgencyServices>>) => {
    setAgencyServices(data);
  }, []);

  const failAgencyServicesLoad = useCallback((error: unknown) => {
    setAgencyServicesError(error instanceof Error ? error.message : t.common_error);
  }, [t.common_error]);

  const finishAgencyServicesLoad = useCallback(() => {
    setAgencyServicesLoading(false);
  }, []);

  const resetContractDetail = useCallback(() => {
    setContractDetail(null);
    setContractDetailError(null);
  }, []);

  const startContractDetailLoad = useCallback(() => {
    setContractDetailLoading(true);
    setContractDetailError(null);
  }, []);

  const applyContractDetail = useCallback((data: Awaited<ReturnType<typeof fetchContract>>) => {
    setContractDetail(data);
    setContractStatusForm(contractToStatusForm(data));
  }, []);

  const failContractDetailLoad = useCallback((error: unknown) => {
    setContractDetailError(error instanceof Error ? error.message : t.common_error);
  }, [t.common_error]);

  const finishContractDetailLoad = useCallback(() => {
    setContractDetailLoading(false);
  }, []);

  const resetQuoteDetail = useCallback(() => {
    setQuoteDetail(null);
    setQuoteVersions([]);
    setQuoteDetailError(null);
    setQuoteVersionsError(null);
  }, []);

  const startQuoteDetailLoad = useCallback(() => {
    setQuoteDetailLoading(true);
    setQuoteVersionsLoading(true);
    setQuoteDetailError(null);
    setQuoteVersionsError(null);
  }, []);

  const applyQuoteWorkspace = useCallback((workspace: Awaited<ReturnType<typeof fetchQuoteWorkspace>>) => {
    setQuoteDetail(workspace.quote);
    setQuoteVersions(workspace.versions);
    setQuoteStatusForm(quoteToStatusForm(workspace.quote));
  }, []);

  const failQuoteDetailLoad = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : t.common_error;
    setQuoteDetailError(message);
    setQuoteVersionsError(message);
  }, [t.common_error]);

  const finishQuoteDetailLoad = useCallback(() => {
    setQuoteDetailLoading(false);
    setQuoteVersionsLoading(false);
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      startOptionsLoad();
      try {
        const result = await fetchContractsLookups();
        if (ignore) return;
        applyContractOptions(result);
      } catch (error) {
        if (ignore) return;
        failOptionsLoad(error);
      } finally {
        if (!ignore) finishOptionsLoad();
      }
    }
    void loadOptions();
    return () => {
      ignore = true;
    };
  }, [applyContractOptions, failOptionsLoad, finishOptionsLoad, startOptionsLoad]);

  useEffect(() => {
    let ignore = false;
    async function loadContracts() {
      startContractsLoad();
      try {
        const data = await fetchContracts(buildContractsPath(contractQuery));
        if (!ignore) applyContracts(data);
      } catch (error) {
        if (!ignore) failContractsLoad(error);
      } finally {
        if (!ignore) finishContractsLoad();
      }
    }
    void loadContracts();
    return () => {
      ignore = true;
    };
  }, [applyContracts, contractQuery, contractsReloadToken, failContractsLoad, finishContractsLoad, startContractsLoad]);

  useEffect(() => {
    let ignore = false;
    async function loadQuotes() {
      startQuotesLoad();
      try {
        const data = await fetchQuotes(buildQuotesPath(quoteQuery));
        if (!ignore) applyQuotes(data);
      } catch (error) {
        if (!ignore) failQuotesLoad(error);
      } finally {
        if (!ignore) finishQuotesLoad();
      }
    }
    void loadQuotes();
    return () => {
      ignore = true;
    };
  }, [applyQuotes, failQuotesLoad, finishQuotesLoad, quoteQuery, quotesReloadToken, startQuotesLoad]);

  useEffect(() => {
    let ignore = false;
    async function loadAgencyServices() {
      startAgencyServicesLoad();
      try {
        const data = await fetchAgencyServices(buildAgencyServicesPath(agencyServiceQuery));
        if (!ignore) applyAgencyServices(data);
      } catch (error) {
        if (!ignore) {
          failAgencyServicesLoad(error);
        }
      } finally {
        if (!ignore) finishAgencyServicesLoad();
      }
    }
    void loadAgencyServices();
    return () => {
      ignore = true;
    };
  }, [agencyServiceQuery, agencyServicesReloadToken, applyAgencyServices, failAgencyServicesLoad, finishAgencyServicesLoad, startAgencyServicesLoad]);

  useEffect(() => {
    if (!selectedContractId) {
      resetContractDetail();
      return;
    }
    let ignore = false;
    async function loadContractDetail() {
      startContractDetailLoad();
      try {
        const data = await fetchContract(selectedContractId);
        if (ignore) return;
        applyContractDetail(data);
      } catch (error) {
        if (!ignore) {
          failContractDetailLoad(error);
        }
      } finally {
        if (!ignore) finishContractDetailLoad();
      }
    }
    void loadContractDetail();
    return () => {
      ignore = true;
    };
  }, [applyContractDetail, contractsReloadToken, failContractDetailLoad, finishContractDetailLoad, resetContractDetail, selectedContractId, startContractDetailLoad]);

  useEffect(() => {
    if (!selectedQuoteId) {
      resetQuoteDetail();
      return;
    }
    let ignore = false;
    async function loadQuoteDetail() {
      startQuoteDetailLoad();
      try {
        const workspace = await fetchQuoteWorkspace(selectedQuoteId);
        if (ignore) return;
        applyQuoteWorkspace(workspace);
      } catch (error) {
        if (!ignore) {
          failQuoteDetailLoad(error);
        }
      } finally {
        if (!ignore) {
          finishQuoteDetailLoad();
        }
      }
    }
    void loadQuoteDetail();
    return () => {
      ignore = true;
    };
  }, [applyQuoteWorkspace, failQuoteDetailLoad, finishQuoteDetailLoad, quotesReloadToken, resetQuoteDetail, selectedQuoteId, startQuoteDetailLoad]);

  async function handleCreateContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateCreateContractForm(
      createContractForm,
      createContractValidationMessages,
    );
    if (validationError) {
      setCreateContractError(validationError);
      return;
    }
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
      setCreateContractError(
        contractActionErrorMessage(
          error,
          createContractValidationMessages,
          t.common_error,
        ),
      );
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
    const validationError = validateContractStatusForm(
      contractStatusForm,
      createContractValidationMessages,
    );
    if (validationError) {
      setContractStatusError(validationError);
      return;
    }
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
      setContractStatusError(
        contractActionErrorMessage(
          error,
          createContractValidationMessages,
          t.common_error,
        ),
      );
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
    setSelectedQuoteId("");
    setSelectedContractId(contractId);
    syncQuery({ contract: contractId, quote: null }, { replace: false });
  }

  function openQuote(quoteId: string) {
    setSelectedContractId("");
    setSelectedQuoteId(quoteId);
    syncQuery({ quote: quoteId, contract: null }, { replace: false });
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
      <div className="space-y-5">
        <PageHeader
          title={text.workspaceTitle}
          actions={
            <>
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

        {optionsError ? <ShellBanner tone="error">{optionsError}</ShellBanner> : null}

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.agencyServiceTitle)}</h2>
            </div>
            <Badge variant="outline" className="rounded-full">
              {agencyServiceStats.active} / {agencyServiceStats.total}
            </Badge>
          </div>

          <div className="mt-5 space-y-4 border-b border-border pb-4">
            <div className="grid gap-1.5 sm:grid-cols-3">
              <MiniMetric label={text.catalogItems} value={String(agencyServiceStats.total)} />
              <MiniMetric label={text.activeLabel} value={String(agencyServiceStats.active)} />
              <MiniMetric label={text.priced} value={String(agencyServiceStats.priced)} />
            </div>

            <div className="flex items-center gap-2" aria-hidden>
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
              <span className="size-1.5 rounded-full bg-orange-400" />
              <span className="size-1.5 rounded-full bg-orange-300" />
              <span className="size-1.5 rounded-full bg-orange-200" />
              <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
            </div>

            <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label={text.agencyServiceSearchPlaceholder}
                  value={agencyServiceFilters.search}
                  onChange={(event) =>
                    setAgencyServiceFilters((current) => ({
                      ...current,
                      search: event.target.value,
                    }))
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

            {agencyServicesError ? <ShellBanner tone="error">{agencyServicesError}</ShellBanner> : null}
          </div>

          <DataTableSurface
            rows={filteredAgencyServices}
            columns={agencyServiceColumns}
            rowId={(row) => row.id}
            defaultDensity="comfortable"
            dictionary={t as unknown as Record<string, string>}
            loading={agencyServicesLoading}
            activeRowId={agencyServiceForm.id || null}
            onRowClick={permissions.canManageCatalog ? handleEditAgencyService : undefined}
            rowAccent={(row) => {
              if (row.id === agencyServiceForm.id) return "bg-sky-500";
              return row.is_active ? "bg-emerald-500" : "bg-zinc-300";
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
        </section>

        <div className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.contractsTab)}</h2>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {contracts.length}
                </Badge>
              </div>

              <div className="mt-5 space-y-4 border-b border-border pb-4">
                <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      aria-label={`${text.contractsTab} ${t.common_search}`}
                      value={contractFilters.search}
                      onChange={(event) =>
                        setContractFilters((current) => ({ ...current, search: event.target.value }))
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
                defaultDensity="comfortable"
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
            </section>
          
            <section className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.quotesTab)}</h2>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {quotes.length}
                </Badge>
              </div>

              <div className="mt-5 space-y-4 border-b border-border pb-4">
                <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
                  <div className="relative min-w-[240px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      aria-label={`${text.quotesTab} ${t.common_search}`}
                      value={quoteFilters.search}
                      onChange={(event) =>
                        setQuoteFilters((current) => ({ ...current, search: event.target.value }))
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
                defaultDensity="comfortable"
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
            </section>
        </div>
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
                  error={agencyServiceFormError}
                  submitLabel={agencyServiceForm.id ? text.saveCatalogItem : text.createCatalogItem}
                  submitting={agencyServiceBusy}
                  onCancel={closeAgencyServiceSheet}
                />
              }
            >
              <div className="space-y-4 rounded-xl">
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.basicData)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.pricing)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.validityPeriod)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.descriptionStatus)}</h2>
                  <div className="mt-5 space-y-4">
                    <Field label={text.description}>
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
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground",
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
                </section>
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
                  error={createContractError}
                  submitLabel={text.createContract}
                  submitting={createContractBusy}
                  onCancel={() => setCreateContractOpen(false)}
                />
              }
            >
              <div className="space-y-4 rounded-xl">
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.contractPatientStatus)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label={t.contracts_patient} required>
                      <NativeComboboxSelect
                        aria-invalid={Boolean(createContractError && !createContractForm.patientId)}
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.contractDates)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label={t.providers_service_valid_from} required>
                      <Input
                        type="date"
                        aria-invalid={Boolean(createContractError && !createContractForm.validFrom)}
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
                        aria-invalid={Boolean(
                          createContractError &&
                          createContractForm.validFrom &&
                          createContractForm.validTo &&
                          createContractForm.validTo < createContractForm.validFrom,
                        )}
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.contractConditions)}</h2>
                  <div className="mt-5">
                    <Field label={t.contracts_notes}>
                      <textarea
                        className={textareaClassName}
                        value={createContractForm.conditionsText}
                        onChange={(event) =>
                          setCreateContractForm((current) => ({
                            ...current,
                            conditionsText: event.target.value,
                          }))
                        }
                        placeholder={t.uiText.contracts_conditions_placeholder}
                      />
                    </Field>
                  </div>
                </section>
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
                  error={createQuoteError}
                  submitLabel={text.createQuote}
                  submitting={createQuoteBusy}
                  submitDisabled={!createQuoteForm.orderId}
                  onCancel={() => setCreateQuoteOpen(false)}
                />
              }
            >
              <div className="space-y-4 rounded-xl">
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.quoteOrderSection)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.quoteNotesSection)}</h2>
                  <div className="mt-5">
                    <Field label={t.contracts_notes}>
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
                </section>
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
            syncQuery({ contract: null }, { replace: false });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={contractDetail ? `${contractDetail.contract_number} / ${contractDetail.patient_name}` : t.contracts_framework}
            description={text.contractSheetDescription}
          >
            <div className="space-y-4 rounded-xl">
              {contractDetailLoading ? (
                <LoadingState label={t.common_loading} />
              ) : contractDetailError ? (
                <ShellBanner tone="error">{contractDetailError}</ShellBanner>
              ) : !contractDetail ? (
                <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
              ) : (
                <>
                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.contracts_title)}</h2>
                      </div>
                    <Badge variant="outline" className={cn("rounded-full", contractStatusClassName(contractDetail.status))}>
                      {contractStatusLabel(contractDetail.status)}
                    </Badge>
                    </div>
                    <div className="mt-5 space-y-5">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <ContractSummaryLine
                          label={t.contracts_patient}
                          value={`${contractDetail.patient_name} (${contractDetail.patient_pid})`}
                        />
                        <ContractSummaryLine
                          label={t.patients_created}
                          value={formatDateTime(contractDetail.created_at, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine
                          label={text.updatedAt}
                          value={formatDateTime(contractDetail.updated_at, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine
                          label={t.contracts_signed_at}
                          value={formatDateTime(contractDetail.signed_at, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine
                          label={t.providers_service_valid_from}
                          value={formatDate(contractDetail.valid_from, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine
                          label={t.providers_service_valid_to}
                          value={formatDate(contractDetail.valid_to, locale, t.common_not_set)}
                        />
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.contracts_notes)}</h2>
                          </div>
                        </div>
                        <pre className="rounded-xl border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                          {contractDetail.conditions && Object.keys(contractDetail.conditions).length > 0
                            ? JSON.stringify(contractDetail.conditions, null, 2)
                            : t.common_not_set}
                        </pre>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.providers_linked_patients)}</h2>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/patients?patient=${contractDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{t.contracts_patient}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.contractLinkedPatientCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/orders?patient=${contractDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{text.orders}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.contractLinkedOrdersCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/documents?patient=${contractDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{text.documents}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.contractLinkedDocumentsCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.contracts_status)}</h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
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
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() => void handleSaveContractStatus()}
                          disabled={contractStatusBusy || !permissions.canManageContract}
                        >
                          {contractStatusBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          {text.saveContract}
                        </Button>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>
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
            syncQuery({ quote: null }, { replace: false });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={quoteDetail ? `${quoteDetail.quote_number} / ${quoteDetail.patient_name}` : text.quotesTab}
            description={text.quoteSheetDescription}
          >
            <div className="space-y-4 rounded-xl">
              {quoteDetailLoading ? (
                <LoadingState label={t.common_loading} />
              ) : quoteDetailError ? (
                <ShellBanner tone="error">{quoteDetailError}</ShellBanner>
              ) : !quoteDetail ? (
                <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
              ) : (
                <>
                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.quotesTab)}</h2>
                      </div>
                      <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(quoteDetail.status))}>
                        {quoteStatusLabel(quoteDetail.status)}
                      </Badge>
                    </div>
                    <div className="mt-5 space-y-5">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <ContractSummaryLine
                          label={t.contracts_patient}
                          value={`${quoteDetail.patient_name} (${quoteDetail.patient_pid})`}
                        />
                        <ContractSummaryLine label={t.orders_title} value={quoteDetail.order_number} />
                        <ContractSummaryLine
                          label={t.providers_service_valid_to}
                          value={formatDate(quoteDetail.valid_until, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine
                          label={t.invoices_paid_at}
                          value={formatDateTime(quoteDetail.paid_at, locale, t.common_not_set)}
                        />
                        <ContractSummaryLine label={t.invoices_subtotal} value={formatCurrency(quoteDetail.total_net)} />
                        <ContractSummaryLine label={text.vatTotal} value={formatCurrency(quoteDetail.total_vat)} />
                        <ContractSummaryLine label={text.grossTotal} value={formatCurrency(quoteDetail.total_gross)} />
                        <ContractSummaryLine label={t.invoices_paid} value={formatCurrency(quoteDetail.paid_amount)} />
                        <ContractSummaryLine
                          label={text.snapshotVersion}
                          value={
                            quoteDetail.current_version_number
                              ? `${quoteDetail.current_version_number} / ${quoteDetail.version_count ?? quoteDetail.current_version_number}`
                              : "0"
                          }
                        />
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.contracts_notes)}</h2>
                          </div>
                        </div>
                        <div className="rounded-xl border border-border bg-background/60 p-4 text-sm leading-snug text-muted-foreground">
                          {quoteDetail.notes || t.common_not_set}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.providers_linked_patients)}</h2>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/patients?patient=${quoteDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{t.contracts_patient}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.quoteLinkedPatientCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/orders?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{text.order}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.quoteLinkedOrderCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/invoices?quote=${quoteDetail.id}&order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{text.invoices}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.quoteLinkedInvoicesCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                        onClick={() => window.open(`/documents?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        <div className="relative z-10">
                          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{text.documents}</h3>
                          <p className="mt-2 text-xs leading-tight text-muted-foreground">
                            {text.quoteLinkedDocumentsCard}
                          </p>
                        </div>
                        <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.quoteLifecycle)}</h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
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
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() => void handleSaveQuoteStatus()}
                          disabled={quoteStatusBusy || !permissions.canManageQuote}
                        >
                          {quoteStatusBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          {text.saveQuote}
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.lineItems)}</h2>
                      </div>
                    </div>
                    <div className="mt-5">
                      <DataTableSurface
                        rows={quoteLineItemRows}
                        columns={quoteLineItemColumns}
                        rowId={(row) => row.id}
                        defaultDensity="comfortable"
                        dictionary={t as unknown as Record<string, string>}
                        rowAccent={(row) => (row.is_cost_passthrough ? "bg-amber-500" : null)}
                        emptyState={<EmptyState title={text.noLineItems} description={text.noLineItemsDescription} />}
                      />
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.versionHistory)}</h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      {quoteVersionsError ? <ShellBanner tone="error">{quoteVersionsError}</ShellBanner> : null}
                      <DataTableSurface
                        rows={quoteVersions}
                        columns={quoteVersionColumns}
                        rowId={(row) => row.id}
                        defaultDensity="comfortable"
                        dictionary={t as unknown as Record<string, string>}
                        loading={quoteVersionsLoading}
                        emptyState={<EmptyState title={text.noVersions} description={text.noVersionsDescription} />}
                      />
                    </div>
                  </section>
                </>
              )}
            </div>
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ContractsPage(...args: Parameters<typeof useContractsPageContent>) {
  return useContractsPageContent(...args);
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-full border border-border bg-muted/20 px-4 py-2">
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 text-sm font-semibold leading-none text-foreground">{value}</span>
    </div>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{title}</span>
    </span>
  );
}

function Field({
  label,
  className,
  children,
  required = false,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-[var(--brand)]">
            *
          </span>
        ) : null}
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
