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
import { CalendarClock, ChevronRight, Download, LoaderCircle, Plus, RefreshCw, Search, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiFetch, getAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { PatientInvoicesPage } from "@/pages/patient-invoices";
import { cn } from "@/lib/utils";

type InvoiceType = "advance" | "interim" | "final";
type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

type InvoiceLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  notes?: string | null;
};

type InvoiceItem = {
  id: string;
  quote_id: string | null;
  quote_number: string | null;
  order_id: string;
  order_number: string;
  contract_id: string | null;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  invoice_number: string;
  invoice_type: InvoiceType | string;
  status: InvoiceStatus | string;
  issued_at: string;
  due_date: string | null;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  paid_amount: unknown;
  balance_due: unknown;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  line_items?: InvoiceLineItem[];
};

type DunningEvent = {
  id: string;
  invoice_id: string;
  level: "first" | "second" | "collections" | string;
  note: string | null;
  due_date_snapshot: string | null;
  balance_due: unknown;
  sent_at: string;
  created_at: string;
  created_by_name?: string;
  created_by_role?: string;
};

type PatientOption = { id: string; patient_id: string; first_name?: string; last_name?: string };
type OrderOption = { id: string; order_number: string; patient_id: string; patient_name: string; patient_pid: string };
type QuoteOption = { id: string; order_id: string; order_number: string; patient_id: string; patient_name: string; patient_pid: string; quote_number: string; total_gross: unknown };

type Filters = { search: string; patientId: string; orderId: string; quoteId: string; status: string; invoiceType: string };
type CreateForm = { quoteId: string; invoiceType: InvoiceType; dueDate: string; notes: string };
type StatusForm = { status: InvoiceStatus; dueDate: string; paidAmount: string; notes: string };
type DunningForm = { note: string };

const INVOICE_TYPES: InvoiceType[] = ["advance", "interim", "final"];
const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"];
const DEFAULT_FILTERS: Filters = { search: "", patientId: "", orderId: "", quoteId: "", status: "", invoiceType: "" };
const selectClassName = "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName = "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function permissions(role?: string) {
  return {
    canView: role === "ceo" || role === "patient_manager" || role === "billing",
    canCreate: role === "ceo" || role === "patient_manager" || role === "billing",
    canManage: role === "ceo" || role === "billing",
  };
}

function buildInvoicesPath(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.quoteId) params.set("quote_id", filters.quoteId);
  if (filters.status) params.set("status", filters.status);
  if (filters.invoiceType) params.set("invoice_type", filters.invoiceType);
  return params.size ? `/invoices?${params.toString()}` : "/invoices";
}

