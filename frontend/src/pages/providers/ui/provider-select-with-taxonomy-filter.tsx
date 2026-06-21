import { useId, useMemo, useState, type ReactNode } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { tokens } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { ProviderTaxonomyCascadeSelect } from "@/pages/providers/ui/provider-taxonomy-cascade-select";
import type { ProviderTaxonomyNode, ProviderType } from "@/pages/providers/model/types";
import {
  type ProviderTaxonomyCarrier,
  collectInsuranceOptions,
  providerMatchesInsurance,
  providerMatchesTaxonomy,
  providerMatchesType,
  selectAvailableTaxonomyNodes,
} from "@/pages/providers/model/provider-selection";

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
  /** Shown under the provider select when a category is chosen but no provider matches it. */
  noProvidersLabel?: ReactNode;
  /** When true, the category dropdown only lists categories that actually have a provider of the current type. */
  restrictTaxonomyToAvailable?: boolean;
  /** When true, adds an insurance dropdown that filters providers by accepted insurance. */
  showInsuranceFilter?: boolean;
  /** Controlled selected insurance id (optional; falls back to internal state). */
  insuranceValue?: string;
  insurancePlaceholder?: string;
  insuranceLabel?: ReactNode;
  onInsuranceChange?: (insuranceId: string) => void;
  providerLabel?: (provider: TProvider) => ReactNode;
  providerSearchText?: (provider: TProvider) => string;
  "aria-label"?: string;
  onChange: (providerId: string) => void;
  onTaxonomyChange?: (taxonomyNodeId: string) => void;
};

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
  noProvidersLabel,
  restrictTaxonomyToAvailable,
  showInsuranceFilter,
  insuranceValue,
  insurancePlaceholder,
  insuranceLabel,
  onInsuranceChange,
  providerLabel = defaultProviderLabel,
  providerSearchText,
  "aria-label": ariaLabel,
  onChange,
  onTaxonomyChange,
}: ProviderSelectWithTaxonomyFilterProps<TProvider>) {
  const generatedId = useId();
  const taxonomySelectId = `${generatedId}-taxonomy`;
  const providerSelectId = `${generatedId}-provider`;
  const insuranceSelectId = `${generatedId}-insurance`;
  const [internalTaxonomyValue, setInternalTaxonomyValue] = useState("");
  const selectedTaxonomyValue = taxonomyValue ?? internalTaxonomyValue;
  const [internalInsuranceValue, setInternalInsuranceValue] = useState("");
  const selectedInsuranceValue = insuranceValue ?? internalInsuranceValue;
  const insuranceOptions = useMemo(
    () => (showInsuranceFilter ? collectInsuranceOptions(providers) : []),
    [showInsuranceFilter, providers],
  );
  const insuranceFilterActive = showInsuranceFilter && insuranceOptions.length > 0;
  const filteredProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          providerMatchesType(provider, providerType) &&
          providerMatchesTaxonomy(provider, selectedTaxonomyValue) &&
          (!insuranceFilterActive || providerMatchesInsurance(provider, selectedInsuranceValue)),
      ),
    [providerType, providers, selectedTaxonomyValue, insuranceFilterActive, selectedInsuranceValue],
  );
  const selectedProviderStillVisible =
    !value || filteredProviders.some((provider) => provider.id === value);
  const showNoProvidersHint =
    Boolean(noProvidersLabel) &&
    filteredProviders.length === 0 &&
    selectedTaxonomyValue.trim() !== "";

  // Only offer categories that actually contain a matching provider (empty categories like
  // pharmacies on a medical appointment are never shown). See selectAvailableTaxonomyNodes.
  const availableTaxonomyNodes = useMemo(
    () =>
      restrictTaxonomyToAvailable
        ? selectAvailableTaxonomyNodes(
            taxonomyNodes,
            providers,
            providerType,
            selectedTaxonomyValue,
          )
        : taxonomyNodes,
    [restrictTaxonomyToAvailable, providers, providerType, taxonomyNodes, selectedTaxonomyValue],
  );

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

  const handleInsuranceChange = (insuranceId: string) => {
    if (insuranceValue === undefined) {
      setInternalInsuranceValue(insuranceId);
    }
    onInsuranceChange?.(insuranceId);

    if (
      value &&
      !providers.some(
        (provider) =>
          provider.id === value &&
          providerMatchesType(provider, providerType) &&
          providerMatchesTaxonomy(provider, selectedTaxonomyValue) &&
          providerMatchesInsurance(provider, insuranceId),
      )
    ) {
      onChange("");
    }
  };

  const insuranceControl = insuranceFilterActive ? (
    <NativeComboboxSelect
      id={insuranceSelectId}
      value={selectedInsuranceValue}
      onChange={(event) => handleInsuranceChange(event.target.value)}
      disabled={disabled}
      className={providerSelectClassName}
      aria-label={insurancePlaceholder ?? "Insurance"}
    >
      <option value="">{insurancePlaceholder ?? "Insurance"}</option>
      {insuranceOptions.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </NativeComboboxSelect>
  ) : null;

  const taxonomyControl = (
    <ProviderTaxonomyCascadeSelect
      id={taxonomySelectId}
      value={selectedTaxonomyValue}
      nodes={availableTaxonomyNodes}
      providerType={providerType}
      mode={taxonomyMode}
      placeholder={taxonomyPlaceholder}
      allLabel={taxonomyAllLabel ?? taxonomyPlaceholder}
      disabled={disabled || taxonomyDisabled || availableTaxonomyNodes.length === 0}
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
    <div
      className={cn(
        "grid min-w-0 gap-2",
        insuranceFilterActive
          ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        containerClassName,
      )}
    >
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
      {insuranceControl ? (
        insuranceLabel ? (
          <div className="space-y-1.5">
            <label htmlFor={insuranceSelectId} className={cn(tokens.text.label, "block")}>
              {insuranceLabel}
            </label>
            {insuranceControl}
          </div>
        ) : (
          insuranceControl
        )
      ) : null}
      {providerSelectLabel ? (
        <div className="space-y-1.5">
          <label htmlFor={providerSelectId} className={cn(tokens.text.label, "block")}>
            {providerSelectLabel}
          </label>
          {providerControl}
          {showNoProvidersHint ? (
            <p className="text-[11px] leading-tight text-muted-foreground">{noProvidersLabel}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          {providerControl}
          {showNoProvidersHint ? (
            <p className="text-[11px] leading-tight text-muted-foreground">{noProvidersLabel}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
