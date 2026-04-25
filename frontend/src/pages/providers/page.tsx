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
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarClock,
  Filter,
  LoaderCircle,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Stethoscope,
  Trash2,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AdminSheetScaffold,
  SheetActionsFooter,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  Sheet,
  SheetContent,
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
import {
  ColumnFilterDateRangePopover,
  ColumnFilterPopover,
  ColumnFilterSelectPopover,
  KpiInlineStat,
  PaginationControls,
  type ColumnFilterKind,
  type SortDir,
} from "@/components/data-table";
import {
  PageHeader,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
} from "@/components/ui-shell";

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

export type ProviderDetail = {
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

export type ProviderPermissions = {
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

const selectTriggerClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;

type ProviderColumnKey =
  | "status"
  | "no"
  | "provider"
  | "type"
  | "location"
  | "fachbereich"
  | "doctors"
  | "patients"
  | "contract";

const PROVIDER_COLUMN_META: Record<
  ProviderColumnKey,
  { labelKey: string; widthClass?: string; sortable?: boolean; filter: ColumnFilterKind }
> = {
  status: { labelKey: "patients_col_status", widthClass: "w-[110px]", sortable: true, filter: "select" },
  no: { labelKey: "patients_col_no", widthClass: "w-[56px]", sortable: true, filter: "text" },
  provider: { labelKey: "providers_title", sortable: true, filter: "text" },
  type: { labelKey: "providers_type", widthClass: "w-[120px]", sortable: true, filter: "select" },
  location: { labelKey: "providers_city", widthClass: "w-[160px]", sortable: true, filter: "text" },
  fachbereich: { labelKey: "providers_fachbereich", widthClass: "w-[160px]", sortable: true, filter: "text" },
  doctors: { labelKey: "providers_doctors", widthClass: "w-[90px]", sortable: true, filter: "text" },
  patients: { labelKey: "providers_linked_patients", widthClass: "w-[90px]", sortable: true, filter: "text" },
  contract: { labelKey: "providers_contract", widthClass: "w-[110px]", sortable: true, filter: "select" },
};

const DEFAULT_PROVIDER_COLUMN_ORDER: ProviderColumnKey[] = [
  "status",
  "no",
  "provider",
  "type",
  "location",
  "fachbereich",
  "doctors",
  "patients",
  "contract",
];

function providerColumnText(
  p: ProviderSummary,
  key: ProviderColumnKey,
  tr: Record<string, string>,
): string {
  switch (key) {
    case "status":
      return p.is_active ? (tr.common_active ?? "active") : (tr.common_inactive ?? "inactive");
    case "no":
      return "";
    case "provider":
      return [p.name, p.legal_name, p.tax_id].filter(Boolean).join(" ");
    case "type":
      return p.provider_type;
    case "location":
      return [p.address_city, p.address_country].filter(Boolean).join(" ");
    case "fachbereich":
      return p.fachbereich ?? "";
    case "doctors":
      return String(p.doctor_count);
    case "patients":
      return String(p.patient_count);
    case "contract":
      return p.has_contract ? "with" : "without";
  }
}

function ProviderCell({
  colKey,
  provider,
  rowNumber,
  tr,
  l,
}: {
  colKey: ProviderColumnKey;
  provider: ProviderSummary;
  rowNumber: number;
  tr: Record<string, string>;
  l: (de: string, ru: string, en: string) => string;
}) {
  switch (colKey) {
    case "status":
      return (
        <td className="px-3 py-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium",
              provider.is_active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600",
            )}
          >
            <span className={cn("size-1.5 rounded-full", provider.is_active ? "bg-emerald-500" : "bg-neutral-400")} />
            {provider.is_active ? (tr.common_active ?? "active") : (tr.common_inactive ?? "inactive")}
          </span>
        </td>
      );
    case "no":
      return (
        <td className="px-3 py-2.5 text-muted-foreground font-mono text-[12px] tabular-nums">
          {rowNumber}
        </td>
      );
    case "provider":
      return (
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-7 rounded-full bg-muted text-[11px] font-medium text-foreground shrink-0">
              {provider.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? "")
                .join("")}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate">{provider.name}</div>
              {provider.legal_name && provider.legal_name !== provider.name ? (
                <div className="text-[11.5px] text-muted-foreground truncate">{provider.legal_name}</div>
              ) : provider.tax_id ? (
                <div className="text-[11.5px] text-muted-foreground truncate">
                  {l("Steuer-ID", "Налоговый ID", "Tax ID")} {provider.tax_id}
                </div>
              ) : null}
            </div>
          </div>
        </td>
      );
    case "type":
      return (
        <td className="px-3 py-2.5">
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px]",
              provider.provider_type === "medical"
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-violet-200 bg-violet-50 text-violet-700",
            )}
          >
            {provider.provider_type === "medical" ? tr.providers_type_medical : tr.providers_type_non_medical}
          </Badge>
        </td>
      );
    case "location":
      return (
        <td className="px-3 py-2.5 text-muted-foreground">
          {[provider.address_city, provider.address_country].filter(Boolean).join(", ") || "—"}
        </td>
      );
    case "fachbereich":
      return (
        <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[200px]">
          {provider.fachbereich ?? "—"}
        </td>
      );
    case "doctors":
      return (
        <td className="px-3 py-2.5 text-foreground tabular-nums">
          {provider.doctor_count}
        </td>
      );
    case "patients":
      return (
        <td className="px-3 py-2.5 text-foreground tabular-nums">
          {provider.patient_count}
        </td>
      );
    case "contract":
      return (
        <td className="px-3 py-2.5">
          {provider.has_contract ? (
            <Badge variant="outline" className="rounded-full text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
              {tr.providers_contract_with}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      );
  }
}

