import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  ChevronDown,
  CornerDownRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  PageHeader,
  Section,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import {
  agencyServiceDescriptionLabel,
  agencyServiceNameLabel,
  agencyServiceUnitLabel,
} from "@/lib/agency-service-labels";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  useLang,
  type TranslationKey,
} from "@/lib/i18n";
import {
  agencyServiceToForm,
  blankAgencyServiceForm,
  toOptional,
  valueToInput,
} from "@/pages/contracts/model/contracts-model";
import type {
  AgencyServiceFormState,
  AgencyServiceItem,
} from "@/pages/contracts/model/types";
import { cn } from "@/lib/utils";

type TaxProfile = {
  id: string;
  profile_key: string;
  name: string;
  description?: string | null;
  vat_rate: string;
  vat_category: string;
  is_default: boolean;
  is_active: boolean;
  valid_from: string;
  valid_to?: string | null;
};

type CatalogTaxProfile = {
  catalog_id: string;
  service_key: string;
  service_name: string;
  vat_rate: string;
  vat_source: string;
  tax_profile_id?: string | null;
  tax_profile_key?: string | null;
  tax_profile_name?: string | null;
  tax_profile_vat_rate?: string | null;
};

type ServicePackage = {
  id: string;
  package_key: string;
  name: string;
  description?: string | null;
  currency: string;
  base_price_net: string;
  base_price_vat: string;
  base_price_gross: string;
  tax_profile_id?: string | null;
  tax_profile_key?: string | null;
  tax_profile_name?: string | null;
  tax_profile_vat_rate?: string | null;
  is_active: boolean;
  valid_from: string;
  valid_to?: string | null;
  items?: ServicePackageItem[];
};

type ServicePackageItem = {
  id: string;
  agency_service_id?: string | null;
  agency_service_name?: string | null;
  agency_service_unit_price?: string | null;
  agency_service_currency?: string | null;
  agency_service_vat_rate?: string | null;
  service_key?: string | null;
  description: string;
  included_quantity: string;
  unit_label: string;
  overage_unit_price_net?: string | null;
  tax_profile_id?: string | null;
  tax_profile_key?: string | null;
  tax_profile_name?: string | null;
  tax_profile_vat_rate?: string | null;
  requires_patient_approval: boolean;
  sort_order: number;
};

type TaxProfileForm = {
  profileKey: string;
  name: string;
  description: string;
  vatRate: string;
  vatCategory: string;
  isDefault: boolean;
  isActive: boolean;
  validFrom: string;
  validTo: string;
};

const BLANK_TAX_PROFILE_FORM: TaxProfileForm = {
  profileKey: "",
  name: "",
  description: "",
  vatRate: "19",
  vatCategory: "standard",
  isDefault: false,
  isActive: true,
  validFrom: "",
  validTo: "",
};

type ServicePackageItemForm = {
  formKey: string;
  agencyServiceId: string;
  description: string;
  serviceKey: string;
  includedQuantity: string;
  unitLabel: string;
  overageUnitPriceNet: string;
  taxProfileId: string;
  requiresPatientApproval: boolean;
};

type ServicePackageForm = {
  id: string;
  packageKey: string;
  name: string;
  description: string;
  currency: string;
  basePriceNet: string;
  taxProfileId: string;
  isActive: boolean;
  validFrom: string;
  validTo: string;
  items: ServicePackageItemForm[];
};

let packageItemFormKeySeed = 0;

function nextPackageItemFormKey() {
  packageItemFormKeySeed += 1;
  return `package-item-form-${packageItemFormKeySeed}`;
}

const BLANK_PACKAGE_ITEM_FORM: ServicePackageItemForm = {
  formKey: "package-item-form-template",
  agencyServiceId: "",
  description: "",
  serviceKey: "",
  includedQuantity: "1",
  unitLabel: "",
  overageUnitPriceNet: "",
  taxProfileId: "",
  requiresPatientApproval: false,
};

const BLANK_PACKAGE_FORM: ServicePackageForm = {
  id: "",
  packageKey: "",
  name: "",
  description: "",
  currency: "EUR",
  basePriceNet: "0",
  taxProfileId: "",
  isActive: true,
  validFrom: "",
  validTo: "",
  items: [],
};

function createBlankPackageItem(unitLabel: string): ServicePackageItemForm {
  return { ...BLANK_PACKAGE_ITEM_FORM, formKey: nextPackageItemFormKey(), unitLabel };
}

function createBlankPackageForm(unitLabel: string): ServicePackageForm {
  return { ...BLANK_PACKAGE_FORM, items: [createBlankPackageItem(unitLabel)] };
}

function todayInputDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function createBlankAgencyServiceForm(unitLabel: string): AgencyServiceFormState {
  return {
    ...blankAgencyServiceForm(unitLabel),
    validFrom: todayInputDate(),
  };
}

const VAT_CATEGORIES = [
  "standard",
  "zero_rated",
  "exempt",
  "reverse_charge",
  "custom",
];

const VAT_CATEGORY_LABEL_KEYS = {
  standard: "finance_catalog_vat_category_standard",
  zero_rated: "finance_catalog_vat_category_zero_rated",
  exempt: "finance_catalog_vat_category_exempt",
  reverse_charge: "finance_catalog_vat_category_reverse_charge",
  custom: "finance_catalog_vat_category_custom",
} satisfies Partial<Record<string, TranslationKey>>;

const VAT_SOURCE_LABEL_KEYS = {
  catalog: "finance_catalog_vat_source_catalog",
  tax_profile: "finance_catalog_vat_source_tax_profile",
  manual: "finance_catalog_vat_source_manual",
  legacy: "finance_catalog_vat_source_legacy",
} satisfies Partial<Record<string, TranslationKey>>;

const createButtonClassName =
  "h-9 rounded-lg px-3.5";

const financeMoneyFormatters = new Map<string, Intl.NumberFormat>();

function financeMoneyFormatter(currency: string) {
  const cached = financeMoneyFormatters.get(currency);
  if (cached) return cached;
  const formatter = Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
  financeMoneyFormatters.set(currency, formatter);
  return formatter;
}

function numberValue(value: string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value: string | number | null | undefined, currency = "EUR") {
  const numeric = typeof value === "number" ? value : numberValue(value);
  return financeMoneyFormatter(currency).format(numeric);
}

export function packageItemVatRate(item: ServicePackageItem, servicePackage: ServicePackage) {
  return (
    item.tax_profile_vat_rate ??
    item.agency_service_vat_rate ??
    servicePackage.tax_profile_vat_rate ??
    "0"
  );
}

function taxProfileToForm(profile: TaxProfile): TaxProfileForm {
  return {
    profileKey: profile.profile_key,
    name: profile.name,
    description: profile.description ?? "",
    vatRate: profile.vat_rate,
    vatCategory: profile.vat_category,
    isDefault: profile.is_default,
    isActive: profile.is_active,
    validFrom: profile.valid_from ?? "",
    validTo: profile.valid_to ?? "",
  };
}

function packageItemToForm(
  item: ServicePackageItem,
  defaultUnitLabel: string,
): ServicePackageItemForm {
  return {
    formKey: item.id || nextPackageItemFormKey(),
    agencyServiceId: item.agency_service_id ?? "",
    description: item.description,
    serviceKey: item.service_key ?? "",
    includedQuantity: item.included_quantity,
    unitLabel: item.unit_label || defaultUnitLabel,
    overageUnitPriceNet: item.overage_unit_price_net ?? "",
    taxProfileId: item.tax_profile_id ?? "",
    requiresPatientApproval: item.requires_patient_approval,
  };
}

function packageToForm(
  item: ServicePackage,
  defaultUnitLabel: string,
): ServicePackageForm {
  return {
    id: item.id,
    packageKey: item.package_key,
    name: item.name,
    description: item.description ?? "",
    currency: item.currency || "EUR",
    basePriceNet: item.base_price_net,
    taxProfileId: item.tax_profile_id ?? "",
    isActive: item.is_active,
    validFrom: item.valid_from ?? "",
    validTo: item.valid_to ?? "",
    items:
      item.items && item.items.length > 0
        ? item.items.map((packageItem) =>
            packageItemToForm(packageItem, defaultUnitLabel),
          )
        : [createBlankPackageItem(defaultUnitLabel)],
  };
}