function buildSearchParams(current: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

function blankCreateForm(quoteId = ""): CreateForm {
  return { quoteId, invoiceType: "final", dueDate: "", notes: "" };
}

function invoiceToStatusForm(invoice: InvoiceItem): StatusForm {
  return {
    status: (invoice.status as InvoiceStatus) ?? "draft",
    dueDate: invoice.due_date ?? "",
    paidAmount: invoice.paid_amount === null || invoice.paid_amount === undefined ? "" : String(invoice.paid_amount),
    notes: invoice.notes ?? "",
  };
}

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  try { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
  catch { return value; }
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  try { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  catch { return value; }
}

function formatCurrency(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "EUR 0.00";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
}

async function fetchInvoicePdfBlob(path: string) {
  const token = getAccessToken();
  const response = await fetch(`/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.blob();
}

function openPdfBlobPreview(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const previewWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    URL.revokeObjectURL(url);
    throw new Error("Allow pop-ups to preview the invoice PDF.");
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openInvoicePdfPreview(invoiceId: string) {
  const blob = await fetchInvoicePdfBlob(`/invoices/${invoiceId}/pdf`);
  openPdfBlobPreview(blob);
}

async function downloadInvoicePdf(invoiceId: string, filename: string) {
  const blob = await fetchInvoicePdfBlob(`/invoices/${invoiceId}/pdf`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "invoice.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "paid": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partially_paid": return "border-amber-200 bg-amber-50 text-amber-700";
    case "sent": return "border-sky-200 bg-sky-50 text-sky-700";
    case "overdue":
    case "cancelled": return "border-rose-200 bg-rose-50 text-rose-700";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function typeBadgeClass(invoiceType: string) {
  switch (invoiceType) {
    case "advance": return "border-violet-200 bg-violet-50 text-violet-700";
    case "interim": return "border-sky-200 bg-sky-50 text-sky-700";
    case "final": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function nextDunningLevel(events: DunningEvent[]) {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}

function StaffInvoicesPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const access = permissions(user?.role);

  const initialPatientId = searchParams.get("patient") ?? "";
  const initialOrderId = searchParams.get("order") ?? "";
  const initialQuoteId = searchParams.get("quote") ?? "";
  const initialInvoiceId = searchParams.get("invoice") ?? "";

  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, patientId: initialPatientId, orderId: initialOrderId, quoteId: initialQuoteId });
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoiceId);
  const [detail, setDetail] = useState<InvoiceItem | null>(null);
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(blankCreateForm(initialQuoteId));
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statusForm, setStatusForm] = useState<StatusForm>({ status: "draft", dueDate: "", paidAmount: "", notes: "" });
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningError, setDunningError] = useState<string | null>(null);
  const [dunningForm, setDunningForm] = useState<DunningForm>({ note: "" });

  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch]);

  const syncQuery = (patch: Record<string, string | null | undefined>) => {
    setSearchParams((current) => buildSearchParams(current, patch), { replace: true });
  };

  const filteredOrders = useMemo(() => {
    if (!filters.patientId) return orders;
    return orders.filter((order) => order.patient_id === filters.patientId);
  }, [filters.patientId, orders]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      if (filters.patientId && quote.patient_id !== filters.patientId) return false;
      if (filters.orderId && quote.order_id !== filters.orderId) return false;
      return true;
    });
  }, [filters.orderId, filters.patientId, quotes]);

  const selectedCreateQuote = useMemo(() => quotes.find((quote) => quote.id === createForm.quoteId) ?? null, [quotes, createForm.quoteId]);
  const stats = useMemo(() => {
    const paid = invoices.filter((invoice) => invoice.status === "paid").length;
    const sent = invoices.filter((invoice) => invoice.status === "sent").length;
    const gross = invoices.reduce((sum, invoice) => sum + Number(invoice.total_gross ?? 0), 0);
    const balance = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due ?? 0), 0);
    return { total: invoices.length, paid, sent, gross, balance };
  }, [invoices]);
  const nextDunning = useMemo(() => nextDunningLevel(dunningEvents), [dunningEvents]);

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      try {
        const [patientsResult, ordersResult, quotesResult] = await Promise.all([
          apiFetch<PatientOption[]>("/patients?active_only=false"),
          apiFetch<OrderOption[]>("/orders"),
          apiFetch<QuoteOption[]>("/quotes"),
        ]);
        if (ignore) return;
        setPatients(patientsResult);
        setOrders(ordersResult);
        setQuotes(quotesResult);
        setOptionsError(null);
      } catch (error) {
        if (!ignore) setOptionsError(error instanceof Error ? error.message : t.common_error);
      }
    }
    void loadOptions();
    return () => {
      ignore = true;
    };
  }, [t.common_error]);

  useEffect(() => {
    let ignore = false;
    async function loadInvoices() {
      setListBusy(true);
      try {
        const data = await apiFetch<InvoiceItem[]>(buildInvoicesPath(effectiveFilters));
        if (!ignore) {
          setInvoices(data);
          setListError(null);
        }
      } catch (error) {
        if (!ignore) setListError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setListBusy(false);
      }
    }
    void loadInvoices();
    return () => {
      ignore = true;
    };
  }, [effectiveFilters, reloadToken, t.common_error]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setDetail(null);
      setDunningEvents([]);
      setDetailError(null);
      return;
    }
    let ignore = false;
    async function loadDetail() {
      setDetailBusy(true);
      try {
        const [data, dunning] = await Promise.all([
          apiFetch<InvoiceItem>(`/invoices/${selectedInvoiceId}`),
          apiFetch<DunningEvent[]>(`/invoices/${selectedInvoiceId}/dunning`),
        ]);
        if (!ignore) {
          setDetail(data);
          setDunningEvents(dunning);
          setStatusForm(invoiceToStatusForm(data));
          setDunningForm({ note: "" });
          setDunningError(null);
          setDetailError(null);
        }
      } catch (error) {
        if (!ignore) setDetailError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setDetailBusy(false);
      }
    }
    void loadDetail();
    return () => {
      ignore = true;
    };
  }, [selectedInvoiceId, reloadToken, t.common_error]);

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.quoteId) {
      setCreateError("Select a quote first.");
      return;
    }
    setCreateBusy(true);
    try {
      const created = await apiFetch<InvoiceItem>(`/quotes/${createForm.quoteId}/invoices`, {
        method: "POST",
        body: JSON.stringify({
          invoice_type: createForm.invoiceType,
          due_date: createForm.dueDate || null,
          notes: createForm.notes.trim() || null,
        }),
      });
      setCreateOpen(false);
      setCreateForm(blankCreateForm(filters.quoteId));
      setCreateError(null);
      setReloadToken((current) => current + 1);
      setSelectedInvoiceId(created.id);
      syncQuery({ invoice: created.id });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveStatus() {
    if (!selectedInvoiceId) return;
    setStatusBusy(true);
    try {
      await apiFetch<InvoiceItem>(`/invoices/${selectedInvoiceId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: statusForm.status,
          due_date: statusForm.dueDate || null,
          paid_amount: statusForm.paidAmount.trim() ? Number(statusForm.paidAmount) : null,
          notes: statusForm.notes.trim() || null,
        }),
      });
      setStatusError(null);
      setReloadToken((current) => current + 1);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleCreateDunning() {
    if (!selectedInvoiceId || !nextDunning) return;
    setDunningBusy(true);
    try {
      const created = await apiFetch<DunningEvent>(`/invoices/${selectedInvoiceId}/dunning`, {
        method: "POST",
        body: JSON.stringify({
          level: nextDunning,
          note: dunningForm.note.trim() || null,
        }),
      });
      setDunningEvents((current) => [...current, created]);
      setDunningForm({ note: "" });
      setDunningError(null);
      setReloadToken((current) => current + 1);
    } catch (error) {
      setDunningError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setDunningBusy(false);
    }
  }

  function openInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    syncQuery({ invoice: invoiceId });
  }

  if (!access.canView) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-800 shadow-sm">
        Invoices are restricted to CEO, patient managers and billing.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Billing workspace</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{t.invoices_title}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Advance, interim and final billing documents generated from live quote snapshots.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setReloadToken((current) => current + 1)}>
                <RefreshCw className="mr-2 size-4" />
                Refresh
              </Button>
              {access.canCreate ? (
                <Button type="button" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => { setCreateForm(blankCreateForm(filters.quoteId)); setCreateError(null); setCreateOpen(true); }}>
                  <Plus className="mr-2 size-4" />
                  New invoice
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-4">
          <StatCard label="Invoices" value={String(stats.total)} description={`${stats.sent} sent / ${stats.paid} paid`} icon={<Wallet className="size-5" />} />
          <StatCard label="Gross total" value={formatCurrency(stats.gross)} description="Current visible invoice total" icon={<CalendarClock className="size-5" />} />
          <StatCard label="Open balance" value={formatCurrency(stats.balance)} description="Remaining amount due" icon={<Wallet className="size-5" />} />
          <StatCard label="Quotes ready" value={String(filteredQuotes.length)} description="Available quote contexts" icon={<Plus className="size-5" />} />
        </div>

        {optionsError ? <Banner tone="error">{optionsError}</Banner> : null}

        <SectionCard title={t.invoices_title} description={t.invoices_subtitle}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(220px,1fr)_minmax(220px,1fr)_minmax(220px,1fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={filters.search} onChange={(event) => startTransition(() => setFilters((current) => ({ ...current, search: event.target.value })))} className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-9" placeholder="Search invoice, quote, order or patient" />
            </div>
            <select value={filters.patientId} onChange={(event) => {
              const patientId = event.target.value;
              setFilters((current) => ({ ...current, patientId, orderId: current.orderId && orders.some((order) => order.id === current.orderId && order.patient_id === patientId) ? current.orderId : "", quoteId: current.quoteId && quotes.some((quote) => quote.id === current.quoteId && quote.patient_id === patientId) ? current.quoteId : "" }));
              syncQuery({ patient: patientId || null, order: null, quote: null });
            }} className={selectClassName}>
              <option value="">{t.providers_all}</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{`${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`}</option>)}
            </select>
            <select value={filters.orderId} onChange={(event) => {
              const orderId = event.target.value;
              setFilters((current) => ({ ...current, orderId, quoteId: current.quoteId && quotes.some((quote) => quote.id === current.quoteId && quote.order_id === orderId) ? current.quoteId : "" }));
              syncQuery({ order: orderId || null, quote: null });
            }} className={selectClassName}>
              <option value="">All orders</option>
              {filteredOrders.map((order) => <option key={order.id} value={order.id}>{`${order.order_number} · ${order.patient_pid} · ${order.patient_name}`}</option>)}
            </select>
            <select value={filters.quoteId} onChange={(event) => {
              const quoteId = event.target.value;
              setFilters((current) => ({ ...current, quoteId }));
              syncQuery({ quote: quoteId || null });
            }} className={selectClassName}>
              <option value="">All quotes</option>
              {filteredQuotes.map((quote) => <option key={quote.id} value={quote.id}>{`${quote.quote_number} · ${quote.order_number} · ${quote.patient_pid}`}</option>)}
            </select>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={selectClassName}>
              <option value="">{t.providers_all}</option>
              {INVOICE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={filters.invoiceType} onChange={(event) => setFilters((current) => ({ ...current, invoiceType: event.target.value }))} className={selectClassName}>
              <option value="">{t.providers_all}</option>
              {INVOICE_TYPES.map((invoiceType) => <option key={invoiceType} value={invoiceType}>{invoiceType}</option>)}
            </select>
            <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={() => setFilters({ ...DEFAULT_FILTERS, patientId: searchParams.get("patient") ?? "", orderId: searchParams.get("order") ?? "", quoteId: searchParams.get("quote") ?? "" })}>{t.access_reset}</Button>
          </div>
        </SectionCard>

        {listBusy ? (
          <LoadingState label={t.common_loading} />
        ) : listError ? (
          <Banner tone="error">{listError}</Banner>
        ) : invoices.length === 0 ? (
          <EmptyState title={t.common_not_set} description="Create the first invoice from a live quote snapshot." action={access.canCreate ? <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="mr-2 size-4" />{t.invoices_new}</Button> : null} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {invoices.map((invoice) => {
              const isSelected = selectedInvoiceId === invoice.id;
              return (
                <button key={invoice.id} type="button" onClick={() => openInvoice(invoice.id)} className={cn("rounded-[1.6rem] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md", isSelected ? "border-sky-300 ring-4 ring-sky-100" : "border-slate-200")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">{invoice.invoice_number}</div>
                      <h2 className="mt-2 text-lg font-semibold text-slate-950">{invoice.patient_name}</h2>
                      <p className="mt-1 text-sm text-slate-500">{`${invoice.order_number} · ${invoice.patient_pid}`}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 text-slate-400" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline" className={cn("rounded-full", statusBadgeClass(invoice.status))}>{invoice.status}</Badge>
                    <Badge variant="outline" className={cn("rounded-full", typeBadgeClass(invoice.invoice_type))}>{invoice.invoice_type}</Badge>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">{formatCurrency(invoice.total_gross)}</Badge>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <MiniMetric label={t.contracts_type} value={invoice.quote_number ?? t.common_not_set} />
                    <MiniMetric label={t.invoices_due_at} value={formatDate(invoice.due_date)} />
                    <MiniMetric label="Paid" value={formatCurrency(invoice.paid_amount)} />
                    <MiniMetric label="Balance" value={formatCurrency(invoice.balance_due)} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.invoices_new}</DialogTitle>
            <DialogDescription>Generate advance, interim or final invoice from a quote snapshot.</DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateInvoice}>
            {createError ? <Banner tone="error">{createError}</Banner> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.contracts_type} className="sm:col-span-2">
                <select required value={createForm.quoteId} onChange={(event) => setCreateForm((current) => ({ ...current, quoteId: event.target.value }))} className={selectClassName}>
                  <option value="">Select quote</option>
                  {filteredQuotes.map((quote) => <option key={quote.id} value={quote.id}>{`${quote.quote_number} · ${quote.order_number} · ${quote.patient_pid}`}</option>)}
                </select>
              </Field>
              <Field label={t.invoices_type}>
                <select value={createForm.invoiceType} onChange={(event) => setCreateForm((current) => ({ ...current, invoiceType: event.target.value as InvoiceType }))} className={selectClassName}>
                  {INVOICE_TYPES.map((invoiceType) => <option key={invoiceType} value={invoiceType}>{invoiceType}</option>)}
                </select>
              </Field>
              <Field label={t.invoices_due_at}>
                <Input type="date" value={createForm.dueDate} onChange={(event) => setCreateForm((current) => ({ ...current, dueDate: event.target.value }))} />
              </Field>
              <Field label="Selected quote snapshot" className="sm:col-span-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {selectedCreateQuote ? `${selectedCreateQuote.quote_number} · ${selectedCreateQuote.order_number} · ${formatCurrency(selectedCreateQuote.total_gross)}` : "Choose a quote"}
                </div>
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <textarea className={textareaClassName} value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Billing note or payment instruction" />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t.common_cancel}</Button>
              <Button type="submit" disabled={createBusy || !createForm.quoteId}>
                {createBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                {t.invoices_new}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(selectedInvoiceId)} onOpenChange={(open) => {
        if (!open) {
          setSelectedInvoiceId("");
          setDetail(null);
          setDunningEvents([]);
          setDunningError(null);
          setDetailError(null);
          syncQuery({ invoice: null });
        }
      }}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle>{detail ? `${detail.invoice_number} / ${detail.patient_name}` : t.invoices_title}</SheetTitle>
            <SheetDescription>Totals, payment state and line item snapshot for the selected invoice.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 py-6">
            {detailBusy ? <LoadingState label={t.common_loading} /> : detailError ? <Banner tone="error">{detailError}</Banner> : !detail ? <EmptyState title="No invoice selected" description="Choose an invoice card to open the billing detail workspace." /> : (
              <>
                <SectionCard
                  title="Invoice overview"
                  description="Commercial totals and linked quote/order context."
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void openInvoicePdfPreview(detail.id).catch((error) =>
                            setDetailError(error instanceof Error ? error.message : "Failed to open invoice PDF."),
                          )
                        }
                      >
                        Preview PDF
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void downloadInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((error) =>
                            setDetailError(error instanceof Error ? error.message : "Failed to download invoice PDF."),
                          )
                        }
                      >
                        <Download className="size-4" />
                        Download PDF
                      </Button>
                      <Badge variant="outline" className={cn("rounded-full", statusBadgeClass(detail.status))}>
                        {detail.status}
                      </Badge>
                      <Badge variant="outline" className={cn("rounded-full", typeBadgeClass(detail.invoice_type))}>
                        {detail.invoice_type}
                      </Badge>
                    </div>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.invoices_patient} value={`${detail.patient_name} (${detail.patient_pid})`} />
                    <DetailField label={t.orders_title} value={detail.order_number} />
                    <DetailField label={t.contracts_type} value={detail.quote_number ?? t.common_not_set} />
                    <DetailField label={t.invoices_issued_at} value={formatDateTime(detail.issued_at)} />
                    <DetailField label={t.invoices_due_at} value={formatDate(detail.due_date)} />
                    <DetailField label={t.invoices_paid_at} value={formatDateTime(detail.paid_at)} />
                    <DetailField label="Gross total" value={formatCurrency(detail.total_gross)} />
                    <DetailField label={t.invoices_paid_at} value={formatCurrency(detail.paid_amount)} />
                    <DetailField label="Balance due" value={formatCurrency(detail.balance_due)} />
                    <DetailField label="Notes" value={detail.notes || t.common_not_set} />
                  </div>
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description={t.common_search}>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)}>Patient</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/orders?order=${detail.order_id}&patient=${detail.patient_id}`)}>Order</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/contracts?quote=${detail.quote_id ?? ""}&order=${detail.order_id}&patient=${detail.patient_id}&tab=quotes`)}>Quotes</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/documents?order=${detail.order_id}&patient=${detail.patient_id}`)}>Documents</Button>
                  </div>
                </SectionCard>

                <SectionCard title={t.invoices_status} description={t.invoices_subtitle}>
                  {statusError ? <Banner tone="error">{statusError}</Banner> : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.users_status}>
                      <select value={statusForm.status} onChange={(event) => setStatusForm((current) => ({ ...current, status: event.target.value as InvoiceStatus }))} className={selectClassName} disabled={!access.canManage}>
                        {INVOICE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </Field>
                    <Field label={t.invoices_due_at}>
                      <Input type="date" value={statusForm.dueDate} onChange={(event) => setStatusForm((current) => ({ ...current, dueDate: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                    <Field label={t.invoices_paid_at}>
                      <Input type="number" step="0.01" min="0" value={statusForm.paidAmount} onChange={(event) => setStatusForm((current) => ({ ...current, paidAmount: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                    <Field label="Notes" className="sm:col-span-2">
                      <textarea className={textareaClassName} value={statusForm.notes} onChange={(event) => setStatusForm((current) => ({ ...current, notes: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" onClick={() => void handleSaveStatus()} disabled={statusBusy || !access.canManage}>
                      {statusBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      Save invoice
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard title="Mahnwesen" description="First reminder, second reminder and collections escalation trail.">
                  {dunningError ? <Banner tone="error">{dunningError}</Banner> : null}
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="space-y-3">
                      {dunningEvents.length === 0 ? (
                        <EmptyState title="No dunning events" description="Once the invoice is overdue, billing can trigger the first reminder from here." />
                      ) : (
                        dunningEvents.map((event) => (
                          <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{event.level}</div>
                                <div className="mt-1 text-xs text-slate-500">{`${formatDateTime(event.sent_at)} · ${event.created_by_name ?? "System"}`}</div>
                              </div>
                              <Badge variant="outline" className={cn("rounded-full", statusBadgeClass("overdue"))}>{formatCurrency(event.balance_due)}</Badge>
                            </div>
                            {event.note ? <div className="mt-3 text-sm text-slate-600">{event.note}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Next escalation</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn("rounded-full", nextDunning ? typeBadgeClass(nextDunning) : "border-slate-200 bg-white text-slate-500")}>
                          {nextDunning ?? "Completed"}
                        </Badge>
                        <span className="text-sm text-slate-600">{`Balance ${formatCurrency(detail.balance_due)}`}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <Field label="Dunning note">
                          <textarea className={textareaClassName} value={dunningForm.note} onChange={(event) => setDunningForm({ note: event.target.value })} disabled={!access.canManage || !nextDunning} placeholder="Reminder message or internal billing note" />
                        </Field>
                        <Button type="button" className="w-full" onClick={() => void handleCreateDunning()} disabled={dunningBusy || !access.canManage || !nextDunning}>
                          {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                          {nextDunning ? `Send ${nextDunning}` : "No further escalation"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Line items" description="Invoice snapshot as stored during creation.">
                  {!detail.line_items || detail.line_items.length === 0 ? <EmptyState title="No line items" description="This invoice does not contain any materialized items yet." /> : (
                    <div className="space-y-3">
                      {detail.line_items.map((line, index) => (
                        <div key={`${line.description}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{line.description}</h3>
                              <p className="mt-1 text-xs text-slate-500">{`Qty ${line.quantity} · Unit ${formatCurrency(line.unit_price)}`}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">{`VAT ${line.vat_rate}%`}</Badge>
                              {line.is_cost_passthrough ? <Badge variant="outline" className="rounded-full border-orange-200 bg-orange-50 text-orange-700">Cost passthrough</Badge> : null}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <MiniMetric label="Net" value={formatCurrency(line.line_net)} />
                            <MiniMetric label={t.invoices_vat} value={formatCurrency(line.line_vat)} />
                            <MiniMetric label="Gross" value={formatCurrency(line.line_gross)} />
                          </div>
                          {line.notes ? <div className="mt-3 text-sm text-slate-600">{line.notes}</div> : null}
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

export function InvoicesPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientInvoicesPage />;
  }

  return <StaffInvoicesPage />;
}

function StatCard({ label, value, description, icon }: { label: string; value: string; description: string; icon: ReactNode }) {
  return (
    <div className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-600">{icon}</span>
      </div>
      <div className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function SectionCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
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
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-900">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-900">{value}</div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-2 block text-sm font-medium text-slate-700">{label}</Label>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-sky-200 bg-sky-50 text-sky-700")}>
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

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