function compareProvidersByColumn(
  a: ProviderSummary,
  b: ProviderSummary,
  key: ProviderColumnKey,
): number {
  switch (key) {
    case "status":
      return Number(b.is_active) - Number(a.is_active);
    case "no":
      return 0;
    case "provider":
      return (a.name ?? "").localeCompare(b.name ?? "");
    case "type":
      return (a.provider_type ?? "").localeCompare(b.provider_type ?? "");
    case "location": {
      const al = `${a.address_city ?? ""} ${a.address_country ?? ""}`.trim().toLowerCase();
      const bl = `${b.address_city ?? ""} ${b.address_country ?? ""}`.trim().toLowerCase();
      return al.localeCompare(bl);
    }
    case "fachbereich":
      return (a.fachbereich ?? "").localeCompare(b.fachbereich ?? "");
    case "doctors":
      return a.doctor_count - b.doctor_count;
    case "patients":
      return a.patient_count - b.patient_count;
    case "contract":
      return Number(b.has_contract) - Number(a.has_contract);
  }
}

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
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
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
  const [pageSize, setPageSize] = useState(20);

  const [columnOrder, setColumnOrder] = useState<ProviderColumnKey[]>(
    DEFAULT_PROVIDER_COLUMN_ORDER,
  );
  const [draggingKey, setDraggingKey] = useState<ProviderColumnKey | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<ProviderColumnKey | null>(null);
  const [sortBy, setSortBy] = useState<{ key: ProviderColumnKey; dir: SortDir } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<ProviderColumnKey, string>>({
    status: "",
    no: "",
    provider: "",
    type: "",
    location: "",
    fachbereich: "",
    doctors: "",
    patients: "",
    contract: "",
  });
  const [filterOpen, setFilterOpen] = useState<ProviderColumnKey | null>(null);

  function toggleSort(key: ProviderColumnKey) {
    setSortBy((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function setColumnFilter(key: ProviderColumnKey, value: string) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function handleColumnDragStart(key: ProviderColumnKey) {
    setDraggingKey(key);
  }

  function handleColumnDragOver(event: React.DragEvent, key: ProviderColumnKey) {
    event.preventDefault();
    if (draggingKey && key !== draggingKey) setDropTargetKey(key);
  }

  function handleColumnDrop(target: ProviderColumnKey) {
    if (!draggingKey || draggingKey === target) {
      setDraggingKey(null);
      setDropTargetKey(null);
      return;
    }
    setColumnOrder((current) => {
      const next = current.filter((k) => k !== draggingKey);
      const insertAt = next.indexOf(target);
      next.splice(insertAt, 0, draggingKey);
      return next;
    });
    setDraggingKey(null);
    setDropTargetKey(null);
  }

  function handleColumnDragEnd() {
    setDraggingKey(null);
    setDropTargetKey(null);
  }

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

  const sortedAndFilteredProviders = useMemo(() => {
    const hasFilter = Object.values(columnFilters).some((v) => v.trim() !== "");
    const filtered = hasFilter
      ? providers.filter((p) => {
          for (const key of columnOrder) {
            const raw = columnFilters[key].trim();
            if (!raw) continue;
            if (key === "status") {
              if (raw === "active" && !p.is_active) return false;
              if (raw === "inactive" && p.is_active) return false;
            } else if (key === "type") {
              if (p.provider_type !== raw) return false;
            } else if (key === "contract") {
              if (raw === "with" && !p.has_contract) return false;
              if (raw === "without" && p.has_contract) return false;
            } else {
              const haystack = providerColumnText(p, key, tr).toLowerCase();
              if (!haystack.includes(raw.toLowerCase())) return false;
            }
          }
          return true;
        })
      : providers;
    if (!sortBy) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = compareProvidersByColumn(a, b, sortBy.key);
      return sortBy.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [providers, columnFilters, columnOrder, sortBy, tr]);

  const totalPages = Math.max(1, Math.ceil(sortedAndFilteredProviders.length / pageSize));
  const paginatedProviders = useMemo(
    () => sortedAndFilteredProviders.slice(page * pageSize, (page + 1) * pageSize),
    [sortedAndFilteredProviders, page, pageSize]
  );
  useEffect(() => { setPage(0); }, [providers.length, pageSize]);

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
            {t.providers_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            {t.providers_no_access_body}
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.providers_title}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg px-3.5"
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
                  className="h-9 rounded-lg px-3.5"
                  onClick={openCreateSheet}
                >
                  <Plus className="size-4" />
                  {t.providers_new}
                </Button>
              ) : null}
            </>
          }
        />

        {/* KPI inline stats */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border/50 bg-card px-4 py-3">
          <KpiInlineStat icon={Building2} label={t.providers_title} value={metrics.total} tone="sky" />
          <KpiInlineStat
            icon={UsersRound}
            label={permissions.forceNonMedical ? l("Services", "Сервисы", "Services") : t.providers_doctors}
            value={permissions.forceNonMedical ? metrics.services : metrics.doctors}
            tone="emerald"
          />
          <KpiInlineStat
            icon={Stethoscope}
            label={t.providers_linked_patients}
            value={metrics.patients}
            tone="amber"
          />
          <KpiInlineStat
            icon={CalendarClock}
            label={permissions.forceNonMedical ? l("Offene Anfragen", "Открытые запросы", "Open requests") : t.providers_appointments}
            value={permissions.forceNonMedical ? metrics.openConciergeRequests : metrics.appointments}
            tone="slate"
          />
        </div>

        {/* Top search bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={t.common_search}
              className="h-9 rounded-lg bg-card pl-3"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-lg"
            onClick={resetFilters}
          >
            {l("Zurücksetzen", "Сбросить", "Reset")}
          </Button>
        </div>

        {/* Error banner */}
        {listError ? <Banner tone="error">{listError}</Banner> : null}

        {/* Table card */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  {columnOrder.map((key) => {
                    const meta = PROVIDER_COLUMN_META[key];
                    const isDragging = draggingKey === key;
                    const isDropTarget = dropTargetKey === key && draggingKey && dropTargetKey !== draggingKey;
                    const isSorted = sortBy?.key === key;
                    const SortIcon = isSorted ? (sortBy?.dir === "asc" ? ArrowUp : ArrowDown) : null;
                    const filterValue = columnFilters[key];
                    const filterActive = filterValue.trim() !== "";
                    const isFilterOpen = filterOpen === key;
                    return (
                      <th
                        key={key}
                        draggable
                        onDragStart={() => handleColumnDragStart(key)}
                        onDragOver={(e) => handleColumnDragOver(e, key)}
                        onDrop={() => handleColumnDrop(key)}
                        onDragEnd={handleColumnDragEnd}
                        className={cn(
                          "px-3 py-2.5 font-medium select-none relative",
                          meta.widthClass,
                          isSorted && "text-foreground",
                          isDragging && "opacity-50",
                          isDropTarget && "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (meta.sortable && !draggingKey) toggleSort(key);
                            }}
                            disabled={!meta.sortable}
                            className={cn(
                              "flex items-center gap-1 min-w-0 text-left",
                              meta.sortable && "cursor-pointer hover:text-foreground"
                            )}
                            title={meta.sortable ? (tr[meta.labelKey] ?? meta.labelKey) : ""}
                          >
                            <span className="truncate">{tr[meta.labelKey] ?? meta.labelKey}</span>
                            {SortIcon ? <SortIcon className="size-3 text-[var(--brand)] shrink-0" /> : null}
                          </button>
                          {meta.filter !== "none" ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterOpen(isFilterOpen ? null : key);
                              }}
                              title={t.common_search}
                              className={cn(
                                "inline-flex items-center justify-center size-5 rounded transition-colors shrink-0",
                                filterActive
                                  ? "text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                                  : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
                              )}
                            >
                              <Filter className="size-3" />
                            </button>
                          ) : null}
                        </div>
                        {isFilterOpen && meta.filter === "text" ? (
                          <ColumnFilterPopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            placeholder={tr[meta.labelKey] ?? meta.labelKey}
                            tr={tr}
                          />
                        ) : null}
                        {isFilterOpen && meta.filter === "select" ? (
                          <ColumnFilterSelectPopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            options={
                              key === "status"
                                ? [
                                    { value: "", label: t.providers_all },
                                    { value: "active", label: t.common_active },
                                    { value: "inactive", label: t.common_inactive },
                                  ]
                                : key === "type"
                                  ? [
                                      { value: "", label: t.providers_all },
                                      { value: "medical", label: t.providers_type_medical },
                                      { value: "non_medical", label: t.providers_type_non_medical },
                                    ]
                                  : [
                                      { value: "", label: t.providers_all },
                                      { value: "with", label: t.providers_contract_with },
                                      { value: "without", label: t.providers_contract_without },
                                    ]
                            }
                            tr={tr}
                          />
                        ) : null}
                        {isFilterOpen && meta.filter === "daterange" ? (
                          <ColumnFilterDateRangePopover
                            value={filterValue}
                            onChange={(v) => setColumnFilter(key, v)}
                            onClear={() => setColumnFilter(key, "")}
                            onClose={() => setFilterOpen(null)}
                            tr={tr}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                  <th className="w-8 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {listBusy ? (
                  <tr>
                    <td colSpan={columnOrder.length + 1} className="py-16 text-center text-muted-foreground">
                      <LoaderCircle className="inline-block mr-2 size-4 animate-spin align-text-bottom" />
                      {t.common_loading}
                    </td>
                  </tr>
                ) : paginatedProviders.length === 0 ? (
                  <tr>
                    <td colSpan={columnOrder.length + 1} className="py-16 text-center text-muted-foreground text-[13px]">
                      {t.patients_no_match}
                    </td>
                  </tr>
                ) : (
                  paginatedProviders.map((provider, idx) => {
                    const rowNumber = page * pageSize + idx + 1;
                    return (
                      <tr
                        key={provider.id}
                        className="group/row border-t border-border transition-colors hover:bg-muted/40 cursor-pointer relative"
                        onClick={() => openProvider(provider.id)}
                      >
                        {columnOrder.map((colKey) => (
                          <ProviderCell
                            key={colKey}
                            colKey={colKey}
                            provider={provider}
                            rowNumber={rowNumber}
                            tr={tr}
                            l={l}
                          />
                        ))}
                        <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="size-7 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/row:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border text-[12.5px] flex-wrap">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{t.pagination_per_page}</span>
              <ShadSelect value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger size="sm" className="h-7 w-[70px] text-[12.5px]">
                  <SelectValue>{pageSize}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>

            <PaginationControls page={page} totalPages={totalPages} onPage={setPage} />

            <div className="text-muted-foreground">
              {sortedAndFilteredProviders.length === 0
                ? "0"
                : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, sortedAndFilteredProviders.length)}`}
              {" / "}
              {sortedAndFilteredProviders.length}
            </div>
          </div>
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form onSubmit={handleCreateProvider} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.providers_new}
              description={t.providers_create_description}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.providers_new}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <ProviderFormFields
                form={createForm}
                onChange={(field, value) =>
                  setCreateForm((current) => ({ ...current, [field]: value }))
                }
                forceNonMedical={permissions.forceNonMedical}
              />
            </AdminSheetScaffold>
          </form>
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
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[880px]">
          {detailBusy ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {l("Anbieter wird geladen", "Загрузка провайдера", "Loading provider")}
            </div>
          ) : detail ? (
            <form onSubmit={handleUpdateProvider} className="flex flex-1 min-h-0 flex-col">
              <AdminSheetScaffold
                title={detail.name || t.providers_detail}
                description={t.providers_subtitle}
                footer={(
                  <SheetActionsFooter>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      onClick={() => setDetailOpen(false)}
                    >
                      {t.common_cancel}
                    </Button>
                    {permissions.canManageRegistry ? (
                      <Button
                        type="submit"
                        className="h-9 rounded-lg gap-1.5"
                        disabled={providerBusy}
                      >
                        {providerBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {providerBusy ? t.patients_saving : t.common_save}
                      </Button>
                    ) : null}
                  </SheetActionsFooter>
                )}
              >
                {detailError ? <Banner tone="error">{detailError}</Banner> : null}
                {providerError ? <Banner tone="error">{providerError}</Banner> : null}

                <ProviderOverviewSection
                  detail={detail}
                  providerActionBusy={providerActionBusy}
                  permissions={permissions}
                  onActivate={() => handleToggleProvider(true)}
                  onDeactivate={() => handleToggleProvider(false)}
                  onDelete={handleDeleteProvider}
                  onOpenPatients={() => staffGo(`/patients?provider=${detail.id}`)}
                  onOpenAppointments={() => staffGo(`/appointments?provider=${detail.id}`)}
                />

                {permissions.canManageRegistry || permissions.canViewPage ? (
                  <section className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                      {l("Anbieterprofil", "Профиль провайдера", "Provider profile")}
                    </h3>
                    <ProviderFormFields
                      form={providerForm}
                      onChange={(field, value) =>
                        setProviderForm((current) => ({ ...current, [field]: value }))
                      }
                      forceNonMedical={permissions.forceNonMedical}
                      disabled={!permissions.canManageRegistry}
                    />
                    {!permissions.canManageRegistry ? (
                      <p className="text-[12px] text-muted-foreground italic">
                        {t.providers_edit_restricted_note}
                      </p>
                    ) : null}
                  </section>
                ) : null}

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
              </AdminSheetScaffold>
            </form>
          ) : detailError ? (
            <div className="p-4">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t.providers_select_to_open_workspace}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ProviderOverviewSection({
  detail,
  providerActionBusy,
  permissions,
  onActivate,
  onDeactivate,
  onDelete,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  return (
    <section className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full text-[10px]",
                detail.provider_type === "medical"
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-violet-200 bg-violet-50 text-violet-700",
              )}
            >
              {providerTypeLabel(detail.provider_type, tr)}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full text-[10px]",
                detail.is_active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border/60 bg-muted/25 text-muted-foreground",
              )}
            >
              {detail.is_active ? t.common_active : t.common_inactive}
            </Badge>
            {detail.kooperationsvertrag ? (
              <Badge variant="outline" className="rounded-full text-[10px] border-border/60 bg-muted/25 text-foreground">
                {l("Vertrag verknüpft", "Договор привязан", "Contract linked")}
              </Badge>
            ) : null}
          </div>
          <h2 className="mt-3 text-xl font-semibold text-foreground">{detail.name}</h2>
          {detail.legal_name && detail.legal_name !== detail.name ? (
            <p className="mt-1 text-sm text-muted-foreground">{detail.legal_name}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 text-sm text-muted-foreground">
        <InlineInfo icon={MapPin}>{providerMeta(detail) || t.common_not_set}</InlineInfo>
        <InlineInfo icon={Phone}>{detail.phone || t.common_not_set}</InlineInfo>
        <InlineInfo icon={Mail}>{detail.email || t.common_not_set}</InlineInfo>
        {detail.tax_id ? (
          <p className="text-xs text-muted-foreground/80">
            {l("Steuer-ID", "Налоговый ID", "Tax ID")} · {detail.tax_id}
          </p>
        ) : null}
        {detail.fachbereich ? (
          <p className="text-xs text-muted-foreground/80">
            {tr.providers_fachbereich} · {detail.fachbereich}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {detail.provider_type === "non_medical"
              ? l("Kontakte", "Контакты", "Contacts")
              : t.providers_doctors}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.doctors.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Services", "Сервисы", "Services")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.services.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.linked_patients.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Aktivität", "Активность", "Activity items")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.interactions.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          onClick={onOpenPatients}
        >
          {l("Patientenlinks", "Связи с пациентами", "Patient links")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          onClick={onOpenAppointments}
        >
          {l("Termine", "Записи", "Appointments")}
        </Button>
        {permissions.canManageRegistry ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={providerActionBusy === "activate" || detail.is_active}
              onClick={onActivate}
            >
              {providerActionBusy === "activate" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {l("Aktivieren", "Активировать", "Activate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={providerActionBusy === "deactivate" || !detail.is_active}
              onClick={onDeactivate}
            >
              {providerActionBusy === "deactivate" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {l("Deaktivieren", "Деактивировать", "Deactivate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
              disabled={providerActionBusy === "delete"}
              onClick={onDelete}
            >
              {providerActionBusy === "delete" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {l("Löschen", "Удалить", "Delete")}
            </Button>
          </>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground/80">
        {l("Aktualisiert", "Обновлено", "Updated")}{" "}
        {compactDateTime(detail.updated_at, t.common_not_set)}
      </p>
    </section>
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
                ? t.providers_doctors_description_non_medical
                : t.providers_doctors_description_medical}
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
                {t.providers_doctors_hint}
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
            {t.providers_services_description}
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
                {t.providers_services_hint}
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

export function LinkedPatientsSection({
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
            {t.providers_linked_patients_description}
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

export function InteractionHistorySection({
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
            {t.providers_interactions_description}
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
            className={shellInputClassName}
            placeholder={t.providers_title}
            required
            disabled={disabled}
          />
        </Field>

        <Field label={l("Rechtlicher Name", "Юридическое название", "Legal name")}>
          <Input
            value={form.legalName}
            onChange={(event) => onChange("legalName", event.target.value)}
            className={shellInputClassName}
            placeholder={l("Rechtsträger / Vertragsname", "Юридическое лицо / название договора", "Legal entity / contract name")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_type}>
          <ShadSelect value={forceNonMedical ? "non_medical" : form.providerType} onValueChange={(v) => onChange("providerType", v ?? "medical")} disabled={disabled || forceNonMedical}>
            <SelectTrigger className={selectTriggerClassName}>
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
            className={shellInputClassName}
            placeholder={l("USt-IdNr. / Steuer-ID", "VAT / налоговый ID", "VAT / tax ID")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_fachbereich}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_website}>
          <Input
            value={form.website}
            onChange={(event) => onChange("website", event.target.value)}
            className={shellInputClassName}
            placeholder={l("https://...", "https://...", "https://...")}
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={t.providers_street}>
        <Input
          value={form.addressStreet}
          onChange={(event) => onChange("addressStreet", event.target.value)}
          className={shellInputClassName}
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_city}>
          <Input
            value={form.addressCity}
            onChange={(event) => onChange("addressCity", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_zip}>
          <Input
            value={form.addressZip}
            onChange={(event) => onChange("addressZip", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_country}>
          <Input
            value={form.addressCountry}
            onChange={(event) => onChange("addressCountry", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className={shellInputClassName}
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
            className={shellInputClassName}
            required
          />
        </Field>
        <Field label={t.providers_doctor_title}>
          <Input
            value={form.title}
            onChange={(event) => onChange("title", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_doctor_title}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Sprachen", "Языки", "Languages")}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className={shellInputClassName}
            placeholder={l("de, en, uk", "de, en, uk", "de, en, uk")}
          />
        </Field>
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Lizenznummer", "Номер лицензии", "License number")}>
          <Input
            value={form.licenseNumber}
            onChange={(event) => onChange("licenseNumber", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Lizenzland", "Страна лицензии", "Licensing country")}>
          <Input
            value={form.licensingCountry}
            onChange={(event) => onChange("licensingCountry", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}>
          <Input
            type="date"
            value={form.licensingValidUntil}
            onChange={(event) => onChange("licensingValidUntil", event.target.value)}
            className={shellInputClassName}
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
            className={shellInputClassName}
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
            className={shellInputClassName}
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
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.providers_service_valid_from}>
          <Input
            type="date"
            value={form.validFrom}
            onChange={(event) => onChange("validFrom", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.providers_service_valid_to}>
          <Input
            type="date"
            value={form.validTo}
            onChange={(event) => onChange("validTo", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>
    </div>
  );
}

export { ProvidersPage };