export function packageItemPatchFromAgencyService(
  service: Pick<
    AgencyServiceItem,
    "id" | "description" | "service_key" | "service_name" | "unit_label" | "unit_price"
  >,
  defaultUnitLabel: string,
) {
  return {
    agencyServiceId: service.id,
    description: service.description?.trim() || service.service_name,
    serviceKey: service.service_key,
    unitLabel: service.unit_label || defaultUnitLabel,
    overageUnitPriceNet: valueToInput(service.unit_price),
  };
}

export function createPackageItemFromAgencyService(
  service: Pick<
    AgencyServiceItem,
    "id" | "description" | "service_key" | "service_name" | "unit_label" | "unit_price"
  >,
  defaultUnitLabel: string,
): ServicePackageItemForm {
  return {
    ...createBlankPackageItem(defaultUnitLabel),
    ...packageItemPatchFromAgencyService(service, defaultUnitLabel),
  };
}

export type AgencyServicePackageUsage = {
  id: string;
  packageKey: string;
  name: string;
  isActive: boolean;
};

export function agencyServiceGrossAmount(
  service: Pick<AgencyServiceItem, "unit_price" | "vat_rate">,
) {
  const net = numberValue(valueToInput(service.unit_price));
  const vatRate = numberValue(valueToInput(service.vat_rate));
  return Math.round((net * (1 + vatRate / 100) + Number.EPSILON) * 100) / 100;
}

export function agencyServicePackageUsagesByServiceId(servicePackages: ServicePackage[]) {
  const usages = new Map<string, AgencyServicePackageUsage[]>();
  const seenPackageLinks = new Set<string>();

  for (const servicePackage of servicePackages) {
    for (const item of servicePackage.items ?? []) {
      const serviceId = item.agency_service_id?.trim();
      if (!serviceId) continue;

      const linkKey = `${servicePackage.id}:${serviceId}`;
      if (seenPackageLinks.has(linkKey)) continue;
      seenPackageLinks.add(linkKey);

      const current = usages.get(serviceId) ?? [];
      current.push({
        id: servicePackage.id,
        packageKey: servicePackage.package_key,
        name: servicePackage.name,
        isActive: servicePackage.is_active,
      });
      usages.set(serviceId, current);
    }
  }

  for (const [serviceId, items] of usages.entries()) {
    usages.set(
      serviceId,
      [...items].sort((left, right) => {
        if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
        return left.name.localeCompare(right.name, "de");
      }),
    );
  }

  return usages;
}

function decimalPayload(value: string, fallback = 0) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalInputIsValid(value: string) {
  return Number.isFinite(Number(value.replace(",", ".")));
}

type AgencyServiceValidationMessages = {
  required: string;
  unitPrice: string;
  vatRate: string;
};

export function validateAgencyServiceForm(
  form: Pick<
    AgencyServiceFormState,
    "serviceKey" | "serviceName" | "unitPrice" | "vatRate" | "validFrom"
  >,
  messages: AgencyServiceValidationMessages,
) {
  if (!form.serviceKey.trim() || !form.serviceName.trim() || !form.validFrom) {
    return messages.required;
  }
  if (
    !form.unitPrice.trim() ||
    !decimalInputIsValid(form.unitPrice) ||
    decimalPayload(form.unitPrice) < 0
  ) {
    return messages.unitPrice;
  }
  if (form.vatRate.trim()) {
    const vatRate = decimalPayload(form.vatRate);
    if (!decimalInputIsValid(form.vatRate) || vatRate < 0 || vatRate > 100) {
      return messages.vatRate;
    }
  }
  return "";
}

type FinanceCatalogState = {
  taxProfiles: TaxProfile[];
  catalogRows: CatalogTaxProfile[];
  agencyServices: AgencyServiceItem[];
  servicePackages: ServicePackage[];
  loading: boolean;
  error: string;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  form: TaxProfileForm;
  editingTaxProfileId: string;
  taxEditBusy: boolean;
  taxEditError: string;
  taxEditForm: TaxProfileForm;
  packageFormOpen: boolean;
  packageBusy: boolean;
  packageError: string;
  packageForm: ServicePackageForm;
  agencyServiceFormOpen: boolean;
  agencyServiceBusy: boolean;
  agencyServiceError: string;
  agencyServiceForm: AgencyServiceFormState;
};

type FinanceCatalogPatch =
  | Partial<FinanceCatalogState>
  | ((current: FinanceCatalogState) => Partial<FinanceCatalogState>);

function financeCatalogReducer(
  current: FinanceCatalogState,
  patch: FinanceCatalogPatch,
): FinanceCatalogState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveFinanceCatalogStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createFinanceCatalogFieldPatch<K extends keyof FinanceCatalogState>(
  field: K,
  nextValue: SetStateAction<FinanceCatalogState[K]>,
): FinanceCatalogPatch {
  return (current) => ({
    [field]: resolveFinanceCatalogStateAction(nextValue, current[field]),
  } as Partial<FinanceCatalogState>);
}

