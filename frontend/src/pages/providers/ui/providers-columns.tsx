import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ColumnDef, FilterOption } from "@/components/data-table/types";
import { cn } from "@/lib/utils";

import {
  compactDateTime,
  providerTypeLabel,
} from "../model/list-model";
import { specializationSummaryForItems } from "../model/specialization-labels";
import { ProviderCategoryIcon } from "./provider-category-icon";
import { ProviderStatusPill } from "./provider-status-pill";
import type { ProviderOrganizationLevel, ProviderSummary, ProviderTaxonomyNode } from "../model/types";

export type ProviderTreeMeta = {
  childCount: number;
  depth: number;
  isExpanded: boolean;
  isMatched: boolean;
};

type BuildProviderColumnsOptions = {
  lang?: "de" | "ru";
  onToggleProviderCollapsed?: (providerId: string) => void;
  treeMetaById?: ReadonlyMap<string, ProviderTreeMeta>;
};

type ProviderDynamicOptions = {
  cities: FilterOption[];
  countries: FilterOption[];
  fachbereiche: FilterOption[];
};

function optionsFrom(values: Iterable<string>): FilterOption[] {
  return Array.from(values)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

function optionsFromMap(values: ReadonlyMap<string, string>): FilterOption[] {
  return Array.from(values.entries())
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([value, label]) => ({ value, label }));
}

function providerSpecializationLabel(
  provider: ProviderSummary,
  lang: "de" | "ru",
  notSet: string,
) {
  return specializationSummaryForItems(provider.specializations, provider.fachbereich, lang, notSet);
}

function deriveDynamicOptions(
  rows: readonly ProviderSummary[],
  lang: "de" | "ru",
): ProviderDynamicOptions {
  const cities = new Set<string>();
  const countries = new Set<string>();
  const fachbereiche = new Map<string, string>();

  for (const row of rows) {
    if (row.address_city) cities.add(row.address_city);
    if (row.address_country) countries.add(row.address_country);
    if (row.fachbereich) {
      fachbereiche.set(row.fachbereich, providerSpecializationLabel(row, lang, row.fachbereich));
    }
  }

  return {
    cities: optionsFrom(cities),
    countries: optionsFrom(countries),
    fachbereiche: optionsFromMap(fachbereiche),
  };
}

function commonNotSet(tr: Record<string, string>) {
  return tr.common_not_set ?? "-";
}

function formatRating(value: number | null, fallback: string) {
  return value == null ? fallback : value.toFixed(1);
}

function providerLevelLabel(level: ProviderOrganizationLevel, tr: Record<string, string>) {
  switch (level) {
    case "organization":
      return tr.providers_level_organization ?? level;
    case "clinic":
      return tr.providers_level_clinic ?? level;
    case "department":
      return tr.providers_level_department ?? level;
    case "unit":
      return tr.providers_level_unit ?? level;
    default:
      return level;
  }
}

function taxonomyNodeLabel(
  node: ProviderTaxonomyNode | null | undefined,
  lang: "de" | "ru",
  notSet: string,
) {
  if (!node) return notSet;
  if (lang === "ru") {
    return node.name_ru || node.name_de || node.name_en || node.code || notSet;
  }
  return node.name_de || node.name_en || node.name_ru || node.code || notSet;
}

function taxonomyProviderLabel(provider: ProviderSummary, lang: "de" | "ru", notSet: string) {
  if (provider.taxonomy_path?.length) {
    return taxonomyNodeLabel(provider.taxonomy_path.at(-1), lang, notSet);
  }
  return taxonomyNodeLabel(provider.taxonomy_node, lang, notSet);
}

function ProviderLevelBadge({
  level,
  tr,
}: {
  level: ProviderOrganizationLevel;
  tr: Record<string, string>;
}) {
  const label = providerLevelLabel(level, tr);

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        level === "organization" && "border-slate-200 bg-slate-50 text-slate-700",
        level === "clinic" && "border-sky-200 bg-sky-50 text-sky-700",
        level === "department" && "border-amber-200 bg-amber-50 text-amber-700",
        level === "unit" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {label}
    </Badge>
  );
}

