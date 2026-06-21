import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  BadgePercent,
  Boxes,
  ChevronDown,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AdminInlineMetric,
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
  const totalCountLabel = (count: number) =>
    t.finance_catalog_total_count.replace("{count}", String(count));
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

  const activeTaxProfiles = useMemo(
    () => taxProfiles.filter((item) => item.is_active).length,
    [taxProfiles],
  );
  const activeAgencyServices = useMemo(
    () => agencyServices.filter((item) => item.is_active).length,
    [agencyServices],
  );
  const activePackages = useMemo(
    () => servicePackages.filter((item) => item.is_active).length,
    [servicePackages],
  );
  const defaultTaxProfile = taxProfiles.find((item) => item.is_default);
  const financeCatalogMetrics = [
    {
      label: t.finance_catalog_active_tax_profiles,
      value: activeTaxProfiles,
      description: totalCountLabel(taxProfiles.length),
    },
    {
      label: t.finance_catalog_default_vat,
      value: defaultTaxProfile ? `${defaultTaxProfile.vat_rate}%` : t.common_not_set,
      description: defaultTaxProfile?.name ?? t.finance_catalog_no_default_profile,
    },
    {
      label: t.finance_catalog_active_packages,
      value: activePackages,
      description: totalCountLabel(servicePackages.length),
    },
    {
      label: t.finance_catalog_catalog_services,
      value: activeAgencyServices,
      description: totalCountLabel(agencyServices.length),
    },
  ];

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

      <section className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={ClipboardList}
          label={financeCatalogMetrics[0].label}
          value={financeCatalogMetrics[0].value}
        />
        <AdminInlineMetric
          icon={BadgePercent}
          label={financeCatalogMetrics[1].label}
          value={financeCatalogMetrics[1].value}
        />
        <AdminInlineMetric
          icon={Wallet}
          label={financeCatalogMetrics[2].label}
          value={financeCatalogMetrics[2].value}
        />
        <AdminInlineMetric
          icon={Boxes}
          label={financeCatalogMetrics[3].label}
          value={financeCatalogMetrics[3].value}
        />
      </section>

      <Section
        title={t.finance_catalog_tax_profiles}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{taxProfiles.length}</CountBadge>
            {canManageTaxProfiles ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={openCreateTaxProfile}
              >
                <Plus className="size-4" />
                {t.finance_catalog_new_tax_profile}
              </Button>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            {t.finance_catalog_loading_tax_profiles}
          </div>
        ) : taxProfiles.length === 0 ? (
          <EmptyCell>{t.finance_catalog_empty_tax_profiles}</EmptyCell>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {taxProfiles.map((profile) => (
              <article
                key={profile.id}
                className="relative overflow-hidden rounded-xl border border-border/50 bg-card px-4 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="max-w-full break-words text-sm font-semibold text-foreground">
                      {profile.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {profile.profile_key}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.is_default ? (
                      <Badge variant="outline" className="rounded-full">
                        {t.finance_catalog_default_badge}
                      </Badge>
                    ) : null}
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full",
                        profile.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600",
                      )}
                    >
                      {profile.is_active ? t.common_active : t.common_inactive}
                    </Badge>
                    {canManageTaxProfiles ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 p-0 text-orange-700 transition-all duration-200 hover:bg-orange-200 hover:text-orange-800"
                        aria-label={t.finance_catalog_edit}
                        title={t.finance_catalog_edit}
                        onClick={() => openEditTaxProfile(profile)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2.5 text-2xl font-semibold text-foreground">
                  {profile.vat_rate}%
                </p>
                <p className="mt-1 pr-16 text-xs text-muted-foreground">
                  {vatCategoryLabel(profile.vat_category)}
                  {profile.description ? ` / ${profile.description}` : ""}
                </p>
              </article>
            ))}
          </div>
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
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={openCreateAgencyService}
              >
                <Plus className="size-4" />
                {t.revenue_agency_service_new_title}
              </Button>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            {t.finance_catalog_loading_mapping}
          </div>
        ) : agencyServices.length === 0 ? (
          <EmptyCell>{t.revenue_agency_service_empty_title}</EmptyCell>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
            <div className="grid grid-cols-[minmax(0,1.4fr)_140px_110px_90px_100px_44px] gap-3 border-b border-border/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span>{t.finance_catalog_service}</span>
              <span>{t.revenue_agency_service_unit_price}</span>
              <span>{t.revenue_agency_service_unit}</span>
              <span>{t.finance_catalog_vat_label}</span>
              <span>{t.users_status}</span>
              <span />
            </div>
            {agencyServices.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1.4fr)_140px_110px_90px_100px_44px] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {agencyServiceNameLabel(item.service_key, item.service_name, t)}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {item.service_key}
                  </p>
                  {item.description ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {agencyServiceDescriptionLabel(item.service_key, item.description, t)}
                    </p>
                  ) : null}
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {formatMoney(item.unit_price as string | number, item.currency)}
                </span>
                <span className="text-muted-foreground">
                  {agencyServiceUnitLabel(item.unit_label, t)}
                </span>
                <span className="tabular-nums text-foreground">
                  {valueToInput(item.vat_rate) || "0"}%
                </span>
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
                {canManageTaxProfiles ? (
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
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
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
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={openCreatePackage}
              >
                <Plus className="size-4" />
                {t.finance_catalog_new_package}
              </Button>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            {t.finance_catalog_loading_packages}
          </div>
        ) : servicePackages.length === 0 ? (
          <EmptyCell>{t.finance_catalog_empty_packages}</EmptyCell>
        ) : (
          <div className="space-y-0">
            {servicePackages.map((item) => (
              <details
                key={item.id}
                className={cn(
                  "group relative pl-9",
                  !item.is_active && "opacity-75",
                )}
              >
                <summary className="relative grid cursor-pointer list-none gap-2 rounded-lg p-3 pr-12 transition hover:bg-[#f9fdff] group-open:bg-[#f9fdff] group-open:ring-1 group-open:ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <div className="absolute -left-9 bottom-0 top-0 flex w-8 items-start justify-center pt-3">
                    <span
                      className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                        item.is_active
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
                      )}
                    >
                      <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                    </span>
                  </div>

                  {canManageTaxProfiles ? (
                    <div
                      role="presentation"
                      className="absolute right-3 top-3 z-20"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-full bg-white text-muted-foreground shadow-sm ring-1 ring-border/60 hover:bg-[#f9fdff] hover:text-foreground"
                        onClick={() => openEditPackage(item)}
                        aria-label={t.finance_catalog_edit}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 max-w-full break-words text-[15px] font-semibold leading-5 text-foreground">
                          {item.name}
                        </p>
                        <span className="size-1 rounded-full bg-muted-foreground/35" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.package_key}
                        </span>
                        <span className="size-1 rounded-full bg-muted-foreground/35" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {item.valid_from}
                          {item.valid_to ? ` - ${item.valid_to}` : ""}
                        </span>
                      </div>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t.finance_catalog_tax_profile_prefix}: {" "}
                          <span className="font-medium text-foreground">
                            {taxProfileLabel(item.tax_profile_name, item.tax_profile_key)}
                          </span>
                        </span>
                        {item.description ? (
                          <>
                            <span className="size-1 rounded-full bg-muted-foreground/35" />
                            <span className="min-w-0 max-w-full break-words">
                              {item.description}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:max-w-[520px] lg:justify-end lg:pr-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          item.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-600",
                        )}
                      >
                        {item.is_active ? t.common_active : t.common_inactive}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {t.finance_catalog_package_total}: {" "}
                        <span className="ml-1 font-semibold text-foreground">
                          {formatMoney(item.base_price_gross, item.currency)}
                        </span>
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                      >
                        {t.finance_catalog_net_label}: {" "}
                        <span className="ml-1 font-semibold text-foreground">
                          {formatMoney(item.base_price_net, item.currency)}
                        </span>
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                      >
                        {t.finance_catalog_vat_label}: {" "}
                        <span className="ml-1 font-semibold text-foreground">
                          {formatMoney(item.base_price_vat, item.currency)}
                        </span>
                      </Badge>
                    </div>
                  </div>
                </summary>

                <div
                  aria-hidden="true"
                  className="ml-20 flex h-3 items-center px-3"
                >
                  <span className="h-px w-12 bg-gradient-to-r from-transparent via-border/70 to-border/70" />
                  <span className="size-1.5 rounded-full bg-border" />
                  <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
                </div>
                <div className="mb-2 ml-20 overflow-hidden rounded-lg bg-[#fbfdff] p-2 shadow-sm">
                  {item.items?.length ? (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {item.items.map((packageItem) => (
                        <div
                          key={packageItem.id}
                          className="rounded-md bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-border/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 break-words font-medium text-foreground">
                              {packageItem.agency_service_name || packageItem.service_key
                                ? agencyServiceNameLabel(
                                    packageItem.service_key,
                                    packageItem.agency_service_name,
                                    t,
                                  )
                                : packageItem.description}
                            </p>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {packageItem.included_quantity}{" "}
                              {agencyServiceUnitLabel(packageItem.unit_label, t)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {packageItem.service_key ? (
                              <span className="font-mono">{packageItem.service_key}</span>
                            ) : null}
                            {packageItem.overage_unit_price_net ? (
                              <span>
                                {t.finance_catalog_overage_net_price}: {" "}
                                <span className="font-medium text-foreground">
                                  {formatMoney(
                                    packageItem.overage_unit_price_net,
                                    item.currency,
                                  )}
                                </span>
                              </span>
                            ) : null}
                            <span>
                              {t.finance_catalog_vat_label}: {" "}
                              <span className="font-medium text-foreground">
                                {packageItemVatRate(packageItem, item)}%
                              </span>
                            </span>
                            {packageItem.requires_patient_approval ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                {t.finance_catalog_approval_suffix}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground">
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/35" />
                      {t.finance_catalog_empty_included_items}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
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
            <div className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)] gap-3 border-b border-border/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.service_key}
                  </p>
                </div>
                <span className="text-foreground">{row.vat_rate}%</span>
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
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {t.finance_catalog_included_items_hint}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
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
