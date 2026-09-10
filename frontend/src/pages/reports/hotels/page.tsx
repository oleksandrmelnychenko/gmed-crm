import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, Check, CircleAlert, Download, Info, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { PageHeader } from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Lang, useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { hotelCopy, createHotelCopy } from "./copy";
import { breakfastCopy } from "./breakfast-copy";
import { BreakfastEditor } from "./breakfast-editor";
import { HotelDocuments } from "./hotel-documents";
import { CreateHotelSheet } from "./create-hotel-sheet";
import { HotelTable } from "./hotel-table";
import { HotelBreakfastTermsEditor } from "./hotel-breakfast-terms";
import { breakfastModes, decimal, emptyHotelGroup, filterHotelStays, groupHotels, hotelKey, hotelsCsv, hotelStatisticsRoles, initialFilters, matchesStaySearch, monthlyCosts, stayCost, stayNights, summarizeStays, type HotelDirectoryItem, type HotelFilters, type HotelStay, type HotelWorkspace } from "./model";

const panelClass = "rounded-xl border border-border/70 bg-card shadow-sm";
const statusOptions = ["committed", "completed", "in_service", "future", "confirmed", "booked", "planned", "cancelled", "all"] as const;
function berlinToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}
function defaultPeriod() { const year = berlinToday().slice(0, 4); return { from: `${year}-01-01`, to: `${year}-12-31` }; }
function dateLabel(value: string | null, lang: Lang) {
  return value ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
}

function RoomEditor({ stay, lang, editable, onSaved, onDirty }: { stay: HotelStay; lang: Lang; editable: boolean; onSaved: () => void; onDirty: (id: string, dirty: boolean) => void }) {
  const labels = hotelCopy[lang];
  const [rooms, setRooms] = useState(stay.room_count?.toString() ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => setRooms(stay.room_count?.toString() ?? ""), [stay.room_count]);
  const changed = rooms !== (stay.room_count?.toString() ?? "");
  const dirtyKey = `rooms:${stay.source}:${stay.id}`;
  useEffect(() => { onDirty(dirtyKey, changed || busy); return () => onDirty(dirtyKey, false); }, [dirtyKey, changed, busy, onDirty]);
  async function save() {
    if (busy || !changed) return;
    if (rooms && (!/^\d+$/.test(rooms) || Number(rooms) < 1 || Number(rooms) > 1000)) { setError(labels.invalidRooms); return; }
    setBusy(true); setError("");
    try {
      await apiFetch(`/stats/reports/hotels/${stay.source}/${stay.id}/rooms`, { method: "PUT", body: JSON.stringify({ room_count: rooms ? Number(rooms) : null }) });
      clearApiCache("/stats/reports/hotels"); onSaved();
    } catch { setError(labels.saveError); }
    finally { setBusy(false); }
  }
  return <div className="max-w-44 space-y-1">
    <div className="flex items-center gap-1.5">
      <Input aria-label={`${labels.rooms} ${stay.id}`} title={rooms ? labels.rooms : labels.clear} type="number" min={1} max={1000} step={1} placeholder="—" value={rooms} disabled={!editable || busy} onChange={event => { setRooms(event.target.value); setError(""); }} className="h-8 w-20 font-mono" />
      {editable && changed ? <Button size="icon-sm" aria-label={labels.save} title={labels.save} disabled={busy} onClick={() => void save()}><Check className="size-4" /></Button> : null}
    </div>
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </div>;
}

