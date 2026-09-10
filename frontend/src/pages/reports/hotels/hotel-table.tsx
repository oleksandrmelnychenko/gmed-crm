import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { hotelCopy } from "./copy";
import { decimal, type groupHotels } from "./model";

type HotelGroup = ReturnType<typeof groupHotels>[number];

export function HotelTable({ groups, lang, currency, resetKey, onOpen }: { groups: HotelGroup[]; lang: Lang; currency: string; resetKey: string; onOpen: (id: string) => void }) {
  const labels = hotelCopy[lang];
  const money = (value: bigint) => formatMoneyAmount(decimal(value), currency);
  const columns: ColumnDef<HotelGroup>[] = [
    { id: "hotel", label: labels.hotel, accessor: row => row.name, required: true, pinned: "left", width: 220,
      render: row => <button className="min-w-0 truncate text-left font-mono font-semibold text-primary hover:underline" title={row.name || labels.noHotel} onClick={event => { event.stopPropagation(); onOpen(row.key); }}>{row.name || labels.noHotel}</button> },
    { id: "city", label: labels.city, accessor: row => row.city, width: 120 },
    { id: "patients", label: labels.patients, accessor: row => row.patients, filterType: "number", width: 104 },
    { id: "bookings", label: labels.bookings, accessor: row => row.bookings, filterType: "number", width: 120 },
    { id: "nights", label: labels.nights, accessor: row => row.nights, filterType: "number", width: 126 },
    { id: "roomNights", label: labels.roomNights, accessor: row => row.roomsKnown ? row.roomNights : null, filterType: "number", width: 126,
      render: row => <div className="w-full text-right tabular-nums">{row.roomsKnown ? row.roomNights : "—"}<p className="text-[10px] text-muted-foreground">{row.roomsKnown}/{row.stays.filter(stay => stay.status !== "cancelled").length}</p></div> },
    { id: "volume", label: labels.volume, accessor: row => row.pricedStays ? Number(decimal(row.total)) : null, filterType: "number", width: 185,
      render: row => <div className="w-full text-right tabular-nums"><span className="font-medium">{row.pricedStays ? money(row.total) : "—"}</span>{row.estimatedStays || row.costsMissing ? <p className="truncate text-[10px] text-muted-foreground">{row.estimatedStays ? `${labels.estimated}: ${money(row.estimated)}` : ""}{row.costsMissing ? ` · ${labels.partial}` : ""}</p> : null}</div> },
    { id: "average", label: labels.average, accessor: row => row.averageRoomNight === null ? null : Number(decimal(row.averageRoomNight)), filterType: "number", width: 185,
      render: row => row.averageRoomNight === null ? "—" : money(row.averageRoomNight) },
    { id: "direct", label: labels.direct, accessor: row => Number(decimal(row.direct)), filterType: "number", width: 155, render: row => money(row.direct) },
    { id: "company", label: labels.company, accessor: row => Number(decimal(row.company)), filterType: "number", width: 155, render: row => money(row.company) },
  ];
  return <section data-testid="hotel-table" className="min-w-0">
    <DataTableSurface rows={groups} columns={columns} rowId={row => row.key} storageKey="hotels:table" onRowClick={row => onOpen(row.key)}
      defaultSort={[{ field: "volume", dir: "desc" }]} defaultDensity="compact" rowHeightOverrides={{ compact: 44 }}
      pagination={{ pageSize: 50, resetKey }} tableClassName="sm:max-h-[640px]" mobilePrimaryColumnId="hotel" mobileDetailColumnIds={["city", "patients", "bookings", "nights", "volume", "direct", "company"]}
      toolbarStart={<h2 className="flex shrink-0 items-center gap-2 self-center text-sm font-semibold"><span className="size-1.5 rounded-full bg-primary" />{labels.table}</h2>}
      emptyState={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{labels.noStays}</p>} />
  </section>;
}
