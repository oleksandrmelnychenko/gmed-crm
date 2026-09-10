export const breakfastModes = ["unknown", "included", "hotel_extra", "self", "none"] as const;
export type BreakfastMode = typeof breakfastModes[number];
export type BreakfastDetails = {
  breakfast_mode: BreakfastMode; breakfast_count: number | null; breakfast_total: string | null;
  breakfast_currency: string | null; breakfast_payer: "unknown" | "patient" | "company" | "split"; breakfast_notes: string | null;
};
export const emptyBreakfast: BreakfastDetails = { breakfast_mode: "unknown", breakfast_count: null, breakfast_total: null, breakfast_currency: null, breakfast_payer: "unknown", breakfast_notes: null };
export type HotelStay = BreakfastDetails & {
  id: string; source: "service" | "task"; task_id: string | null; patient_id: string;
  patient_name: string | null; patient_number: string | null; booking_reference: string | null;
  provider_id: string | null; hotel_name: string | null; city: string | null;
  status: string; check_in: string | null; check_out: string | null;
  room_count: number | null; details_updated_at: string | null; currency: string;
  actual_cost: string | null; cost_estimate: string | null;
  posted_cost: string; posted_count: number; direct_paid: string; company_paid: string;
  provider_due: string; pending_cost: string; pending_count: number;
};
export type HotelWorkspace = { rows: HotelStay[]; from: string; to: string; timezone: string; generated_at: string };
export type HotelDirectoryItem = { id: string; name: string; city: string | null; country: string | null };
export type HotelFilters = { hotel: string; city: string; currency: string; status: string; search: string; breakfast: string };
export const initialFilters: HotelFilters = { hotel: "all", city: "all", currency: "EUR", status: "committed", search: "", breakfast: "all" };
export const hotelStatisticsRoles = ["ceo", "ceo_assistant", "billing", "patient_manager", "concierge"];

