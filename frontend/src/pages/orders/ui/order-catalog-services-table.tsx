import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Trash2 } from "lucide-react";
import { formatMoneyLabel, moneyLineAmounts, moneyLineDiscount, parseDiscountPercent, roundCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { t as translationsFor, type Lang } from "@/lib/i18n";
import { agencyServiceLineDisplayDescription, agencyServiceLineDisplayName } from "@/lib/agency-service-labels";
import { listAgencyServicePriceChoices } from "@/pages/contracts/model/contracts-model";
import type { AgencyServiceItem } from "@/pages/contracts/model/types";
import type { ServiceLine } from "../model/order-service-line";
import type { PositionTaxProfile } from "../model/order-model";
import { money, germanDateLabel, formatMoneyValue, priceVersionDisplayName, serviceBillingUnitLabel, serviceBillingUnitBadgeLabel, serviceBillingUnitBadgeClass } from "../model/order-service-presentation";
type Tx = (ru: string, de: string) => string;
const inputString = (value: unknown) => String(value ?? "");
/** The discount of a line as a number (an unreadable entry counts as none until fixed). */
export function serviceLineDiscount(line: ServiceLine): number {
  if (line.isCostPassthrough) return 0;
  return parseDiscountPercent(line.discount ?? "") ?? 0;
}

/** Net of a line after its discount, as the server prices it. */
function serviceLineNet(line: ServiceLine): number {
  return moneyLineAmounts(money(line.quantity), money(line.price), 0, serviceLineDiscount(line)).net;
}

/** The profiles a line may carry: the pass-through profile for a pass-through cost only. */
export function taxProfilesForLine(line: Pick<ServiceLine, "isCostPassthrough">, profiles: readonly PositionTaxProfile[]) {
  return profiles.filter((profile) => (profile.vat_category === "pass_through") === (line.isCostPassthrough === true));
}

/** «Standard VAT · 19 %»: the profile as a pill or option. */
export function taxProfileLabel(profile: Pick<PositionTaxProfile, "name" | "vat_rate">) {
  return `${profile.name} · ${String(Number(profile.vat_rate))} %`;
}

export function OrderCatalogServicesTable({ lines, catalogById, effectiveOn, lang, tx, disabled, describe, selectedPriceId: resolvePriceId, onQuantityChange, onPriceChange, onDiscountChange, onTaxProfileChange, taxProfiles = [], onDelete, totals, lineLocked }: {
  lines: ServiceLine[]; catalogById: ReadonlyMap<string, AgencyServiceItem>; effectiveOn?: string; lang: Lang; tx: Tx; disabled: boolean;
  describe: (line: ServiceLine) => string;
  selectedPriceId: (line: ServiceLine, service: AgencyServiceItem) => string;
  onQuantityChange: (line: ServiceLine, value: string) => void;
  onPriceChange: (line: ServiceLine, service: AgencyServiceItem, priceId: string) => void;
  /** Without it the discount is shown, not edited. */
  onDiscountChange?: (line: ServiceLine, value: string) => void;
  /** The position's tax profile picked (owner 2026-11-19); without it the profile is a pill. */
  onTaxProfileChange?: (line: ServiceLine, profile: PositionTaxProfile | null) => void;
  taxProfiles?: readonly PositionTaxProfile[];
  onDelete: (line: ServiceLine) => void;
  totals: { net: number; vat: number; gross: number };
  /** A line this table shows but does not change (the lead wizard: one the order workspace added). */
  lineLocked?: (line: ServiceLine) => boolean;
}) {
  const locked = (line: ServiceLine) => lineLocked?.(line) ?? false;
  // Names and descriptions in the UI language; the line keeps the catalogue's
  // German text for the documents (QA 2026-10-11).
  const translations = translationsFor(lang);
  const lineService = (line: ServiceLine) => (line.agencyServiceId ? catalogById.get(line.agencyServiceId) : undefined);
  const displayName = (line: ServiceLine) => agencyServiceLineDisplayName(line.description, lineService(line), translations, lang);
  const displayDescription = (line: ServiceLine) =>
    agencyServiceLineDisplayDescription(describe(line), line.catalogDescription, lineService(line), translations, lang);
  const servicePriceChoiceLabel = (price: ReturnType<typeof listAgencyServicePriceChoices>[number]) => [
    formatMoneyLabel(money(price.unit_price), price.currency), priceVersionDisplayName(price),
    `${germanDateLabel(price.valid_from)} — ${price.valid_to ? germanDateLabel(price.valid_to) : tx("бессрочно", "unbefristet")}`,
    price.is_effective ? tx("рекомендуемая", "empfohlen") : "",
  ].filter(Boolean).join(" · ");
  const serviceLineColumns: ColumnDef<ServiceLine>[] = [
    {
      id: "service",
      label: tx("Услуга", "Leistung"),
      accessor: (line) => displayName(line),
      sortable: false,
      required: true,
      pinned: "left",
      width: 420,
      render: (line) => {
        const catalogService = line.agencyServiceId
          ? catalogById.get(line.agencyServiceId)
          : undefined;
        const rawUnit = line.catalogUnitLabel || catalogService?.unit_label;
        return (
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{displayName(line)}</div>
            {rawUnit ? (
              <Badge
                variant="outline"
                className={cn(
                  "mt-1 h-5 w-fit max-w-full truncate text-[10px] font-semibold",
                  serviceBillingUnitBadgeClass(rawUnit),
                )}
              >
                {serviceBillingUnitBadgeLabel(rawUnit, tx)}
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "quantity",
      label: tx("Объём", "Umfang"),
      accessor: (line) => money(line.quantity),
      sortable: false,
      required: true,
      align: "right",
      width: 132,
      cellClassName: "overflow-visible",
      render: (line) => {
        const catalogService = line.agencyServiceId
          ? catalogById.get(line.agencyServiceId)
          : undefined;
        const rawUnit = line.catalogUnitLabel || catalogService?.unit_label;
        const unit = serviceBillingUnitLabel(
          rawUnit,
          tx,
        );
        return (
          <div className="grid min-w-0 grid-cols-[3rem_4.25rem] items-center justify-end gap-1">
            <Input
              name={`service_quantity_${line.id}`}
              autoComplete="off"
              inputMode="decimal"
              aria-label={`${tx("Объём", "Umfang")} (${unit}): ${line.description}`}
              title={`${tx("Объём", "Umfang")}: ${line.quantity || "0"} ${unit}`}
              className="h-7 w-12 shrink-0 rounded-md bg-field px-2 text-right font-mono text-xs tabular-nums"
              value={line.quantity}
              disabled={disabled || locked(line)}
              onChange={(event) => {
                onQuantityChange(line, event.target.value);
              }}
            />
            <Badge
              aria-hidden="true"
              variant="outline"
              className={cn(
                "h-5 w-full shrink-0 justify-center px-1.5 font-mono text-[10px] font-semibold",
                serviceBillingUnitBadgeClass(rawUnit),
              )}
            >
              {unit}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "description",
      label: tx("Описание", "Beschreibung"),
      accessor: (line) => displayDescription(line),
      sortable: false,
      searchable: true,
      render: (line) => {
        const description = displayDescription(line);
        return (
          <span
            className="line-clamp-2 whitespace-normal text-xs text-muted-foreground"
            title={description || undefined}
          >
            {description || tx("Описание не указано", "Keine Beschreibung hinterlegt")}
          </span>
        );
      },
    },
    {
      id: "unit_price",
      label: tx("Ставка", "Satz"),
      accessor: (line) => money(line.price),
      sortable: false,
      align: "right",
      width: 240,
      render: (line) => {
        const catalogService = line.agencyServiceId
          ? catalogById.get(line.agencyServiceId)
          : undefined;
        const unit = serviceBillingUnitLabel(
          line.catalogUnitLabel || catalogService?.unit_label,
          tx,
        );
        if (catalogService) {
          const priceChoices = listAgencyServicePriceChoices(
            catalogService,
            effectiveOn,
          );
          const selectedPriceId = resolvePriceId(line, catalogService);
          const selectedPrice = priceChoices.find((price) => price.id === selectedPriceId);
          return (
            <NativeComboboxSelect
              aria-label={`${tx("Цена каталога", "Katalogpreis")}: ${line.description}`}
              name={`service_price_${line.id}`}
              value={selectedPriceId}
              selectedLabel={selectedPrice ? (
                <span className="inline-flex max-w-full items-baseline gap-1.5">
                  <span className="font-medium">{formatMoneyLabel(money(line.price), line.currency)}</span>
                  <span className="text-muted-foreground">/ {unit}</span>
                </span>
              ) : undefined}
              disabled={disabled || locked(line)}
              className="h-8 min-w-0 bg-field font-mono text-xs tabular-nums [&>span]:text-right"
              title={selectedPrice ? servicePriceChoiceLabel(selectedPrice) : tx("Выбрать тариф", "Tarif auswählen")}
              searchPlaceholder={tx("Найти тариф…", "Tarif suchen…")}
              onChange={(event) => onPriceChange(
                line,
                catalogService,
                event.target.value,
              )}
            >
              {priceChoices.map((price) => {
                const priceName = priceVersionDisplayName(price);
                return (
                  <option
                    key={price.id || "catalog-price"}
                    value={price.id}
                    data-search-text={`${servicePriceChoiceLabel(price)} ${unit}`}
                    disabled={
                      (!price.id && !price.is_effective)
                      || price.currency.toUpperCase() !== "EUR"
                    }
                  >
                    <span className="block whitespace-normal py-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-xs font-medium tabular-nums">
                          {formatMoneyLabel(money(inputString(price.unit_price)), price.currency)}
                          <span className="font-normal text-muted-foreground"> / {unit}</span>
                        </span>
                        {price.is_effective ? <span className="text-[10px] font-medium text-emerald-700">{tx("Рекомендуемая", "Empfohlen")}</span> : null}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {tx("С", "Ab")} {germanDateLabel(price.valid_from)}
                        {price.valid_to ? ` ${tx("по", "bis")} ${germanDateLabel(price.valid_to)}` : ` · ${tx("бессрочно", "unbefristet")}`}
                      </span>
                      {priceName ? <span className="mt-1 block text-xs text-muted-foreground">{priceName}</span> : null}
                    </span>
                  </option>
                );
              })}
            </NativeComboboxSelect>
          );
        }
        return (
          <span className="whitespace-nowrap">
            {formatMoneyLabel(money(line.price), line.currency)} / {unit}
          </span>
        );
      },
    },
    {
      id: "discount",
      label: tx("Скидка, %", "Rabatt, %"),
      accessor: (line) => serviceLineDiscount(line),
      sortable: false,
      align: "right",
      width: 92,
      render: (line) => {
        const value = line.isCostPassthrough ? "" : (line.discount ?? "");
        const invalid = parseDiscountPercent(value) === null;
        return (
          <Input
            name={`service_discount_${line.id}`}
            autoComplete="off"
            inputMode="decimal"
            aria-label={`${tx("Скидка, %", "Rabatt, %")}: ${line.description}`}
            aria-invalid={invalid || undefined}
            placeholder="0"
            className={cn(
              "h-7 w-16 rounded-md bg-field px-2 text-right font-mono text-xs tabular-nums",
              invalid && "border-destructive",
            )}
            value={value}
            disabled={disabled || locked(line) || line.isCostPassthrough === true || !onDiscountChange}
            onChange={(event) => onDiscountChange?.(line, event.target.value)}
          />
        );
      },
    },
    {
      id: "vat",
      label: tx("НДС", "MwSt."),
      accessor: (line) => money(line.vat),
      sortable: false,
      align: "right",
      width: 200,
      render: (line) => {
        const rate = <span className="whitespace-nowrap font-mono tabular-nums">{formatMoneyValue(money(line.vat), lang)}%</span>;
        const choices = taxProfilesForLine(line, taxProfiles);
        const current = taxProfiles.find((profile) => profile.id === line.taxProfileId);
        if (onTaxProfileChange && choices.length && !disabled && !locked(line)) {
          return (
            <span className="flex flex-col items-end gap-0.5">
              {rate}
              <NativeComboboxSelect
                aria-label={`${tx("Налоговый профиль", "Steuerprofil")}: ${line.description}`}
                value={line.taxProfileId ?? ""}
                onChange={(event) => onTaxProfileChange(line, choices.find((profile) => profile.id === event.target.value) ?? null)}
                className="h-6 max-w-44 rounded-md px-1.5 text-[11px]"
              >
                <option value="">{tx("По каталогу", "Standard des Katalogs")}</option>
                {choices.map((profile) => <option key={profile.id} value={profile.id}>{taxProfileLabel(profile)}</option>)}
              </NativeComboboxSelect>
            </span>
          );
        }
        const name = current ? taxProfileLabel(current) : line.taxProfileName;
        return (
          <span className="flex flex-col items-end gap-0.5">
            {rate}
            {name ? <Badge variant="outline" className="h-auto max-w-44 truncate px-1.5 py-0 text-[10px] font-normal" title={name}>{name}</Badge> : null}
          </span>
        );
      },
    },
    {
      id: "total",
      label: tx("Сумма", "Gesamt"),
      accessor: (line) => serviceLineNet(line),
      sortable: false,
      align: "right",
      width: 150,
      render: (line) => {
        const catalogService = line.agencyServiceId
          ? catalogById.get(line.agencyServiceId)
          : undefined;
        const unit = serviceBillingUnitLabel(
          line.catalogUnitLabel || catalogService?.unit_label,
          tx,
        );
        const listTotal = roundCents(money(line.quantity) * money(line.price));
        const discount = moneyLineDiscount(money(line.quantity), money(line.price), serviceLineDiscount(line));
        const total = roundCents(listTotal - discount);
        return (
          <span
            className="flex flex-col items-end whitespace-nowrap"
            title={`${line.quantity || "0"} ${unit} × ${formatMoneyLabel(money(line.price), line.currency)} = ${formatMoneyLabel(listTotal, line.currency)}`}
          >
            <span className="font-mono font-semibold tabular-nums">{formatMoneyLabel(total, line.currency)}</span>
            {discount > 0 ? (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                −{formatMoneyLabel(discount, line.currency)}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];
  return (
                  <DataTable
                    rows={lines}
                    columns={serviceLineColumns}
                    rowId={(line) => line.id}
                    density="comfortable"
                    rowHeightOverrides={{ comfortable: 46 }}
                    storageKey="wizard-order-lines-v4"
                    className="[&_article_dl>div:has([role=combobox])]:col-span-2"
                    mobilePrimaryColumnId="service"
                    mobileDetailColumnIds={["quantity", "description", "unit_price", "discount", "vat", "total"]}
                    disableRowHover
                    rowActionsAlwaysVisible
                    rowActionsWidth={36}
                    rowActionsLabel={(
                      <span className="sr-only">{tx("Действия", "Aktionen")}</span>
                    )}
                    rowActions={(line) => (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={disabled || locked(line)}
                        title={locked(line) ? tx("Услуга заказа: меняется в заказе", "Auftragsleistung: im Auftrag ändern") : tx("Удалить услугу", "Leistung entfernen")}
                        aria-label={`${tx("Удалить услугу", "Leistung entfernen")}: ${line.description}`}
                        onClick={() => onDelete(line)}
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </Button>
                    )}
                    footer={(
                      <dl
                        aria-label={tx("Итоги заказа", "Auftragssummen")}
                        className="ml-auto flex w-fit max-w-full flex-wrap items-start justify-end gap-x-8 gap-y-2 text-right"
                      >
                        <div className="min-w-[7rem]">
                          <dt className="text-[10px] font-medium text-muted-foreground">{tx("Нетто", "Netto")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {formatMoneyLabel(totals.net)}
                          </dd>
                        </div>
                        <div className="min-w-[7rem]">
                          <dt className="text-[10px] font-medium text-muted-foreground">{tx("НДС", "MwSt.")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {formatMoneyLabel(totals.vat)}
                          </dd>
                        </div>
                        <div className="min-w-[8rem] border-l border-border pl-6">
                          <dt className="text-[10px] font-semibold text-foreground">{tx("Итого", "Gesamt")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/55 dark:text-emerald-100">
                            {formatMoneyLabel(totals.gross)}
                          </dd>
                        </div>
                      </dl>
                    )}
                  />
  );
}
