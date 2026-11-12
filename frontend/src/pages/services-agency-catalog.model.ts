import {
  agencyCatalogItemDescription,
  agencyCatalogItemName,
  agencyServiceUnitCount,
  agencyServiceUnitLabel,
} from "@/lib/agency-service-labels";
import type { Lang, Translations } from "@/lib/i18n";

/**
 * GMED's own agency services and packages as the concierge reads them (owner
 * decision 4 of 2026-11-12): the server sends them without any price, so these
 * types carry no amount either.
 */
export type ConciergeAgencyService = {
  id: string;
  service_key?: string | null;
  service_name: string;
  description?: string | null;
  name_ru?: string | null;
  description_ru?: string | null;
  unit_label?: string | null;
  is_active?: boolean;
};

export type ConciergePackageItem = {
  id: string;
  agency_service_id?: string | null;
  agency_service_name?: string | null;
  service_key?: string | null;
  description: string;
  included_quantity?: string | null;
  unit_label?: string | null;
};

export type ConciergeServicePackage = {
  id: string;
  package_key: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
  items: ConciergePackageItem[];
};

/** The roles that see GMED's catalogue read-only, without prices, on the services page. */
export function readsAgencyCatalogWithoutPrices(role: string | null | undefined) {
  return role === "concierge";
}

export type AgencyServiceRow = {
  id: string;
  name: string;
  description: string;
  unit: string;
};

export function agencyServiceRows(
  services: ConciergeAgencyService[],
  translations: Translations,
  lang: Lang,
): AgencyServiceRow[] {
  return services
    .filter((service) => service.is_active !== false)
    .map((service) => {
      const name = agencyCatalogItemName(service, translations, lang);
      const description = agencyCatalogItemDescription(service, translations, lang).trim();
      return {
        id: service.id,
        name,
        description: description === name ? "" : description,
        unit: service.unit_label?.trim() ? agencyServiceUnitLabel(service.unit_label, translations) : "",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, lang));
}

/** "Трансфер — 2 поездки": what a package contains, never its price. */
export function packageItemLine(
  item: ConciergePackageItem,
  translations: Translations,
  lang: Lang,
) {
  const name = item.agency_service_name?.trim() || item.description.trim();
  const quantity = item.included_quantity?.trim()
    ? agencyServiceUnitCount(item.included_quantity, item.unit_label, translations, lang)
    : "";
  return quantity ? `${name} — ${quantity}` : name;
}

export function activePackages(packages: ConciergeServicePackage[]) {
  return packages
    .filter((entry) => entry.is_active !== false)
    .sort((left, right) => left.name.localeCompare(right.name));
}
