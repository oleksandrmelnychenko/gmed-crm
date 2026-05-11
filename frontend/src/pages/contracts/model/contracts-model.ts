import type {
  AgencyServiceFilters,
  AgencyServiceFormState,
  AgencyServiceItem,
  ContractFilters,
  ContractFormState,
  ContractItem,
  ContractStatus,
  ContractStatusFormState,
  ContractsPermissions,
  OrderOption,
  PatientOption,
  QuoteFilters,
  QuoteFormState,
  QuoteItem,
  QuoteStatus,
  QuoteStatusFormState,
} from "./types";
import { formatEnumLabel, type Translations } from "@/lib/i18n";

type EnumLabelTranslations = Pick<
  Translations,
  "common_not_set" | "common_unknown" | "common_unknown_value"
>;

export const CONTRACT_STATUSES: ContractStatus[] = [
  "draft",
  "sent",
  "signed",
  "expired",
  "terminated",
];

export const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
];

export const DEFAULT_CONTRACT_FILTERS: ContractFilters = {
  search: "",
  patientId: "",
  status: "",
};

export const DEFAULT_QUOTE_FILTERS: QuoteFilters = {
  search: "",
  patientId: "",
  orderId: "",
  status: "",
};

export const DEFAULT_AGENCY_SERVICE_FILTERS: AgencyServiceFilters = {
  search: "",
  activeOnly: "true",
};

export function contractsPermissions(role?: string): ContractsPermissions {
  const canView =
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "billing";
  const canManage = role === "ceo" || role === "patient_manager" || role === "billing";
  return {
    canViewPage: canView,
    canCreateContract: canManage,
    canManageContract: canManage,
    canCreateQuote: canManage,
    canManageQuote: canManage,
    canManageCatalog: canManage,
  };
}

export function buildContractsPath(filters: ContractFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.status) params.set("status", filters.status);
  return params.size ? `/framework-contracts?${params.toString()}` : "/framework-contracts";
}

export function buildQuotesPath(filters: QuoteFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.status) params.set("status", filters.status);
  return params.size ? `/quotes?${params.toString()}` : "/quotes";
}

export function buildAgencyServicesPath(filters: AgencyServiceFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.activeOnly === "true") params.set("active_only", "true");
  if (filters.activeOnly === "false") params.set("active_only", "false");
  return params.size ? `/agency-services?${params.toString()}` : "/agency-services";
}

export function blankContractForm(patientId = ""): ContractFormState {
  return {
    patientId,
    status: "draft",
    validFrom: "",
    validTo: "",
    signedAt: "",
    conditionsText: "",
  };
}

export function blankQuoteForm(orderId = ""): QuoteFormState {
  return {
    orderId,
    validUntil: "",
    notes: "",
  };
}

export function blankAgencyServiceForm(unitLabel = "unit"): AgencyServiceFormState {
  return {
    id: "",
    serviceKey: "",
    serviceName: "",
    description: "",
    unitLabel,
    unitPrice: "",
    currency: "EUR",
    vatRate: "19",
    isActive: true,
    validFrom: "",
    validTo: "",
  };
}

export function contractToStatusForm(contract: ContractItem): ContractStatusFormState {
  return {
    status: (contract.status as ContractStatus) ?? "draft",
    validFrom: contract.valid_from ?? "",
    validTo: contract.valid_to ?? "",
    signedAt: contract.signed_at ? toDateTimeLocal(contract.signed_at) : "",
    conditionsText: contract.conditions ? JSON.stringify(contract.conditions, null, 2) : "",
  };
}

export function quoteToStatusForm(quote: QuoteItem): QuoteStatusFormState {
  return {
    status: (quote.status as QuoteStatus) ?? "draft",
    paidAmount: valueToInput(quote.paid_amount),
    notes: quote.notes ?? "",
  };
}

export function agencyServiceToForm(service: AgencyServiceItem): AgencyServiceFormState {
  return {
    id: service.id,
    serviceKey: service.service_key,
    serviceName: service.service_name,
    description: service.description ?? "",
    unitLabel: service.unit_label,
    unitPrice: valueToInput(service.unit_price),
    currency: service.currency,
    vatRate: valueToInput(service.vat_rate),
    isActive: service.is_active,
    validFrom: service.valid_from ?? "",
    validTo: service.valid_to ?? "",
  };
}

export function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function valueToInput(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const CONTRACT_DATE_TIME_FORMAT_OPTIONS = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} satisfies Intl.DateTimeFormatOptions;

const CONTRACT_DATE_FORMAT_OPTIONS = {
  day: "2-digit",
  month: "short",
  year: "numeric",
} satisfies Intl.DateTimeFormatOptions;

const contractDateTimeFormatters: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", CONTRACT_DATE_TIME_FORMAT_OPTIONS),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", CONTRACT_DATE_TIME_FORMAT_OPTIONS),
  "en-GB": new Intl.DateTimeFormat("en-GB", CONTRACT_DATE_TIME_FORMAT_OPTIONS),
};

const contractDateFormatters: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", CONTRACT_DATE_FORMAT_OPTIONS),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", CONTRACT_DATE_FORMAT_OPTIONS),
  "en-GB": new Intl.DateTimeFormat("en-GB", CONTRACT_DATE_FORMAT_OPTIONS),
};

const contractCurrencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function contractDateTimeFormatter(locale: string) {
  return contractDateTimeFormatters[locale] ?? contractDateTimeFormatters["en-GB"];
}

function contractDateFormatter(locale: string) {
  return contractDateFormatters[locale] ?? contractDateFormatters["en-GB"];
}

export function formatDateTime(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return contractDateTimeFormatter(locale).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatDate(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return contractDateFormatter(locale).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

export function enumLabel(
  value: string | null | undefined,
  labels: Partial<Record<string, string>>,
  translations: EnumLabelTranslations,
) {
  return formatEnumLabel(value, labels, translations);
}

export function formatCurrency(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "EUR 0.00";
  return contractCurrencyFormatter.format(numeric);
}

export function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
}

export function orderOptionLabel(order: OrderOption) {
  return `${order.order_number} · ${order.patient_pid} · ${order.patient_name}`;
}

export function buildSearchParams(
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
