import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Trash2 } from "lucide-react";
import { formatMoneyLabel, roundCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { t as translationsFor, type Lang } from "@/lib/i18n";
import { agencyServiceLineDisplayDescription, agencyServiceLineDisplayName } from "@/lib/agency-service-labels";
import { listAgencyServicePriceChoices } from "@/pages/contracts/model/contracts-model";
import type { AgencyServiceItem } from "@/pages/contracts/model/types";
import type { ServiceLine } from "../model/order-service-line";
import { money, germanDateLabel, formatMoneyValue, priceVersionDisplayName, serviceBillingUnitLabel, serviceBillingUnitBadgeClass } from "../model/order-service-presentation";
type Tx = (ru: string, de: string) => string;
const inputString = (value: unknown) => String(value ?? "");
export function OrderCatalogServicesTable({ lines, catalogById, effectiveOn, lang, tx, disabled, describe, selectedPriceId: resolvePriceId, onQuantityChange, onPriceChange, onDelete, totals, lineLocked }: {
  lines: ServiceLine[]; catalogById: ReadonlyMap<string, AgencyServiceItem>; effectiveOn?: string; lang: Lang; tx: Tx; disabled: boolean;
  describe: (line: ServiceLine) => string;
  selectedPriceId: (line: ServiceLine, service: AgencyServiceItem) => string;
  onQuantityChange: (line: ServiceLine, value: string) => void;
  onPriceChange: (line: ServiceLine, service: AgencyServiceItem, priceId: string) => void;
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
                {serviceBillingUnitLabel(rawUnit, tx)}
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
      id: "vat",
      label: tx("НДС", "MwSt."),
      accessor: (line) => money(line.vat),
      sortable: false,
      align: "right",
      width: 100,
      render: (line) => <span className="whitespace-nowrap">{formatMoneyValue(money(line.vat), lang)}%</span>,
    },
    {
      id: "total",
      label: tx("Сумма", "Gesamt"),
      accessor: (line) => roundCents(money(line.quantity) * money(line.price)),
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
        const total = roundCents(money(line.quantity) * money(line.price));
        return (
          <span
            className="whitespace-nowrap font-semibold"
            title={`${line.quantity || "0"} ${unit} × ${formatMoneyLabel(money(line.price), line.currency)} = ${formatMoneyLabel(total, line.currency)}`}
          >
            {formatMoneyLabel(total, line.currency)}
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
                    storageKey="wizard-order-lines-v3"
                    className="[&_article_dl>div:has([role=combobox])]:col-span-2"
                    mobilePrimaryColumnId="service"
                    mobileDetailColumnIds={["quantity", "description", "unit_price", "vat", "total"]}
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
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{tx("Нетто", "Netto")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {formatMoneyLabel(totals.net)}
                          </dd>
                        </div>
                        <div className="min-w-[7rem]">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{tx("НДС", "MwSt.")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            {formatMoneyLabel(totals.vat)}
                          </dd>
                        </div>
                        <div className="min-w-[8rem] border-l border-border pl-6">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-foreground">{tx("Итого", "Gesamt")}</dt>
                          <dd className="mt-1 inline-flex whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/55 dark:text-emerald-100">
                            {formatMoneyLabel(totals.gross)}
                          </dd>
                        </div>
                      </dl>
                    )}
                  />
  );
}