function useFinanceCatalogPageContent() {
  const { user } = useAuth();
  const { t } = useLang();
  const vatCategoryLabel = (value: string | null | undefined) =>
    formatEnumLabelFromKeys(value, VAT_CATEGORY_LABEL_KEYS, t);
  const vatSourceLabel = (value: string | null | undefined) =>
    formatEnumLabelFromKeys(value, VAT_SOURCE_LABEL_KEYS, t);
  const taxProfileLabel = (
    name: string | null | undefined,
    key: string | null | undefined,
  ) => {
    const trimmedName = name?.trim();
    if (trimmedName) return trimmedName;
    if (key?.trim()) return formatUnknownValue(key, t);
    return t.common_not_set;
  };
  const blankPackageItem = useCallback(
    () => createBlankPackageItem(t.finance_catalog_unit_default),
    [t.finance_catalog_unit_default],
  );
  const blankPackageForm = useCallback(
    () => createBlankPackageForm(t.finance_catalog_unit_default),
    [t.finance_catalog_unit_default],
  );
  const canManageTaxProfiles = user?.role === "ceo" || user?.role === "billing";

  const [financeCatalogState, dispatchFinanceCatalogState] = useReducer(
    financeCatalogReducer,
    undefined,
    (): FinanceCatalogState => ({
      taxProfiles: [],
      catalogRows: [],
      agencyServices: [],
      servicePackages: [],
      loading: true,
      error: "",
      createOpen: false,
      createBusy: false,
      createError: "",
      form: BLANK_TAX_PROFILE_FORM,
      editingTaxProfileId: "",
      taxEditBusy: false,
      taxEditError: "",
      taxEditForm: BLANK_TAX_PROFILE_FORM,
      packageFormOpen: false,
      packageBusy: false,
      packageError: "",
      packageForm: createBlankPackageForm(t.finance_catalog_unit_default),
      agencyServiceFormOpen: false,
      agencyServiceBusy: false,
      agencyServiceError: "",
      agencyServiceForm: createBlankAgencyServiceForm(t.finance_catalog_unit_default),
    }),
  );
  const {
    agencyServiceBusy,
    agencyServiceError,
    agencyServiceForm,
    agencyServiceFormOpen,
    agencyServices,
    catalogRows,
    createBusy,
    createError,
    createOpen,
    editingTaxProfileId,
    error,
    form,
    loading,
    packageBusy,
    packageError,
    packageForm,
    packageFormOpen,
    servicePackages,
    taxEditBusy,
    taxEditError,
    taxEditForm,
    taxProfiles,
  } = financeCatalogState;
  const setFinanceCatalogField = <K extends keyof FinanceCatalogState>(
    field: K,
    nextValue: SetStateAction<FinanceCatalogState[K]>,
  ) =>
    dispatchFinanceCatalogState(
      createFinanceCatalogFieldPatch(field, nextValue),
    );
  const setTaxProfiles = (nextValue: SetStateAction<TaxProfile[]>) =>
    setFinanceCatalogField("taxProfiles", nextValue);
  const setCatalogRows = (nextValue: SetStateAction<CatalogTaxProfile[]>) =>
    setFinanceCatalogField("catalogRows", nextValue);
  const setAgencyServices = (nextValue: SetStateAction<AgencyServiceItem[]>) =>
    setFinanceCatalogField("agencyServices", nextValue);
  const setServicePackages = (nextValue: SetStateAction<ServicePackage[]>) =>
    setFinanceCatalogField("servicePackages", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("loading", nextValue);
  const setError = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("error", nextValue);
  const setCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("createOpen", nextValue);
  const setCreateBusy = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("createBusy", nextValue);
  const setCreateError = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("createError", nextValue);
  const setForm = (nextValue: SetStateAction<TaxProfileForm>) =>
    setFinanceCatalogField("form", nextValue);
  const setEditingTaxProfileId = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("editingTaxProfileId", nextValue);
  const setTaxEditBusy = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("taxEditBusy", nextValue);
  const setTaxEditError = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("taxEditError", nextValue);
  const setTaxEditForm = (nextValue: SetStateAction<TaxProfileForm>) =>
    setFinanceCatalogField("taxEditForm", nextValue);
  const setPackageFormOpen = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("packageFormOpen", nextValue);
  const setPackageBusy = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("packageBusy", nextValue);
  const setPackageError = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("packageError", nextValue);
  const setPackageForm = (nextValue: SetStateAction<ServicePackageForm>) =>
    setFinanceCatalogField("packageForm", nextValue);
  const setAgencyServiceFormOpen = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("agencyServiceFormOpen", nextValue);
  const setAgencyServiceBusy = (nextValue: SetStateAction<boolean>) =>
    setFinanceCatalogField("agencyServiceBusy", nextValue);
  const setAgencyServiceError = (nextValue: SetStateAction<string>) =>
    setFinanceCatalogField("agencyServiceError", nextValue);
  const setAgencyServiceForm = (nextValue: SetStateAction<AgencyServiceFormState>) =>
    setFinanceCatalogField("agencyServiceForm", nextValue);

  const agencyServicePackageUsages = useMemo(
    () => agencyServicePackageUsagesByServiceId(servicePackages),
    [servicePackages],
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const filteredAgencyServices = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return agencyServices;
    return agencyServices.filter((item) =>
      [
        agencyServiceNameLabel(item.service_key, item.service_name, t),
        item.service_key,
        item.description ? agencyServiceDescriptionLabel(item.service_key, item.description, t) : "",
        (agencyServicePackageUsages.get(item.id) ?? []).map((usage) => usage.name).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [agencyServicePackageUsages, agencyServices, catalogSearch, t]);
  const taxProfileColumns = useMemo<ColumnDef<TaxProfile>[]>(
    () => [
      {
        id: "name",
        label: t.finance_catalog_tax_profile_prefix,
        accessor: (profile) => profile.name,
        filterType: "text",
        sortable: true,
        searchable: true,
        required: true,
        width: 260,
        render: (profile) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs font-medium text-foreground">
              {profile.name}
            </span>
            {profile.is_default ? (
              <Badge variant="outline" className="shrink-0 rounded-full">
                {t.finance_catalog_default_badge}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "vat_rate",
        label: t.finance_catalog_vat_label,
        accessor: (profile) => Number(profile.vat_rate) || 0,
        filterType: "number",
        sortable: true,
        width: 100,
        render: (profile) => (
          <span className="font-medium tabular-nums text-foreground">{profile.vat_rate}%</span>
        ),
      },
      {
        id: "category",
        label: t.finance_catalog_source,
        accessor: (profile) => vatCategoryLabel(profile.vat_category),
        filterType: "text",
        sortable: true,
        searchable: true,
        width: 220,
        render: (profile) => (
          <span className="truncate text-muted-foreground">
            {vatCategoryLabel(profile.vat_category)}
          </span>
        ),
      },
      {
        id: "description",
        label: t.revenue_agency_service_description_label,
        accessor: (profile) => profile.description ?? "",
        filterType: "text",
        searchable: true,
        width: 320,
        render: (profile) => (
          <span className="truncate text-muted-foreground" title={profile.description ?? undefined}>
            {profile.description || "—"}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (profile) => (profile.is_active ? "active" : "inactive"),
        filterType: "enum",
        filterOptions: [
          { value: "active", label: t.common_active },
          { value: "inactive", label: t.common_inactive },
        ],
        sortable: true,
        width: 110,
        render: (profile) => (
          <Badge
            variant="outline"
            className={cn(
              "w-fit rounded-full",
              profile.is_active
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600",
            )}
          >
            {profile.is_active ? t.common_active : t.common_inactive}
          </Badge>
        ),
      },
    ],
    [t, vatCategoryLabel],
  );

  type PackageTableRow = {
    rowId: string;
    kind: "package" | "item";
    name: string;
    itemCount: number;
    gross: number;
    net: number;
    vat: number;
    currency: string;
    isActive: boolean;
    description: string;
    pkg?: ServicePackage;
    unitLabel?: string;
    quantity?: string;
  };
  const [expandedPackages, setExpandedPackages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const togglePackageExpanded = useCallback((packageId: string) => {
    setExpandedPackages((current) => {
      const next = new Set(current);
      if (next.has(packageId)) next.delete(packageId);
      else next.add(packageId);
      return next;
    });
  }, []);
  const packageTableRows = useMemo<PackageTableRow[]>(
    () =>
      servicePackages.map((pkg) => ({
        rowId: pkg.id,
        kind: "package",
        name: pkg.name,
        itemCount: pkg.items?.length ?? 0,
        gross: Number(pkg.base_price_gross) || 0,
        net: Number(pkg.base_price_net) || 0,
        vat: Number(pkg.base_price_vat) || 0,
        currency: pkg.currency,
        isActive: pkg.is_active,
        description: pkg.description ?? "",
        pkg,
      })),
    [servicePackages],
  );
  const expandPackageRow = useCallback(
    (row: PackageTableRow): PackageTableRow[] | null => {
      if (row.kind !== "package" || !row.pkg || !expandedPackages.has(row.rowId)) {
        return null;
      }
      const items = row.pkg.items ?? [];
      return items.map((item) => ({
        rowId: `${row.rowId}:item:${item.id}`,
        kind: "item" as const,
        name:
          item.agency_service_name ||
          agencyServiceNameLabel(item.service_key ?? "", item.agency_service_name ?? null, t) ||
          item.description,
        itemCount: 0,
        gross: 0,
        net: Number(item.agency_service_unit_price) || 0,
        vat: 0,
        currency: item.agency_service_currency || row.currency,
        isActive: true,
        description: item.description,
        unitLabel: agencyServiceUnitLabel(item.unit_label, t),
        quantity: item.included_quantity,
      }));
    },
    [expandedPackages, t],
  );
  const packageTableColumns = useMemo<ColumnDef<PackageTableRow>[]>(
    () => [
      {
        id: "name",
        label: t.finance_catalog_service,
        accessor: (row) => row.name,
        filterType: "text",
        sortable: true,
        searchable: true,
        required: true,
        width: 380,
        render: (row) =>
          row.kind === "item" ? (
            <div
              className="flex min-w-0 items-center gap-1.5 pl-7"
              title={row.description || undefined}
            >
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground/60" />
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.name}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-expanded={expandedPackages.has(row.rowId)}
              onClick={(event) => {
                event.stopPropagation();
                togglePackageExpanded(row.rowId);
              }}
            >
              <span className="truncate font-mono text-xs font-medium text-foreground">
                {row.name}
              </span>
              {row.itemCount > 0 ? (
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    expandedPackages.has(row.rowId) && "rotate-180",
                  )}
                />
              ) : null}
            </button>
          ),
      },
      {
        id: "items",
        label: t.finance_catalog_packages_column,
        accessor: (row) => (row.kind === "package" ? row.itemCount : Number(row.quantity) || 0),
        filterType: "number",
        sortable: true,
        width: 110,
        render: (row) =>
          row.kind === "item" ? (
            <span className="tabular-nums text-muted-foreground">
              {row.quantity}
              {row.unitLabel ? ` ${row.unitLabel}` : ""}
            </span>
          ) : (
            <span className="tabular-nums text-foreground">{row.itemCount}</span>
          ),
      },
      {
        id: "net",
        label: t.finance_catalog_net_label,
        accessor: (row) => row.net,
        filterType: "number",
        sortable: true,
        width: 130,
        render: (row) => (
          <span className={cn("tabular-nums", row.kind === "item" ? "text-muted-foreground" : "font-medium text-foreground")}>
            {row.net ? formatMoney(String(row.net), row.currency) : "—"}
          </span>
        ),
      },
      {
        id: "vat",
        label: t.finance_catalog_vat_label,
        accessor: (row) => row.vat,
        filterType: "number",
        sortable: true,
        width: 120,
        render: (row) =>
          row.kind === "item" ? null : (
            <span className="tabular-nums text-foreground">
              {formatMoney(String(row.vat), row.currency)}
            </span>
          ),
      },
      {
        id: "gross",
        label: t.finance_catalog_package_total,
        accessor: (row) => row.gross,
        filterType: "number",
        sortable: true,
        width: 140,
        render: (row) =>
          row.kind === "item" ? null : (
            <span className="font-semibold tabular-nums text-foreground">
              {formatMoney(String(row.gross), row.currency)}
            </span>
          ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => (row.isActive ? "active" : "inactive"),
        filterType: "enum",
        filterOptions: [
          { value: "active", label: t.common_active },
          { value: "inactive", label: t.common_inactive },
        ],
        sortable: true,
        width: 110,
        render: (row) =>
          row.kind === "item" ? null : (
            <Badge
              variant="outline"
              className={cn(
                "w-fit rounded-full",
                row.isActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              {row.isActive ? t.common_active : t.common_inactive}
            </Badge>
          ),
      },
    ],
    [expandedPackages, t, togglePackageExpanded],
  );

  const agencyServiceColumns = useMemo<ColumnDef<AgencyServiceItem>[]>(
    () => [
      {
        id: "service",
        label: t.finance_catalog_service,
        accessor: (item) => agencyServiceNameLabel(item.service_key, item.service_name, t),
        filterType: "text",
        sortable: true,
        searchable: true,
        required: true,
        width: 260,
        render: (item) => (
          <span
            className="truncate font-medium text-foreground"
            title={
              item.description
                ? agencyServiceDescriptionLabel(item.service_key, item.description, t)
                : undefined
            }
          >
            {agencyServiceNameLabel(item.service_key, item.service_name, t)}
          </span>
        ),
      },
      {
        id: "unit_price",
        label: t.revenue_agency_service_unit_price,
        accessor: (item) => Number(item.unit_price) || 0,
        filterType: "number",
        sortable: true,
        width: 120,
        render: (item) => (
          <span className="font-medium tabular-nums text-foreground">
            {formatMoney(item.unit_price as string | number, item.currency)}
          </span>
        ),
      },
      {
        id: "gross",
        label: t.revenue_common_gross,
        accessor: (item) => agencyServiceGrossAmount(item),
        filterType: "number",
        sortable: true,
        width: 120,
        render: (item) => (
          <span className="font-medium tabular-nums text-foreground">
            {formatMoney(agencyServiceGrossAmount(item), item.currency)}
          </span>
        ),
      },
      {
        id: "unit",
        label: t.revenue_agency_service_unit,
        accessor: (item) => agencyServiceUnitLabel(item.unit_label, t),
        filterType: "text",
        sortable: true,
        width: 110,
        render: (item) => (
          <span className="truncate text-muted-foreground">
            {agencyServiceUnitLabel(item.unit_label, t)}
          </span>
        ),
      },
      {
        id: "vat",
        label: t.finance_catalog_vat_label,
        accessor: (item) => Number(valueToInput(item.vat_rate)) || 0,
        filterType: "number",
        sortable: true,
        width: 80,
        render: (item) => (
          <span className="tabular-nums text-foreground">{valueToInput(item.vat_rate) || "0"}%</span>
        ),
      },
      {
        id: "packages",
        label: t.finance_catalog_packages_column,
        accessor: (item) =>
          (agencyServicePackageUsages.get(item.id) ?? []).map((usage) => usage.name).join(", "),
        filterType: "text",
        searchable: true,
        width: 380,
        render: (item) => {
          const packageUsages = agencyServicePackageUsages.get(item.id) ?? [];
          if (packageUsages.length === 0) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              {packageUsages.slice(0, 2).map((usage) => (
                <Badge
                  key={usage.id}
                  variant="outline"
                  title={usage.packageKey}
                  className={cn(
                    "max-w-[160px] truncate rounded-full",
                    usage.isActive
                      ? "border-sky-200 bg-sky-50 text-sky-700"
                      : "border-slate-200 bg-slate-50 text-slate-600",
                  )}
                >
                  {usage.name}
                </Badge>
              ))}
              {packageUsages.length > 2 ? (
                <Badge variant="outline" className="shrink-0 rounded-full">
                  {t.finance_catalog_more_packages.replace(
                    "{count}",
                    String(packageUsages.length - 2),
                  )}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (item) => (item.is_active ? "active" : "inactive"),
        filterType: "enum",
        filterOptions: [
          { value: "active", label: t.common_active },
          { value: "inactive", label: t.common_inactive },
        ],
        sortable: true,
        width: 110,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn(
              "w-fit rounded-full",
              item.is_active
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600",
            )}
          >
            {item.is_active ? t.common_active : t.common_inactive}
          </Badge>
        ),
      },
    ],
    [agencyServicePackageUsages, t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [taxResult, catalogResult, packageResult, agencyServiceResult] = await Promise.all([
        apiFetch<TaxProfile[]>("/tax-profiles"),
        apiFetch<CatalogTaxProfile[]>("/tax-profiles/catalog"),
        apiFetch<ServicePackage[]>("/service-packages"),
        apiFetch<AgencyServiceItem[]>("/agency-services"),
      ]);
      setTaxProfiles(taxResult);
      setCatalogRows(catalogResult);
      setServicePackages(packageResult);
      setAgencyServices(agencyServiceResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.finance_catalog_error_load);
    } finally {
      setLoading(false);
    }
  }, [t.finance_catalog_error_load]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreateTaxProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    const vatRate = Number(form.vatRate.replace(",", "."));
    if (!form.profileKey.trim() || !form.name.trim()) {
      setCreateError(t.finance_catalog_error_profile_required);
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setCreateError(t.finance_catalog_error_vat_rate);
      return;
    }

    setCreateBusy(true);
    try {
      await apiFetch("/tax-profiles", {
        method: "POST",
        body: JSON.stringify({
          profile_key: form.profileKey.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          vat_rate: vatRate,
          vat_category: form.vatCategory,
          is_default: form.isDefault,
          is_active: form.isActive,
          valid_from: form.validFrom || null,
          valid_to: form.validTo || null,
        }),
      });
      clearApiCache("/tax-profiles");
      setForm(BLANK_TAX_PROFILE_FORM);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : t.finance_catalog_error_create_tax_profile,
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveTaxProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTaxProfileId) return;
    setTaxEditError("");

    const vatRate = Number(taxEditForm.vatRate.replace(",", "."));
    if (!taxEditForm.profileKey.trim() || !taxEditForm.name.trim()) {
      setTaxEditError(t.finance_catalog_error_profile_required);
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setTaxEditError(t.finance_catalog_error_vat_rate);
      return;
    }

    setTaxEditBusy(true);
    try {
      await apiFetch(`/tax-profiles/${editingTaxProfileId}`, {
        method: "POST",
        body: JSON.stringify({
          profile_key: taxEditForm.profileKey.trim(),
          name: taxEditForm.name.trim(),
          description: taxEditForm.description.trim() || null,
          vat_rate: vatRate,
          vat_category: taxEditForm.vatCategory,
          is_default: taxEditForm.isDefault,
          is_active: taxEditForm.isActive,
          valid_from: taxEditForm.validFrom || null,
          valid_to: taxEditForm.validTo || null,
        }),
      });
      clearApiCache("/tax-profiles");
      setEditingTaxProfileId("");
      setTaxEditForm(BLANK_TAX_PROFILE_FORM);
      await load();
    } catch (err) {
      setTaxEditError(
        err instanceof Error ? err.message : t.finance_catalog_error_update_tax_profile,
      );
    } finally {
      setTaxEditBusy(false);
    }
  }

  function openCreateTaxProfile() {
    setForm(BLANK_TAX_PROFILE_FORM);
    setCreateError("");
    setEditingTaxProfileId("");
    setPackageFormOpen(false);
    setAgencyServiceFormOpen(false);
    setCreateOpen(true);
  }

  function closeCreateTaxProfile() {
    if (createBusy) return;
    setCreateOpen(false);
    setCreateError("");
    setForm(BLANK_TAX_PROFILE_FORM);
  }

  function openEditTaxProfile(profile: TaxProfile) {
    setCreateOpen(false);
    setCreateError("");
    setPackageFormOpen(false);
    setPackageError("");
    setAgencyServiceFormOpen(false);
    setAgencyServiceError("");
    setEditingTaxProfileId(profile.id);
    setTaxEditForm(taxProfileToForm(profile));
    setTaxEditError("");
  }

  function closeEditTaxProfile() {
    if (taxEditBusy) return;
    setEditingTaxProfileId("");
    setTaxEditError("");
    setTaxEditForm(BLANK_TAX_PROFILE_FORM);
  }
  function openCreatePackage() {
    setCreateOpen(false);
    setEditingTaxProfileId("");
    setAgencyServiceFormOpen(false);
    setAgencyServiceError("");
    setPackageForm(blankPackageForm());
    setPackageError("");
    setPackageFormOpen(true);
  }

  function openEditPackage(item: ServicePackage) {
    setCreateOpen(false);
    setEditingTaxProfileId("");
    setAgencyServiceFormOpen(false);
    setAgencyServiceError("");
    setPackageForm(packageToForm(item, t.finance_catalog_unit_default));
    setPackageError("");
    setPackageFormOpen(true);
  }

  function closePackageForm() {
    if (packageBusy) return;
    setPackageFormOpen(false);
    setPackageError("");
    setPackageForm(blankPackageForm());
  }

  function openCreateAgencyService() {
    setCreateOpen(false);
    setEditingTaxProfileId("");
    setPackageFormOpen(false);
    setAgencyServiceError("");
    setAgencyServiceForm(createBlankAgencyServiceForm(t.finance_catalog_unit_default));
    setAgencyServiceFormOpen(true);
  }

  function openEditAgencyService(item: AgencyServiceItem) {
    setCreateOpen(false);
    setEditingTaxProfileId("");
    setPackageFormOpen(false);
    setAgencyServiceError("");
    setAgencyServiceForm(agencyServiceToForm(item));
    setAgencyServiceFormOpen(true);
  }

  function closeAgencyServiceForm() {
    if (agencyServiceBusy) return;
    setAgencyServiceFormOpen(false);
    setAgencyServiceError("");
    setAgencyServiceForm(createBlankAgencyServiceForm(t.finance_catalog_unit_default));
  }

  function updatePackageItem(index: number, patch: Partial<ServicePackageItemForm>) {
    setPackageForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function applyAgencyServiceToPackageItem(index: number, serviceId: string) {
    const service = agencyServices.find((item) => item.id === serviceId);
    if (!service) {
      updatePackageItem(index, { agencyServiceId: "" });
      return;
    }

    updatePackageItem(index, {
      ...packageItemPatchFromAgencyService(
        service,
        t.finance_catalog_unit_default,
      ),
    });
  }

  function addAgencyServiceToPackage(serviceId: string) {
    const service = agencyServices.find((item) => item.id === serviceId);
    if (!service) return;
    const nextItem = createPackageItemFromAgencyService(
      service,
      t.finance_catalog_unit_default,
    );
    const isEmptyDefaultItem = (item: ServicePackageItemForm) =>
      !item.agencyServiceId &&
      !item.description.trim() &&
      !item.serviceKey.trim() &&
      (!item.includedQuantity.trim() || item.includedQuantity.trim() === "1") &&
      (!item.unitLabel.trim() ||
        item.unitLabel.trim() === t.finance_catalog_unit_default) &&
      !item.overageUnitPriceNet.trim() &&
      !item.taxProfileId &&
      !item.requiresPatientApproval;
    setPackageForm((current) => ({
      ...current,
      items:
        current.items.length === 1 && isEmptyDefaultItem(current.items[0])
          ? [nextItem]
          : [...current.items, nextItem],
    }));
  }

  function removePackageItem(index: number) {
    setPackageForm((current) => ({
      ...current,
      items:
        current.items.length <= 1
          ? [blankPackageItem()]
          : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSaveServicePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPackageError("");

    if (!packageForm.packageKey.trim() || !packageForm.name.trim()) {
      setPackageError(t.finance_catalog_error_package_required);
      return;
    }
    if (packageForm.items.some((item) => !item.description.trim())) {
      setPackageError(t.finance_catalog_error_package_item_description);
      return;
    }
    if (!decimalInputIsValid(packageForm.basePriceNet)) {
      setPackageError(t.finance_catalog_error_base_price_numeric);
      return;
    }
    if (
      packageForm.items.some(
        (item) =>
          !decimalInputIsValid(item.includedQuantity) ||
          Boolean(
            item.overageUnitPriceNet.trim() &&
              !decimalInputIsValid(item.overageUnitPriceNet),
          ),
      )
    ) {
      setPackageError(t.finance_catalog_error_item_numbers);
      return;
    }

    setPackageBusy(true);
    try {
      const payload = {
        package_key: packageForm.packageKey.trim(),
        name: packageForm.name.trim(),
        description: packageForm.description.trim() || null,
        currency: packageForm.currency.trim() || "EUR",
        base_price_net: decimalPayload(packageForm.basePriceNet),
        tax_profile_id: packageForm.taxProfileId || null,
        is_active: packageForm.isActive,
        valid_from: packageForm.validFrom || null,
        valid_to: packageForm.validTo || null,
        items: packageForm.items.map((item) => ({
          id: item.formKey.startsWith("package-item-form-")
            ? null
            : item.formKey,
          agency_service_id: item.agencyServiceId || null,
          description: item.description.trim(),
          service_key: item.serviceKey.trim() || null,
          included_quantity: decimalPayload(item.includedQuantity, 1),
          unit_label: item.unitLabel.trim() || t.finance_catalog_unit_default,
          overage_unit_price_net: item.overageUnitPriceNet.trim()
            ? decimalPayload(item.overageUnitPriceNet)
            : null,
          tax_profile_id: item.taxProfileId || null,
          requires_patient_approval: item.requiresPatientApproval,
        })),
      };

      await apiFetch(
        packageForm.id ? `/service-packages/${packageForm.id}` : "/service-packages",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      clearApiCache("/service-packages");
      setPackageForm(blankPackageForm());
      setPackageFormOpen(false);
      await load();
    } catch (err) {
      setPackageError(
        err instanceof Error ? err.message : t.finance_catalog_error_save_package,
      );
    } finally {
      setPackageBusy(false);
    }
  }

  async function handleSaveAgencyService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAgencyServiceError("");
    const validationError = validateAgencyServiceForm(agencyServiceForm, {
      required: t.finance_catalog_error_agency_service_required,
      unitPrice: t.finance_catalog_error_agency_service_unit_price,
      vatRate: t.finance_catalog_error_agency_service_vat_rate,
    });
    if (validationError) {
      setAgencyServiceError(validationError);
      return;
    }
    setAgencyServiceBusy(true);
    try {
      await apiFetch(
        agencyServiceForm.id
          ? `/agency-services/${agencyServiceForm.id}/update`
          : "/agency-services",
        {
          method: "POST",
          body: JSON.stringify({
            service_key: agencyServiceForm.serviceKey.trim(),
            service_name: agencyServiceForm.serviceName.trim(),
            description: toOptional(agencyServiceForm.description),
            unit_label: toOptional(agencyServiceForm.unitLabel),
            unit_price: decimalPayload(agencyServiceForm.unitPrice),
            currency: toOptional(agencyServiceForm.currency),
            vat_rate: agencyServiceForm.vatRate.trim()
              ? decimalPayload(agencyServiceForm.vatRate)
              : null,
            is_active: agencyServiceForm.isActive,
            valid_from: agencyServiceForm.validFrom || todayInputDate(),
            valid_to: toOptional(agencyServiceForm.validTo),
          }),
        },
      );
      clearApiCache("/agency-services");
      setAgencyServiceForm(createBlankAgencyServiceForm(t.finance_catalog_unit_default));
      setAgencyServiceFormOpen(false);
      await load();
    } catch (err) {
      setAgencyServiceError(
        err instanceof Error
          ? err.message
          : t.finance_catalog_error_save_agency_service,
      );
    } finally {
      setAgencyServiceBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.finance_catalog_title}
      />

      {error ? (
        <Banner tone="error" withIcon>
          {error}
        </Banner>
      ) : null}

      <Section
        title={t.finance_catalog_tax_profiles}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{taxProfiles.length}</CountBadge>
            {canManageTaxProfiles ? (
              <Button
                type="button"
                className={createButtonClassName}
                onClick={openCreateTaxProfile}
              >
                <Plus className="size-4" />
                {t.finance_catalog_new_tax_profile}
              </Button>
            ) : null}
          </div>
        }
      >
        {!loading && taxProfiles.length === 0 ? (
          <EmptyCell>{t.finance_catalog_empty_tax_profiles}</EmptyCell>
        ) : (
          <DataTableSurface
            loading={loading}
            rows={taxProfiles}
            columns={taxProfileColumns}
            dictionary={t as unknown as Record<string, string>}
            rowId={(profile) => profile.id}
            emptyState={<EmptyCell>{t.finance_catalog_empty_tax_profiles}</EmptyCell>}
            rowActions={
              canManageTaxProfiles
                ? (profile) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => openEditTaxProfile(profile)}
                      aria-label={t.finance_catalog_edit}
                      title={t.finance_catalog_edit}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </Section>

      <Section
        title={t.revenue_agency_service_catalog_items}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{agencyServices.length}</CountBadge>
            {canManageTaxProfiles ? (
              <Button
                type="button"
                className={createButtonClassName}
                onClick={openCreateAgencyService}
              >
                <Plus className="size-4" />
                {t.revenue_agency_service_new_title}
              </Button>
            ) : null}
          </div>
        }
      >
        {!loading && agencyServices.length === 0 ? (
          <EmptyCell>{t.revenue_agency_service_empty_title}</EmptyCell>
        ) : (
          <DataTableSurface
            loading={loading}
            rows={filteredAgencyServices}
            columns={agencyServiceColumns}
            dictionary={t as unknown as Record<string, string>}
            rowId={(item) => item.id}
            emptyState={<EmptyCell>{t.revenue_agency_service_empty_title}</EmptyCell>}
            tableClassName="max-h-[560px]"
            toolbarStart={
              <>
                <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setCatalogSearch("");
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    className={cn(inputClass, "h-8 rounded-lg bg-background pl-8 text-[13px]")}
                    placeholder={t.common_search}
                    aria-label={t.common_search}
                  />
                </div>
                {catalogSearch ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCatalogSearch("")}
                  >
                    <X className="size-3.5" />
                    {t.common_reset}
                  </Button>
                ) : null}
              </>
            }
            rowActions={
              canManageTaxProfiles
                ? (item) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => openEditAgencyService(item)}
                      aria-label={t.finance_catalog_edit}
                      title={t.finance_catalog_edit}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </Section>

      <Section
        title={t.finance_catalog_service_package_catalog}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{servicePackages.length}</CountBadge>
            {canManageTaxProfiles ? (
              <Button
                type="button"
                className={createButtonClassName}
                onClick={openCreatePackage}
              >
                <Plus className="size-4" />
                {t.finance_catalog_new_package}
              </Button>
            ) : null}
          </div>
        }
      >
        {!loading && servicePackages.length === 0 ? (
          <EmptyCell>{t.finance_catalog_empty_packages}</EmptyCell>
        ) : (
          <DataTableSurface
            loading={loading}
            rows={packageTableRows}
            columns={packageTableColumns}
            dictionary={t as unknown as Record<string, string>}
            rowId={(row) => row.rowId}
            expandRow={expandPackageRow}
            emptyState={<EmptyCell>{t.finance_catalog_empty_packages}</EmptyCell>}
            rowActions={
              canManageTaxProfiles
                ? (row) =>
                    row.kind === "package" && row.pkg ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => row.pkg && openEditPackage(row.pkg)}
                        aria-label={t.finance_catalog_edit}
                        title={t.finance_catalog_edit}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    ) : null
                : undefined
            }
          />
        )}
      </Section>

      <Section
        title={t.finance_catalog_agency_service_vat_mapping}
        accessory={<CountBadge>{catalogRows.length}</CountBadge>}
      >
        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            {t.finance_catalog_loading_mapping}
          </div>
        ) : catalogRows.length === 0 ? (
          <EmptyCell>{t.finance_catalog_empty_mapping}</EmptyCell>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
            <div className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)] gap-3 border-b border-border/50 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>{t.finance_catalog_service}</span>
              <span>{t.finance_catalog_vat_label}</span>
              <span>{t.finance_catalog_source}</span>
              <span>{t.finance_catalog_tax_profile_prefix}</span>
            </div>
            {catalogRows.map((row) => (
              <div
                key={row.catalog_id}
                className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)] gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {agencyServiceNameLabel(row.service_key, row.service_name, t)}
                  </p>
                </div>
                <span className="font-mono tabular-nums text-foreground">{row.vat_rate}%</span>
                <span className="text-muted-foreground">{vatSourceLabel(row.vat_source)}</span>
                <span className="truncate text-muted-foreground">
                  {taxProfileLabel(row.tax_profile_name, row.tax_profile_key)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Sheet
        open={createOpen && canManageTaxProfiles}
        onOpenChange={(open) => {
          if (open) {
            setCreateOpen(true);
          } else {
            closeCreateTaxProfile();
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form className="flex h-full min-h-0 flex-col" onSubmit={handleCreateTaxProfile}>
            <AdminSheetScaffold
              title={t.finance_catalog_new_tax_profile}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.finance_catalog_create}
                  submitting={createBusy}
                  onCancel={closeCreateTaxProfile}
                />
              }
            >
              <div className="space-y-3 rounded-xl p-4">
                {createError ? (
                  <Banner tone="error" withIcon>
                    {createError}
                  </Banner>
                ) : null}

                <Section title={t.finance_catalog_tax_profile_identity}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_profile_key} htmlFor="tax-profile-key">
                      <Input
                        id="tax-profile-key"
                        value={form.profileKey}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            profileKey: event.target.value,
                          }))
                        }
                        className={inputClass}
                        placeholder={t.uiText.finance_catalog_standard_code_placeholder}
                        disabled={createBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_name} htmlFor="tax-profile-name">
                      <Input
                        id="tax-profile-name"
                        value={form.name}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        className={inputClass}
                        disabled={createBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_vat_rate} htmlFor="tax-profile-vat">
                      <Input
                        id="tax-profile-vat"
                        value={form.vatRate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            vatRate: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={createBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_vat_category} htmlFor="tax-profile-category">
                      <NativeComboboxSelect
                        id="tax-profile-category"
                        value={form.vatCategory}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            vatCategory: event.target.value,
                          }))
                        }
                        className={selectClass}
                        disabled={createBusy}
                      >
                        {VAT_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {vatCategoryLabel(category)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                </Section>

                <Section title={t.finance_catalog_tax_profile_rules}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_valid_from} htmlFor="tax-profile-valid-from">
                      <Input
                        id="tax-profile-valid-from"
                        type="date"
                        value={form.validFrom}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, validFrom: event.target.value }))
                        }
                        className={inputClass}
                        disabled={createBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_valid_to} htmlFor="tax-profile-valid-to">
                      <Input
                        id="tax-profile-valid-to"
                        type="date"
                        value={form.validTo}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, validTo: event.target.value }))
                        }
                        className={inputClass}
                        disabled={createBusy}
                      />
                    </Field>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={form.isDefault}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            isDefault: event.target.checked,
                          }))
                        }
                        disabled={createBusy}
                      />
                      {t.finance_catalog_default_profile}
                    </label>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                        disabled={createBusy}
                      />
                      {t.finance_catalog_active}
                    </label>
                  </div>
                </Section>

                <Section title={t.finance_catalog_tax_profile_notes}>
                  <Field label={t.finance_catalog_description_label} htmlFor="tax-profile-description">
                    <textarea
                      id="tax-profile-description"
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={textareaClass}
                      rows={3}
                      disabled={createBusy}
                    />
                  </Field>
                </Section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(editingTaxProfileId) && canManageTaxProfiles}
        onOpenChange={(open) => {
          if (!open) closeEditTaxProfile();
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form className="flex h-full min-h-0 flex-col" onSubmit={handleSaveTaxProfile}>
            <AdminSheetScaffold
              title={t.finance_catalog_save_vat_profile}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.finance_catalog_save_vat_profile}
                  submitting={taxEditBusy}
                  onCancel={closeEditTaxProfile}
                />
              }
            >
              <div className="space-y-3 rounded-xl p-4">
                {taxEditError ? (
                  <Banner tone="error" withIcon>
                    {taxEditError}
                  </Banner>
                ) : null}

                <Section title={t.finance_catalog_tax_profile_identity}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_profile_key} htmlFor="tax-edit-profile-key">
                      <Input
                        id="tax-edit-profile-key"
                        value={taxEditForm.profileKey}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            profileKey: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={taxEditBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_name} htmlFor="tax-edit-profile-name">
                      <Input
                        id="tax-edit-profile-name"
                        value={taxEditForm.name}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({ ...current, name: event.target.value }))
                        }
                        className={inputClass}
                        disabled={taxEditBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_vat_rate} htmlFor="tax-edit-profile-vat">
                      <Input
                        id="tax-edit-profile-vat"
                        value={taxEditForm.vatRate}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            vatRate: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={taxEditBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_vat_category} htmlFor="tax-edit-profile-category">
                      <NativeComboboxSelect
                        id="tax-edit-profile-category"
                        value={taxEditForm.vatCategory}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            vatCategory: event.target.value,
                          }))
                        }
                        className={selectClass}
                        disabled={taxEditBusy}
                      >
                        {VAT_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {vatCategoryLabel(category)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                </Section>

                <Section title={t.finance_catalog_tax_profile_rules}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_valid_from} htmlFor="tax-edit-valid-from">
                      <Input
                        id="tax-edit-valid-from"
                        type="date"
                        value={taxEditForm.validFrom}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            validFrom: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={taxEditBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_valid_to} htmlFor="tax-edit-valid-to">
                      <Input
                        id="tax-edit-valid-to"
                        type="date"
                        value={taxEditForm.validTo}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            validTo: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={taxEditBusy}
                      />
                    </Field>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={taxEditForm.isDefault}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            isDefault: event.target.checked,
                          }))
                        }
                        disabled={taxEditBusy}
                      />
                      {t.finance_catalog_default_profile}
                    </label>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={taxEditForm.isActive}
                        onChange={(event) =>
                          setTaxEditForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                        disabled={taxEditBusy}
                      />
                      {t.finance_catalog_active}
                    </label>
                  </div>
                </Section>

                <Section title={t.finance_catalog_tax_profile_notes}>
                  <Field
                    label={t.finance_catalog_description_label}
                    htmlFor="tax-edit-profile-description"
                  >
                    <textarea
                      id="tax-edit-profile-description"
                      value={taxEditForm.description}
                      onChange={(event) =>
                        setTaxEditForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={textareaClass}
                      rows={3}
                      disabled={taxEditBusy}
                    />
                  </Field>
                </Section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={agencyServiceFormOpen && canManageTaxProfiles}
        onOpenChange={(open) => {
          if (!open) closeAgencyServiceForm();
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form className="flex h-full min-h-0 flex-col" onSubmit={handleSaveAgencyService}>
            <AdminSheetScaffold
              title={
                agencyServiceForm.id
                  ? t.revenue_agency_service_edit_title
                  : t.revenue_agency_service_new_title
              }
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={
                    agencyServiceForm.id
                      ? t.revenue_agency_service_save
                      : t.revenue_agency_service_create
                  }
                  submitting={agencyServiceBusy}
                  onCancel={closeAgencyServiceForm}
                />
              }
            >
              <div className="space-y-3 rounded-xl p-4">
                {agencyServiceError ? (
                  <Banner tone="error" withIcon>
                    {agencyServiceError}
                  </Banner>
                ) : null}

                <Section title={t.revenue_common_basic_data}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.revenue_agency_service_service_key}>
                      <Input
                        required
                        value={agencyServiceForm.serviceKey}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            serviceKey: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                        placeholder={t.uiText.finance_catalog_service_key_placeholder}
                      />
                    </Field>
                    <Field label={t.revenue_agency_service_service_name}>
                      <Input
                        required
                        value={agencyServiceForm.serviceName}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            serviceName: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                    <Field label={t.revenue_agency_service_unit_label}>
                      <Input
                        value={agencyServiceForm.unitLabel}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            unitLabel: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                    <Field label={t.revenue_agency_service_currency}>
                      <Input
                        value={agencyServiceForm.currency}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            currency: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title={t.finance_catalog_package_pricing}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.revenue_agency_service_unit_price}>
                      <Input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={agencyServiceForm.unitPrice}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            unitPrice: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                    <Field label={t.revenue_agency_service_vat_percent}>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={agencyServiceForm.vatRate}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            vatRate: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title={t.revenue_common_validity_period}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_valid_from}>
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
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_valid_to}>
                      <Input
                        type="date"
                        value={agencyServiceForm.validTo}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            validTo: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={agencyServiceBusy}
                      />
                    </Field>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={agencyServiceForm.isActive}
                        onChange={(event) =>
                          setAgencyServiceForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                        disabled={agencyServiceBusy}
                      />
                      {t.revenue_agency_service_active_hint}
                    </label>
                  </div>
                </Section>

                <Section title={t.revenue_agency_service_description_status}>
                  <Field label={t.revenue_agency_service_description_label}>
                    <textarea
                      value={agencyServiceForm.description}
                      onChange={(event) =>
                        setAgencyServiceForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={textareaClass}
                      rows={3}
                      disabled={agencyServiceBusy}
                    />
                  </Field>
                </Section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={packageFormOpen && canManageTaxProfiles}
        onOpenChange={(open) => {
          if (!open) closePackageForm();
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[840px]">
          <form className="flex h-full min-h-0 flex-col" onSubmit={handleSaveServicePackage}>
            <AdminSheetScaffold
              title={
                packageForm.id
                  ? t.finance_catalog_save_package
                  : t.finance_catalog_create_package
              }
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={
                    packageForm.id
                      ? t.finance_catalog_save_package
                      : t.finance_catalog_create_package
                  }
                  submitting={packageBusy}
                  onCancel={closePackageForm}
                />
              }
            >
              <div className="space-y-3 rounded-xl p-4">
                {packageError ? (
                  <Banner tone="error" withIcon>
                    {packageError}
                  </Banner>
                ) : null}

                <Section title={t.finance_catalog_package_basics}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_package_key} htmlFor="package-key">
                      <Input
                        id="package-key"
                        value={packageForm.packageKey}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            packageKey: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                        placeholder={t.uiText.finance_catalog_package_key_placeholder}
                      />
                    </Field>
                    <Field label={t.finance_catalog_name} htmlFor="package-name">
                      <Input
                        id="package-name"
                        value={packageForm.name}
                        onChange={(event) =>
                          setPackageForm((current) => ({ ...current, name: event.target.value }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title={t.finance_catalog_package_pricing}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_base_net_price} htmlFor="package-base-price">
                      <Input
                        id="package-base-price"
                        value={packageForm.basePriceNet}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            basePriceNet: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                    <Field
                      label={t.finance_catalog_package_vat_profile}
                      htmlFor="package-tax-profile"
                    >
                      <NativeComboboxSelect
                        id="package-tax-profile"
                        value={packageForm.taxProfileId || "__none__"}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            taxProfileId:
                              event.target.value === "__none__" ? "" : event.target.value,
                          }))
                        }
                        className={selectClass}
                        disabled={packageBusy}
                      >
                        <option value="__none__">{t.finance_catalog_no_vat_profile}</option>
                        {taxProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} ({profile.vat_rate}%)
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                    <Field label={t.finance_catalog_currency} htmlFor="package-currency">
                      <Input
                        id="package-currency"
                        value={packageForm.currency}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            currency: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title={t.finance_catalog_package_validity}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.finance_catalog_valid_from} htmlFor="package-valid-from">
                      <Input
                        id="package-valid-from"
                        type="date"
                        value={packageForm.validFrom}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            validFrom: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                    <Field label={t.finance_catalog_valid_to} htmlFor="package-valid-to">
                      <Input
                        id="package-valid-to"
                        type="date"
                        value={packageForm.validTo}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            validTo: event.target.value,
                          }))
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                    <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={packageForm.isActive}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                        disabled={packageBusy}
                      />
                      {t.finance_catalog_active}
                    </label>
                  </div>
                </Section>

                <Section title={t.finance_catalog_package_notes}>
                  <Field label={t.finance_catalog_description_label} htmlFor="package-description">
                    <textarea
                      id="package-description"
                      value={packageForm.description}
                      onChange={(event) =>
                        setPackageForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={textareaClass}
                      rows={3}
                      disabled={packageBusy}
                    />
                  </Field>
                </Section>

                <Section title={t.finance_catalog_included_items}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {t.finance_catalog_included_items_hint}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <NativeComboboxSelect
                          value="__select_existing__"
                          onChange={(event) => {
                            if (event.target.value !== "__select_existing__") {
                              addAgencyServiceToPackage(event.target.value);
                            }
                          }}
                          className={cn(selectClass, "h-8 min-w-64")}
                          disabled={packageBusy || agencyServices.length === 0}
                        >
                          <option value="__select_existing__">
                            {t.finance_catalog_add_existing_item}
                          </option>
                          {agencyServices.map((service) => (
                            <option key={service.id} value={service.id}>
                              {agencyServiceNameLabel(
                                service.service_key,
                                service.service_name,
                                t,
                              )}{" "}
                              / {valueToInput(service.vat_rate) || "0"}%
                            </option>
                          ))}
                        </NativeComboboxSelect>
                        <Button
                          type="button"
                          className={createButtonClassName}
                          onClick={() =>
                            setPackageForm((current) => ({
                              ...current,
                              items: [...current.items, blankPackageItem()],
                            }))
                          }
                          disabled={packageBusy}
                        >
                          <Plus className="size-4" />
                          {t.finance_catalog_add_item}
                        </Button>
                      </div>
                    </div>
                    {packageForm.items.map((item, index) => (
                      <div
                        key={item.formKey}
                        className="rounded-xl border border-border/50 bg-muted/20 p-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={t.revenue_agency_service_catalog_items}>
                            <NativeComboboxSelect
                              value={item.agencyServiceId || "__manual__"}
                              onChange={(event) =>
                                applyAgencyServiceToPackageItem(
                                  index,
                                  event.target.value === "__manual__"
                                    ? ""
                                    : event.target.value,
                                )
                              }
                              className={selectClass}
                              disabled={packageBusy}
                            >
                              <option value="__manual__">{t.common_not_set}</option>
                              {agencyServices.map((service) => (
                                <option key={service.id} value={service.id}>
                                  {agencyServiceNameLabel(
                                    service.service_key,
                                    service.service_name,
                                    t,
                                  )}{" "}
                                  / {valueToInput(service.vat_rate) || "0"}%
                                </option>
                              ))}
                            </NativeComboboxSelect>
                          </Field>
                          <Field label={t.finance_catalog_description_label}>
                            <Input
                              value={item.description}
                              onChange={(event) =>
                                updatePackageItem(index, { description: event.target.value })
                              }
                              className={inputClass}
                              disabled={packageBusy}
                            />
                          </Field>
                          <Field label={t.finance_catalog_service_key}>
                            <Input
                              value={item.serviceKey}
                              onChange={(event) =>
                                updatePackageItem(index, { serviceKey: event.target.value })
                              }
                              className={inputClass}
                              disabled={packageBusy}
                              placeholder={t.uiText.finance_catalog_service_key_placeholder}
                            />
                          </Field>
                          <Field label={t.finance_catalog_included_quantity}>
                            <Input
                              value={item.includedQuantity}
                              onChange={(event) =>
                                updatePackageItem(index, {
                                  includedQuantity: event.target.value,
                                })
                              }
                              className={inputClass}
                              disabled={packageBusy}
                            />
                          </Field>
                          <Field label={t.finance_catalog_unit_label}>
                            <Input
                              value={item.unitLabel}
                              onChange={(event) =>
                                updatePackageItem(index, { unitLabel: event.target.value })
                              }
                              className={inputClass}
                              disabled={packageBusy}
                            />
                          </Field>
                          <Field label={t.finance_catalog_overage_net_price}>
                            <Input
                              value={item.overageUnitPriceNet}
                              onChange={(event) =>
                                updatePackageItem(index, {
                                  overageUnitPriceNet: event.target.value,
                                })
                              }
                              className={inputClass}
                              disabled={packageBusy}
                            />
                          </Field>
                          <Field label={t.finance_catalog_item_vat_profile}>
                            <NativeComboboxSelect
                              value={item.taxProfileId || "__none__"}
                              onChange={(event) =>
                                updatePackageItem(index, {
                                  taxProfileId:
                                    event.target.value === "__none__" ? "" : event.target.value,
                                })
                              }
                              className={selectClass}
                              disabled={packageBusy}
                            >
                              <option value="__none__">
                                {t.finance_catalog_use_package_default_vat}
                              </option>
                              {taxProfiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name} ({profile.vat_rate}%)
                                </option>
                              ))}
                            </NativeComboboxSelect>
                          </Field>
                          <label className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={item.requiresPatientApproval}
                              onChange={(event) =>
                                updatePackageItem(index, {
                                  requiresPatientApproval: event.target.checked,
                                })
                              }
                              disabled={packageBusy}
                            />
                            {t.finance_catalog_approval_required}
                          </label>
                          <div className="flex items-end justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-lg text-rose-700"
                              onClick={() => removePackageItem(index)}
                              disabled={packageBusy}
                            >
                              <Trash2 className="size-4" />
                              {t.common_remove}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function FinanceCatalogPage(...args: Parameters<typeof useFinanceCatalogPageContent>) {
  return useFinanceCatalogPageContent(...args);
}
