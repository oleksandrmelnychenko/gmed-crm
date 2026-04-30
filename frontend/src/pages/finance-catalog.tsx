import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";

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
  tax_profile_key?: string | null;
  is_active: boolean;
  valid_from: string;
  valid_to?: string | null;
};

type TaxProfileForm = {
  profileKey: string;
  name: string;
  description: string;
  vatRate: string;
  vatCategory: string;
  isDefault: boolean;
};

const BLANK_TAX_PROFILE_FORM: TaxProfileForm = {
  profileKey: "",
  name: "",
  description: "",
  vatRate: "19",
  vatCategory: "standard",
  isDefault: false,
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
          is_active: true,
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
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
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
        accessory={<CountBadge>{servicePackages.length}</CountBadge>}
      >
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
                </div>
                <p className="mt-3 text-xl font-semibold text-foreground">
                  {formatMoney(item.base_price_gross, item.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  net {formatMoney(item.base_price_net, item.currency)} / VAT{" "}
                  {formatMoney(item.base_price_vat, item.currency)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  tax profile: {item.tax_profile_key ?? "not set"}
                </p>
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
