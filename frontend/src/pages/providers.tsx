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
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Star,
  Stethoscope,
  Trash2,
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
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

type ProviderType = "medical" | "non_medical";

type ProviderSummary = {
  id: string;
  name: string;
  provider_type: ProviderType;
  legal_name: string | null;
  tax_id: string | null;
  address_city: string | null;
  address_country: string | null;
  fachbereich: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  has_contract: boolean;
  doctor_count: number;
  patient_count: number;
  appointment_count: number;
  service_count: number;
  concierge_service_count: number;
  open_concierge_service_count: number;
  rating_count: number;
  avg_rating: number | null;
  last_interaction_at: string | null;
  created_at: string;
};

type LinkedPatient = {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  appointment_count: number;
  leistung_count: number;
  concierge_count: number;
  last_interaction_at: string;
};

type InteractionItem = {
  kind: string;
  id: string;
  patient_id: string;
  patient_name: string;
  doctor_id: string | null;
  doctor_name: string | null;
  order_id: string | null;
  order_number: string | null;
  status: string;
  title: string;
  appointment_type: string | null;
  location: string | null;
  notes: string | null;
  occurred_at: string;
  quantity: string | null;
  unit_price: string | null;
  currency: string | null;
};

type DoctorSummary = {
  id: string;
  provider_id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
  languages: string[];
  phone: string | null;
  email: string | null;
  license_number: string | null;
  licensing_country: string | null;
  licensing_valid_until: string | null;
  notes: string | null;
  patient_count: number;
  appointment_count: number;
  created_at: string;
};

type ServiceItem = {
  id: string;
  provider_id: string;
  service_name: string;
  description: string | null;
  price: string;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

type ProviderDetail = {
  id: string;
  name: string;
  provider_type: ProviderType;
  legal_name: string | null;
  tax_id: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  fachbereich: string | null;
  kooperationsvertrag: unknown;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  doctors: DoctorSummary[];
  services: ServiceItem[];
  linked_patients: LinkedPatient[];
  interactions: InteractionItem[];
};

type CreateResponse = {
  id: string;
  created_at?: string;
};

type ProviderFilters = {
  search: string;
  providerType: string;
  activeOnly: string;
  city: string;
  country: string;
  fachbereich: string;
  doctorName: string;
  doctorFachbereich: string;
  serviceName: string;
  hasContract: string;
  ratingGte: string;
};

type ProviderFormState = {
  name: string;
  providerType: ProviderType;
  legalName: string;
  taxId: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  phone: string;
  email: string;
  website: string;
  fachbereich: string;
  contractText: string;
  notes: string;
};

type DoctorFormState = {
  id: string;
  name: string;
  title: string;
  fachbereich: string;
  languages: string;
  phone: string;
  email: string;
  licenseNumber: string;
  licensingCountry: string;
  licensingValidUntil: string;
  notes: string;
};

type ServiceFormState = {
  id: string;
  serviceName: string;
  description: string;
  price: string;
  currency: string;
  validFrom: string;
  validTo: string;
};

type ProviderPermissions = {
  canViewPage: boolean;
  canManageRegistry: boolean;
  forceNonMedical: boolean;
};

const DEFAULT_FILTERS: ProviderFilters = {
  search: "",
  providerType: "",
  activeOnly: "true",
  city: "",
  country: "",
  fachbereich: "",
  doctorName: "",
  doctorFachbereich: "",
  serviceName: "",
  hasContract: "",
  ratingGte: "",
};

const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function providerPermissions(role?: string): ProviderPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return { canViewPage: true, canManageRegistry: true, forceNonMedical: false };
    case "concierge":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: true };
    case "billing":
    case "sales":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: false };
    default:
      return { canViewPage: false, canManageRegistry: false, forceNonMedical: false };
  }
}

function blankProviderForm(providerType: ProviderType = "medical"): ProviderFormState {
  return {
    name: "",
    providerType,
    legalName: "",
    taxId: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    addressCountry: "",
    phone: "",
    email: "",
    website: "",
    fachbereich: "",
    contractText: "",
    notes: "",
  };
}

function blankDoctorForm(): DoctorFormState {
  return {
    id: "",
    name: "",
    title: "",
    fachbereich: "",
    languages: "",
    phone: "",
    email: "",
    licenseNumber: "",
    licensingCountry: "",
    licensingValidUntil: "",
    notes: "",
  };
}

