import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import type { Lang } from "@/lib/i18n";
import type { OrderEconomics, OrderServiceEconomics } from "../model/types";

export function OrderEconomicsTable({ economics, lang, formatMoney }: {
  economics: OrderEconomics;
  lang: Lang;
  formatMoney: (value: unknown, currency: string) => string;
}) {
  const de = lang === "de";
  const moneyColumn = (id: keyof OrderServiceEconomics, label: string, width: number, strong = false): ColumnDef<OrderServiceEconomics> => ({
    id, label, width, filterType: "number",
    accessor: service => {
      const value = service[id];
      return value === null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
    },
    render: service => <span className={`whitespace-nowrap font-mono tabular-nums ${strong ? "font-semibold" : ""}`}>{formatMoney(service[id], economics.currency)}</span>,
  });
  const columns: ColumnDef<OrderServiceEconomics>[] = [
    { id: "name", label: de ? "Leistung" : "Услуга", accessor: service => service.name, required: true, minWidth: 280,
      render: service => <span className="block min-w-0 truncate font-medium" title={service.name}>{service.name}</span> },
    moneyColumn("planned_revenue_net", de ? "Geplanter Erlös" : "Плановый доход", 165),
    moneyColumn("actual_revenue_net", de ? "Abgerechneter Erlös" : "Выставленный доход", 180),
    ...(economics.margin_visible ? [
      moneyColumn("planned_partner_cost_net", de ? "Geplante Partnerkosten" : "Плановые затраты на партнёра", 245),
      moneyColumn("actual_partner_cost_net", de ? "Tatsächliche Partnerkosten" : "Фактические затраты на партнёра", 260),
      moneyColumn("margin_net", de ? "Marge ohne Mehrwertsteuer" : "Маржа без налога", 195, true),
    ] : []),
  ];
  return <section data-testid="order-economics-table" className="min-w-0">
    <DataTableSurface key={`${economics.order_id}:${economics.margin_visible}`} rows={economics.services} columns={columns} rowId={service => service.order_leistung_id}
      storageKey="orders:service-economics" defaultDensity="compact" rowHeightOverrides={{ compact: 44 }}
      pagination={{ pageSize: 10, resetKey: economics.order_id }} mobilePrimaryColumnId="name"
      toolbarStart={<h3 className="flex shrink-0 items-center gap-2 self-center text-sm font-semibold"><span className="size-1.5 rounded-full bg-primary" />{de ? "Leistungsübersicht" : "Экономика услуг"}</h3>}
      emptyState={<p className="px-4 py-6 text-center text-xs text-muted-foreground">{economics.services.length ? de ? "Keine Leistungen entsprechen den Filtern." : "Нет услуг, соответствующих фильтрам." : de ? "Noch keine Leistungen hinzugefügt" : "Услуги ещё не добавлены"}</p>}
    />
  </section>;
}