function ProviderIdentityCell({
  provider,
  treeMeta,
  tr,
  onToggleProviderCollapsed,
}: {
  provider: ProviderSummary;
  treeMeta: ProviderTreeMeta | null;
  tr: Record<string, string>;
  onToggleProviderCollapsed?: (providerId: string) => void;
}) {
  const notSet = commonNotSet(tr);
  const childCount = treeMeta?.childCount ?? 0;
  const depth = treeMeta?.depth ?? 0;
  const hasChildren = childCount > 0;

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      style={{ paddingLeft: depth > 0 ? Math.min(depth, 8) * 18 : 0 }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={treeMeta?.isExpanded ?? false}
          aria-label={
            treeMeta?.isExpanded
              ? (tr.providers_tree_collapse ?? provider.name)
              : (tr.providers_tree_expand ?? provider.name)
          }
          className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={(event) => {
            event.stopPropagation();
            onToggleProviderCollapsed?.(provider.id);
          }}
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              treeMeta?.isExpanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
        {provider.name
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0]?.toUpperCase() ?? "")
          .join("")}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">{provider.name}</span>
          {childCount > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {childCount}
            </span>
          ) : null}
        </div>
        {provider.legal_name && provider.legal_name !== provider.name ? (
          <div className="truncate text-[10px] text-muted-foreground">{provider.legal_name}</div>
        ) : provider.tax_id ? (
          <div className="truncate text-[10px] text-muted-foreground">
            {(tr.providers_tax_id ?? notSet)} {provider.tax_id}
          </div>
        ) : provider.parent_provider_name && depth === 0 ? (
          <div className="truncate text-[10px] text-muted-foreground">
            {tr.providers_parent_provider ?? notSet}: {provider.parent_provider_name}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProviderTypeBadge({
  provider,
  tr,
}: {
  provider: ProviderSummary;
  tr: Record<string, string>;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        provider.provider_type === "medical"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-violet-200 bg-violet-50 text-violet-700",
      )}
    >
      <ProviderCategoryIcon
        providerType={provider.provider_type}
        categoryKey={provider.taxonomy_node?.code ?? null}
        className="mr-1 inline size-3 align-[-2px]"
      />
      {providerTypeLabel(provider.provider_type, tr)}
    </Badge>
  );
}

function ContractBadge({
  hasContract,
  tr,
}: {
  hasContract: boolean;
  tr: Record<string, string>;
}) {
  if (!hasContract) {
    return <span className="text-xs text-muted-foreground">{tr.providers_contract_without ?? commonNotSet(tr)}</span>;
  }

  return (
    <Badge
      variant="outline"
      className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
    >
      {tr.providers_contract ?? tr.providers_contract_with ?? commonNotSet(tr)}
    </Badge>
  );
}

