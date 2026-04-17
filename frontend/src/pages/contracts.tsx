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
import { useStaffNavigate } from "@/lib/use-staff-navigate";
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
  version_count?: number;
  current_version_number?: number;
  created_at: string;
  updated_at: string;
  line_items?: QuoteLineItem[];
};

type QuoteVersionItem = {
  id: string;
  quote_id: string;
  version_number: number;
  order_id: string;
  quote_number: string;
  status: QuoteStatus | string;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  valid_until: string | null;
  paid_amount: unknown;
  paid_at: string | null;
  notes: string | null;
  change_reason: string | null;
  line_item_count: number;
  created_at: string;
  created_by_name: string;
  created_by_role: string;
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

type AgencyServiceItem = {
  id: string;
  service_key: string;
  service_name: string;
  description: string | null;
  unit_label: string;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AgencyServiceFilters = {
  search: string;
  activeOnly: string;
};

type AgencyServiceFormState = {
  id: string;
  serviceKey: string;
  serviceName: string;
  description: string;
  unitLabel: string;
  unitPrice: string;
  currency: string;
  vatRate: string;
  isActive: boolean;
  validFrom: string;
  validTo: string;
};

type ContractsPermissions = {
  canViewPage: boolean;
  canCreateContract: boolean;
  canManageContract: boolean;
  canCreateQuote: boolean;
  canManageQuote: boolean;
  canManageCatalog: boolean;
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
const DEFAULT_AGENCY_SERVICE_FILTERS: AgencyServiceFilters = {
  search: "",
  activeOnly: "true",
};
const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function contractsPermissions(role?: string): ContractsPermissions {
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

function buildAgencyServicesPath(filters: AgencyServiceFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.activeOnly === "true") params.set("active_only", "true");
  if (filters.activeOnly === "false") params.set("active_only", "false");
  return params.size ? `/agency-services?${params.toString()}` : "/agency-services";
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

function blankAgencyServiceForm(lang: "de" | "ru" = "de"): AgencyServiceFormState {
  return {
    id: "",
    serviceKey: "",
    serviceName: "",
    description: "",
    unitLabel: lang === "de" ? "Einheit" : "ед.",
    unitPrice: "",
    currency: "EUR",
    vatRate: "19",
    isActive: true,
    validFrom: "",
    validTo: "",
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

function agencyServiceToForm(service: AgencyServiceItem): AgencyServiceFormState {
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

function formatDateTime(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
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

function formatDate(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function enumLabel(value: string, labels: Record<string, string>) {
  return labels[value] ?? value.replaceAll("_", " ");
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
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = contractsPermissions(user?.role);
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = lang === "de"
    ? {
        accessDenied:
          "Verträge und Angebote sind nur für CEO, CEO-Assistenz, Patientenmanager und Abrechnung verfügbar.",
        workspaceKicker: "Kaufmännischer Arbeitsbereich",
        workspaceTitle: "Verträge und Angebote",
        workspaceDescription:
          "Patientengebundene Rahmenverträge und Angebote auf Basis von Auftragsleistungen, Durchlaufkosten und kaufmännischer Freigabe.",
        refresh: "Aktualisieren",
        newContract: "Neuer Vertrag",
        newQuote: "Neues Angebot",
        contractsTab: "Rahmenverträge",
        quotesTab: "Angebote",
        contractStatsDescription: "unterzeichnet / versendet",
        quoteStatsDescription: "angenommen",
        agencyServiceTitle: "Leistungskatalog der Agentur",
        agencyServiceDescription:
          "Interner Preiskatalog für agenturseitige Leistungen und künftige Auto-Abrechnungen.",
        agencyServiceSearchPlaceholder:
          "Nach Schlüssel, Leistungsname oder Beschreibung suchen",
        activeOnly: "Nur aktiv",
        allStatuses: "Alle Status",
        inactiveOnly: "Nur inaktiv",
        catalogItems: "Katalogpositionen",
        activeLabel: "Aktiv",
        priced: "Mit Preis",
        noCatalogItems: "Keine Katalogpositionen",
        noCatalogItemsDescription:
          "Lege wiederverwendbare Agenturpositionen an, etwa Dolmetscherstunden oder Koordinationspakete.",
        activeState: "aktiv",
        inactiveState: "inaktiv",
        unitPrice: "Einzelpreis",
        unit: "Einheit",
        updated: "Aktualisiert",
        editCatalogItem: "Katalogposition bearbeiten",
        newCatalogItem: "Neue Katalogposition",
        catalogHelp:
          "Verwende stabile Service-Keys wie `interpreter_hours` für künftige Automatisierungen.",
        cancelEdit: "Bearbeitung verwerfen",
        serviceKey: "Service-Key",
        serviceName: "Leistungsname",
        unitLabel: "Einheitsbezeichnung",
        currency: "Währung",
        vatPercent: "MwSt. %",
        description: "Beschreibung",
        itemIsActive:
          "Position ist aktiv und kann in nachgelagerten Workflows verwendet werden",
        saveCatalogItem: "Katalogposition speichern",
        createCatalogItem: "Katalogposition anlegen",
        createContractDescription:
          "Lege zuerst die patientengebundene kaufmännische Basis fest, bevor Angebote und Ausführungsaufträge erstellt werden.",
        selectPatient: "Patient auswählen",
        createContract: "Vertrag anlegen",
        createQuoteDescription:
          "Erzeuge ein Angebot aus den aktuellen Auftragsleistungen. Summen werden serverseitig aus den Auftragspositionen berechnet.",
        loadingOrders: "Aufträge werden geladen...",
        selectOrder: "Auftrag auswählen",
        chooseOrder: "Auftrag auswählen",
        createQuote: "Angebot anlegen",
        contractSheetDescription:
          "Status, Laufzeit und kaufmännischer Kontext für den ausgewählten Patienten.",
        contractOverviewDescription:
          "Details zur patientengebundenen Vereinbarung und aktueller Lebenszyklus.",
        linkedContractDescription:
          "Mit aktuellem Vertragskontext direkt zu Patient, Auftrag oder Dokumenten springen.",
        orders: "Aufträge",
        documents: "Dokumente",
        saveContract: "Vertrag speichern",
        quoteSheetDescription:
          "Angebotssummen, Positionen und Zahlungsstatus für den ausgewählten Auftrag.",
        quoteOverviewDescription:
          "Kaufmännische Summen und Umfang aus dem verknüpften Auftrag.",
        vatTotal: "MwSt. gesamt",
        grossTotal: "Gesamt brutto",
        snapshotVersion: "Snapshot-Version",
        linkedQuoteDescription:
          "Mit aktuellem Angebotskontext direkt zu Patient, Auftrag, Rechnungen oder Dokumenten springen.",
        order: "Auftrag",
        invoices: "Rechnungen",
        quoteLifecycle: "Angebots-Lebenszyklus",
        quoteLifecycleDescription:
          "Angebot durch Versand- und Zahlungsbestätigung führen.",
        saveQuote: "Angebot speichern",
        lineItems: "Positionen",
        lineItemsDescription:
          "Netto-, MwSt.- und Bruttowerte wie im Angebots-Snapshot gespeichert.",
        noLineItems: "Keine Positionen",
        noLineItemsDescription:
          "Dieses Angebot enthält noch keine materialisierten Positionen.",
        quantity: "Menge",
        net: "Netto",
        gross: "Brutto",
        versionHistory: "Versionsverlauf",
        versionHistoryDescription:
          "Unveränderliche Angebots-Snapshots für Lebenszyklus- und Zahlungsstatusänderungen.",
        noVersions: "Keine Versionen",
        noVersionsDescription:
          "Es sind noch keine gespeicherten Angebots-Snapshots vorhanden.",
        version: "Version",
        snapshotFallback: "Snapshot",
        lineItemsCount: "Positionen",
        updatedAt: "Aktualisiert am",
        roleLabels: {
          draft: "Entwurf",
          sent: "Versendet",
          signed: "Unterzeichnet",
          expired: "Abgelaufen",
          terminated: "Beendet",
          accepted: "Angenommen",
          rejected: "Abgelehnt",
        },
      }
    : {
        accessDenied:
          "Договоры и предложения доступны только CEO, ассистенту CEO, пациент-менеджерам и биллингу.",
        workspaceKicker: "Коммерческое рабочее пространство",
        workspaceTitle: "Договоры и предложения",
        workspaceDescription:
          "Рамочные договоры и предложения по пациенту на основе услуг заказа, проходных расходов и коммерческого согласования.",
        refresh: "Обновить",
        newContract: "Новый договор",
        newQuote: "Новое предложение",
        contractsTab: "Рамочные договоры",
        quotesTab: "Предложения",
        contractStatsDescription: "подписано / отправлено",
        quoteStatsDescription: "принято",
        agencyServiceTitle: "Каталог агентских услуг",
        agencyServiceDescription:
          "Внутренний прайс-каталог для агентских услуг и будущих потоков автоначисления.",
        agencyServiceSearchPlaceholder:
          "Поиск по ключу, названию услуги или описанию",
        activeOnly: "Только активные",
        allStatuses: "Все статусы",
        inactiveOnly: "Только неактивные",
        catalogItems: "Позиции каталога",
        activeLabel: "Активные",
        priced: "С ценой",
        noCatalogItems: "Нет позиций каталога",
        noCatalogItemsDescription:
          "Создайте переиспользуемые агентские позиции, например часы переводчика или пакеты координации.",
        activeState: "активна",
        inactiveState: "неактивна",
        unitPrice: "Цена за единицу",
        unit: "Единица",
        updated: "Обновлено",
        editCatalogItem: "Редактировать позицию каталога",
        newCatalogItem: "Новая позиция каталога",
        catalogHelp:
          "Используйте стабильные service keys вроде `interpreter_hours` для будущей автоматизации.",
        cancelEdit: "Отменить редактирование",
        serviceKey: "Ключ услуги",
        serviceName: "Название услуги",
        unitLabel: "Обозначение единицы",
        currency: "Валюта",
        vatPercent: "НДС %",
        description: "Описание",
        itemIsActive:
          "Позиция активна и может использоваться в последующих рабочих процессах",
        saveCatalogItem: "Сохранить позицию каталога",
        createCatalogItem: "Создать позицию каталога",
        createContractDescription:
          "Сначала задайте коммерческую основу по пациенту, а затем создавайте предложения и рабочие заказы.",
        selectPatient: "Выберите пациента",
        createContract: "Создать договор",
        createQuoteDescription:
          "Сформируйте предложение из текущих услуг заказа. Итоги рассчитываются на бэкенде по строкам заказа.",
        loadingOrders: "Загрузка заказов...",
        selectOrder: "Выберите заказ",
        chooseOrder: "Выберите заказ",
        createQuote: "Создать предложение",
        contractSheetDescription:
          "Статус, срок действия и коммерческий контекст для выбранного пациента.",
        contractOverviewDescription:
          "Детали соглашения по пациенту и его текущий жизненный цикл.",
        linkedContractDescription:
          "Быстрый переход к пациенту, заказам или документам в контексте текущего договора.",
        orders: "Заказы",
        documents: "Документы",
        saveContract: "Сохранить договор",
        quoteSheetDescription:
          "Суммы предложения, позиции и статус оплаты для выбранного заказа.",
        quoteOverviewDescription:
          "Коммерческие итоги и объём, унаследованные из связанного заказа.",
        vatTotal: "НДС итого",
        grossTotal: "Итого брутто",
        snapshotVersion: "Версия снимка",
        linkedQuoteDescription:
          "Быстрый переход к пациенту, заказу, счетам или документам в контексте текущего предложения.",
        order: "Заказ",
        invoices: "Счета",
        quoteLifecycle: "Жизненный цикл предложения",
        quoteLifecycleDescription:
          "Проведите предложение через этапы отправки и подтверждения оплаты.",
        saveQuote: "Сохранить предложение",
        lineItems: "Позиции",
        lineItemsDescription:
          "Значения нетто, НДС и брутто в том виде, как они сохранены в снимке предложения.",
        noLineItems: "Нет позиций",
        noLineItemsDescription:
          "В этом предложении пока нет материализованных позиций.",
        quantity: "Кол-во",
        net: "Нетто",
        gross: "Брутто",
        versionHistory: "История версий",
        versionHistoryDescription:
          "Неизменяемые снимки предложения для изменений жизненного цикла и статуса оплаты.",
        noVersions: "Нет версий",
        noVersionsDescription:
          "Сохранённые снимки предложения пока отсутствуют.",
        version: "Версия",
        snapshotFallback: "Снимок",
        lineItemsCount: "позиций",
        updatedAt: "Обновлено",
        roleLabels: {
          draft: "Черновик",
          sent: "Отправлено",
          signed: "Подписано",
          expired: "Истекло",
          terminated: "Прекращено",
          accepted: "Принято",
          rejected: "Отклонено",
        },
      };
  const contractStatusLabel = (status: string) => enumLabel(status, text.roleLabels);
  const quoteStatusLabel = (status: string) => enumLabel(status, text.roleLabels);
  const roleLabel = (roleValue: string) =>
    tr[`role_${roleValue}`] ?? roleValue.replaceAll("_", " ");

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
    blankAgencyServiceForm(lang),
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
    let ignore = false;
    async function loadAgencyServices() {
      setAgencyServicesLoading(true);
      setAgencyServicesError(null);
      try {
        const data = await apiFetch<AgencyServiceItem[]>(
          buildAgencyServicesPath(agencyServiceQuery),
        );
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
        const [data, versions] = await Promise.all([
          apiFetch<QuoteItem>(`/quotes/${selectedQuoteId}`),
          apiFetch<QuoteVersionItem[]>(`/quotes/${selectedQuoteId}/versions`),
        ]);
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
      setCreateQuoteError(text.selectOrder);
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

      const path = agencyServiceForm.id
        ? `/agency-services/${agencyServiceForm.id}/update`
        : "/agency-services";
      await apiFetch(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAgencyServiceForm(blankAgencyServiceForm(lang));
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
  }

  function resetAgencyServiceForm() {
    setAgencyServiceFormError(null);
    setAgencyServiceForm(blankAgencyServiceForm(lang));
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
        {text.accessDenied}
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
                {text.workspaceKicker}
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                {text.workspaceTitle}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                {text.workspaceDescription}
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
                {text.refresh}
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
                  <Plus className="mr-2 size-4" />
                  {text.newQuote}
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <StatCard
            label={t.contracts_title}
            value={String(contractStats.total)}
            description={lang === "de"
              ? `${contractStats.signed} unterzeichnet / ${contractStats.sent} versendet`
              : `${contractStats.signed} подписано / ${contractStats.sent} отправлено`}
            icon={<ShieldCheck className="size-5" />}
          />
          <StatCard
            label={text.quotesTab}
            value={String(quoteStats.total)}
            description={lang === "de"
              ? `${quoteStats.accepted} angenommen`
              : `${quoteStats.accepted} принято`}
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

        <SectionCard
          title={text.agencyServiceTitle}
          description={text.agencyServiceDescription}
          action={
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
              {lang === "de"
                ? `${agencyServiceStats.active} aktiv / ${agencyServiceStats.total} gesamt`
                : `${agencyServiceStats.active} активных / ${agencyServiceStats.total} всего`}
            </Badge>
          }
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
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
                    className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-9"
                    placeholder={text.agencyServiceSearchPlaceholder}
                  />
                </div>
                <select
                  value={agencyServiceFilters.activeOnly}
                  onChange={(event) =>
                    setAgencyServiceFilters((current) => ({
                      ...current,
                      activeOnly: event.target.value,
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="true">{text.activeOnly}</option>
                  <option value="">{text.allStatuses}</option>
                  <option value="false">{text.inactiveOnly}</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-2xl"
                  onClick={() => setAgencyServiceFilters(DEFAULT_AGENCY_SERVICE_FILTERS)}
                >
                  Reset
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MiniMetric label={text.catalogItems} value={String(agencyServiceStats.total)} />
                <MiniMetric label={text.activeLabel} value={String(agencyServiceStats.active)} />
                <MiniMetric label={text.priced} value={String(agencyServiceStats.priced)} />
              </div>

              {agencyServicesLoading ? (
                <LoadingState label={t.common_loading} />
              ) : agencyServicesError ? (
                <Banner tone="error">{agencyServicesError}</Banner>
              ) : agencyServices.length === 0 ? (
                <EmptyState
                  title={text.noCatalogItems}
                  description={text.noCatalogItemsDescription}
                />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {agencyServices.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {item.service_key}
                          </div>
                          <h3 className="mt-2 text-base font-semibold text-slate-950">
                            {item.service_name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {item.description || t.common_not_set}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              item.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-600",
                            )}
                          >
                            {item.is_active ? text.activeState : text.inactiveState}
                          </Badge>
                          {permissions.canManageCatalog ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-xl"
                              onClick={() => handleEditAgencyService(item)}
                            >
                              {t.common_edit}
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <MiniMetric
                          label={text.unitPrice}
                          value={formatCurrency(item.unit_price)}
                        />
                        <MiniMetric label={text.unit} value={item.unit_label} />
                        <MiniMetric
                          label={t.invoices_vat}
                          value={`${valueToInput(item.vat_rate) || "0"}%`}
                        />
                        <MiniMetric
                          label={t.providers_service_valid_from}
                          value={formatDate(item.valid_from, locale, t.common_not_set)}
                        />
                        <MiniMetric
                          label={t.providers_service_valid_to}
                          value={formatDate(item.valid_to, locale, t.common_not_set)}
                        />
                        <MiniMetric
                          label={text.updated}
                          value={formatDateTime(item.updated_at, locale, t.common_not_set)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {permissions.canManageCatalog ? (
              <form
                onSubmit={handleSaveAgencyService}
                className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {agencyServiceForm.id ? text.editCatalogItem : text.newCatalogItem}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {text.catalogHelp}
                    </p>
                  </div>
                  {agencyServiceForm.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      onClick={resetAgencyServiceForm}
                    >
                      {text.cancelEdit}
                    </Button>
                  ) : null}
                </div>

                {agencyServiceFormError ? (
                  <div className="mt-4">
                    <Banner tone="error">{agencyServiceFormError}</Banner>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label={text.serviceKey}>
                    <Input
                      required
                      value={agencyServiceForm.serviceKey}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          serviceKey: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.serviceName}>
                    <Input
                      required
                      value={agencyServiceForm.serviceName}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          serviceName: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.unitLabel}>
                    <Input
                      value={agencyServiceForm.unitLabel}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          unitLabel: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.currency}>
                    <Input
                      value={agencyServiceForm.currency}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          currency: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.unitPrice}>
                    <Input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={agencyServiceForm.unitPrice}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          unitPrice: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.vatPercent}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={agencyServiceForm.vatRate}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          vatRate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={t.providers_service_valid_from}>
                    <Input
                      required
                      type="date"
                      value={agencyServiceForm.validFrom}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          validFrom: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={t.providers_service_valid_to}>
                    <Input
                      type="date"
                      value={agencyServiceForm.validTo}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          validTo: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={text.description} className="sm:col-span-2">
                    <textarea
                      className={textareaClassName}
                      value={agencyServiceForm.description}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={agencyServiceForm.isActive}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          isActive: event.target.checked,
                        }))
                      }
                      className="size-4 rounded border-slate-300"
                    />
                    {text.itemIsActive}
                  </label>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button
                    type="submit"
                    className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                    disabled={agencyServiceBusy}
                  >
                    {agencyServiceBusy ? (
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {agencyServiceForm.id ? text.saveCatalogItem : text.createCatalogItem}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </SectionCard>

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
              {text.contractsTab}
            </TabsTrigger>
            <TabsTrigger value="quotes" className="rounded-xl px-4 data-active:bg-slate-950 data-active:text-white">
              {text.quotesTab}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contracts">
            <div className="space-y-5">
              <SectionCard
                title={text.quotesTab}
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
                    <option value="">{lang === "de" ? "Alle Patienten" : "Все пациенты"}</option>
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
                        {contractStatusLabel(status)}
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
                    {t.access_reset}
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
                        {text.createContract}
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
                            {contractStatusLabel(contract.status)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                            {contract.signed_at ? t.contracts_signed : t.contracts_draft}
                          </Badge>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <MiniMetric label={t.providers_service_valid_from} value={formatDate(contract.valid_from, locale, t.common_not_set)} />
                          <MiniMetric label={t.providers_service_valid_to} value={formatDate(contract.valid_to, locale, t.common_not_set)} />
                          <MiniMetric label={t.contracts_signed_at} value={formatDateTime(contract.signed_at, locale, t.common_not_set)} />
                          <MiniMetric label={text.updatedAt} value={formatDateTime(contract.updated_at, locale, t.common_not_set)} />
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
                    <option value="">{lang === "de" ? "Alle Patienten" : "Все пациенты"}</option>
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
                    <option value="">{lang === "de" ? "Alle Aufträge" : "Все заказы"}</option>
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
                        {quoteStatusLabel(status)}
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
                    {t.access_reset}
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
                        {text.createQuote}
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
                            {quoteStatusLabel(quote.status)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                            {formatCurrency(quote.total_gross)}
                          </Badge>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <MiniMetric label={t.providers_service_valid_to} value={formatDate(quote.valid_until, locale, t.common_not_set)} />
                          <MiniMetric label={t.invoices_paid} value={formatCurrency(quote.paid_amount)} />
                          <MiniMetric label={t.patients_created} value={formatDateTime(quote.created_at, locale, t.common_not_set)} />
                          <MiniMetric label={t.invoices_paid_at} value={formatDateTime(quote.paid_at, locale, t.common_not_set)} />
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
            <DialogTitle>{text.newContract}</DialogTitle>
            <DialogDescription>
              {text.createContractDescription}
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
                  <option value="">{text.selectPatient}</option>
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
                      {contractStatusLabel(status)}
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
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={createContractBusy}>
                {createContractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                {text.createContract}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createQuoteOpen} onOpenChange={setCreateQuoteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{text.newQuote}</DialogTitle>
            <DialogDescription>
              {text.createQuoteDescription}
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
                  <option value="">{optionsLoading ? text.loadingOrders : text.selectOrder}</option>
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
                    : text.chooseOrder}
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
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={createQuoteBusy || !createQuoteForm.orderId}>
                {createQuoteBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                {text.createQuote}
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
            <SheetDescription>{text.contractSheetDescription}</SheetDescription>
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
                  description={text.contractOverviewDescription}
                  action={<Badge variant="outline" className={cn("rounded-full", contractStatusClassName(contractDetail.status))}>{contractStatusLabel(contractDetail.status)}</Badge>}
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.contracts_patient} value={`${contractDetail.patient_name} (${contractDetail.patient_pid})`} />
                    <DetailField label={t.patients_created} value={formatDateTime(contractDetail.created_at, locale, t.common_not_set)} />
                    <DetailField label={text.updatedAt} value={formatDateTime(contractDetail.updated_at, locale, t.common_not_set)} />
                    <DetailField label={t.contracts_signed_at} value={formatDateTime(contractDetail.signed_at, locale, t.common_not_set)} />
                    <DetailField label={t.providers_service_valid_from} value={formatDate(contractDetail.valid_from, locale, t.common_not_set)} />
                    <DetailField label={t.providers_service_valid_to} value={formatDate(contractDetail.valid_to, locale, t.common_not_set)} />
                    <DetailField
                      label={t.contracts_notes}
                      value={contractDetail.conditions && Object.keys(contractDetail.conditions).length > 0 ? JSON.stringify(contractDetail.conditions, null, 2) : t.common_not_set}
                    />
                  </div>
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description={text.linkedContractDescription}>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/patients?patient=${contractDetail.patient_id}`)}>{t.contracts_patient}</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/orders?patient=${contractDetail.patient_id}`)}>{text.orders}</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/documents?patient=${contractDetail.patient_id}`)}>{text.documents}</Button>
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
                          <option key={status} value={status}>{contractStatusLabel(status)}</option>
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
                      {text.saveContract}
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
            <SheetTitle>{quoteDetail ? `${quoteDetail.quote_number} / ${quoteDetail.patient_name}` : text.quotesTab}</SheetTitle>
            <SheetDescription>{text.quoteSheetDescription}</SheetDescription>
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
                  title={text.quotesTab}
                  description={text.quoteOverviewDescription}
                  action={<Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(quoteDetail.status))}>{quoteStatusLabel(quoteDetail.status)}</Badge>}
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description={text.linkedQuoteDescription}>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/patients?patient=${quoteDetail.patient_id}`)}>{t.contracts_patient}</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/orders?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>{text.order}</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/invoices?quote=${quoteDetail.id}&order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>{text.invoices}</Button>
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => staffGo(`/documents?order=${quoteDetail.order_id}&patient=${quoteDetail.patient_id}`)}>{text.documents}</Button>
                  </div>
                </SectionCard>

                <SectionCard title={text.quoteLifecycle} description={text.quoteLifecycleDescription}>
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
                          <option key={status} value={status}>{quoteStatusLabel(status)}</option>
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
                      {text.saveQuote}
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard title={text.lineItems} description={text.lineItemsDescription}>
                  {!quoteDetail.line_items || quoteDetail.line_items.length === 0 ? (
                    <EmptyState title={text.noLineItems} description={text.noLineItemsDescription} />
                  ) : (
                    <div className="space-y-3">
                      {quoteDetail.line_items.map((line, index) => (
                        <div key={`${line.description}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{line.description}</h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {text.quantity} {line.quantity} · {text.unit} {formatCurrency(line.unit_price)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                                {t.invoices_vat} {line.vat_rate}%
                              </Badge>
                              {line.is_cost_passthrough ? (
                                <Badge variant="outline" className="rounded-full border-orange-200 bg-orange-50 text-orange-700">
                                  {t.orders_cost_pass_through_badge}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <MiniMetric label={text.net} value={formatCurrency(line.line_net)} />
                            <MiniMetric label={t.invoices_vat} value={formatCurrency(line.line_vat)} />
                            <MiniMetric label={text.gross} value={formatCurrency(line.line_gross)} />
                          </div>
                          {line.notes ? (
                            <div className="mt-3 text-sm text-slate-600">{line.notes}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title={text.versionHistory} description={text.versionHistoryDescription}>
                  {quoteVersionsLoading ? (
                    <LoadingState label={t.common_loading} />
                  ) : quoteVersionsError ? (
                    <Banner tone="error">{quoteVersionsError}</Banner>
                  ) : quoteVersions.length === 0 ? (
                    <EmptyState title={text.noVersions} description={text.noVersionsDescription} />
                  ) : (
                    <div className="space-y-3">
                      {quoteVersions.map((version) => (
                        <div key={version.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-900">
                                  {text.version} {version.version_number}
                                </h3>
                                <Badge variant="outline" className={cn("rounded-full", quoteStatusClassName(version.status))}>
                                  {quoteStatusLabel(version.status)}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatDateTime(version.created_at, locale, t.common_not_set)} · {version.created_by_name} ({roleLabel(version.created_by_role)})
                              </p>
                              <p className="mt-2 text-sm text-slate-600">
                                {(version.change_reason || text.snapshotFallback).replaceAll("_", " ")} · {version.line_item_count} {text.lineItemsCount}
                              </p>
                            </div>
                            <div className="grid min-w-[220px] gap-3 md:grid-cols-2">
                              <MiniMetric label={text.gross} value={formatCurrency(version.total_gross)} />
                              <MiniMetric label={t.invoices_paid} value={formatCurrency(version.paid_amount)} />
                              <MiniMetric label={t.providers_service_valid_to} value={formatDate(version.valid_until, locale, t.common_not_set)} />
                              <MiniMetric label={t.invoices_paid_at} value={formatDateTime(version.paid_at, locale, t.common_not_set)} />
                            </div>
                          </div>
                          {version.notes ? (
                            <div className="mt-3 text-sm text-slate-600">{version.notes}</div>
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
