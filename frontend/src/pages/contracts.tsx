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
  ChevronRight,
  FileBadge2,
  FileSpreadsheet,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ContractsTab = "contracts" | "quotes";
type ContractStatus = "draft" | "sent" | "signed" | "expired" | "terminated";
type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

type ContractItem = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  contract_number: string;
  status: ContractStatus | string;
  signed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  conditions: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type QuoteLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  provider_id?: string | null;
  doctor_id?: string | null;
  notes?: string | null;
};

type QuoteItem = {
  id: string;
  order_id: string;
  order_number: string;
  contract_id: string | null;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  quote_number: string;
  status: QuoteStatus | string;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  valid_until: string | null;
  paid_amount: unknown;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  line_items?: QuoteLineItem[];
};

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type OrderOption = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: string;
  status: string;
  total_estimated?: unknown;
};

type ContractFilters = {
  search: string;
  patientId: string;
  status: string;
};

type QuoteFilters = {
  search: string;
  patientId: string;
  orderId: string;
  status: string;
};

type ContractFormState = {
  patientId: string;
  status: ContractStatus;
  validFrom: string;
  validTo: string;
  signedAt: string;
  conditionsText: string;
};

type ContractStatusFormState = {
  status: ContractStatus;
  validFrom: string;
  validTo: string;
  signedAt: string;
  conditionsText: string;
};

type QuoteFormState = {
  orderId: string;
  validUntil: string;
  notes: string;
};

type QuoteStatusFormState = {
  status: QuoteStatus;
  paidAmount: string;
  notes: string;
};

type ContractsPermissions = {
  canViewPage: boolean;
  canCreateContract: boolean;
  canManageContract: boolean;
  canCreateQuote: boolean;
  canManageQuote: boolean;
};

const CONTRACT_STATUSES: ContractStatus[] = [
  "draft",
  "sent",
  "signed",
  "expired",
  "terminated",
];
const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
];
const DEFAULT_CONTRACT_FILTERS: ContractFilters = {
  search: "",
  patientId: "",
  status: "",
};
const DEFAULT_QUOTE_FILTERS: QuoteFilters = {
  search: "",
  patientId: "",
  orderId: "",
  status: "",
};
const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function contractsPermissions(role?: string): ContractsPermissions {
  const canManage = role === "ceo" || role === "patient_manager" || role === "billing";
  return {
    canViewPage: canManage,
    canCreateContract: canManage,
    canManageContract: canManage,
    canCreateQuote: canManage,
    canManageQuote: canManage,
  };
}

function buildContractsPath(filters: ContractFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.status) params.set("status", filters.status);
  return params.size ? `/framework-contracts?${params.toString()}` : "/framework-contracts";
}

function buildQuotesPath(filters: QuoteFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.status) params.set("status", filters.status);
  return params.size ? `/quotes?${params.toString()}` : "/quotes";
}

function blankContractForm(patientId = ""): ContractFormState {
  return {
    patientId,
    status: "draft",
    validFrom: "",
    validTo: "",
    signedAt: "",
    conditionsText: "",
  };
}

function blankQuoteForm(orderId = ""): QuoteFormState {
  return {
    orderId,
    validUntil: "",
    notes: "",
  };
}

function contractToStatusForm(contract: ContractItem): ContractStatusFormState {
  return {
    status: (contract.status as ContractStatus) ?? "draft",
    validFrom: contract.valid_from ?? "",
    validTo: contract.valid_to ?? "",
    signedAt: contract.signed_at ? toDateTimeLocal(contract.signed_at) : "",
    conditionsText: contract.conditions ? JSON.stringify(contract.conditions, null, 2) : "",
  };
}

