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
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type OrderPhase = "discovery" | "intake" | "execution" | "closure" | "followup";
type OrderStatus = "active" | "paused" | "completed" | "cancelled";
type LeistungStatus = "draft" | "delivered" | "approved" | "cancelled";

type OrderSummary = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  total_estimated?: unknown;
  created_at: string;
};

type Leistung = {
  id: string;
  description: string;
  quantity: unknown;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_cost_passthrough: boolean;
  status: LeistungStatus | string;
  delivered_at?: string | null;
  approved_at?: string | null;
  notes: string | null;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
};

type OrderDetail = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  needs_description: string | null;
  signed_patient?: boolean | null;
  signed_agency?: boolean | null;
  total_estimated: unknown;
  total_actual: unknown;
  leistungen: Leistung[];
  created_at: string;
  updated_at: string;
};

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type ProviderOption = {
  id: string;
  name: string;
  address_city: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  fachbereich: string | null;
};

type ProviderDetailResponse = {
  doctors?: DoctorOption[];
};

type CreateResponse = {
  id: string;
};

type OrdersFilters = {
  search: string;
  phase: string;
  status: string;
  patientId: string;
  providerId: string;
  doctorId: string;
};

type CreateOrderFormState = {
  patientId: string;
  needsDescription: string;
};

type LeistungFormState = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  providerId: string;
  doctorId: string;
  notes: string;
  isCostPassthrough: boolean;
};

type OrdersPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canManagePhase: boolean;
  canAddLeistung: boolean;
  canApproveLeistung: boolean;
};

type StatCardProps = {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type DetailFieldProps = {
  label: string;
  value: ReactNode;
};

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

const ORDER_PHASES: OrderPhase[] = [
  "discovery",
  "intake",
  "execution",
  "closure",
  "followup",
];
const ORDER_STATUSES: OrderStatus[] = ["active", "paused", "completed", "cancelled"];

const DEFAULT_FILTERS: OrdersFilters = {
  search: "",
  phase: "",
  status: "",
  patientId: "",
  providerId: "",
  doctorId: "",
};

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function orderPermissions(role?: string): OrdersPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return {
        canViewPage: true,
        canCreate: true,
        canManagePhase: true,
        canAddLeistung: true,
        canApproveLeistung: true,
      };
    case "billing":
      return {
        canViewPage: true,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
      };
    default:
      return {
        canViewPage: false,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
      };
  }
}

function blankCreateOrderForm(): CreateOrderFormState {
  return { patientId: "", needsDescription: "" };
}

function blankLeistungForm(): LeistungFormState {
  return {
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "19",
    providerId: "",
    doctorId: "",
    notes: "",
    isCostPassthrough: false,
  };
}

