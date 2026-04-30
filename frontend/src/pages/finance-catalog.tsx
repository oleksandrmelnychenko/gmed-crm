import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  PageHeader,
  Section,
  StatCard,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
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

const BLANK_PACKAGE_ITEM_FORM: ServicePackageItemForm = {
  description: "",
  serviceKey: "",
  includedQuantity: "1",
  unitLabel: "unit",
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
  items: [{ ...BLANK_PACKAGE_ITEM_FORM }],
};

const VAT_CATEGORIES = [
  "standard",
  "zero_rated",
  "exempt",
  "reverse_charge",
  "custom",
];

function numberValue(value: string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value: string | number | null | undefined, currency = "EUR") {
  const numeric = typeof value === "number" ? value : numberValue(value);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric);
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

function packageItemToForm(item: ServicePackageItem): ServicePackageItemForm {
  return {
    description: item.description,
    serviceKey: item.service_key ?? "",
    includedQuantity: item.included_quantity,
    unitLabel: item.unit_label || "unit",
    overageUnitPriceNet: item.overage_unit_price_net ?? "",
    taxProfileId: item.tax_profile_id ?? "",
    requiresPatientApproval: item.requires_patient_approval,
  };
}

function packageToForm(item: ServicePackage): ServicePackageForm {
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
        ? item.items.map(packageItemToForm)
        : [{ ...BLANK_PACKAGE_ITEM_FORM }],
  };
}

function decimalPayload(value: string, fallback = 0) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalInputIsValid(value: string) {
  return Number.isFinite(Number(value.replace(",", ".")));
}