function blankServiceForm(): ServiceFormState {
  return {
    id: "",
    serviceName: "",
    description: "",
    price: "",
    currency: "EUR",
    validFrom: new Date().toLocaleDateString("en-CA"),
    validTo: "",
  };
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function providerTypeLabel(value: string, tr: Record<string, string>) {
  return value === "non_medical" ? tr.providers_type_non_medical : tr.providers_type_medical;
}

function providerTypeBadge(value: string) {
  return value === "non_medical"
    ? "border-teal-200 bg-teal-50 text-teal-700"
    : "border-sky-200 bg-sky-50 text-sky-700";
}

function statusBadge(active: boolean) {
  return active
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

function compactDateTime(value?: string | null, fallback = "Not set") {
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

function compactDate(value?: string | null, fallback = "Not set") {
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

function formatRating(value?: number | null) {
  if (value === null || value === undefined) return null;
  return value.toFixed(1);
}

function stringifyContract(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "summary" in value) {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseContract(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return { summary: trimmed };
}

function buildProvidersQuery(filters: ProviderFilters, forceNonMedical: boolean) {
  const params = new URLSearchParams();
  const providerType = forceNonMedical ? "non_medical" : filters.providerType;
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (providerType) params.set("provider_type", providerType);
  if (filters.activeOnly) params.set("active_only", filters.activeOnly);
  if (filters.city.trim()) params.set("city", filters.city.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.fachbereich.trim()) params.set("fachbereich", filters.fachbereich.trim());
  if (filters.doctorName.trim()) params.set("doctor_name", filters.doctorName.trim());
  if (filters.doctorFachbereich.trim()) {
    params.set("doctor_fachbereich", filters.doctorFachbereich.trim());
  }
  if (filters.serviceName.trim()) params.set("service_name", filters.serviceName.trim());
  if (filters.hasContract) params.set("has_contract", filters.hasContract);
  if (filters.ratingGte) params.set("rating_gte", filters.ratingGte);
  const query = params.toString();
  return query ? `/providers?${query}` : "/providers";
}

function providerToForm(detail: ProviderDetail): ProviderFormState {
  return {
    name: detail.name,
    providerType: detail.provider_type,
    legalName: detail.legal_name ?? "",
    taxId: detail.tax_id ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    website: detail.website ?? "",
    fachbereich: detail.fachbereich ?? "",
    contractText: stringifyContract(detail.kooperationsvertrag),
    notes: detail.notes ?? "",
  };
}

function doctorToForm(doctor: DoctorSummary): DoctorFormState {
  return {
    id: doctor.id,
    name: doctor.name,
    title: doctor.title ?? "",
    fachbereich: doctor.fachbereich ?? "",
    languages: doctor.languages?.join(", ") ?? "",
    phone: doctor.phone ?? "",
    email: doctor.email ?? "",
    licenseNumber: doctor.license_number ?? "",
    licensingCountry: doctor.licensing_country ?? "",
    licensingValidUntil: doctor.licensing_valid_until ?? "",
    notes: doctor.notes ?? "",
  };
}

function serviceToForm(service: ServiceItem): ServiceFormState {
  return {
    id: service.id,
    serviceName: service.service_name,
    description: service.description ?? "",
    price: service.price,
    currency: service.currency || "EUR",
    validFrom: service.valid_from || new Date().toLocaleDateString("en-CA"),
    validTo: service.valid_to ?? "",
  };
}

function toProviderPayload(form: ProviderFormState, forceNonMedical: boolean) {
  return {
    name: form.name.trim(),
    provider_type: forceNonMedical ? "non_medical" : form.providerType,
    legal_name: toOptional(form.legalName),
    tax_id: toOptional(form.taxId),
    address_street: toOptional(form.addressStreet),
    address_city: toOptional(form.addressCity),
    address_zip: toOptional(form.addressZip),
    address_country: toOptional(form.addressCountry),
    phone: toOptional(form.phone),
    email: toOptional(form.email),
    website: toOptional(form.website),
    fachbereich: toOptional(form.fachbereich),
    kooperationsvertrag: parseContract(form.contractText),
    notes: toOptional(form.notes),
  };
}

function toDoctorPayload(form: DoctorFormState) {
  return {
    name: form.name.trim(),
    title: toOptional(form.title),
    fachbereich: toOptional(form.fachbereich),
    languages: parseCommaList(form.languages),
    phone: toOptional(form.phone),
    email: toOptional(form.email),
    license_number: toOptional(form.licenseNumber),
    licensing_country: toOptional(form.licensingCountry),
    licensing_valid_until: toOptional(form.licensingValidUntil),
    notes: toOptional(form.notes),
  };
}

function toServicePayload(form: ServiceFormState) {
  return {
    service_name: form.serviceName.trim(),
    description: toOptional(form.description),
    price: Number.parseFloat(form.price || "0"),
    currency: toOptional(form.currency) ?? "EUR",
    valid_from: toOptional(form.validFrom),
    valid_to: toOptional(form.validTo),
  };
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
  icon: typeof Building2;
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

function InlineInfo({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className="size-4 text-slate-400" />
      <span>{children}</span>
    </div>
  );
}

function EmptyPanel({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-6">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function humanizeCode(value: string) {
  return value.replaceAll("_", " ");
}

function moneyLabel(price: string, currency: string) {
  const numeric = Number.parseFloat(price);
  if (!Number.isFinite(numeric)) return `${price} ${currency}`.trim();
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`.trim();
  }
}

function patientLabel(patient: LinkedPatient) {
  return `${patient.patient_id} · ${patient.first_name} ${patient.last_name}`;
}

function providerMeta(provider: ProviderSummary | ProviderDetail) {
  return [provider.address_city, provider.address_country].filter(Boolean).join(", ");
}

function ProvidersPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => providerPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<ProviderFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<ProviderFormState>(
    blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical")
  );

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [providerForm, setProviderForm] = useState<ProviderFormState>(blankProviderForm());
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerActionBusy, setProviderActionBusy] = useState<string | null>(null);

  const [doctorForm, setDoctorForm] = useState<DoctorFormState>(blankDoctorForm());
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorError, setDoctorError] = useState("");

  const [serviceForm, setServiceForm] = useState<ServiceFormState>(blankServiceForm());
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceError, setServiceError] = useState("");

  const effectiveFilters = useMemo<ProviderFilters>(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );

  const providersPath = useMemo(
    () => buildProvidersQuery(effectiveFilters, permissions.forceNonMedical),
    [effectiveFilters, permissions.forceNonMedical]
  );

  const metrics = useMemo(() => {
    return providers.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.is_active) acc.active += 1;
        acc.doctors += item.doctor_count;
        acc.patients += item.patient_count;
        acc.appointments += item.appointment_count;
        acc.services += item.service_count;
        acc.conciergeRequests += item.concierge_service_count;
        acc.openConciergeRequests += item.open_concierge_service_count;
        return acc;
      },
      {
        total: 0,
        active: 0,
        doctors: 0,
        patients: 0,
        appointments: 0,
        services: 0,
        conciergeRequests: 0,
        openConciergeRequests: 0,
      }
    );
  }, [providers]);

  const totalPages = Math.max(1, Math.ceil(providers.length / PAGE_SIZE));
  const paginatedProviders = useMemo(
    () => providers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [providers, page]
  );
  useEffect(() => { setPage(0); }, [providers.length]);

  const selectedSummary = useMemo(
    () => providers.find((provider) => provider.id === selectedId) ?? null,
    [providers, selectedId]
  );

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
    const providerParam = searchParams.get("provider") ?? "";
    if (providerParam && providerParam !== selectedId) {
      setSelectedId(providerParam);
      setDetailOpen(true);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    if (!permissions.canViewPage) {
      startTransition(() => setProviders([]));
      return;
    }

    let cancelled = false;
    setListBusy(true);
    setListError("");

    void apiFetch<ProviderSummary[]>(providersPath)
      .then((items) => {
        if (cancelled) return;
        startTransition(() => setProviders(items));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : t.common_failed_load);
      })
      .finally(() => {
        if (!cancelled) {
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage, providersPath, listVersion, t.common_failed_load]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;

    let cancelled = false;
    setDetailBusy(true);
    setDetailError("");
    setProviderError("");
    setDoctorError("");
    setServiceError("");

    void apiFetch<ProviderDetail>(`/providers/${selectedId}`)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
          setDetail(item);
          setProviderForm(providerToForm(item));
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetailError(error instanceof Error ? error.message : t.common_failed_load);
      })
      .finally(() => {
        if (!cancelled) {
          setDetailBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, selectedId, detailVersion, t.common_failed_load]);

  useEffect(() => {
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
  }, [permissions.forceNonMedical]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function openProvider(id: string) {
    staffGo(`/providers/${id}`);
    syncQuery({ provider: id });
  }

  function resetFilters() {
    setFilters({
      ...DEFAULT_FILTERS,
      providerType: permissions.forceNonMedical ? "non_medical" : "",
    });
    syncQuery({ provider: null });
  }

  function openCreateSheet() {
    setCreateError("");
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
    setCreateOpen(true);
  }

  async function handleCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const payload = toProviderPayload(createForm, permissions.forceNonMedical);
      const created = await apiFetch<CreateResponse>("/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      staffGo(`/providers/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleUpdateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setProviderBusy(true);
    setProviderError("");

    try {
      const payload = toProviderPayload(providerForm, permissions.forceNonMedical);
      await apiFetch(`/providers/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleToggleProvider(active: boolean) {
    if (!detail) return;

    setProviderActionBusy(active ? "activate" : "deactivate");
    setProviderError("");

    try {
      await apiFetch(`/providers/${detail.id}/${active ? "activate" : "deactivate"}`, {
        method: "POST",
      });
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(
        error instanceof Error
          ? error.message
          : `Failed to ${active ? "activate" : "deactivate"} provider`
      );
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDeleteProvider() {
    if (!detail) return;
    if (!window.confirm(`Delete provider "${detail.name}"?`)) return;

    setProviderActionBusy("delete");
    setProviderError("");

    try {
      await apiFetch(`/providers/${detail.id}/delete`, { method: "POST" });
      setDetailOpen(false);
      setSelectedId("");
      setDetail(null);
      refreshList();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDoctorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setDoctorBusy(true);
    setDoctorError("");

    try {
      const path = doctorForm.id
        ? `/providers/${detail.id}/doctors/${doctorForm.id}/update`
        : `/providers/${detail.id}/doctors`;
      await apiFetch(path, {
        method: "POST",
        body: JSON.stringify(toDoctorPayload(doctorForm)),
      });
      setDoctorForm(blankDoctorForm());
      refreshList();
      refreshDetail();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function handleDeleteDoctor(doctorId: string, doctorName: string) {
    if (!detail) return;
    if (!window.confirm(`Delete doctor "${doctorName}"?`)) return;

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await apiFetch(`/providers/${detail.id}/doctors/${doctorId}/delete`, {
        method: "POST",
      });
      if (doctorForm.id === doctorId) {
        setDoctorForm(blankDoctorForm());
      }
      refreshDetail();
      refreshList();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setServiceBusy(true);
    setServiceError("");

    try {
      const path = serviceForm.id
        ? `/providers/${detail.id}/services/${serviceForm.id}/update`
        : `/providers/${detail.id}/services`;
      await apiFetch(path, {
        method: "POST",
        body: JSON.stringify(toServicePayload(serviceForm)),
      });
      setServiceForm(blankServiceForm());
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  async function handleDeleteService(serviceId: string, serviceName: string) {
    if (!detail) return;
    if (!window.confirm(`Delete service "${serviceName}"?`)) return;

    setServiceBusy(true);
    setServiceError("");

    try {
      await apiFetch(`/providers/${detail.id}/services/${serviceId}/delete`, {
        method: "POST",
      });
      if (serviceForm.id === serviceId) {
        setServiceForm(blankServiceForm());
      }
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {l("Klinik- und Arztregister", "Реестр клиник и врачей", "Clinic and doctor registry")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            {l(
              "Dieser Bereich ist auf CEO, Patientenmanager, Concierge, Billing und Sales beschränkt, weil er die Klinikkoordination und die Sicht auf externe Partner steuert.",
              "Этот раздел доступен только CEO, менеджерам пациентов, concierge, billing и sales, потому что он управляет координацией клиник и видимостью внешних партнёров.",
              "This workspace is limited to CEO, patient managers, concierge, billing and sales roles because it drives clinic coordination and external partner visibility.",
            )}
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
                  {t.providers_title}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600"
                >
                  {permissions.canManageRegistry ? t.patients_registry_control : t.patients_readonly_view}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                {t.providers_subtitle}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">
                {t.providers_subtitle}
                
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => {
                  refreshList();
                  if (detailOpen && selectedId) {
                    refreshDetail();
                  }
                }}
              >
                <RefreshCw className="size-4" />
                {l("Aktualisieren", "Обновить", "Refresh")}
              </Button>
              {permissions.canManageRegistry ? (
                <Button
                  type="button"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={openCreateSheet}
                >
                  <Plus className="size-4" />
                  {t.providers_new}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Building2} label={t.providers_title} value={metrics.total.toString()} tone="sky" />
            <MetricCard
              icon={UsersRound}
              label={permissions.forceNonMedical ? l("Services", "Сервисы", "Services") : t.providers_doctors}
              value={(permissions.forceNonMedical ? metrics.services : metrics.doctors).toString()}
              tone="emerald"
            />
            <MetricCard icon={Stethoscope} label={t.providers_linked_patients} value={metrics.patients.toString()} tone="amber" />
            <MetricCard
              icon={CalendarClock}
              label={permissions.forceNonMedical ? l("Offene Anfragen", "Открытые запросы", "Open requests") : t.providers_appointments}
              value={(permissions.forceNonMedical ? metrics.openConciergeRequests : metrics.appointments).toString()}
              tone="slate"
            />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.common_search}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.providers_subtitle}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={resetFilters}>
                {l("Zurücksetzen", "Сбросить", "Reset")}
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

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field label={t.providers_type}>
                  <ShadSelect value={permissions.forceNonMedical ? "non_medical" : filters.providerType} onValueChange={(v) => setFilters((current) => ({ ...current, providerType: v ?? "" }))} disabled={permissions.forceNonMedical}>
                    <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                      <SelectValue>
                        {(() => {
                          const v = permissions.forceNonMedical ? "non_medical" : filters.providerType;
                          if (v === "medical") return t.providers_type_medical;
                          if (v === "non_medical") return t.providers_type_non_medical;
                          return t.providers_all;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t.providers_all}</SelectItem>
                      <SelectItem value="medical">{t.providers_type_medical}</SelectItem>
                      <SelectItem value="non_medical">{t.providers_type_non_medical}</SelectItem>
                    </SelectContent>
                  </ShadSelect>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field label={t.providers_city}>
                  <Input
                    value={filters.city}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, city: event.target.value }))
                    }
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </Field>

                <Field label={t.providers_country}>
                  <Input
                    value={filters.country}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, country: event.target.value }))
                    }
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </Field>
              </div>

              <Field label={t.providers_fachbereich}>
                <Input
                  value={filters.fachbereich}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, fachbereich: event.target.value }))
                  }
                  placeholder={t.providers_fachbereich}
                  className="h-10 rounded-xl bg-slate-50"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field label={t.common_doctor}>
                  <Input
                    value={filters.doctorName}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, doctorName: event.target.value }))
                    }
                    placeholder={t.common_doctor}
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </Field>

                <Field label={t.providers_fachbereich}>
                  <Input
                    value={filters.doctorFachbereich}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        doctorFachbereich: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </Field>
              </div>

              <Field label={t.providers_services}>
                <Input
                  value={filters.serviceName}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, serviceName: event.target.value }))
                  }
                  placeholder={t.providers_services}
                  className="h-10 rounded-xl bg-slate-50"
                />
              </Field>

              <Field label={t.providers_min_rating}>
                <ShadSelect
                  value={filters.ratingGte}
                  onValueChange={(value) =>
                    setFilters((current) => ({ ...current, ratingGte: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue placeholder={t.providers_all} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t.providers_all}</SelectItem>
                    <SelectItem value="3.5">3.5+</SelectItem>
                    <SelectItem value="4">4.0+</SelectItem>
                    <SelectItem value="4.5">4.5+</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </Field>

              <Field label={t.providers_contract}>
                <ShadSelect value={filters.hasContract} onValueChange={(v) => setFilters((current) => ({ ...current, hasContract: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue>
                      {filters.hasContract === "true" ? t.providers_contract_with
                        : filters.hasContract === "false" ? t.providers_contract_without
                        : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t.providers_all}</SelectItem>
                    <SelectItem value="true">{t.providers_contract_with}</SelectItem>
                    <SelectItem value="false">{t.providers_contract_without}</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </Field>

              {permissions.forceNonMedical ? (
                <Banner tone="warning">
                  {t.providers_select_hint}
                </Banner>
              ) : null}
            </div>
          </section>

          <section className={cardClass("p-5")}>
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.providers_title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.providers_subtitle}
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                {listBusy ? t.patients_syncing : `${providers.length} ${t.patients_records}`}
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
            ) : providers.length === 0 ? (
              <div className="mt-5">
                <EmptyPanel
                  title={t.patients_no_match}
                  text={t.patients_no_match}
                />
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {paginatedProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => openProvider(provider.id)}
                    className={cn(
                      "rounded-[1.6rem] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]",
                      selectedId === provider.id
                        ? "border-sky-300 bg-sky-50/70 shadow-[0_18px_48px_rgba(14,165,233,0.12)]"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                              providerTypeBadge(provider.provider_type)
                            )}
                          >
                            {providerTypeLabel(provider.provider_type, tr)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                              statusBadge(provider.is_active)
                            )}
                          >
                            {provider.is_active ? t.common_active : t.common_inactive}
                          </span>
                          {provider.has_contract ? (
                            <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                              {l("Vertrag", "Договор", "Contract")}
                            </Badge>
                          ) : null}
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-slate-950">
                          {provider.name}
                        </h3>
                        {provider.legal_name && provider.legal_name !== provider.name ? (
                          <p className="mt-1 text-sm text-slate-700">{provider.legal_name}</p>
                        ) : null}
                        <p className="mt-1 text-sm text-slate-600">
                          {provider.tax_id
                            ? `${l("Steuer-ID", "Налоговый ID", "Tax ID")} ${provider.tax_id}`
                            : provider.fachbereich || t.common_not_set}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="rounded-xl">
                        {l("Öffnen", "Открыть", "Open")}
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      <InlineInfo icon={MapPin}>
                        {providerMeta(provider) || t.common_not_set}
                      </InlineInfo>
                      <InlineInfo icon={Phone}>{provider.phone || t.common_not_set}</InlineInfo>
                      <InlineInfo icon={Mail}>{provider.email || t.common_not_set}</InlineInfo>
                      {provider.rating_count > 0 ? (
                        <InlineInfo icon={Star}>
                          {formatRating(provider.avg_rating)} / 5 · {provider.rating_count} {l("Bewertungen", "оценок", "ratings")}
                        </InlineInfo>
                      ) : null}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                          {provider.provider_type === "non_medical" ? l("Kontakte", "Контакты", "Contacts") : t.providers_doctors}
                        </p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">
                          {provider.doctor_count}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                          {l("Patienten", "Пациенты", "Patients")}
                        </p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">
                          {provider.patient_count}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                          {l("Services", "Сервисы", "Services")}
                        </p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">
                          {provider.service_count}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                          {provider.provider_type === "non_medical" ? l("Offene Anfragen", "Открытые запросы", "Open requests") : l("Slots", "Слоты", "Slots")}
                        </p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">
                          {provider.provider_type === "non_medical"
                            ? provider.open_concierge_service_count
                            : provider.appointment_count}
                        </p>
                      </div>
                    </div>
                    {provider.provider_type === "non_medical" ? (
                      <p className="mt-4 text-sm text-slate-500">
                        {provider.concierge_service_count} {l("erfasste Concierge-Anfragen", "запросов concierge в учете", "concierge requests tracked")}
                        {provider.last_interaction_at ? ` · Last activity ${compactDateTime(provider.last_interaction_at)}` : ""}
                      </p>
                    ) : provider.last_interaction_at ? (
                      <p className="mt-4 text-sm text-slate-500">
                        Last activity {compactDateTime(provider.last_interaction_at)}
                      </p>
                    ) : null}
                  </button>
                ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, providers.length)} / {providers.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="xs" className="rounded-lg" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <Button key={i} type="button" variant={i === page ? "default" : "outline"} size="xs" className="rounded-lg min-w-[28px]" onClick={() => setPage(i)}>
                        {i + 1}
                      </Button>
                    ))}
                    <Button type="button" variant="outline" size="xs" className="rounded-lg" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
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
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>{l("Anbieter anlegen", "Создать провайдера", "Create provider")}</SheetTitle>
            <SheetDescription>
              {l(
                "Legen Sie die nächste Klinik oder den nächsten Servicepartner direkt mit Vertragsnotizen, Kontaktdaten und Fachkontext an.",
                "Добавьте следующую клинику или сервисного партнера сразу с примечаниями по договору, контактами и профильным контекстом.",
                "Add the next clinic or service partner with contract notes, contact data and specialty context from the start.",
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <form onSubmit={handleCreateProvider} className="space-y-6 pt-5">
              {createError ? <Banner tone="error">{createError}</Banner> : null}

              <ProviderFormFields
                form={createForm}
                onChange={(field, value) =>
                  setCreateForm((current) => ({ ...current, [field]: value }))
                }
                forceNonMedical={permissions.forceNonMedical}
              />

              <div className="flex justify-end gap-3 border-t border-border/70 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setCreateOpen(false)}
                >
                  {l("Abbrechen", "Отмена", "Cancel")}
                </Button>
                <Button
                  type="submit"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  disabled={createBusy}
                >
                  {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {createBusy ? t.patients_creating : t.providers_new}
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
            setProviderError("");
            setDoctorError("");
            setServiceError("");
            setDoctorForm(blankDoctorForm());
            setServiceForm(blankServiceForm());
            syncQuery({ provider: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[880px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>{detail?.name || selectedSummary?.name || t.providers_detail}</SheetTitle>
            <SheetDescription>
              {l(
                "Prüfen Sie das Klinikprofil, halten Sie Arzt- und Serviceverzeichnisse synchron und verfolgen Sie die patientenseitigen Aktivitäten dieses Partners.",
                "Просматривайте профиль клиники, синхронизируйте реестры врачей и сервисов и отслеживайте активность, связанную с этим партнером.",
                "Review the clinic profile, keep doctor and service registries in sync and trace the patient-facing activity tied to this partner.",
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {detailBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {l("Anbieter wird geladen", "Загрузка провайдера", "Loading provider")}
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error">{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <ProviderOverviewSection
                  detail={detail}
                  providerForm={providerForm}
                  providerError={providerError}
                  providerBusy={providerBusy}
                  providerActionBusy={providerActionBusy}
                  permissions={permissions}
                  onFormChange={(field, value) =>
                    setProviderForm((current) => ({ ...current, [field]: value }))
                  }
                  onSubmit={handleUpdateProvider}
                  onActivate={() => handleToggleProvider(true)}
                  onDeactivate={() => handleToggleProvider(false)}
                  onDelete={handleDeleteProvider}
                  onOpenPatients={() => staffGo(`/patients?provider=${detail.id}`)}
                  onOpenAppointments={() => staffGo(`/appointments?provider=${detail.id}`)}
                />

                <DoctorSection
                  detail={detail}
                  form={doctorForm}
                  busy={doctorBusy}
                  error={doctorError}
                  canManage={permissions.canManageRegistry}
                  onChange={(field, value) =>
                    setDoctorForm((current) => ({ ...current, [field]: value }))
                  }
                  onEdit={(doctor) => {
                    setDoctorError("");
                    setDoctorForm(doctorToForm(doctor));
                  }}
                  onCancelEdit={() => setDoctorForm(blankDoctorForm())}
                  onDelete={handleDeleteDoctor}
                  onSubmit={handleDoctorSubmit}
                />

                <ServiceSection
                  detail={detail}
                  form={serviceForm}
                  busy={serviceBusy}
                  error={serviceError}
                  canManage={permissions.canManageRegistry}
                  onChange={(field, value) =>
                    setServiceForm((current) => ({ ...current, [field]: value }))
                  }
                  onEdit={(service) => {
                    setServiceError("");
                    setServiceForm(serviceToForm(service));
                  }}
                  onCancelEdit={() => setServiceForm(blankServiceForm())}
                  onDelete={handleDeleteService}
                  onSubmit={handleServiceSubmit}
                />

                <LinkedPatientsSection
                  detail={detail}
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                />
                <InteractionHistorySection
                  detail={detail}
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                  onOpenAppointment={(appointmentId) =>
                    staffGo(`/appointments?appointment=${appointmentId}`)
                  }
                  onOpenOrder={(orderId) => staffGo(`/orders?order=${orderId}`)}
                />
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                {l("Wählen Sie einen Anbieter aus, um den Registerbereich zu öffnen.", "Выберите провайдера, чтобы открыть реестровое рабочее пространство.", "Select a provider to open the registry workspace.")}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ProviderOverviewSection({
  detail,
  providerForm,
  providerError,
  providerBusy,
  providerActionBusy,
  permissions,
  onFormChange,
  onSubmit,
  onActivate,
  onDeactivate,
  onDelete,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  providerForm: ProviderFormState;
  providerError: string;
  providerBusy: boolean;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onFormChange: (field: keyof ProviderFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <>
      <section className={cardClass("p-5")}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
              providerTypeBadge(detail.provider_type)
            )}
          >
            {providerTypeLabel(detail.provider_type, tr)}
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
              statusBadge(detail.is_active)
            )}
          >
            {detail.is_active ? t.common_active : t.common_inactive}
          </span>
          {detail.kooperationsvertrag ? (
            <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
              {l("Vertrag verknüpft", "Договор привязан", "Contract linked")}
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">{detail.name}</h2>
            {detail.legal_name && detail.legal_name !== detail.name ? (
              <p className="mt-1 text-sm font-medium text-slate-700">{detail.legal_name}</p>
            ) : null}
            <p className="mt-2 text-sm text-slate-600">
              {detail.tax_id ? `${l("Steuer-ID", "Налоговый ID", "Tax ID")} ${detail.tax_id}` : detail.fachbereich || t.common_not_set}
            </p>
          </div>

          <div className="grid gap-2 text-sm text-slate-600">
            <InlineInfo icon={MapPin}>{providerMeta(detail) || t.common_not_set}</InlineInfo>
            <InlineInfo icon={Phone}>{detail.phone || t.common_not_set}</InlineInfo>
            <InlineInfo icon={Mail}>{detail.email || t.common_not_set}</InlineInfo>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
              {detail.provider_type === "non_medical" ? l("Kontakte", "Контакты", "Contacts") : t.providers_doctors}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{detail.doctors.length}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Services", "Сервисы", "Services")}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{detail.services.length}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
              {l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {detail.linked_patients.length}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Aktivität", "Активность", "Activity items")}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {detail.interactions.length}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenPatients}>
            {l("Patientenlinks", "Связи с пациентами", "Patient links")}
          </Button>
          <Button type="button" variant="outline" className="rounded-2xl" onClick={onOpenAppointments}>
            {l("Termine", "Записи", "Appointments")}
          </Button>
        </div>
      </section>

      <section className={cardClass("p-5")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{l("Anbieterprofil", "Профиль провайдера", "Provider profile")}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Halten Sie die kanonischen Klinikdaten mit Terminen, Services und Registerfiltern synchron.",
                "Поддерживайте канонические данные клиники синхронизированными с записями, сервисами и фильтрами реестра.",
                "Keep the canonical clinic data aligned with appointments, services and registry filters.",
              )}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
            {l("Aktualisiert", "Обновлено", "Updated")} {compactDateTime(detail.updated_at, t.common_not_set)}
          </div>
        </div>

        {providerError ? (
          <div className="mt-4">
            <Banner tone="error">{providerError}</Banner>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          <ProviderFormFields
            form={providerForm}
            onChange={onFormChange}
            forceNonMedical={permissions.forceNonMedical}
            disabled={!permissions.canManageRegistry}
          />

          {permissions.canManageRegistry ? (
            <div className="flex flex-wrap justify-between gap-3 border-t border-border/70 pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  disabled={providerActionBusy === "activate"}
                  onClick={onActivate}
                >
                  {providerActionBusy === "activate" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  {l("Aktivieren", "Активировать", "Activate")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  disabled={providerActionBusy === "deactivate"}
                  onClick={onDeactivate}
                >
                  {providerActionBusy === "deactivate" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  {l("Deaktivieren", "Деактивировать", "Deactivate")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-2xl"
                  disabled={providerActionBusy === "delete"}
                  onClick={onDelete}
                >
                  {providerActionBusy === "delete" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  {l("Löschen", "Удалить", "Delete")}
                </Button>
              </div>

              <Button
                type="submit"
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={providerBusy}
              >
                {providerBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {providerBusy ? t.patients_saving : t.common_save}
              </Button>
            </div>
          ) : (
            <div className="border-t border-border/70 pt-4 text-sm text-slate-500">
              {l(
                "Registeränderungen sind für Ihre Rolle gesperrt. Dieses Blatt bleibt im Lesemodus mit der Live-Aktivität von Anbieter, Ärzten und Patienten verbunden.",
                "Изменения в реестре для вашей роли ограничены. Этот лист остается связанным с живой активностью провайдера, врачей и пациентов в режиме только чтения.",
                "Registry edits are restricted for your role. This sheet stays connected to live provider, doctor and patient activity in read-only mode.",
              )}
            </div>
          )}
        </form>
      </section>
    </>
  );
}

function DoctorSection({
  detail,
  form,
  busy,
  error,
  canManage,
  onChange,
  onEdit,
  onCancelEdit,
  onDelete,
  onSubmit,
}: {
  detail: ProviderDetail;
  form: DoctorFormState;
  busy: boolean;
  error: string;
  canManage: boolean;
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onCancelEdit: () => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
            <h3 className="text-sm font-semibold text-slate-950">
              {detail.provider_type === "non_medical" ? l("Kontakte", "Контакты", "Contacts") : t.providers_doctors}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {detail.provider_type === "non_medical"
                ? l("Register der operativen Kontakte dieses Partners.", "Реестр операционных контактов этого партнера.", "Registry of operational contacts attached to this partner.")
                : l("Register der diesem Anbieter zugeordneten Ärztinnen und Ärzte.", "Реестр врачей, привязанных к этому провайдеру.", "Registry of clinicians attached to this provider.")}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
            {detail.doctors.length} {detail.provider_type === "non_medical" ? l("Kontakte", "контактов", "contacts") : l("Kliniker", "врачей", "clinicians")}
          </div>
        </div>

      {detail.doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_doctors}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.doctors.map((doctor) => (
            <div
              key={doctor.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-950">
                    {doctor.title ? `${doctor.title} ` : ""}
                    {doctor.name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {doctor.fachbereich || t.common_not_set}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => onEdit(doctor)}
                  >
                    {l("Bearbeiten", "Редактировать", "Edit")}
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                <InlineInfo icon={Phone}>{doctor.phone || t.common_not_set}</InlineInfo>
                <InlineInfo icon={Mail}>{doctor.email || t.common_not_set}</InlineInfo>
              </div>

              {doctor.languages.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {doctor.languages.map((language) => (
                    <Badge
                      key={`${doctor.id}-${language}`}
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white text-slate-700"
                    >
                      {language}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Lizenz", "Лицензия", "License")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {doctor.license_number || t.common_not_set}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {doctor.licensing_country || t.common_not_set}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {compactDate(doctor.licensing_valid_until, t.common_not_set)}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Patienten", "Пациенты", "Patients")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {doctor.patient_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Slots", "Слоты", "Slots")}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {doctor.appointment_count}
                  </p>
                </div>
              </div>

              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={busy}
                    onClick={() => onDelete(doctor.id, doctor.name)}
                  >
                    {l("Löschen", "Удалить", "Delete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-4 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-950">
                {form.id ? t.providers_doctor_detail : t.providers_doctor_new}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {l("Arztstammdaten werden für Anbieterfilter und Terminrouting verwendet.", "Карточки врачей используются в фильтрах провайдеров и маршрутизации записей.", "Doctor records are used by provider filters and appointment routing.")}
              </p>
            </div>
            {form.id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={onCancelEdit}
              >
                {l("Bearbeitung abbrechen", "Отменить редактирование", "Cancel edit")}
              </Button>
            ) : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <DoctorFormFields form={form} onChange={onChange} />

          <div className="flex justify-end">
            <Button
              type="submit"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={busy}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {form.id ? t.common_save : t.providers_doctor_new}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ServiceSection({
  detail,
  form,
  busy,
  error,
  canManage,
  onChange,
  onEdit,
  onCancelEdit,
  onDelete,
  onSubmit,
}: {
  detail: ProviderDetail;
  form: ServiceFormState;
  busy: boolean;
  error: string;
  canManage: boolean;
  onChange: (field: keyof ServiceFormState, value: string) => void;
  onEdit: (service: ServiceItem) => void;
  onCancelEdit: () => void;
  onDelete: (serviceId: string, serviceName: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{l("Servicekatalog", "Каталог сервисов", "Service catalog")}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {l("Operativer Katalog für Suche und künftige Order-/Concierge-Abläufe.", "Операционный каталог для поиска и будущих сценариев заказа / concierge.", "Operational catalog used for search and future order / concierge flows.")}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.services.length} {l("Services", "сервисов", "services")}
        </div>
      </div>

      {detail.services.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_services}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.services.map((service) => (
            <div
              key={service.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-950">{service.service_name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {service.description || t.common_not_set}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => onEdit(service)}
                  >
                    {l("Bearbeiten", "Редактировать", "Edit")}
                  </Button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Preis", "Цена", "Price")}</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {moneyLabel(service.price, service.currency)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Gültigkeit", "Срок действия", "Validity")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {compactDate(service.valid_from, t.common_not_set)}
                    {" -> "}
                    {compactDate(service.valid_to, t.common_not_set)}
                  </p>
                </div>
              </div>

              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={busy}
                    onClick={() => onDelete(service.id, service.service_name)}
                  >
                    {l("Löschen", "Удалить", "Delete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-4 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-950">
                {form.id ? t.providers_service_detail : t.providers_service_new}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {l("Services speisen heute die Filter und fließen als Nächstes in Orders und Concierge-Ausführung ein.", "Сервисы уже питают фильтры и следующим шагом войдут в заказы и выполнение concierge.", "Services power filters today and will flow into orders and concierge execution next.")}
              </p>
            </div>
            {form.id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={onCancelEdit}
              >
                {l("Bearbeitung abbrechen", "Отменить редактирование", "Cancel edit")}
              </Button>
            ) : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <ServiceFormFields form={form} onChange={onChange} />

          <div className="flex justify-end">
            <Button
              type="submit"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={busy}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {form.id ? t.common_save : t.providers_service_new}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function LinkedPatientsSection({
  detail,
  onOpenPatient,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients")}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {l("Patienten, die diesen Anbieter bereits über Termine oder Serviceeinträge berührt haben.", "Пациенты, уже связанные с этим провайдером через записи или сервисные записи.", "Patients who already touched this provider through appointments or service records.")}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.linked_patients.length} {l("Patienten", "пациентов", "patients")}
        </div>
      </div>

      {detail.linked_patients.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_patients}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.linked_patients.map((patient) => (
            <div
              key={patient.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <p className="text-base font-semibold text-slate-950">{patientLabel(patient)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {l("Letzte Aktivität", "Последнее взаимодействие", "Last interaction")} {compactDateTime(patient.last_interaction_at)}
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Termine", "Записи", "Appointments")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.appointment_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Services", "Сервисы", "Services")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.leistung_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Concierge", "Concierge", "Concierge")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.concierge_count}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenPatient(patient.id)}
                >
                  {l("Patient öffnen", "Открыть пациента", "Open patient")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenAppointments(patient.id)}
                >
                  {l("Termine", "Записи", "Appointments")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InteractionHistorySection({
  detail,
  onOpenPatient,
  onOpenAppointments,
  onOpenAppointment,
  onOpenOrder,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{l("Interaktionsverlauf", "История взаимодействий", "Interaction history")}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {l("Zeitachse der mit diesem Anbieter verbundenen Termine und Service-Interaktionen.", "Хронология записей и сервисных взаимодействий, связанных с этим провайдером.", "Timeline of appointments and service-level interactions associated with this provider.")}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.interactions.length} {l("Einträge", "записей", "items")}
        </div>
      </div>

      {detail.interactions.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_activity}
            text={t.providers_no_activity}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.interactions.map((item) => (
            <div
              key={item.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {humanizeCode(item.kind)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {humanizeCode(item.status)}
                    </Badge>
                    {item.appointment_type ? (
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                        {humanizeCode(item.appointment_type)}
                      </Badge>
                    ) : null}
                  </div>

                  <p className="mt-3 text-base font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.patient_id} · {item.patient_name}
                  </p>
                </div>

                <div className="text-sm text-slate-600">{compactDateTime(item.occurred_at)}</div>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                <InlineInfo icon={Stethoscope}>{item.doctor_name || t.common_not_set}</InlineInfo>
                <InlineInfo icon={MapPin}>{item.location || t.common_not_set}</InlineInfo>
              </div>

              {item.notes ? (
                <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                  {item.notes}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenPatient(item.patient_id)}
                >
                  {l("Patient", "Пациент", "Patient")}
                </Button>
                {item.kind === "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenAppointment(item.id)}
                  >
                    {l("Termin", "Запись", "Appointment")}
                  </Button>
                ) : null}
                {item.kind !== "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenAppointments(item.patient_id)}
                  >
                    {l("Termine", "Записи", "Appointments")}
                  </Button>
                ) : null}
                {item.order_id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenOrder(item.order_id!)}
                  >
                    {l("Auftrag", "Заказ", "Order")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderFormFields({
  form,
  onChange,
  forceNonMedical,
  disabled = false,
}: {
  form: ProviderFormState;
  onChange: (field: keyof ProviderFormState, value: string) => void;
  forceNonMedical: boolean;
  disabled?: boolean;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("Anzeigename", "Отображаемое имя", "Display name")}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={t.providers_title}
            required
            disabled={disabled}
          />
        </Field>

        <Field label={l("Rechtlicher Name", "Юридическое название", "Legal name")}>
          <Input
            value={form.legalName}
            onChange={(event) => onChange("legalName", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={l("Rechtsträger / Vertragsname", "Юридическое лицо / название договора", "Legal entity / contract name")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_type}>
          <ShadSelect value={forceNonMedical ? "non_medical" : form.providerType} onValueChange={(v) => onChange("providerType", v ?? "medical")} disabled={disabled || forceNonMedical}>
            <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="medical">{t.providers_type_medical}</SelectItem>
              <SelectItem value="non_medical">{t.providers_type_non_medical}</SelectItem>
            </SelectContent>
          </ShadSelect>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("Steuer-ID", "Налоговый ID", "Tax ID")}>
          <Input
            value={form.taxId}
            onChange={(event) => onChange("taxId", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={l("USt-IdNr. / Steuer-ID", "VAT / налоговый ID", "VAT / tax ID")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={t.providers_fachbereich}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_website}>
          <Input
            value={form.website}
            onChange={(event) => onChange("website", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={l("https://...", "https://...", "https://...")}
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={t.providers_street}>
        <Input
          value={form.addressStreet}
          onChange={(event) => onChange("addressStreet", event.target.value)}
          className="h-10 rounded-xl bg-slate-50"
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_city}>
          <Input
            value={form.addressCity}
            onChange={(event) => onChange("addressCity", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_zip}>
          <Input
            value={form.addressZip}
            onChange={(event) => onChange("addressZip", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_country}>
          <Input
            value={form.addressCountry}
            onChange={(event) => onChange("addressCountry", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            disabled={disabled}
          />
        </Field>
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={t.providers_contract}>
        <textarea
          value={form.contractText}
          onChange={(event) => onChange("contractText", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={l('Klartext wird automatisch zu {"summary": "..."} umgewandelt. JSON ist ebenfalls erlaubt.', 'Обычный текст автоматически станет {"summary": "..."}; JSON тоже допустим.', 'Plain text becomes {"summary": "..."} automatically. JSON is accepted too.')}
          disabled={disabled}
        />
      </Field>

      <Field label={t.providers_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={t.providers_notes}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function DoctorFormFields({
  form,
  onChange,
}: {
  form: DoctorFormState;
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.providers_doctors}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
        <Field label={t.providers_doctor_title}>
          <Input
            value={form.title}
            onChange={(event) => onChange("title", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={t.providers_doctor_title}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={l("Sprachen", "Языки", "Languages")}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            placeholder={l("de, en, uk", "de, en, uk", "de, en, uk")}
          />
        </Field>
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={l("Lizenznummer", "Номер лицензии", "License number")}>
          <Input
            value={form.licenseNumber}
            onChange={(event) => onChange("licenseNumber", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={l("Lizenzland", "Страна лицензии", "Licensing country")}>
          <Input
            value={form.licensingCountry}
            onChange={(event) => onChange("licensingCountry", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}>
          <Input
            type="date"
            value={form.licensingValidUntil}
            onChange={(event) => onChange("licensingValidUntil", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.providers_notes}>
          <textarea
            value={form.notes}
            onChange={(event) => onChange("notes", event.target.value)}
            className={textareaClassName}
            rows={3}
          />
        </Field>
      </div>
    </div>
  );
}

function ServiceFormFields({
  form,
  onChange,
}: {
  form: ServiceFormState;
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.providers_service_name}>
          <Input
            value={form.serviceName}
            onChange={(event) => onChange("serviceName", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
        <Field label={t.providers_service_price}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(event) => onChange("price", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
      </div>

      <Field label={t.providers_service_desc}>
        <textarea
          value={form.description}
          onChange={(event) => onChange("description", event.target.value)}
          className={textareaClassName}
          rows={3}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_service_currency}>
          <Input
            value={form.currency}
            onChange={(event) => onChange("currency", event.target.value.toUpperCase())}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.providers_service_valid_from}>
          <Input
            type="date"
            value={form.validFrom}
            onChange={(event) => onChange("validFrom", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field label={t.providers_service_valid_to}>
          <Input
            type="date"
            value={form.validTo}
            onChange={(event) => onChange("validTo", event.target.value)}
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
      </div>
    </div>
  );
}

export { ProvidersPage };