export function buildProviderColumns(
  tr: Record<string, string>,
  rows: readonly ProviderSummary[] = [],
  options: BuildProviderColumnsOptions = {},
): ColumnDef<ProviderSummary>[] {
  const notSet = commonNotSet(tr);
  const lang = options.lang ?? "de";
  const dyn = deriveDynamicOptions(rows, lang);

  return [
    {
      id: "status",
      label: tr.patients_col_status ?? notSet,
      accessor: (provider) => (provider.is_active ? "active" : "inactive"),
      filterType: "enum",
      filterOptions: [
        { value: "active", label: tr.common_active ?? notSet },
        { value: "inactive", label: tr.common_inactive ?? notSet },
      ],
      sortable: true,
      width: 112,
      group: "identity",
      render: (provider) => <ProviderStatusPill active={provider.is_active} labels={tr} />,
    },
    {
      id: "provider",
      label: tr.providers_title ?? notSet,
      accessor: (provider) => provider.name,
      filterType: "text",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 320,
      group: "identity",
      render: (provider) => (
        <ProviderIdentityCell
          provider={provider}
          treeMeta={options.treeMetaById?.get(provider.id) ?? null}
          tr={tr}
          onToggleProviderCollapsed={options.onToggleProviderCollapsed}
        />
      ),
    },
    {
      id: "organization_level",
      label: tr.providers_organization_level ?? notSet,
      accessor: (provider) => provider.organization_level,
      filterType: "enum",
      filterOptions: [
        { value: "organization", label: tr.providers_level_organization ?? "organization" },
        { value: "clinic", label: tr.providers_level_clinic ?? "clinic" },
        { value: "department", label: tr.providers_level_department ?? "department" },
        { value: "unit", label: tr.providers_level_unit ?? "unit" },
      ],
      sortable: true,
      searchable: true,
      width: 150,
      group: "identity",
      render: (provider) => <ProviderLevelBadge level={provider.organization_level} tr={tr} />,
    },
    {
      id: "type",
      label: tr.providers_type ?? notSet,
      accessor: (provider) => provider.provider_type,
      filterType: "enum",
      filterOptions: [
        { value: "medical", label: tr.providers_type_medical ?? notSet },
        { value: "non_medical", label: tr.providers_type_non_medical ?? notSet },
      ],
      sortable: true,
      searchable: true,
      width: 150,
      group: "identity",
      render: (provider) => <ProviderTypeBadge provider={provider} tr={tr} />,
    },
    {
      id: "taxonomy",
      label: tr.providers_category ?? "Kategorie",
      accessor: (provider) => taxonomyProviderLabel(provider, lang, notSet),
      filterType: "text",
      sortable: true,
      searchable: true,
      width: 240,
      group: "registry",
      render: (provider) => (
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {taxonomyProviderLabel(provider, lang, notSet)}
        </span>
      ),
    },
    {
      id: "city",
      label: tr.providers_city ?? notSet,
      accessor: (provider) => provider.address_city,
      filterType: "enum",
      filterOptions: dyn.cities,
      sortable: true,
      searchable: true,
      width: 150,
      group: "registry",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">
          {provider.address_city || notSet}
        </span>
      ),
    },
    {
      id: "country",
      label: tr.providers_country ?? notSet,
      accessor: (provider) => provider.address_country,
      filterType: "enum",
      filterOptions: dyn.countries,
      sortable: true,
      searchable: true,
      width: 150,
      group: "registry",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">
          {provider.address_country || notSet}
        </span>
      ),
    },
    {
      id: "fachbereich",
      label: tr.providers_fachbereich ?? notSet,
      accessor: (provider) => providerSpecializationLabel(provider, lang, ""),
      filterType: "enum",
      filterOptions: dyn.fachbereiche,
      sortable: true,
      searchable: true,
      width: 180,
      group: "registry",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">
          {providerSpecializationLabel(provider, lang, notSet)}
        </span>
      ),
    },
    {
      id: "contract",
      label: tr.providers_contract ?? notSet,
      accessor: (provider) => provider.has_contract,
      filterType: "boolean",
      sortable: true,
      width: 130,
      group: "registry",
      render: (provider) => <ContractBadge hasContract={provider.has_contract} tr={tr} />,
    },
    {
      id: "doctors",
      label: tr.providers_doctors ?? notSet,
      accessor: (provider) => provider.doctor_count,
      filterType: "number",
      sortable: true,
      width: 96,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-foreground">{provider.doctor_count}</span>
      ),
    },
    {
      id: "patients",
      label: tr.providers_linked_patients ?? notSet,
      accessor: (provider) => provider.patient_count,
      filterType: "number",
      sortable: true,
      width: 104,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-foreground">{provider.patient_count}</span>
      ),
    },
    {
      id: "appointments",
      label: tr.providers_appointments ?? notSet,
      accessor: (provider) => provider.appointment_count,
      filterType: "number",
      sortable: true,
      width: 126,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-foreground">{provider.appointment_count}</span>
      ),
    },
    {
      id: "services",
      label: tr.providers_services ?? notSet,
      accessor: (provider) => provider.service_count,
      filterType: "number",
      sortable: true,
      width: 104,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-foreground">{provider.service_count}</span>
      ),
    },
    {
      id: "open_requests",
      label: tr.concierge_open_requests ?? notSet,
      accessor: (provider) => provider.open_concierge_service_count,
      filterType: "number",
      sortable: true,
      width: 128,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-foreground">
          {provider.open_concierge_service_count}
        </span>
      ),
    },
    {
      id: "rating",
      label: tr.providers_rating ?? notSet,
      accessor: (provider) => provider.avg_rating,
      filterType: "number",
      sortable: true,
      width: 96,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatRating(provider.avg_rating, notSet)}
          {provider.rating_count > 0 ? (
            <span className="ml-1 text-[10px]">({provider.rating_count})</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "internal_rating",
      label: tr.providers_internal_rating ?? tr.providers_rating ?? notSet,
      accessor: (provider) => provider.internal_rating,
      filterType: "number",
      sortable: true,
      width: 120,
      group: "activity",
      render: (provider) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatRating(provider.internal_rating ?? null, notSet)}
        </span>
      ),
    },
    {
      id: "phone",
      label: tr.field_phone ?? notSet,
      accessor: (provider) => provider.phone,
      filterType: "text",
      sortable: true,
      searchable: true,
      width: 170,
      group: "contact",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">{provider.phone || notSet}</span>
      ),
    },
    {
      id: "email",
      label: tr.field_email ?? tr.patients_email ?? notSet,
      accessor: (provider) => provider.email,
      filterType: "text",
      sortable: true,
      searchable: true,
      width: 220,
      group: "contact",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">{provider.email || notSet}</span>
      ),
    },
    {
      id: "tax_id",
      label: tr.providers_tax_id ?? notSet,
      accessor: (provider) => provider.tax_id,
      filterType: "text",
      sortable: true,
      searchable: true,
      width: 160,
      group: "registry",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">{provider.tax_id || notSet}</span>
      ),
    },
    {
      id: "last_interaction_at",
      label: tr.providers_last_activity ?? notSet,
      accessor: (provider) => provider.last_interaction_at,
      filterType: "date",
      sortable: true,
      width: 150,
      group: "audit",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">
          {compactDateTime(provider.last_interaction_at, notSet)}
        </span>
      ),
    },
    {
      id: "created_at",
      label: tr.patients_col_created_at ?? notSet,
      accessor: (provider) => provider.created_at,
      filterType: "date",
      sortable: true,
      width: 150,
      group: "audit",
      render: (provider) => (
        <span className="truncate text-xs text-muted-foreground">
          {compactDateTime(provider.created_at, notSet)}
        </span>
      ),
    },
  ];
}