function quoteToStatusForm(quote: QuoteItem): QuoteStatusFormState {
  return {
    status: (quote.status as QuoteStatus) ?? "draft",
    paidAmount: valueToInput(quote.paid_amount),
    notes: quote.notes ?? "",
  };
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function valueToInput(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
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

function formatDate(value?: string | null) {
  if (!value) return "Not set";
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

function formatCurrency(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "EUR 0.00";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function contractStatusClassName(status: string) {
  switch (status) {
    case "signed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "sent":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "expired":
    case "terminated":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function quoteStatusClassName(status: string) {
  switch (status) {
    case "accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "sent":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "rejected":
    case "expired":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
}

function buildSearchParams(
  current: URLSearchParams,
  patch: Record<string, string | null | undefined>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function ContractsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = contractsPermissions(user?.role);

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
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState(initialContractId);
  const [selectedQuoteId, setSelectedQuoteId] = useState(initialQuoteId);
  const [contractDetail, setContractDetail] = useState<ContractItem | null>(null);
  const [quoteDetail, setQuoteDetail] = useState<QuoteItem | null>(null);
  const [contractDetailLoading, setContractDetailLoading] = useState(false);
  const [quoteDetailLoading, setQuoteDetailLoading] = useState(false);
  const [contractDetailError, setContractDetailError] = useState<string | null>(null);
  const [quoteDetailError, setQuoteDetailError] = useState<string | null>(null);
  const [contractsReloadToken, setContractsReloadToken] = useState(0);
  const [quotesReloadToken, setQuotesReloadToken] = useState(0);
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

  const contractQuery = useMemo(
    () => ({ ...contractFilters, search: deferredContractSearch }),
    [contractFilters, deferredContractSearch],
  );
  const quoteQuery = useMemo(
    () => ({ ...quoteFilters, search: deferredQuoteSearch }),
    [quoteFilters, deferredQuoteSearch],
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

  const selectedCreateOrder = useMemo(
    () => orders.find((order) => order.id === createQuoteForm.orderId) ?? null,
    [orders, createQuoteForm.orderId],
  );

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsError(null);
      try {
        const [patientsResult, ordersResult] = await Promise.all([
          apiFetch<PatientOption[]>("/patients?active_only=false"),
          apiFetch<OrderOption[]>("/orders"),
        ]);
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
        const data = await apiFetch<ContractItem[]>(buildContractsPath(contractQuery));
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
        const data = await apiFetch<QuoteItem[]>(buildQuotesPath(quoteQuery));
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
        const data = await apiFetch<ContractItem>(`/framework-contracts/${selectedContractId}`);
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
      setQuoteDetailError(null);
      return;
    }
    let ignore = false;
    async function loadQuoteDetail() {
      setQuoteDetailLoading(true);
      setQuoteDetailError(null);
      try {
        const data = await apiFetch<QuoteItem>(`/quotes/${selectedQuoteId}`);
        if (ignore) return;
        setQuoteDetail(data);
        setQuoteStatusForm(quoteToStatusForm(data));
      } catch (error) {
        if (!ignore) setQuoteDetailError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setQuoteDetailLoading(false);
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
      const result = await apiFetch<{ id: string } & Partial<ContractItem>>("/framework-contracts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
      setCreateQuoteError("Select an order first.");
      return;
    }
    setCreateQuoteBusy(true);
    setCreateQuoteError(null);
    try {
      const result = await apiFetch<{ id: string }>(
        `/orders/${createQuoteForm.orderId}/quotes`,
        {
          method: "POST",
          body: JSON.stringify({
            valid_until: toOptional(createQuoteForm.validUntil),
            notes: toOptional(createQuoteForm.notes),
          }),
        },
      );
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
      await apiFetch<ContractItem>(`/framework-contracts/${selectedContractId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: contractStatusForm.status,
          valid_from: toOptional(contractStatusForm.validFrom),
          valid_to: toOptional(contractStatusForm.validTo),
          signed_at: toOptional(contractStatusForm.signedAt)
            ? new Date(contractStatusForm.signedAt).toISOString()
            : null,
          conditions,
        }),
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
      await apiFetch<QuoteItem>(`/quotes/${selectedQuoteId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: quoteStatusForm.status,
          paid_amount: toOptional(quoteStatusForm.paidAmount)
            ? Number(quoteStatusForm.paidAmount)
            : null,
          notes: toOptional(quoteStatusForm.notes),
        }),
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
        Contracts and quotes are restricted to CEO, patient managers and billing.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Commercial workspace
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                Contracts and quotes
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Patient-bound framework contracts and quote preparation based on order services, cost passthrough
                rules and commercial approval state.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => {
                  setContractsReloadToken((current) => current + 1);
                  setQuotesReloadToken((current) => current + 1);
                }}
              >
                <RefreshCw className="mr-2 size-4" />
                Refresh
              </Button>
              {permissions.canCreateContract ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => {
                    setCreateContractError(null);
                    setCreateContractForm(blankContractForm(contractFilters.patientId));
                    setCreateContractOpen(true);
                  }}
                >
                  <FileBadge2 className="mr-2 size-4" />
                  New contract
                </Button>
              ) : null}
              {permissions.canCreateQuote ? (
                <Button
                  type="button"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={() => {
                    setCreateQuoteError(null);
                    setCreateQuoteForm(blankQuoteForm(quoteFilters.orderId));
                    setCreateQuoteOpen(true);
                  }}
                >
                  <Plus className="mr-2 size-4" />
                  New quote
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <StatCard
            label={t.contracts_title}
            value={String(contractStats.total)}
            description={`${contractStats.signed} signed / ${contractStats.sent} sent`}
            icon={<ShieldCheck className="size-5" />}
          />
          <StatCard
            label={t.contracts_title}
            value={String(quoteStats.total)}
            description={`${quoteStats.accepted} accepted`}
            icon={<FileSpreadsheet className="size-5" />}
          />
          <StatCard
            label={t.contracts_total}
            value={formatCurrency(quoteStats.gross)}
            description={t.contracts_subtitle}
            icon={<Wallet className="size-5" />}
          />
          <StatCard
            label={t.invoices_paid_at}
            value={formatCurrency(quoteStats.paid)}
            description={t.invoices_subtitle}
            icon={<CalendarClock className="size-5" />}
          />
        </section>

        {optionsError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {optionsError}
          </div>
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const next = value as ContractsTab;
            setActiveTab(next);
            syncQuery({ tab: next, contract: next === "contracts" ? selectedContractId : null, quote: next === "quotes" ? selectedQuoteId : null });
          }}
          className="gap-6"
        >
          <TabsList variant="line" className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <TabsTrigger value="contracts" className="rounded-xl px-4 data-active:bg-slate-950 data-active:text-white">
              Framework contracts
            </TabsTrigger>
            <TabsTrigger value="quotes" className="rounded-xl px-4 data-active:bg-slate-950 data-active:text-white">
              Quotes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contracts">
            <div className="space-y-5">
              <SectionCard
                title={t.contracts_title}
                description={t.contracts_subtitle}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)_minmax(180px,0.8fr)_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={contractFilters.search}
                      onChange={(event) =>
                        startTransition(() =>
                          setContractFilters((current) => ({ ...current, search: event.target.value })),
                        )
                      }
                      className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-9"
                      placeholder={t.common_search}
                    />
                  </div>
                  <select
                    value={contractFilters.patientId}
                    onChange={(event) => {
                      const patientId = event.target.value;
                      setContractFilters((current) => ({ ...current, patientId }));
                      syncQuery({ patient: patientId || null });
                    }}
                    className={selectClassName}
                  >
                    <option value="">All patients</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patientOptionLabel(patient)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={contractFilters.status}
                    onChange={(event) =>
                      setContractFilters((current) => ({ ...current, status: event.target.value }))
                    }
                    className={selectClassName}
                  >
                    <option value="">{t.providers_all}</option>
                    {CONTRACT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-2xl"
                    onClick={() => {
                      setContractFilters({
                        ...DEFAULT_CONTRACT_FILTERS,
                        patientId: searchParams.get("patient") ?? "",
                      });
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </SectionCard>

              {contractsLoading ? (
                <LoadingState label={t.common_loading} />
              ) : contractsError ? (
                <Banner tone="error">{contractsError}</Banner>
              ) : contracts.length === 0 ? (
                <EmptyState
                  title={t.common_not_set}
                  description={t.contracts_subtitle}
                  action={
                    permissions.canCreateContract ? (
                      <Button type="button" onClick={() => setCreateContractOpen(true)}>
                        <Plus className="mr-2 size-4" />
                        Create contract
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {contracts.map((contract) => {
                    const isSelected = selectedContractId === contract.id;
                    return (
                      <button
                        key={contract.id}
                        type="button"
                        onClick={() => openContract(contract.id)}
                        className={cn(
                          "rounded-[1.6rem] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                          isSelected ? "border-sky-300 ring-4 ring-sky-100" : "border-slate-200",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                              {contract.contract_number}
                            </div>
                            <h2 className="mt-2 text-lg font-semibold text-slate-950">
                              {contract.patient_name}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">{contract.patient_pid}</p>
                          </div>
                          <ChevronRight className="mt-1 size-4 text-slate-400" />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Badge variant="outline" className={cn("rounded-full", contractStatusClassName(contract.status))}>
                            {contract.status}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                            {contract.signed_at ? t.contracts_signed : t.contracts_draft}
                          </Badge>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <MiniMetric label={t.providers_service_valid_from} value={formatDate(contract.valid_from)} />
                          <MiniMetric label={t.providers_service_valid_to} value={formatDate(contract.valid_to)} />
                          <MiniMetric label={t.contracts_signed_at} value={formatDateTime(contract.signed_at)} />
                          <MiniMetric label={t.common_loading} value={formatDateTime(contract.updated_at)} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent value="quotes">
            <div className="space-y-5">
              <SectionCard
                title={t.contracts_title}
                description={t.contracts_subtitle}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,1fr)_minmax(220px,1fr)_minmax(180px,0.8fr)_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={quoteFilters.search}
                      onChange={(event) =>
                        startTransition(() =>
                          setQuoteFilters((current) => ({ ...current, search: event.target.value })),
                        )
                      }
                      className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-9"
                      placeholder={t.common_search}
                    />
                  </div>
                  <select
                    value={quoteFilters.patientId}
                    onChange={(event) => {
                      const patientId = event.target.value;
                      setQuoteFilters((current) => ({
                        ...current,
                        patientId,
                        orderId:
                          current.orderId &&
                          orders.some((order) => order.id === current.orderId && order.patient_id === patientId)
                            ? current.orderId
                            : "",
                      }));
                      syncQuery({ patient: patientId || null, order: null });
                    }}
                    className={selectClassName}
                  >
                    <option value="">All patients</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patientOptionLabel(patient)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={quoteFilters.orderId}
                    onChange={(event) => {
                      const orderId = event.target.value;
                      setQuoteFilters((current) => ({ ...current, orderId }));
                      syncQuery({ order: orderId || null });
                    }}
                    className={selectClassName}
                  >
                    <option value="">All orders</option>
                    {filteredOrderOptions.map((order) => (
                      <option key={order.id} value={order.id}>
                        {`${order.order_number} · ${order.patient_pid}`}
                      </option>
                    ))}
                  </select>
                  <select
                    value={quoteFilters.status}
                    onChange={(event) =>
                      setQuoteFilters((current) => ({ ...current, status: event.target.value }))
                    }
                    className={selectClassName}
                  >
                    <option value="">{t.providers_all}</option>
                    {QUOTE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-2xl"
                    onClick={() => {
                      setQuoteFilters({
                        ...DEFAULT_QUOTE_FILTERS,
                        patientId: searchParams.get("patient") ?? "",
                        orderId: searchParams.get("order") ?? "",
                      });
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </SectionCard>

              {quotesLoading ? (
                <LoadingState label={t.common_loading} />
              ) : quotesError ? (
                <Banner tone="error">{quotesError}</Banner>
              ) : quotes.length === 0 ? (
                <EmptyState
                  title={t.common_not_set}
                  description={t.contracts_subtitle}
                  action={
                    permissions.canCreateQuote ? (
                      <Button type="button" onClick={() => setCreateQuoteOpen(true)}>
                        <Plus className="mr-2 size-4" />
                        Create quote
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {quotes.map((quote) => {
                    const isSelected = selectedQuoteId === quote.id;
                    return (
                      <button
                        key={quote.id}
                        type="button"
                        onClick={() => openQuote(quote.id)}
                        className={cn(
                          "rounded-[1.6rem] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                          isSelected ? "border-sky-300 ring-4 ring-sky-100" : "border-slate-200",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                              {quote.quote_number}
                            </div>
                            <h2 className="mt-2 text-lg font-semibold text-slate-950">
                              {quote.patient_name}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">{`${quote.order_number} · ${quote.patient_pid}`}</p>
                          </div>
                          <ChevronRight className="mt-1 size-4 text-slate-400" />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(quote.status))}>
                            {quote.status}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                            {formatCurrency(quote.total_gross)}
                          </Badge>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <MiniMetric label={t.providers_service_valid_to} value={formatDate(quote.valid_until)} />
                          <MiniMetric label={t.invoices_paid} value={formatCurrency(quote.paid_amount)} />
                          <MiniMetric label={t.patients_created} value={formatDateTime(quote.created_at)} />
                          <MiniMetric label={t.invoices_paid_at} value={formatDateTime(quote.paid_at)} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={createContractOpen} onOpenChange={setCreateContractOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.contracts_new}</DialogTitle>
            <DialogDescription>
              Set the patient-bound commercial base before building quotes and execution orders.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateContract}>
            {createContractError ? <Banner tone="error">{createContractError}</Banner> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.contracts_patient}>
                <select
                  required
                  value={createContractForm.patientId}
                  onChange={(event) =>
                    setCreateContractForm((current) => ({ ...current, patientId: event.target.value }))
                  }
                  className={selectClassName}
                >
                  <option value="">Select patient</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientOptionLabel(patient)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.users_status}>
                <select
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
                      {status}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.providers_service_valid_from}>
                <Input
                  type="date"
                  value={createContractForm.validFrom}
                  onChange={(event) =>
                    setCreateContractForm((current) => ({ ...current, validFrom: event.target.value }))
                  }
                />
              </Field>
              <Field label={t.providers_service_valid_to}>
                <Input
                  type="date"
                  value={createContractForm.validTo}
                  onChange={(event) =>
                    setCreateContractForm((current) => ({ ...current, validTo: event.target.value }))
                  }
                />
              </Field>
              <Field label={t.contracts_signed_at} className="sm:col-span-2">
                <Input
                  type="datetime-local"
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
                    setCreateContractForm((current) => ({ ...current, conditionsText: event.target.value }))
                  }
                  placeholder='{"language":"de","jurisdiction":"DE"}'
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateContractOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createContractBusy}>
                {createContractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                Create contract
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createQuoteOpen} onOpenChange={setCreateQuoteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.contracts_new}</DialogTitle>
            <DialogDescription>
              Generate a quote from current order services. Totals are calculated from order lines on the backend.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateQuote}>
            {createQuoteError ? <Banner tone="error">{createQuoteError}</Banner> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.orders_title} className="sm:col-span-2">
                <select
                  required
                  value={createQuoteForm.orderId}
                  onChange={(event) =>
                    setCreateQuoteForm((current) => ({ ...current, orderId: event.target.value }))
                  }
                  className={selectClassName}
                  disabled={optionsLoading}
                >
                  <option value="">{optionsLoading ? "Loading orders..." : "Select order"}</option>
                  {filteredOrderOptions.map((order) => (
                    <option key={order.id} value={order.id}>
                      {`${order.order_number} · ${order.patient_pid} · ${order.patient_name}`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.providers_service_valid_to}>
                <Input
                  type="date"
                  value={createQuoteForm.validUntil}
                  onChange={(event) =>
                    setCreateQuoteForm((current) => ({ ...current, validUntil: event.target.value }))
                  }
                />
              </Field>
              <Field label={t.orders_title}>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {selectedCreateOrder
                    ? `${selectedCreateOrder.order_number} · ${selectedCreateOrder.patient_pid} · ${formatCurrency(selectedCreateOrder.total_estimated)}`
                    : "Choose an order"}
                </div>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateQuoteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createQuoteBusy || !createQuoteForm.orderId}>
                {createQuoteBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                Create quote
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle>{contractDetail ? `${contractDetail.contract_number} / ${contractDetail.patient_name}` : t.contracts_framework}</SheetTitle>
            <SheetDescription>Contract status, validity and linked commercial context for the selected patient.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 py-6">
            {contractDetailLoading ? (
              <LoadingState label={t.common_loading} />
            ) : contractDetailError ? (
              <Banner tone="error">{contractDetailError}</Banner>
            ) : !contractDetail ? (
              <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
            ) : (
              <>
                <SectionCard
                  title={t.contracts_title}
                  description="Patient-bound agreement details and current lifecycle."
                  action={<Badge variant="outline" className={cn("rounded-full", contractStatusClassName(contractDetail.status))}>{contractDetail.status}</Badge>}
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.contracts_patient} value={`${contractDetail.patient_name} (${contractDetail.patient_pid})`} />
                    <DetailField label={t.patients_created} value={formatDateTime(contractDetail.created_at)} />
                    <DetailField label={t.common_loading} value={formatDateTime(contractDetail.updated_at)} />
                    <DetailField label={t.contracts_signed_at} value={formatDateTime(contractDetail.signed_at)} />
                    <DetailField label={t.providers_service_valid_from} value={formatDate(contractDetail.valid_from)} />
                    <DetailField label={t.providers_service_valid_to} value={formatDate(contractDetail.valid_to)} />
                    <DetailField
                      label={t.contracts_notes}
                      value={contractDetail.conditions && Object.keys(contractDetail.conditions).length > 0 ? JSON.stringify(contractDetail.conditions, null, 2) : t.common_not_set}
                    />
                  </div>
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description={t.contracts_subtitle}>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/patients?patient=${contractDetail.patient_id}`)}>Patient</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/orders?patient=${contractDetail.patient_id}`)}>Orders</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/documents?patient=${contractDetail.patient_id}`)}>Documents</Button>
                  </div>
                </SectionCard>

                <SectionCard title={t.contracts_status} description={t.contracts_subtitle}>
                  {contractStatusError ? <Banner tone="error">{contractStatusError}</Banner> : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.users_status}>
                      <select
                        value={contractStatusForm.status}
                        onChange={(event) =>
                          setContractStatusForm((current) => ({ ...current, status: event.target.value as ContractStatus }))
                        }
                        className={selectClassName}
                      >
                        {CONTRACT_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t.contracts_signed_at}>
                      <Input type="datetime-local" value={contractStatusForm.signedAt} onChange={(event) => setContractStatusForm((current) => ({ ...current, signedAt: event.target.value }))} />
                    </Field>
                    <Field label={t.providers_service_valid_from}>
                      <Input type="date" value={contractStatusForm.validFrom} onChange={(event) => setContractStatusForm((current) => ({ ...current, validFrom: event.target.value }))} />
                    </Field>
                    <Field label={t.providers_service_valid_to}>
                      <Input type="date" value={contractStatusForm.validTo} onChange={(event) => setContractStatusForm((current) => ({ ...current, validTo: event.target.value }))} />
                    </Field>
                    <Field label={t.contracts_notes} className="sm:col-span-2">
                      <textarea className={textareaClassName} value={contractStatusForm.conditionsText} onChange={(event) => setContractStatusForm((current) => ({ ...current, conditionsText: event.target.value }))} />
                    </Field>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" onClick={() => void handleSaveContractStatus()} disabled={contractStatusBusy || !permissions.canManageContract}>
                      {contractStatusBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      Save contract
                    </Button>
                  </div>
                </SectionCard>
              </>
            )}
          </div>
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
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle>{quoteDetail ? `${quoteDetail.quote_number} / ${quoteDetail.patient_name}` : t.contracts_title}</SheetTitle>
            <SheetDescription>Quote totals, line items and payment state for the selected order.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 py-6">
            {quoteDetailLoading ? (
              <LoadingState label={t.common_loading} />
            ) : quoteDetailError ? (
              <Banner tone="error">{quoteDetailError}</Banner>
            ) : !quoteDetail ? (
              <EmptyState title={t.common_not_set} description={t.contracts_subtitle} />
            ) : (
              <>
                <SectionCard
                  title={t.contracts_title}
                  description="Commercial totals and scope inherited from the linked order."
                  action={<Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(quoteDetail.status))}>{quoteDetail.status}</Badge>}
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.contracts_patient} value={`${quoteDetail.patient_name} (${quoteDetail.patient_pid})`} />
                    <DetailField label={t.orders_title} value={quoteDetail.order_number} />
                    <DetailField label={t.providers_service_valid_to} value={formatDate(quoteDetail.valid_until)} />
                    <DetailField label={t.invoices_paid_at} value={formatDateTime(quoteDetail.paid_at)} />
                    <DetailField label={t.invoices_subtotal} value={formatCurrency(quoteDetail.total_net)} />
                    <DetailField label="VAT total" value={formatCurrency(quoteDetail.total_vat)} />
                    <DetailField label="Gross total" value={formatCurrency(quoteDetail.total_gross)} />
                    <DetailField label={t.invoices_paid_at} value={formatCurrency(quoteDetail.paid_amount)} />
                    <DetailField label={t.contracts_notes} value={quoteDetail.notes || t.common_not_set} />
                  </div>
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description="Jump back into patient, order or document scope with the current quote context.">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/patients?patient=${quoteDetail.patient_id}`)}>Patient</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/orders?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>Order</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/invoices?quote=${quoteDetail.id}&order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>Invoices</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/documents?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>Documents</Button>
                  </div>
                </SectionCard>

                <SectionCard title="Quote lifecycle" description="Move the quote through sending and payment confirmation stages.">
                  {quoteStatusError ? <Banner tone="error">{quoteStatusError}</Banner> : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.users_status}>
                      <select
                        value={quoteStatusForm.status}
                        onChange={(event) =>
                          setQuoteStatusForm((current) => ({ ...current, status: event.target.value as QuoteStatus }))
                        }
                        className={selectClassName}
                      >
                        {QUOTE_STATUSES.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t.invoices_paid_at}>
                      <Input type="number" step="0.01" min="0" value={quoteStatusForm.paidAmount} onChange={(event) => setQuoteStatusForm((current) => ({ ...current, paidAmount: event.target.value }))} />
                    </Field>
                    <Field label={t.contracts_notes} className="sm:col-span-2">
                      <textarea className={textareaClassName} value={quoteStatusForm.notes} onChange={(event) => setQuoteStatusForm((current) => ({ ...current, notes: event.target.value }))} />
                    </Field>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" onClick={() => void handleSaveQuoteStatus()} disabled={quoteStatusBusy || !permissions.canManageQuote}>
                      {quoteStatusBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      Save quote
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard title="Line items" description="Net, VAT and gross values as stored in the quote snapshot.">
                  {!quoteDetail.line_items || quoteDetail.line_items.length === 0 ? (
                    <EmptyState title="No line items" description="This quote does not contain any materialized line items yet." />
                  ) : (
                    <div className="space-y-3">
                      {quoteDetail.line_items.map((line, index) => (
                        <div key={`${line.description}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{line.description}</h3>
                              <p className="mt-1 text-xs text-slate-500">
                                Qty {line.quantity} · Unit {formatCurrency(line.unit_price)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                                VAT {line.vat_rate}%
                              </Badge>
                              {line.is_cost_passthrough ? (
                                <Badge variant="outline" className="rounded-full border-orange-200 bg-orange-50 text-orange-700">
                                  Cost passthrough
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <MiniMetric label="Net" value={formatCurrency(line.line_net)} />
                            <MiniMetric label="VAT" value={formatCurrency(line.line_vat)} />
                            <MiniMetric label="Gross" value={formatCurrency(line.line_gross)} />
                          </div>
                          {line.notes ? (
                            <div className="mt-3 text-sm text-slate-600">{line.notes}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function StatCard({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-600">
          {icon}
        </span>
      </div>
      <div className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  const rendered =
    typeof value === "string" && value.includes("{") && value.includes("}")
      ? (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            {value}
          </pre>
        )
      : (
          <div className="text-sm text-slate-900">{value}</div>
        );

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2">{rendered}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm text-slate-900">{value}</div>
    </div>
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
    <div className={className}>
      <Label className="mb-2 block text-sm font-medium text-slate-700">{label}</Label>
      {children}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-sky-200 bg-sky-50 text-sky-700",
      )}
    >
      {children}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-[1.8rem] border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
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
    <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