export function FinanceCatalogPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const canManageTaxProfiles = user?.role === "ceo" || user?.role === "billing";

  const [taxProfiles, setTaxProfiles] = useState<TaxProfile[]>([]);
  const [catalogRows, setCatalogRows] = useState<CatalogTaxProfile[]>([]);
  const [servicePackages, setServicePackages] = useState<ServicePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState<TaxProfileForm>(BLANK_TAX_PROFILE_FORM);
  const [editingTaxProfileId, setEditingTaxProfileId] = useState("");
  const [taxEditBusy, setTaxEditBusy] = useState(false);
  const [taxEditError, setTaxEditError] = useState("");
  const [taxEditForm, setTaxEditForm] = useState<TaxProfileForm>(BLANK_TAX_PROFILE_FORM);
  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageError, setPackageError] = useState("");
  const [packageForm, setPackageForm] = useState<ServicePackageForm>(BLANK_PACKAGE_FORM);

  const activeTaxProfiles = useMemo(
    () => taxProfiles.filter((item) => item.is_active).length,
    [taxProfiles],
  );
  const activePackages = useMemo(
    () => servicePackages.filter((item) => item.is_active).length,
    [servicePackages],
  );
  const defaultTaxProfile = taxProfiles.find((item) => item.is_default);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [taxResult, catalogResult, packageResult] = await Promise.all([
        apiFetch<TaxProfile[]>("/tax-profiles"),
        apiFetch<CatalogTaxProfile[]>("/tax-profiles/catalog"),
        apiFetch<ServicePackage[]>("/service-packages"),
      ]);
      setTaxProfiles(taxResult);
      setCatalogRows(catalogResult);
      setServicePackages(packageResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load finance catalog");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreateTaxProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    const vatRate = Number(form.vatRate.replace(",", "."));
    if (!form.profileKey.trim() || !form.name.trim()) {
      setCreateError("Profile key and name are required.");
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setCreateError("VAT rate must be a non-negative number.");
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
      setCreateError(err instanceof Error ? err.message : "Failed to create tax profile");
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
      setTaxEditError("Profile key and name are required.");
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setTaxEditError("VAT rate must be a non-negative number.");
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
      setTaxEditError(err instanceof Error ? err.message : "Failed to update tax profile");
    } finally {
      setTaxEditBusy(false);
    }
  }

  function openCreatePackage() {
    setPackageForm(BLANK_PACKAGE_FORM);
    setPackageError("");
    setPackageFormOpen(true);
  }

  function openEditPackage(item: ServicePackage) {
    setPackageForm(packageToForm(item));
    setPackageError("");
    setPackageFormOpen(true);
  }

  function updatePackageItem(index: number, patch: Partial<ServicePackageItemForm>) {
    setPackageForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removePackageItem(index: number) {
    setPackageForm((current) => ({
      ...current,
      items:
        current.items.length <= 1
          ? [{ ...BLANK_PACKAGE_ITEM_FORM }]
          : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSaveServicePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPackageError("");

    if (!packageForm.packageKey.trim() || !packageForm.name.trim()) {
      setPackageError("Package key and name are required.");
      return;
    }
    if (packageForm.items.some((item) => !item.description.trim())) {
      setPackageError("Every package item needs a description.");
      return;
    }
    if (!decimalInputIsValid(packageForm.basePriceNet)) {
      setPackageError("Base price must be numeric.");
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
      setPackageError("Package item quantities and overage prices must be numeric.");
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
          description: item.description.trim(),
          service_key: item.serviceKey.trim() || null,
          included_quantity: decimalPayload(item.includedQuantity, 1),
          unit_label: item.unitLabel.trim() || "unit",
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
      setPackageForm(BLANK_PACKAGE_FORM);
      setPackageFormOpen(false);
      await load();
    } catch (err) {
      setPackageError(err instanceof Error ? err.message : "Failed to save service package");
    } finally {
      setPackageBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={l("Finance catalog", "Finance catalog", "Finance catalog")}
        description={l(
          "VAT profiles, service package catalog and agency-service VAT mapping. Uses the existing staff UI shell.",
          "VAT profiles, service package catalog and agency-service VAT mapping. Uses the existing staff UI shell.",
          "VAT profiles, service package catalog and agency-service VAT mapping. Uses the existing staff UI shell.",
        )}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {l("Refresh", "Refresh", "Refresh")}
          </Button>
        }
      />

      {error ? (
        <Banner tone="error" withIcon>
          {error}
        </Banner>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={l("Active tax profiles", "Active tax profiles", "Active tax profiles")}
          value={activeTaxProfiles}
          description={`${taxProfiles.length} total`}
        />
        <StatCard
          label={l("Default VAT", "Default VAT", "Default VAT")}
          value={defaultTaxProfile ? `${defaultTaxProfile.vat_rate}%` : "Not set"}
          description={defaultTaxProfile?.name ?? "No default profile"}
        />
        <StatCard
          label={l("Active packages", "Active packages", "Active packages")}
          value={activePackages}
          description={`${servicePackages.length} total`}
        />
        <StatCard
          label={l("Catalog services", "Catalog services", "Catalog services")}
          value={catalogRows.length}
          description={l("VAT mapping rows", "VAT mapping rows", "VAT mapping rows")}
        />
      </div>

      <Section
        title={l("Tax profiles", "Tax profiles", "Tax profiles")}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{taxProfiles.length}</CountBadge>
            {canManageTaxProfiles ? (
              <Button
                type="button"
                size="sm"
                variant={createOpen ? "default" : "outline"}
                className="h-8 rounded-lg"
                onClick={() => setCreateOpen((current) => !current)}
              >
                <Plus className="size-4" />
                {l("New tax profile", "New tax profile", "New tax profile")}
              </Button>
            ) : null}
          </div>
        }
      >
        {createOpen && canManageTaxProfiles ? (
          <form
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
            onSubmit={handleCreateTaxProfile}
          >
            {createError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {createError}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Profile key" htmlFor="tax-profile-key">
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
                  placeholder="standard_19"
                  disabled={createBusy}
                />
              </Field>
              <Field label="Name" htmlFor="tax-profile-name">
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
              <Field label="VAT rate" htmlFor="tax-profile-vat">
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
              <Field label="VAT category" htmlFor="tax-profile-category">
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
                      {category}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <Field label="Description" htmlFor="tax-profile-description" className="mt-3">
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
                rows={2}
                disabled={createBusy}
              />
            </Field>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Valid from" htmlFor="tax-profile-valid-from">
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
              <Field label="Valid to" htmlFor="tax-profile-valid-to">
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
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                Default profile
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                Active
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setCreateOpen(false)}
                disabled={createBusy}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-9 rounded-lg" disabled={createBusy}>
                {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Create
              </Button>
            </div>
          </form>
        ) : null}

        {editingTaxProfileId && canManageTaxProfiles ? (
          <form
            className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3"
            onSubmit={handleSaveTaxProfile}
          >
            {taxEditError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {taxEditError}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Profile key" htmlFor="tax-edit-profile-key">
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
              <Field label="Name" htmlFor="tax-edit-profile-name">
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
              <Field label="VAT rate" htmlFor="tax-edit-profile-vat">
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
              <Field label="VAT category" htmlFor="tax-edit-profile-category">
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
                      {category}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label="Valid from" htmlFor="tax-edit-valid-from">
                <Input
                  id="tax-edit-valid-from"
                  type="date"
                  value={taxEditForm.validFrom}
                  onChange={(event) =>
                    setTaxEditForm((current) => ({ ...current, validFrom: event.target.value }))
                  }
                  className={inputClass}
                  disabled={taxEditBusy}
                />
              </Field>
              <Field label="Valid to" htmlFor="tax-edit-valid-to">
                <Input
                  id="tax-edit-valid-to"
                  type="date"
                  value={taxEditForm.validTo}
                  onChange={(event) =>
                    setTaxEditForm((current) => ({ ...current, validTo: event.target.value }))
                  }
                  className={inputClass}
                  disabled={taxEditBusy}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                Default profile
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                Active
              </label>
            </div>
            <Field label="Description" htmlFor="tax-edit-profile-description" className="mt-3">
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
                rows={2}
                disabled={taxEditBusy}
              />
            </Field>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setEditingTaxProfileId("")}
                disabled={taxEditBusy}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-9 rounded-lg" disabled={taxEditBusy}>
                {taxEditBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Save VAT profile
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading tax profiles...
          </div>
        ) : taxProfiles.length === 0 ? (
          <EmptyCell>No tax profiles configured yet.</EmptyCell>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {taxProfiles.map((profile) => (
              <article
                key={profile.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {profile.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {profile.profile_key}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.is_default ? (
                      <Badge variant="outline" className="rounded-full">
                        default
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
                      {profile.is_active ? "active" : "inactive"}
                    </Badge>
                    {canManageTaxProfiles ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-lg px-2"
                        onClick={() => {
                          setEditingTaxProfileId(profile.id);
                          setTaxEditForm(taxProfileToForm(profile));
                          setTaxEditError("");
                        }}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-3 text-2xl font-semibold text-foreground">
                  {profile.vat_rate}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {profile.vat_category}
                  {profile.description ? ` / ${profile.description}` : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={l("Service package catalog", "Service package catalog", "Service package catalog")}
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
                New package
              </Button>
            ) : null}
          </div>
        }
      >
        {packageFormOpen && canManageTaxProfiles ? (
          <form
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
            onSubmit={handleSaveServicePackage}
          >
            {packageError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {packageError}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Package key" htmlFor="package-key">
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
                  placeholder="premium_care"
                />
              </Field>
              <Field label="Name" htmlFor="package-name">
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
              <Field label="Base net price" htmlFor="package-base-price">
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
              <Field label="Package VAT profile" htmlFor="package-tax-profile">
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
                  <option value="__none__">No VAT profile</option>
                  {taxProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.vat_rate}%)
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label="Currency" htmlFor="package-currency">
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
              <Field label="Valid from" htmlFor="package-valid-from">
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
              <Field label="Valid to" htmlFor="package-valid-to">
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
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                Active
              </label>
            </div>
            <Field label="Description" htmlFor="package-description" className="mt-3">
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
                rows={2}
                disabled={packageBusy}
              />
            </Field>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Included items</p>
                  <p className="text-xs text-muted-foreground">
                    Quantities drive consumption and overage approval.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() =>
                    setPackageForm((current) => ({
                      ...current,
                      items: [...current.items, { ...BLANK_PACKAGE_ITEM_FORM }],
                    }))
                  }
                  disabled={packageBusy}
                >
                  <Plus className="size-4" />
                  Add item
                </Button>
              </div>
              {packageForm.items.map((item, index) => (
                <div
                  key={`package-item-${index}`}
                  className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3"
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Description">
                      <Input
                        value={item.description}
                        onChange={(event) =>
                          updatePackageItem(index, { description: event.target.value })
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                    <Field label="Service key">
                      <Input
                        value={item.serviceKey}
                        onChange={(event) =>
                          updatePackageItem(index, { serviceKey: event.target.value })
                        }
                        className={inputClass}
                        disabled={packageBusy}
                        placeholder="interpreter_hours"
                      />
                    </Field>
                    <Field label="Included quantity">
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
                    <Field label="Unit label">
                      <Input
                        value={item.unitLabel}
                        onChange={(event) =>
                          updatePackageItem(index, { unitLabel: event.target.value })
                        }
                        className={inputClass}
                        disabled={packageBusy}
                      />
                    </Field>
                    <Field label="Overage net price">
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
                    <Field label="Item VAT profile">
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
                        <option value="__none__">Use package/default VAT</option>
                        {taxProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} ({profile.vat_rate}%)
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                      Approval required
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
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setPackageFormOpen(false)}
                disabled={packageBusy}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-9 rounded-lg" disabled={packageBusy}>
                {packageBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {packageForm.id ? "Save package" : "Create package"}
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading packages...
          </div>
        ) : servicePackages.length === 0 ? (
          <EmptyCell>No service packages configured yet.</EmptyCell>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {servicePackages.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {item.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {item.package_key}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full",
                      item.is_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-600",
                    )}
                  >
                    {item.is_active ? "active" : "inactive"}
                  </Badge>
                  {canManageTaxProfiles ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2"
                      onClick={() => openEditPackage(item)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  ) : null}
                </div>
                <p className="mt-3 text-xl font-semibold text-foreground">
                  {formatMoney(item.base_price_gross, item.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  net {formatMoney(item.base_price_net, item.currency)} / VAT{" "}
                  {formatMoney(item.base_price_vat, item.currency)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  tax profile: {item.tax_profile_name ?? item.tax_profile_key ?? "not set"}
                </p>
                {item.items?.length ? (
                  <div className="mt-3 space-y-1.5">
                    {item.items.slice(0, 4).map((packageItem) => (
                      <div
                        key={packageItem.id}
                        className="rounded-lg border border-border/50 bg-muted/25 px-2 py-1.5 text-xs text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">
                          {packageItem.description}
                        </span>{" "}
                        / {packageItem.included_quantity} {packageItem.unit_label}
                        {packageItem.requires_patient_approval ? " / approval" : ""}
                      </div>
                    ))}
                    {item.items.length > 4 ? (
                      <p className="text-xs text-muted-foreground">
                        +{item.items.length - 4} more items
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No included items configured.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={l("Agency service VAT mapping", "Agency service VAT mapping", "Agency service VAT mapping")}
        accessory={<CountBadge>{catalogRows.length}</CountBadge>}
      >
        {loading ? (
          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading catalog mapping...
          </div>
        ) : catalogRows.length === 0 ? (
          <EmptyCell>No catalog VAT mappings found.</EmptyCell>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
            <div className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)] gap-3 border-b border-border/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span>Service</span>
              <span>VAT</span>
              <span>Source</span>
              <span>Tax profile</span>
            </div>
            {catalogRows.map((row) => (
              <div
                key={row.catalog_id}
                className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)] gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {row.service_name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.service_key}
                  </p>
                </div>
                <span className="text-foreground">{row.vat_rate}%</span>
                <span className="text-muted-foreground">{row.vat_source}</span>
                <span className="truncate text-muted-foreground">
                  {row.tax_profile_name ?? row.tax_profile_key ?? "not set"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
