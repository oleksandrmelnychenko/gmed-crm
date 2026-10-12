import { agencyServiceLineDisplayName } from "@/lib/agency-service-labels";
import type { Lang, Translations } from "@/lib/i18n";

import type { OrderServiceEconomics } from "./types";

/**
 * The service's name in the UI language, as the service list shows it (QA
 * D3-03: the RU "Экономика услуг" listed the German document names): the
 * catalogue's Russian name while the line still carries the catalogue name,
 * else the line's own text, localized when it is a known catalogue name.
 */
export function economicsServiceName(
  service: OrderServiceEconomics,
  translations: Translations,
  lang: Lang,
) {
  const catalogItem = service.catalog_service_name || service.agency_service_key
    ? {
        service_key: service.agency_service_key ?? null,
        service_name: service.catalog_service_name ?? null,
        name_ru: service.catalog_name_ru ?? null,
      }
    : null;
  return agencyServiceLineDisplayName(service.name, catalogItem, translations, lang === "de" ? "de" : "ru")
    || service.name;
}