function phaseClassName(phase: string) {
  switch (phase) {
    case "discovery":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "intake":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "execution":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "closure":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "followup":
      return "border-violet-200 bg-violet-100 text-violet-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function statusClassName(status: string) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "paused":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "completed":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "cancelled":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "draft":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "delivered":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "approved":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function optString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: unknown) {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    if (typeof value === "string") return value;
    return "0";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
}

function formatCurrency(value: unknown, currency = "EUR") {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    const fallback = typeof value === "string" && value.trim() ? value : "0";
    return `${fallback} ${currency}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || "Patient"} (${patient.patient_id})`;
}

function nextPhase(current: string) {
  const index = ORDER_PHASES.indexOf(current as OrderPhase);
  if (index < 0 || index >= ORDER_PHASES.length - 1) return null;
  return ORDER_PHASES[index + 1];
}

function sumLeistungTotals(items: Leistung[]) {
  return items.reduce((sum, item) => {
    const quantity = numberFromUnknown(item.quantity) ?? 0;
    const unitPrice = numberFromUnknown(item.unit_price) ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
}

function StatCard({ label, value, description, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function SectionCard({ title, description, action, children, className }: SectionCardProps) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.02em] text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm text-slate-900">{value}</div>
    </div>
  );
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-500">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function OrdersPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = orderPermissions(user?.role);

  const [filters, setFilters] = useState<OrdersFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerDoctors, setProviderDoctors] = useState<Record<string, DoctorOption[]>>({});

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [phaseDraft, setPhaseDraft] = useState("");
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [approvingLeistungId, setApprovingLeistungId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateOrderFormState>(blankCreateOrderForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [leistungOpen, setLeistungOpen] = useState(false);
  const [leistungForm, setLeistungForm] = useState<LeistungFormState>(blankLeistungForm);
  const [leistungSaving, setLeistungSaving] = useState(false);
  const [leistungError, setLeistungError] = useState<string | null>(null);

  const filterDoctorOptions = useMemo(
    () => (filters.providerId ? (providerDoctors[filters.providerId] ?? []) : []),
    [filters.providerId, providerDoctors],
  );
  const leistungDoctorOptions = useMemo(
    () => (leistungForm.providerId ? (providerDoctors[leistungForm.providerId] ?? []) : []),
    [leistungForm.providerId, providerDoctors],
  );

  const metrics = useMemo(() => {
    const active = orders.filter((item) => item.status === "active").length;
    const execution = orders.filter(
      (item) => item.phase === "execution" || item.phase === "closure",
    ).length;
    const estimatedTotal = orders.reduce((sum, item) => {
      return sum + (numberFromUnknown(item.total_estimated) ?? 0);
    }, 0);

    return {
      total: orders.length,
      active,
      execution,
      estimatedTotal,
    };
  }, [orders]);

  const leistungMetrics = useMemo(() => {
    const items = orderDetail?.leistungen ?? [];
    return {
      total: items.length,
      delivered: items.filter((item) => item.status === "delivered").length,
      approved: items.filter((item) => item.status === "approved").length,
      gross: sumLeistungTotals(items),
    };
  }, [orderDetail]);

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

  function triggerReload() {
    startTransition(() => {
      setReloadNonce((current) => current + 1);
    });
  }

  const ensureProviderDoctors = useCallback(
    async (providerId: string) => {
      if (!providerId) return [] as DoctorOption[];
      const cached = providerDoctors[providerId];
      if (cached) return cached;

      const detail = await apiFetch<ProviderDetailResponse>(`/providers/${providerId}`);
      const doctors = detail.doctors ?? [];
      setProviderDoctors((current) => ({
        ...current,
        [providerId]: doctors,
      }));
      return doctors;
    },
    [providerDoctors],
  );

  function openOrder(orderId: string) {
    setDetailError(null);
    setDetailLoading(true);
    startTransition(() => {
      setSelectedOrderId(orderId);
    });
    syncQuery({ order: orderId });
  }

  function resetCreateDialog(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setCreateError(null);
      setCreateForm(blankCreateOrderForm());
      setCreateSaving(false);
    }
  }

  function resetLeistungDialog(open: boolean) {
    setLeistungOpen(open);
    if (!open) {
      setLeistungError(null);
      setLeistungForm(blankLeistungForm());
      setLeistungSaving(false);
    }
  }

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";
    const orderParam = searchParams.get("order") ?? "";

    setFilters((current) => {
      if (
        current.patientId === patientParam &&
        current.providerId === providerParam &&
        current.doctorId === doctorParam
      ) {
        return current;
      }
      return {
        ...current,
        patientId: patientParam,
        providerId: providerParam,
        doctorId: doctorParam,
      };
    });

    if (orderParam && orderParam !== selectedOrderId) {
      setSelectedOrderId(orderParam);
      setDetailLoading(true);
    }
  }, [searchParams, selectedOrderId]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    async function loadDirectory() {
      try {
        const [patientsResponse, providersResponse] = await Promise.all([
          apiFetch<PatientOption[]>("/patients"),
          apiFetch<ProviderOption[]>("/providers"),
        ]);
        if (cancelled) return;
        setPatients(patientsResponse);
        setProviders(providersResponse);
      } catch {
        if (cancelled) return;
        setPatients([]);
        setProviders([]);
      }
    }

    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    setLoading(true);
    setListError(null);

    async function loadOrders() {
      try {
        const params = new URLSearchParams();
        if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
        if (filters.phase) params.set("phase", filters.phase);
        if (filters.status) params.set("status", filters.status);
        if (filters.patientId) params.set("patient_id", filters.patientId);
        if (filters.providerId) params.set("provider_id", filters.providerId);
        if (filters.doctorId) params.set("doctor_id", filters.doctorId);

        const queryString = params.toString();
        const response = await apiFetch<OrderSummary[]>(
          `/orders${queryString ? `?${queryString}` : ""}`,
        );
        if (cancelled) return;
        setOrders(response);
      } catch (error) {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : "Failed to load orders");
        setOrders([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [
    deferredSearch,
    filters.doctorId,
    filters.patientId,
    filters.phase,
    filters.providerId,
    filters.status,
    permissions.canViewPage,
    reloadNonce,
  ]);

  useEffect(() => {
    if (!filters.providerId) return;
    void ensureProviderDoctors(filters.providerId).catch(() => {
      setProviderDoctors((current) => ({ ...current, [filters.providerId]: [] }));
    });
  }, [ensureProviderDoctors, filters.providerId]);

  useEffect(() => {
    if (!leistungForm.providerId) return;
    void ensureProviderDoctors(leistungForm.providerId).catch(() => {
      setProviderDoctors((current) => ({ ...current, [leistungForm.providerId]: [] }));
    });
  }, [ensureProviderDoctors, leistungForm.providerId]);

  useEffect(() => {
    if (!selectedOrderId) {
      setOrderDetail(null);
      setPhaseDraft("");
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    async function loadDetail() {
      try {
        const detail = await apiFetch<OrderDetail>(`/orders/${selectedOrderId}`);
        if (cancelled) return;
        setOrderDetail(detail);
        setPhaseDraft(detail.phase);
      } catch (error) {
        if (cancelled) return;
        setOrderDetail(null);
        setDetailError(error instanceof Error ? error.message : "Failed to load order");
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, selectedOrderId]);

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.patientId) {
      setCreateError("Patient is required");
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    try {
      const created = await apiFetch<CreateResponse>("/orders", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          contract_id: null,
          needs_description: optString(createForm.needsDescription),
        }),
      });

      resetCreateDialog(false);
      openOrder(created.id);
      triggerReload();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create order");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleSavePhase() {
    if (!selectedOrderId || !phaseDraft || phaseDraft === orderDetail?.phase) {
      return;
    }

    setPhaseSaving(true);
    setPhaseError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/phase`, {
        method: "POST",
        body: JSON.stringify({ phase: phaseDraft }),
      });
      triggerReload();
    } catch (error) {
      setPhaseError(error instanceof Error ? error.message : "Failed to update phase");
    } finally {
      setPhaseSaving(false);
    }
  }

  async function handleAdvancePhase() {
    if (!orderDetail) return;
    const phase = nextPhase(orderDetail.phase);
    if (!phase) return;
    setPhaseDraft(phase);
    await apiFetch(`/orders/${orderDetail.id}/phase`, {
      method: "POST",
      body: JSON.stringify({ phase }),
    })
      .then(() => {
        setPhaseError(null);
        triggerReload();
      })
      .catch((error: unknown) => {
        setPhaseDraft(orderDetail.phase);
        setPhaseError(error instanceof Error ? error.message : "Failed to advance phase");
      });
  }

  async function handleAddLeistung(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedOrderId) {
      setLeistungError("Select an order first");
      return;
    }

    const quantity = Number(leistungForm.quantity.replace(",", "."));
    const unitPrice = Number(leistungForm.unitPrice.replace(",", "."));
    const vatRate = Number(leistungForm.vatRate.replace(",", "."));

    if (!leistungForm.description.trim()) {
      setLeistungError("Description is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLeistungError("Quantity must be a positive number");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setLeistungError("Unit price must be numeric");
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setLeistungError("VAT must be numeric");
      return;
    }

    setLeistungSaving(true);
    setLeistungError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/leistungen`, {
        method: "POST",
        body: JSON.stringify({
          description: leistungForm.description.trim(),
          quantity,
          unit_price: unitPrice,
          vat_rate: vatRate,
          is_cost_passthrough: leistungForm.isCostPassthrough,
          provider_id: optString(leistungForm.providerId),
          doctor_id: optString(leistungForm.doctorId),
          notes: optString(leistungForm.notes),
        }),
      });
      resetLeistungDialog(false);
      triggerReload();
    } catch (error) {
      setLeistungError(error instanceof Error ? error.message : "Failed to add Leistung");
    } finally {
      setLeistungSaving(false);
    }
  }

  async function handleApproveLeistung(leistungId: string) {
    if (!selectedOrderId) return;

    setApprovingLeistungId(leistungId);
    try {
      await apiFetch(`/orders/${selectedOrderId}/leistungen/${leistungId}/approve`, {
        method: "POST",
      });
      triggerReload();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to approve Leistung");
    } finally {
      setApprovingLeistungId(null);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <EmptyState
        title="Orders are not available for this role"
        description="This workspace is limited to patient management, billing and CEO access in the current backend contract."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Operations
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {t.orders_title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">{t.orders_subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={triggerReload}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          {permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              New order
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Orders"
          value={String(metrics.total)}
          description="Visible records after current access rules and filters."
          icon={<ClipboardList className="size-4" />}
        />
        <StatCard
          label="Active"
          value={String(metrics.active)}
          description="Orders currently in active lifecycle states."
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="Execution"
          value={String(metrics.execution)}
          description="Orders in execution or closure phases."
          icon={<Stethoscope className="size-4" />}
        />
        <StatCard
          label="Est. Volume"
          value={formatCurrency(metrics.estimatedTotal)}
          description="Estimated order volume based on current list payload."
          icon={<Wallet className="size-4" />}
        />
      </div>

      <SectionCard
        title="Search and routing"
        description="Filter orders by patient, phase and provider context without losing the selected detail."
      >
        <div className="grid gap-4 xl:grid-cols-6">
          <div className="xl:col-span-2">
            <Label htmlFor="orders-search">{t.common_search}</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
              <Input
                id="orders-search"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                placeholder={t.search_placeholder}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label>{t.orders_phase}</Label>
            <select
              value={filters.phase}
              onChange={(event) =>
                setFilters((current) => ({ ...current, phase: event.target.value }))
              }
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">All phases</option>
              {ORDER_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t.users_status}</Label>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t.orders_patient}</Label>
            <select
              value={filters.patientId}
              onChange={(event) => {
                const patientId = event.target.value;
                setFilters((current) => ({ ...current, patientId }));
                syncQuery({ patient: patientId || null });
              }}
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">All patients</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientLabel(patient)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Provider</Label>
            <select
              value={filters.providerId}
              onChange={(event) => {
                const providerId = event.target.value;
                setFilters((current) => ({
                  ...current,
                  providerId,
                  doctorId: "",
                }));
                syncQuery({ provider: providerId || null, doctor: null });
              }}
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.address_city ? ` (${provider.address_city})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-xs">
            <Label>Doctor</Label>
            <select
              value={filters.doctorId}
              onChange={(event) => {
                const doctorId = event.target.value;
                setFilters((current) => ({ ...current, doctorId }));
                syncQuery({ doctor: doctorId || null });
              }}
              className={`mt-1 ${selectClassName}`}
              disabled={!filters.providerId}
            >
              <option value="">All doctors</option>
              {filterDoctorOptions.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                  {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                syncQuery({ patient: null, provider: null, doctor: null, order: null });
              }}
            >
              Reset filters
            </Button>
          </div>
        </div>
      </SectionCard>

      {listError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {listError}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
          {t.common_loading}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders matched these filters"
          description="Try broadening the provider or patient scope, or create the first order for a patient assignment you already manage."
          action={
            permissions.canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                New order
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => {
            const isSelected = order.id === selectedOrderId;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => openOrder(order.id)}
                className={cn(
                  "rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                  isSelected
                    ? "border-sky-300 ring-4 ring-sky-100"
                    : "border-slate-200",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                      {order.order_number}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">
                      {order.patient_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">{order.patient_pid}</p>
                  </div>
                  <ChevronRight className="mt-1 size-4 text-slate-400" />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className={cn("rounded-full", phaseClassName(order.phase))}>
                    {order.phase}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full", statusClassName(order.status))}
                  >
                    {order.status}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Created
                    </div>
                    <div className="mt-2 text-sm text-slate-900">
                      {formatDateOnly(order.created_at)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Estimated
                    </div>
                    <div className="mt-2 text-sm text-slate-900">
                      {formatCurrency(order.total_estimated)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet
        open={Boolean(selectedOrderId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOrderId(null);
            setOrderDetail(null);
            setDetailError(null);
            setPhaseDraft("");
            syncQuery({ order: null });
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-3xl"
        >
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle>
              {orderDetail ? `${orderDetail.order_number} / ${orderDetail.patient_name}` : "Order"}
            </SheetTitle>
            <SheetDescription>
              Full operational view for the current order, including phase control and provider-linked Leistungen.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-6 py-6">
            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
                <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
                {t.common_loading}
              </div>
            ) : detailError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {detailError}
              </div>
            ) : !orderDetail ? (
              <EmptyState
                title="Order detail is empty"
                description="Choose an order from the list to load the detail workspace."
              />
            ) : (
              <>
                <SectionCard
                  title="Order overview"
                  description="Patient and delivery context for this order."
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("rounded-full", phaseClassName(orderDetail.phase))}>
                        {orderDetail.phase}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", statusClassName(orderDetail.status))}
                      >
                        {orderDetail.status}
                      </Badge>
                    </div>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField
                      label="Patient"
                      value={`${orderDetail.patient_name} (${orderDetail.patient_pid})`}
                    />
                    <DetailField
                      label="Created"
                      value={
                        <span className="inline-flex items-center gap-2">
                          <CalendarClock className="size-4 text-slate-500" />
                          {formatDateTime(orderDetail.created_at)}
                        </span>
                      }
                    />
                    <DetailField
                      label="Updated"
                      value={
                        <span className="inline-flex items-center gap-2">
                          <RefreshCw className="size-4 text-slate-500" />
                          {formatDateTime(orderDetail.updated_at)}
                        </span>
                      }
                    />
                    <DetailField
                      label="Signatures"
                      value={`${orderDetail.signed_patient ? "Patient signed" : "Patient pending"} / ${
                        orderDetail.signed_agency ? "Agency signed" : "Agency pending"
                      }`}
                    />
                    <DetailField
                      label="Needs"
                      value={orderDetail.needs_description || "No intake note"}
                    />
                    <DetailField
                      label="Estimated total"
                      value={formatCurrency(orderDetail.total_estimated)}
                    />
                    <DetailField
                      label="Actual total"
                      value={formatCurrency(orderDetail.total_actual)}
                    />
                    <DetailField
                      label="Leistungen"
                      value={`${leistungMetrics.total} items / ${leistungMetrics.delivered} delivered / ${leistungMetrics.approved} approved`}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Linked workspaces"
                  description="Jump to the adjacent patient, case and appointment contexts without rebuilding filters manually."
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/patients?patient=${orderDetail.patient_id}`)}
                    >
                      Patient
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/cases?patient=${orderDetail.patient_id}`)}
                    >
                      Cases
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/appointments?patient=${orderDetail.patient_id}`)}
                    >
                      Appointments
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Phase control"
                  description="Current backend allows explicit phase changes and forward progression."
                  action={
                    permissions.canManagePhase && nextPhase(orderDetail.phase) ? (
                      <Button variant="outline" onClick={() => void handleAdvancePhase()}>
                        <ChevronRight className="mr-2 size-4" />
                        Advance to {nextPhase(orderDetail.phase)}
                      </Button>
                    ) : null
                  }
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex flex-wrap gap-2">
                      {ORDER_PHASES.map((phase) => (
                        <button
                          key={phase}
                          type="button"
                          disabled={!permissions.canManagePhase}
                          onClick={() => setPhaseDraft(phase)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition",
                            phaseDraft === phase
                              ? phaseClassName(phase)
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                            !permissions.canManagePhase && "cursor-not-allowed opacity-60",
                          )}
                        >
                          {phase}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {permissions.canManagePhase ? (
                        <Button
                          onClick={() => void handleSavePhase()}
                          disabled={
                            phaseSaving || !phaseDraft || phaseDraft === orderDetail.phase
                          }
                        >
                          {phaseSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                          Save phase
                        </Button>
                      ) : (
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-100 text-slate-600"
                        >
                          Billing read-only
                        </Badge>
                      )}
                    </div>
                  </div>
                  {phaseError ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {phaseError}
                    </div>
                  ) : null}
                </SectionCard>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Leistungen"
                    value={String(leistungMetrics.total)}
                    description="Current service lines attached to this order."
                    icon={<ClipboardList className="size-4" />}
                  />
                  <StatCard
                    label="Delivered"
                    value={String(leistungMetrics.delivered)}
                    description="Service lines waiting for PM approval."
                    icon={<CheckCircle2 className="size-4" />}
                  />
                  <StatCard
                    label="Approved"
                    value={String(leistungMetrics.approved)}
                    description="Lines already approved in the current order."
                    icon={<Wallet className="size-4" />}
                  />
                  <StatCard
                    label="Gross"
                    value={formatCurrency(leistungMetrics.gross)}
                    description="Quantity x price across visible service lines."
                    icon={<Building2 className="size-4" />}
                  />
                </div>

                <SectionCard
                  title="Leistungen"
                  description="Provider- and doctor-linked services within the current order."
                  action={
                    permissions.canAddLeistung ? (
                      <Button onClick={() => resetLeistungDialog(true)}>
                        <Plus className="mr-2 size-4" />
                        Add Leistung
                      </Button>
                    ) : null
                  }
                >
                  {orderDetail.leistungen.length === 0 ? (
                    <EmptyState
                      title="No Leistungen yet"
                      description="Use provider-linked lines to build the order delivery scope and give billing enough context."
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            Add Leistung
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {orderDetail.leistungen.map((leistung) => (
                        <div
                          key={leistung.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-slate-950">
                                  {leistung.description}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn("rounded-full", statusClassName(leistung.status))}
                                >
                                  {leistung.status}
                                </Badge>
                                {leistung.is_cost_passthrough ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-violet-200 bg-violet-100 text-violet-700"
                                  >
                                    Cost pass-through
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <DetailField
                                  label="Provider"
                                  value={
                                    leistung.provider_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          navigate(`/providers?provider=${leistung.provider_id}`)
                                        }
                                      >
                                        {leistung.provider_name || "Open provider"}
                                      </button>
                                    ) : (
                                      leistung.provider_name || "Unlinked"
                                    )
                                  }
                                />
                                <DetailField
                                  label="Doctor"
                                  value={
                                    leistung.provider_id && leistung.doctor_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          navigate(
                                            `/appointments?provider=${leistung.provider_id}&doctor=${leistung.doctor_id}`,
                                          )
                                        }
                                      >
                                        {leistung.doctor_name || "Open doctor context"}
                                      </button>
                                    ) : (
                                      leistung.doctor_name || "Not specified"
                                    )
                                  }
                                />
                                <DetailField
                                  label="Quantity"
                                  value={formatNumber(leistung.quantity)}
                                />
                                <DetailField
                                  label="Unit price"
                                  value={formatCurrency(leistung.unit_price, leistung.currency)}
                                />
                                <DetailField
                                  label="VAT"
                                  value={`${formatNumber(leistung.vat_rate)}%`}
                                />
                                <DetailField
                                  label="Gross line"
                                  value={formatCurrency(
                                    (numberFromUnknown(leistung.quantity) ?? 0) *
                                      (numberFromUnknown(leistung.unit_price) ?? 0),
                                    leistung.currency,
                                  )}
                                />
                                <DetailField
                                  label="Delivered"
                                  value={formatDateTime(leistung.delivered_at)}
                                />
                                <DetailField
                                  label="Approved"
                                  value={formatDateTime(leistung.approved_at)}
                                />
                              </div>

                              {leistung.notes ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                                  {leistung.notes}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 items-start">
                              {permissions.canApproveLeistung && leistung.status === "delivered" ? (
                                <Button
                                  onClick={() => void handleApproveLeistung(leistung.id)}
                                  disabled={approvingLeistungId === leistung.id}
                                >
                                  {approvingLeistungId === leistung.id ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 size-4" />
                                  )}
                                  Approve
                                </Button>
                              ) : null}
                            </div>
                          </div>
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

      <Dialog open={createOpen} onOpenChange={resetCreateDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateOrder} className="space-y-4">
            {createError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {createError}
              </div>
            ) : null}

            <div>
              <Label>{t.orders_patient}</Label>
              <select
                required
                value={createForm.patientId}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    patientId: event.target.value,
                  }))
                }
                className={`mt-1 ${selectClassName}`}
              >
                <option value="">Select patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patientLabel(patient)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Needs / intake note</Label>
              <textarea
                value={createForm.needsDescription}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    needsDescription: event.target.value,
                  }))
                }
                className={`mt-1 ${textareaClassName}`}
                placeholder="Describe treatment need, provider expectations or intake remarks."
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => resetCreateDialog(false)}>
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={createSaving}>
                {createSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={leistungOpen} onOpenChange={resetLeistungDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Leistung</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLeistung} className="space-y-4">
            {leistungError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {leistungError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Description</Label>
                <Input
                  required
                  value={leistungForm.description}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={leistungForm.notes}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Quantity</Label>
                <Input
                  value={leistungForm.quantity}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Unit price</Label>
                <Input
                  value={leistungForm.unitPrice}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      unitPrice: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>VAT %</Label>
                <Input
                  value={leistungForm.vatRate}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      vatRate: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Provider</Label>
                <select
                  value={leistungForm.providerId}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    setLeistungForm((current) => ({
                      ...current,
                      providerId,
                      doctorId: "",
                    }));
                  }}
                  className={`mt-1 ${selectClassName}`}
                >
                  <option value="">Select provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.address_city ? ` (${provider.address_city})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Doctor</Label>
                <select
                  value={leistungForm.doctorId}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      doctorId: event.target.value,
                    }))
                  }
                  className={`mt-1 ${selectClassName}`}
                  disabled={!leistungForm.providerId}
                >
                  <option value="">Select doctor</option>
                  {leistungDoctorOptions.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                      {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leistungForm.isCostPassthrough}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      isCostPassthrough: event.target.checked,
                    }))
                  }
                  className="mt-1 size-4 rounded border-slate-300"
                />
                <span>
                  <div className="text-sm font-medium text-slate-900">Treat as cost pass-through</div>
                  <div className="mt-1 text-sm text-slate-500">
                    Keep the line item visible for billing without merging it into agency-owned margin logic.
                  </div>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => resetLeistungDialog(false)}>
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={leistungSaving}>
                {leistungSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
