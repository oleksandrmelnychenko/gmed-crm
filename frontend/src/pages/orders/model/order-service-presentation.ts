import type { ServiceDescriptionItem } from "@/lib/service-description";
type Tx = (ru: string, de: string) => string;
const SERVICE_PRICE_OPTION_SEPARATOR = "::price::";

export function servicePriceOptionValue(serviceId: string, priceVersionId: string) {
  return `${serviceId}${SERVICE_PRICE_OPTION_SEPARATOR}${priceVersionId}`;
}

export function parseServicePriceOptionValue(value: string) {
  const separatorIndex = value.indexOf(SERVICE_PRICE_OPTION_SEPARATOR);
  if (separatorIndex < 0) return null;
  return {
    serviceId: value.slice(0, separatorIndex),
    priceVersionId: value.slice(separatorIndex + SERVICE_PRICE_OPTION_SEPARATOR.length),
  };
}

export function money(value: unknown): number {
  const normalized = typeof value === "string"
    ? value.replace(",", ".").trim()
    : String(value ?? "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function germanDateLabel(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized);
  if (!match) return normalized || "noch festzulegen";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function germanList(values: string[]) {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (uniqueValues.length === 0) return "noch festzulegende Fachrichtungen";
  if (uniqueValues.length === 1) return uniqueValues[0];
  return `${uniqueValues.slice(0, -1).join(", ")} und ${uniqueValues.at(-1)}`;
}

export function resolveServiceDescriptionTemplate(
  template: string,
  context: {
    dateFrom: string;
    dateTo: string;
    specialties: string[];
  },
) {
  const specialties = germanList(context.specialties);
  const resolved = template
    .replace(/\[\s*Datum\s+Beginn\s*\]/giu, () => germanDateLabel(context.dateFrom))
    .replace(/\[\s*Datum\s+Ende\s*\]/giu, () => germanDateLabel(context.dateTo))
    .replace(
      /\[\s*Fachrichtung(?:\s+(?:\d+|n(?:\s*\+\s*1)?))?\s*\](?:(?:\s*,\s*(?:und\s+)?|\s+und\s+)\[\s*Fachrichtung(?:\s+(?:\d+|n(?:\s*\+\s*1)?))?\s*\])*/giu,
      () => specialties,
    );
  return resolved
    .split(/\r?\n/gu)
    .map((line) => line
      .replace(/[^\S\r\n]+([,.;:])/gu, "$1")
      .replace(/[^\S\r\n]{2,}/gu, " ")
      .trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function resolveServiceDescriptionItems(
  items: ServiceDescriptionItem[],
  context: Parameters<typeof resolveServiceDescriptionTemplate>[1],
) {
  return items.map((item) => ({ ...item, text: resolveServiceDescriptionTemplate(item.text, context) }));
}

type ServiceBillingUnitKind =
  | "hour"
  | "day"
  | "unit"
  | "item"
  | "ride"
  | "appointment"
  | "package"
  | "other";

// Catalog unit labels are free text: English keys from the seed catalog
// ("ride", "item"), German or Russian labels typed by staff.
const SERVICE_BILLING_UNIT_PATTERNS: ReadonlyArray<[Exclude<ServiceBillingUnitKind, "other">, RegExp]> = [
  ["hour", /^(std\.?|stunde(?:n)?|hour(?:s)?|ч\.?|час(?:а|ов)?)$/u],
  ["day", /^(tag(?:e)?\.?|day(?:s)?|день|дня|дней)$/u],
  ["unit", /^(einheit(?:en)?|unit(?:s)?|ед\.?|единиц(?:а|ы)?)$/u],
  ["item", /^(item(?:s)?|piece(?:s)?|pcs\.?|stk\.?|stück|шт\.?|штук(?:а|и)?)$/u],
  ["ride", /^(ride(?:s)?|trip(?:s)?|fahrt(?:en)?|поездк(?:а|и)|поездок)$/u],
  ["appointment", /^(appointment(?:s)?|termin(?:e)?|при[её]м(?:а|ов)?)$/u],
  ["package", /^(package(?:s)?|paket(?:e)?|пакет(?:а|ов)?)$/u],
];

function serviceBillingUnitKind(unitLabel: string | null | undefined): ServiceBillingUnitKind {
  const normalized = unitLabel?.trim().toLocaleLowerCase("de-DE") ?? "";
  return SERVICE_BILLING_UNIT_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "other";
}

/** Localized billing unit of a catalog service; unknown custom labels stay as typed. */
export function serviceBillingUnitLabel(
  unitLabel: string | null | undefined,
  tx: Tx,
) {
  switch (serviceBillingUnitKind(unitLabel)) {
    case "hour":
      return tx("час", "Stunde");
    case "day":
      return tx("день", "Tag");
    case "unit":
      return tx("единица", "Einheit");
    case "item":
      return tx("шт.", "Stk.");
    case "ride":
      return tx("поездка", "Fahrt");
    case "appointment":
      return tx("приём", "Termin");
    case "package":
      return tx("пакет", "Paket");
    default:
      return unitLabel?.trim() || tx("единица", "Einheit");
  }
}

export function serviceBillingUnitBadgeClass(unitLabel: string | null | undefined) {
  switch (serviceBillingUnitKind(unitLabel)) {
    case "hour":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "day":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "unit":
    case "item":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-border/70 bg-muted/40 text-muted-foreground";
  }
}

const MONEY_FORMATTERS = {
  de: new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
  ru: new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
};

export function formatMoneyValue(value: number, lang: string) {
  return (lang === "de" ? MONEY_FORMATTERS.de : MONEY_FORMATTERS.ru).format(value);
}