export function moneyCents(value: string | null): bigint | null {
  if (value === null || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimal(cents: bigint) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function hotelKey(stay: HotelStay) {
  return stay.provider_id ?? `vendor:${stay.hotel_name?.trim().toLocaleLowerCase() || "unknown"}`;
}
export function matchesStaySearch(stay: HotelStay, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [stay.patient_name, stay.patient_number, stay.booking_reference]
    .some(value => value?.toLocaleLowerCase().includes(needle));
}
function dateNumber(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}
export function stayNights(stay: HotelStay): number | null {
  const start = dateNumber(stay.check_in), end = dateNumber(stay.check_out);
  return start !== null && end !== null && end > start ? (end - start) / 86400000 : null;
}
export function stayCost(stay: HotelStay) {
  const actual = moneyCents(stay.actual_cost);
  if (actual !== null) return { cents: actual, estimated: false };
  // Cancellation costs require a recorded actual; a cancelled quote is not spend.
  const estimate = stay.status === "cancelled" ? null : moneyCents(stay.cost_estimate);
  return estimate === null ? null : { cents: estimate, estimated: true };
}
export function filterHotelStays(rows: HotelStay[], filters: HotelFilters, today: string) {
  const search = filters.search.trim().toLocaleLowerCase();
  return rows.filter(row => row.currency === filters.currency
    && (filters.hotel === "all" || hotelKey(row) === filters.hotel)
    && (filters.city === "all" || row.city === filters.city)
    && (filters.breakfast === "all" || (row.breakfast_mode ?? "unknown") === filters.breakfast)
    && (!search || `${row.hotel_name ?? ""} ${row.city ?? ""}`.toLocaleLowerCase().includes(search))
    && (filters.status === "all"
      || (filters.status === "committed" && ["confirmed", "in_service", "completed"].includes(row.status))
      || (filters.status === "future" && row.status === "confirmed" && row.check_in !== null && row.check_in > today)
      || row.status === filters.status));
}
export function summarizeStays(rows: HotelStay[], today: string) {
  let nights = 0, roomNights = 0, roomsKnown = 0, datesMissing = 0, costsMissing = 0, future = 0;
  let actual = 0n, estimated = 0n, direct = 0n, company = 0n, due = 0n, pending = 0n;
  let pricedRoomNights = 0, pricedRoomCost = 0n;
  let pricedStays = 0, estimatedStays = 0, pricedRoomBookings = 0;
  for (const row of rows) {
    const duration = stayNights(row);
    const cost = stayCost(row);
    if (row.status !== "cancelled") {
      if (duration === null) datesMissing++;
      else {
        nights += duration;
        if (row.room_count !== null && Number.isInteger(row.room_count) && row.room_count > 0) {
          roomNights += duration * row.room_count;
          roomsKnown++;
          if (cost) { pricedRoomCost += cost.cents; pricedRoomNights += duration * row.room_count; pricedRoomBookings++; }
        }
      }
    }
    if (cost) {
      pricedStays++;
      if (cost.estimated) { estimated += cost.cents; estimatedStays++; }
      else actual += cost.cents;
    } else costsMissing++;
    if (row.status === "confirmed" && row.check_in && row.check_in > today) future++;
    direct += moneyCents(row.direct_paid) ?? 0n;
    company += moneyCents(row.company_paid) ?? 0n;
    due += moneyCents(row.provider_due) ?? 0n;
    pending += moneyCents(row.pending_cost) ?? 0n;
  }
  return {
    bookings: rows.length, patients: new Set(rows.map(row => row.patient_id)).size,
    nights, roomNights, roomsKnown, datesMissing, costsMissing, future, pricedStays, estimatedStays,
    actual, estimated, total: actual + estimated, direct, company, due, pending, pricedRoomBookings,
    breakfast: summarizeBreakfast(rows),
    averageRoomNight: pricedRoomNights ? (pricedRoomCost + BigInt(Math.floor(pricedRoomNights / 2))) / BigInt(pricedRoomNights) : null,
  };
}
export function summarizeBreakfast(rows: HotelStay[]) {
  const counts: Record<BreakfastMode, number> = { unknown: 0, included: 0, hotel_extra: 0, self: 0, none: 0 };
  let meals = 0, mealsKnown = 0, hotelCost = 0n, selfCost = 0n, hotelPriced = 0, selfPriced = 0, otherCurrency = 0;
  for (const row of rows.filter(row => row.status !== "cancelled")) {
    const mode = row.breakfast_mode ?? "unknown";
    counts[mode]++;
    if (row.breakfast_count != null) { meals += row.breakfast_count; mealsKnown++; }
    if (mode !== "hotel_extra" && mode !== "self") continue;
    const amount = moneyCents(row.breakfast_total ?? null);
    if (amount === null) continue;
    // Keep the original currency if a booking is subsequently changed to another currency.
    if (row.breakfast_currency !== row.currency) { otherCurrency++; continue; }
    if (mode === "hotel_extra") { hotelCost += amount; hotelPriced++; }
    else { selfCost += amount; selfPriced++; }
  }
  return { counts, meals, mealsKnown, hotelCost, selfCost, hotelPriced, selfPriced, otherCurrency };
}
export type HotelSummary = ReturnType<typeof summarizeStays>;
export function groupHotels(rows: HotelStay[], today: string) {
  const grouped = new Map<string, HotelStay[]>();
  for (const row of rows) {
    const key = hotelKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped].map(([key, stays]) => ({
    key, name: stays[0].hotel_name, city: stays[0].city, providerId: stays[0].provider_id,
    stays, ...summarizeStays(stays, today),
  }));
}
export function emptyHotelGroup(hotel: HotelDirectoryItem, today: string) {
  return { key: hotel.id, name: hotel.name, city: hotel.city, providerId: hotel.id, stays: [] as HotelStay[], ...summarizeStays([], today) };
}
export function monthlyCosts(rows: HotelStay[], from: string, to: string) {
  const months: { month: string; actual: bigint; estimated: bigint; known: number; bookings: number }[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (Number.isFinite(cursor.getTime()) && cursor.toISOString().slice(0, 7) <= to.slice(0, 7)) {
    const month = cursor.toISOString().slice(0, 7);
    const stays = rows.filter(row => row.check_in?.startsWith(month));
    const summary = summarizeStays(stays, to);
    months.push({ month, actual: summary.actual, estimated: summary.estimated, known: summary.pricedStays, bookings: stays.length });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
export function csvCell(value: string | number) {
  let text = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function hotelsCsv(headers: string[], rows: (string | number)[][]) {
  return "\uFEFF" + [headers, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n");
}