export default function HotelStatisticsPage() {
  const { lang } = useLang(), { user } = useAuth();
  const labels = hotelCopy[lang];
  const breakfastLabels = breakfastCopy[lang];
  const [period, setPeriod] = useState(defaultPeriod), [draftPeriod, setDraftPeriod] = useState(defaultPeriod);
  const [filters, setFilters] = useState<HotelFilters>(initialFilters);
  const [workspace, setWorkspace] = useState<HotelWorkspace | null>(null);
  const [directory, setDirectory] = useState<HotelDirectoryItem[]>([]), [directoryError, setDirectoryError] = useState(false), [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedStayKeys, setSelectedStayKeys] = useState<string[]>([]);
  const [staySearch, setStaySearch] = useState("");
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(() => new Set());
  const onRoomDirty = useCallback((id: string, dirty: boolean) => setDirtyRows(current => {
    if (current.has(id) === dirty) return current;
    const next = new Set(current); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  const allowed = hotelStatisticsRoles.includes(user?.role ?? "");
  const editable = allowed && user?.role !== "ceo_assistant";
  const canCreate = ["ceo", "patient_manager", "concierge"].includes(user?.role ?? "");
  const today = berlinToday();
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setLoading(true); setError("");
    setDirectoryError(false);
    void apiFetch<HotelDirectoryItem[]>("/stats/reports/hotels/directory", { forceFresh: true }).then(data => { if (active) setDirectory(data); }).catch(() => { if (active) setDirectoryError(true); });
    void apiFetch<HotelWorkspace>(`/stats/reports/hotels?from=${period.from}&to=${period.to}`, { forceFresh: true }).then(data => {
      if (active) { setWorkspace(data); setLoading(false); }
    }).catch(() => { if (active) { setError(labels.loadError); setLoading(false); } });
    return () => { active = false; };
  }, [allowed, period, version, labels.loadError]);
  const scoped = useMemo(() => filterHotelStays(workspace?.rows ?? [], filters, today), [workspace, filters, today]);
  const rows = scoped.filter(row => row.check_in && row.check_in >= period.from && row.check_in <= period.to);
  const undated = scoped.filter(row => !row.check_in).length;
  const summary = summarizeStays(rows, today);
  const reportGroups = groupHotels(rows, today);
  const unbookedHotels = directory.filter(hotel => !reportGroups.some(group => group.key === hotel.id)
    && filters.breakfast === "all" && ["all", "committed"].includes(filters.status)
    && (filters.hotel === "all" || filters.hotel === hotel.id) && (filters.city === "all" || filters.city === hotel.city)
    && `${hotel.name} ${hotel.city ?? ""}`.toLocaleLowerCase().includes(filters.search.trim().toLocaleLowerCase()));
  const groups = [...reportGroups, ...unbookedHotels.map(hotel => emptyHotelGroup(hotel, today))];
  // Keep an open editor mounted if its save changes the breakfast filter match.
  const selectedDirectoryHotel = directory.find(hotel => hotel.id === selected);
  const selectedHotel = groupHotels((workspace?.rows ?? []).filter(row => selectedStayKeys.includes(`${row.source}:${row.id}`)), today).find(group => group.key === selected)
    ?? (selectedDirectoryHotel ? emptyHotelGroup(selectedDirectoryHotel, today) : undefined);
  const detailStays = selectedHotel?.stays.filter(stay => matchesStaySearch(stay, staySearch)) ?? [];
  function openHotel(key: string) {
    setStaySearch("");
    setSelectedStayKeys(groups.find(group => group.key === key)?.stays.map(row => `${row.source}:${row.id}`) ?? []);
    setSelected(key);
  }
  const hotels = [...new Map([...directory.map(hotel => [hotel.id, hotel.name] as const), ...(workspace?.rows ?? []).map(row => [hotelKey(row), row.hotel_name || labels.noHotel] as const)]).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cities = [...new Set([...directory.flatMap(hotel => hotel.city ? [hotel.city] : []), ...(workspace?.rows ?? []).flatMap(row => row.city ? [row.city] : [])])].sort();
  const currencies = [...new Set([filters.currency, ...(workspace?.rows ?? []).map(row => row.currency)])].sort();
  const money = (cents: bigint) => formatMoneyAmount(decimal(cents), filters.currency);
  const monthly = monthlyCosts(rows, period.from, period.to).map(row => ({
    ...row, label: new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${row.month}-01T00:00:00Z`)),
    // Empty months are measured zero; unpriced bookings remain gaps, not zero-cost stays.
    actual: row.bookings && !row.known ? null : Number(row.actual) / 100,
    estimated: row.bookings && !row.known ? null : Number(row.estimated) / 100,
  }));
  const ranking = [...groups].sort((a, b) => b.nights - a.nights).slice(0, 6).map(group => ({ key: group.key, name: group.name || labels.noHotel, nights: group.nights }));
  const eligible = rows.filter(row => row.status !== "cancelled").length;
  function changeFilter<K extends keyof HotelFilters>(key: K, value: HotelFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }));
  }
  function applyPeriod() {
    const from = Date.parse(`${draftPeriod.from}T00:00:00Z`), to = Date.parse(`${draftPeriod.to}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 1096 * 86400000) { setError(labels.invalidDates); return; }
    setPeriod({ ...draftPeriod }); setSelected(null);
  }
  function exportStays() {
    const headers = [labels.hotel, labels.patient, labels.reference, labels.checkIn, labels.checkOut, labels.nights, labels.rooms, labels.status, labels.currency, labels.volume, labels.estimated, breakfastLabels.title, breakfastLabels.count, breakfastLabels.amount, labels.currency, breakfastLabels.payer, breakfastLabels.notes];
    const contents = hotelsCsv(headers, detailStays.map(stay => {
      const cost = stayCost(stay);
      return [stay.hotel_name ?? "", [stay.patient_name, stay.patient_number].filter(Boolean).join(" · "), stay.booking_reference ?? "", stay.check_in ?? "", stay.check_out ?? "", stayNights(stay) ?? "", stay.room_count ?? "", labels[stay.status as keyof typeof labels] || stay.status, stay.currency, cost ? decimal(cost.cents) : "", cost?.estimated ? labels.estimated : "", breakfastLabels[stay.breakfast_mode], stay.breakfast_count ?? "", stay.breakfast_total ?? "", stay.breakfast_currency ?? "", breakfastLabels[stay.breakfast_payer], stay.breakfast_notes ?? ""];
    }));
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `hotel-stays-${period.from}-${period.to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  if (!allowed) return <p className="p-6 text-muted-foreground">{labels.readOnly}</p>;
  return <div className="space-y-4 pb-4" data-testid="hotel-statistics">
    <PageHeader title={labels.title} actions={canCreate ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" />{createHotelCopy[lang].add}</Button> : undefined} />
    <section aria-label={labels.filters} data-testid="hotel-filters" className={`${panelClass} flex flex-wrap items-end gap-2 p-3`}>
      <label className="min-w-36 flex-1 basis-36 space-y-1 text-xs text-muted-foreground">{labels.from}<Input aria-label={labels.from} type="date" value={draftPeriod.from} onChange={event => setDraftPeriod(current => ({ ...current, from: event.target.value }))} /></label>
      <label className="min-w-36 flex-1 basis-36 space-y-1 text-xs text-muted-foreground">{labels.to}<Input aria-label={labels.to} type="date" value={draftPeriod.to} onChange={event => setDraftPeriod(current => ({ ...current, to: event.target.value }))} /></label>
      <Button size="icon-sm" className="shrink-0" title={labels.apply} aria-label={labels.apply} onClick={applyPeriod}><Check className="size-4" /></Button>
      <div className="min-w-40 flex-1 basis-40 space-y-1"><p className="text-xs text-muted-foreground">{labels.hotel}</p><NativeComboboxSelect aria-label={labels.hotel} className="h-8 w-full min-w-0" value={filters.hotel} onChange={event => changeFilter("hotel", event.target.value)}><option value="all">{labels.allHotels}</option>{hotels.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</NativeComboboxSelect></div>
      <div className="min-w-28 flex-1 basis-28 space-y-1"><p className="text-xs text-muted-foreground">{labels.city}</p><NativeComboboxSelect aria-label={labels.city} className="h-8 w-full min-w-0" value={filters.city} onChange={event => changeFilter("city", event.target.value)}><option value="all">{labels.allCities}</option>{cities.map(city => <option key={city}>{city}</option>)}</NativeComboboxSelect></div>
      <div className="w-20 shrink-0 space-y-1"><p className="text-xs text-muted-foreground">{labels.currency}</p><NativeComboboxSelect aria-label={labels.currency} className="h-8 w-full min-w-0" value={filters.currency} onChange={event => changeFilter("currency", event.target.value)}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</NativeComboboxSelect></div>
      <div className="min-w-44 flex-[1.25_1_11rem] space-y-1"><p className="text-xs text-muted-foreground">{labels.status}</p><NativeComboboxSelect aria-label={labels.status} className="h-8 w-full min-w-0" value={filters.status} onChange={event => changeFilter("status", event.target.value)}>{statusOptions.map(status => <option key={status} value={status}>{labels[status]}</option>)}</NativeComboboxSelect></div>
      <div className="min-w-44 flex-[1.25_1_11rem] space-y-1"><p className="text-xs text-muted-foreground">{breakfastLabels.title}</p><NativeComboboxSelect aria-label={breakfastLabels.title} className="h-8 w-full min-w-0" value={filters.breakfast} onChange={event => changeFilter("breakfast", event.target.value)}><option value="all">{breakfastLabels.all}</option>{breakfastModes.map(mode => <option key={mode} value={mode}>{breakfastLabels[mode]}</option>)}</NativeComboboxSelect></div>
      <div className="relative min-w-44 flex-[1.5_1_11rem]"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input className="h-8 pl-8" aria-label={labels.search} placeholder={labels.search} value={filters.search} onChange={event => changeFilter("search", event.target.value)} /></div>
      <Button variant="ghost" size="icon-sm" className="shrink-0" title={labels.reset} aria-label={labels.reset} onClick={() => setFilters(initialFilters)}><X className="size-4" /></Button>
    </section>
    {error || directoryError ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="size-5 shrink-0" /><div className="min-w-0 flex-1">{error ? <p>{error}</p> : null}{directoryError ? <p>{createHotelCopy[lang].directoryError}</p> : null}</div>{error !== labels.invalidDates ? <Button variant="outline" size="sm" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw className="size-4" />{labels.retry}</Button> : null}</div> : null}
    {loading ? <div role="status" className={`${panelClass} flex min-h-40 items-center justify-center gap-2.5 p-5 text-sm text-muted-foreground`}><LoaderCircle className="size-5 animate-spin text-primary" />{labels.loading}</div> : workspace && !error ? <>
      {undated > 0 ? <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{labels.noDate}: {undated}</p> : null}
      {!rows.length ? <div className={`${panelClass} flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground`}><Building2 className="size-9 text-orange-400" /><p>{groups.length ? createHotelCopy[lang].noPeriodStays : labels.noData}</p></div> : null}
      {rows.length ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="hotel-kpis">
          <Metric label={labels.patients} value={String(summary.patients)} detail={`${labels.bookings}: ${summary.bookings} · ${labels.future}: ${summary.future}`} />
          <Metric label={labels.roomNights} value={summary.roomsKnown ? summary.roomNights.toLocaleString(lang === "ru" ? "ru-RU" : "de-DE") : "—"} title={labels.roomDefinition} detail={`${labels.known}: ${summary.roomsKnown} ${labels.outOf} ${eligible} · ${labels.nights}: ${summary.nights}`} />
          <Metric label={labels.volume} value={summary.pricedStays ? money(summary.total) : "—"} title={labels.costDefinition} detail={`${labels.estimated}: ${money(summary.estimated)} · ${labels.known}: ${summary.pricedStays}/${summary.bookings}`} />
          <Metric label={labels.average} value={summary.averageRoomNight === null ? "—" : money(summary.averageRoomNight)} title={labels.averageDefinition} detail={`${labels.known}: ${summary.pricedRoomBookings} ${labels.outOf} ${eligible}`} />
        </div>
        {(summary.costsMissing || summary.roomsKnown < eligible || summary.datesMissing) ? <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-orange-200 bg-orange-50/70 px-4 py-3 text-xs text-orange-900"><span className="inline-flex items-center gap-1.5 font-medium"><Info className="size-3.5" />{labels.missing}</span><span>{labels.missingRooms}: {rows.filter(row => row.status !== "cancelled" && row.room_count === null).length}</span><span>{labels.missingCost}: {summary.costsMissing}</span><span>{labels.missingDates}: {summary.datesMissing}</span></div> : null}
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <section className={`${panelClass} min-w-0 p-4`}><h2 className="flex items-center gap-2.5 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-primary" />{labels.trend}</h2><div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block size-2 rounded-full bg-orange-500" />{labels.actual}</span><span><i className="mr-1.5 inline-block size-2 rounded-full bg-orange-200" />{labels.estimated}</span><span>{filters.currency}</span></div>
            {summary.pricedStays ? <div className="mt-4 h-64" data-testid="hotel-trend"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ left: 0, right: 8, bottom: 0 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis width={58} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={value => new Intl.NumberFormat("de-DE", { notation: "compact" }).format(Number(value))} /><Tooltip formatter={(value, name) => [formatMoneyAmount(Number(value), filters.currency), name === "actual" ? labels.actual : labels.estimated]} /><Bar dataKey="actual" stackId="cost" fill="#f97316" maxBarSize={36} isAnimationActive={false} /><Bar dataKey="estimated" stackId="cost" fill="#fed7aa" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">{labels.noMoney}</p>}
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{labels.costDefinition}</p>
          </section>
          <section className={`${panelClass} min-w-0 p-4`}><h2 className="flex items-center gap-2.5 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-primary" />{labels.ranking}</h2><p className="mt-2 text-xs text-muted-foreground">{labels.nightDefinition}</p><div className="mt-4 h-64" data-testid="hotel-ranking"><ResponsiveContainer width="100%" height="100%"><BarChart data={ranking} layout="vertical" margin={{ right: 24 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={138} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value: string) => value.length > 22 ? `${value.slice(0, 21)}…` : value} /><Tooltip formatter={value => [value, labels.nights]} /><Bar dataKey="nights" fill="#fdba74" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
        </div>
        <section className={`${panelClass} p-4`}><h2 className="flex items-center gap-2.5 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-primary" />{labels.payments}</h2><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[[labels.direct, summary.direct], [labels.company, summary.company], [labels.due, summary.due], [labels.pending, summary.pending]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-muted-foreground">{String(label)}</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(value as bigint)}</p></div>)}</div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{labels.paymentDefinition}</p></section>
        <section className={`${panelClass} p-4`} data-testid="breakfast-summary"><h2 className="flex items-center gap-2.5 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-primary" />{breakfastLabels.title}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">{breakfastModes.map(mode => <div key={mode} className="rounded-lg bg-orange-50/60 p-3"><p className="text-xs text-muted-foreground">{breakfastLabels[mode]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary.breakfast.counts[mode]}</p><p className="text-[10px] text-muted-foreground">{labels.bookings}</p></div>)}</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">{breakfastLabels.meals}</p><p className="mt-1 font-semibold">{summary.breakfast.mealsKnown ? summary.breakfast.meals : "—"}</p><p className="text-xs text-muted-foreground">{labels.known}: {summary.breakfast.mealsKnown}/{eligible}</p></div>{([["hotelCost", summary.breakfast.hotelCost, summary.breakfast.hotelPriced, summary.breakfast.counts.hotel_extra], ["selfCost", summary.breakfast.selfCost, summary.breakfast.selfPriced, summary.breakfast.counts.self]] as const).map(([label, value, known, count]) => <div key={label}><p className="text-xs text-muted-foreground">{breakfastLabels[label]}</p><p className="mt-1 font-semibold tabular-nums">{known ? money(value) : "—"}</p><p className="text-xs text-muted-foreground">{breakfastLabels.known}: {known}/{count}</p></div>)}</div>
          {summary.breakfast.otherCurrency ? <p className="mt-2 text-xs text-amber-800">{breakfastLabels.otherCurrency}: {summary.breakfast.otherCurrency}</p> : null}<p className="mt-3 text-xs leading-relaxed text-muted-foreground">{breakfastLabels.definition}</p>
        </section>
      </> : null}
      <HotelTable groups={groups} lang={lang} currency={filters.currency} resetKey={JSON.stringify([period, filters])} onOpen={openHotel} />
    </> : null}
    <Dialog open={Boolean(selectedHotel)} dirty={dirtyRows.size > 0} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent data-testid="hotel-detail-dialog" className="left-1/2 right-auto top-1/2 bottom-auto flex max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border-border/70 bg-card p-0 pb-0 shadow-2xl sm:max-h-[92dvh] sm:w-[calc(100vw-2rem)] sm:max-w-[1480px] sm:pb-0"><DialogHeader className="shrink-0 gap-1.5 border-b border-border/70 bg-muted/20 px-5 py-4 pr-14"><DialogTitle className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-orange-500" />{selectedHotel?.name || labels.noHotel}</DialogTitle><DialogDescription>{labels.details} · {dateLabel(period.from, lang)} — {dateLabel(period.to, lang)}</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto bg-muted/10 p-4 sm:p-5">
        {selectedHotel ? <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><span className="font-medium">{selectedHotel.city || selectedDirectoryHotel?.country || "—"}</span><span className="text-muted-foreground">{labels.patients}: {selectedHotel.patients}</span><span className="text-muted-foreground">{labels.bookings}: {selectedHotel.bookings}</span><span className="text-muted-foreground">{labels.nights}: {selectedHotel.nights}</span></div>
          <div className="grid items-start gap-4 lg:grid-cols-2"><HotelBreakfastTermsEditor key={`terms:${selectedHotel.key}`} providerId={selectedHotel.providerId} role={user?.role ?? ""} lang={lang} onDirty={onRoomDirty} /><HotelDocuments key={selectedHotel.key} providerId={selectedHotel.providerId} role={user?.role ?? ""} lang={lang} onDirty={onRoomDirty} /></div>
        </> : null}
        <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-muted/15 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 shrink-0 rounded-full bg-orange-500" />{labels.details}<span className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-xs font-normal text-muted-foreground">{selectedHotel?.stays.length ?? 0}</span></h3><div className="flex flex-wrap items-center gap-3 sm:ml-auto">{selectedHotel?.providerId ? <StaffLink className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline" to={`/providers/${selectedHotel.providerId}`}>{labels.hotelProfile}<ArrowUpRight className="size-3.5" /></StaffLink> : null}<Button size="sm" disabled={!detailStays.length} onClick={exportStays}><Download className="size-3.5" />{labels.exportStays}</Button></div></header>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3"><div className="relative min-w-0 flex-1 basis-60"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={labels.staySearch} placeholder={labels.staySearch} className="pl-9" value={staySearch} onChange={event => setStaySearch(event.target.value)} /></div><span className="text-xs text-muted-foreground">{labels.shown}: {detailStays.length}/{selectedHotel?.stays.length ?? 0}</span></div>
        <div className="overflow-x-auto"><table data-testid="hotel-stays-table" className="block w-full text-sm md:table md:min-w-[1060px]">
          <thead className="hidden bg-muted/20 md:table-header-group"><tr>{[labels.patient, labels.checkIn, labels.checkOut, labels.rooms, labels.volume, labels.status, breakfastLabels.title, ""].map((label, i) => <th key={i} className={`px-3 py-2.5 text-left text-xs font-medium text-muted-foreground ${i === 4 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
          <tbody className="block md:table-row-group">{selectedHotel?.stays.map(stay => { const cost = stayCost(stay); return <tr key={stay.source + ":" + stay.id} hidden={!matchesStaySearch(stay, staySearch)} className={`${matchesStaySearch(stay, staySearch) ? "grid md:table-row" : "hidden"} grid-cols-2 gap-x-3 border-t border-border/60 px-3 py-2 align-middle odd:bg-muted/10 hover:bg-muted/25 md:px-0 md:py-0`}>
            <td className="col-span-2 block py-2 md:table-cell md:max-w-52 md:px-3 md:py-2.5"><StaffLink to={`/patients/${stay.patient_id}`} className="font-medium text-orange-700 hover:underline">{stay.patient_name || stay.patient_number || labels.patient}</StaffLink><p className="mt-0.5 font-mono text-xs text-muted-foreground">{stay.patient_number}</p>{stay.booking_reference ? <p className="break-all text-xs text-muted-foreground">{labels.reference}: {stay.booking_reference}</p> : null}</td>
            <td className="block py-2 md:table-cell md:whitespace-nowrap md:px-3 md:py-2.5"><span className="block text-xs text-muted-foreground md:hidden">{labels.checkIn}</span>{dateLabel(stay.check_in, lang)}</td>
            <td className="block py-2 md:table-cell md:whitespace-nowrap md:px-3 md:py-2.5"><span className="block text-xs text-muted-foreground md:hidden">{labels.checkOut}</span>{dateLabel(stay.check_out, lang)}<p className="mt-0.5 text-xs text-muted-foreground">{labels.nights}: {stayNights(stay) ?? "—"}</p></td>
            <td className="block py-2 md:table-cell md:px-3 md:py-2.5"><span className="mb-1 block text-xs text-muted-foreground md:hidden">{labels.rooms}</span><RoomEditor stay={stay} lang={lang} editable={editable} onDirty={onRoomDirty} onSaved={() => setVersion(value => value + 1)} /></td>
            <td className="block py-2 md:table-cell md:whitespace-nowrap md:px-3 md:py-2.5 md:text-right"><span className="block text-xs text-muted-foreground md:hidden">{labels.volume}</span><span className="font-mono font-medium">{cost ? money(cost.cents) : "—"}</span>{cost?.estimated ? <p className="mt-1"><span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{labels.estimated}</span></p> : null}</td>
            <td className="block py-2 text-xs md:table-cell md:px-3 md:py-2.5"><span className="mb-1 block text-xs text-muted-foreground md:hidden">{labels.status}</span><Badge variant="outline" className={stay.status === "cancelled" ? "border-rose-200 bg-rose-50 text-rose-700" : ["completed", "confirmed"].includes(stay.status) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}>{labels[stay.status as keyof typeof labels] || stay.status}</Badge></td>
            <td className="col-span-2 block min-w-0 py-2 md:table-cell md:max-w-72 md:px-3 md:py-2.5"><span className="mb-1 block text-xs text-muted-foreground md:hidden">{breakfastLabels.title}</span><BreakfastEditor stay={stay} lang={lang} editable={editable} onDirty={onRoomDirty} onSaved={() => setVersion(value => value + 1)} /></td>
            <td className="block py-2 md:table-cell md:px-3 md:py-2.5">{stay.task_id ? <StaffLink className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline" to={"/task-manager?task=" + stay.task_id}>{labels.task}<ArrowUpRight className="size-3" /></StaffLink> : null}</td>
          </tr>; })}</tbody>
        </table></div>
        {!detailStays.length ? <p className="py-6 text-center text-sm text-muted-foreground">{labels.noStays}</p> : null}
        </section>
      </div>
      <footer className="shrink-0 space-y-3 border-t border-border/70 bg-muted/20 px-5 py-3">{error ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}<Button size="sm" variant="outline" disabled={loading} onClick={() => setVersion(value => value + 1)}>{labels.refresh}</Button></div> : null}<div className="flex justify-end"><DialogClose render={<Button variant="outline" />}><X className="size-4" />{labels.close}</DialogClose></div></footer>
    </DialogContent></Dialog>
    {creating ? <CreateHotelSheet lang={lang} onClose={() => setCreating(false)} onCreated={hotel => {
      setDirectory(current => [...current.filter(item => item.id !== hotel.id), hotel]); setCreating(false); setFilters(initialFilters); setSelectedStayKeys([]); setStaySearch(""); setSelected(hotel.id);
    }} /> : null}
  </div>;
}

function Metric({ label, value, detail, title }: { label: string; value: string; detail: string; title?: string }) {
  return <div className={`${panelClass} min-w-0 border-l-[3px] border-l-primary/60 p-4`} title={title}><p className="text-xs font-medium text-muted-foreground">{label}{title ? <Info className="ml-1 inline size-3" /> : null}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>;
}
