import { useId, useMemo, useState, type ReactNode } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { tokens } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { ProviderTaxonomyCascadeSelect } from "@/pages/providers/ui/provider-taxonomy-cascade-select";
import type { ProviderTaxonomyNode, ProviderType } from "@/pages/providers/model/types";

type ProviderTaxonomyCarrier = {
  id: string;
  name: string;
  provider_type?: string | null;
  address_city?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  /** Assigned nodes + all their ancestors; used for parent-category filtering. */
  taxonomy_filter_ids?: string[];
  taxonomy_node?: { id?: string | null } | null;
  taxonomy_path?: Array<{ id?: string | null }>;
};

type ProviderSelectWithTaxonomyFilterProps<TProvider extends ProviderTaxonomyCarrier> = {
  value: string;
  providers: TProvider[];
  taxonomyNodes: ProviderTaxonomyNode[];
  providerType?: ProviderType | "" | null;
  taxonomyValue?: string;
  taxonomyMode?: "any" | "leaf";
  disabled?: boolean;
  providerDisabled?: boolean;
  taxonomyDisabled?: boolean;
  providerPlaceholder: string;
  taxonomyPlaceholder: string;
  taxonomyAllLabel?: string;
  containerClassName?: string;
  taxonomyContainerClassName?: string;
  taxonomySelectClassName?: string;
  providerSelectClassName?: string;
  taxonomyLabel?: ReactNode;
  providerSelectLabel?: ReactNode;
  providerLabel?: (provider: TProvider) => ReactNode;
  providerSearchText?: (provider: TProvider) => string;
  "aria-label"?: string;
  onChange: (providerId: string) => void;
  onTaxonomyChange?: (taxonomyNodeId: string) => void;
};

function providerMatchesTaxonomy(provider: ProviderTaxonomyCarrier, taxonomyNodeId: string) {
  const selected = taxonomyNodeId.trim();
  if (!selected) return true;

  return new Set([
    provider.taxonomy_node_id ?? "",
    provider.taxonomy_node?.id ?? "",
    ...(provider.taxonomy_filter_ids ?? []),
    ...(provider.taxonomy_node_ids ?? []),
    ...(provider.taxonomy_path ?? []).map((node) => node.id ?? ""),
  ].filter(Boolean)).has(selected);
}

function providerMatchesType(
  provider: ProviderTaxonomyCarrier,
  providerType: ProviderType | "" | null | undefined,
) {
  if (providerType !== "medical" && providerType !== "non_medical") return true;
  return provider.provider_type === providerType;
}

function defaultProviderLabel(provider: ProviderTaxonomyCarrier) {
  return provider.address_city ? `${provider.name} (${provider.address_city})` : provider.name;
}

export function ProviderSelectWithTaxonomyFilter<TProvider extends ProviderTaxonomyCarrier>({
  value,
  providers,
  taxonomyNodes,
  providerType,
  taxonomyValue,
  taxonomyMode = "any",
  disabled,
  providerDisabled,
  taxonomyDisabled,
  providerPlaceholder,
  taxonomyPlaceholder,
  taxonomyAllLabel,
  containerClassName,
  taxonomyContainerClassName,
  taxonomySelectClassName,
  providerSelectClassName,
  taxonomyLabel,
  providerSelectLabel,
  providerLabel = defaultProviderLabel,
  providerSearchText,
  "aria-label": ariaLabel,
  onChange,
  onTaxonomyChange,
}: ProviderSelectWithTaxonomyFilterProps<TProvider>) {
  const generatedId = useId();
  const taxonomySelectId = `${generatedId}-taxonomy`;
  const providerSelectId = `${generatedId}-provider`;
  const [internalTaxonomyValue, setInternalTaxonomyValue] = useState("");
  const selectedTaxonomyValue = taxonomyValue ?? internalTaxonomyValue;
  const filteredProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          providerMatchesType(provider, providerType) &&
          providerMatchesTaxonomy(provider, selectedTaxonomyValue),
      ),
    [providerType, providers, selectedTaxonomyValue],
  );
  const selectedProviderStillVisible =
    !value || filteredProviders.some((provider) => provider.id === value);

  const handleTaxonomyChange = (taxonomyNodeId: string) => {
    if (taxonomyValue === undefined) {
      setInternalTaxonomyValue(taxonomyNodeId);
    }
    onTaxonomyChange?.(taxonomyNodeId);

    if (
      value &&
      !providers.some(
        (provider) =>
          provider.id === value &&
          providerMatchesType(provider, providerType) &&
          providerMatchesTaxonomy(provider, taxonomyNodeId),
      )
    ) {
      onChange("");
    }
  };

  const taxonomyControl = (
    <ProviderTaxonomyCascadeSelect
      id={taxonomySelectId}
      value={selectedTaxonomyValue}
      nodes={taxonomyNodes}
      providerType={providerType}
      mode={taxonomyMode}
      placeholder={taxonomyPlaceholder}
      allLabel={taxonomyAllLabel ?? taxonomyPlaceholder}
      disabled={disabled || taxonomyDisabled || taxonomyNodes.length === 0}
      containerClassName={taxonomyContainerClassName}
      selectClassName={taxonomySelectClassName}
      onChange={handleTaxonomyChange}
    />
  );
  const providerControl = (
    <NativeComboboxSelect
      id={providerSelectId}
      value={selectedProviderStillVisible ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || providerDisabled}
      className={providerSelectClassName}
      aria-label={ariaLabel ?? providerPlaceholder}
    >
      <option value="">{providerPlaceholder}</option>
      {filteredProviders.map((provider) => (
        <option
          key={provider.id}
          value={provider.id}
          data-search-text={providerSearchText?.(provider)}
        >
          {providerLabel(provider)}
        </option>
      ))}
    </NativeComboboxSelect>
  );

  return (
    <div className={cn("grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", containerClassName)}>
      {taxonomyLabel ? (
        <div className="space-y-1.5">
          <label htmlFor={taxonomySelectId} className={cn(tokens.text.label, "block")}>
            {taxonomyLabel}
          </label>
          {taxonomyControl}
        </div>
      ) : (
        taxonomyControl
      )}
      {providerSelectLabel ? (
        <div className="space-y-1.5">
          <label htmlFor={providerSelectId} className={cn(tokens.text.label, "block")}>
            {providerSelectLabel}
          </label>
          {providerControl}
        </div>
      ) : (
        providerControl
      )}
    </div>
  );
}
