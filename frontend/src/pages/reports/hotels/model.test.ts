import { describe, expect, it } from "vitest";
import { canAccessStaffRoute } from "@/lib/staff-route-access";
import { decimal, emptyBreakfast, filterHotelStays, groupHotels, hotelsCsv, initialFilters, matchesStaySearch, moneyCents, monthlyCosts, stayCost, stayNights, summarizeBreakfast, summarizeStays, type HotelStay } from "./model";

const today = "2026-09-10";
function stay(overrides: Partial<HotelStay> = {}): HotelStay {
  return { ...emptyBreakfast, patient_name: "Test Patient", patient_number: "P-001", booking_reference: "BOOK-001", id: "stay1", source: "service", task_id: null, patient_id: "p1", provider_id: "h1", hotel_name: "Hotel A", city: "Berlin", status: "completed", check_in: "2026-03-28", check_out: "2026-03-30", room_count: 1, details_updated_at: null, currency: "EUR", actual_cost: "200.00", cost_estimate: "250.00", posted_cost: "0.00", posted_count: 0, direct_paid: "0.00", company_paid: "0.00", provider_due: "0.00", pending_cost: "0.00", pending_count: 0, ...overrides };
}
describe("hotel negotiation statistics", () => {
  it("finds stays by patient name, public patient number and booking reference", () => {
    for (const query of [" test PATIENT ", "p-001", "book-001", ""]) expect(matchesStaySearch(stay(), query)).toBe(true);
    expect(matchesStaySearch(stay(), "missing")).toBe(false);
    expect(matchesStaySearch(stay({ patient_name: null, patient_number: null, booking_reference: null }), "test")).toBe(false);
  });
  it("reports breakfasts independently without duplicating included prices or accounting payments", () => {
    const rows = [stay({ breakfast_mode: "included", breakfast_count: 4 }), stay({ breakfast_mode: "self", breakfast_total: "25.40", breakfast_currency: "EUR", breakfast_payer: "patient" }), stay({ breakfast_mode: "hotel_extra", breakfast_total: "10.00", breakfast_currency: "EUR", breakfast_count: 2 }), stay()];
    const summary = summarizeStays(rows, today);
    expect(summary.total).toBe(80000n); expect(summary.direct).toBe(0n); expect(summary.company).toBe(0n);
    expect(summary.breakfast.counts).toEqual({ included: 1, self: 1, hotel_extra: 1, unknown: 1, none: 0 });
    expect(summary.breakfast.selfCost).toBe(2540n); expect(summary.breakfast.hotelCost).toBe(1000n);
    expect(summary.breakfast.meals).toBe(6); expect(summary.breakfast.mealsKnown).toBe(2);
    expect(filterHotelStays(rows, { ...initialFilters, breakfast: "self" }, today)).toEqual([rows[1]]);
  });
  it("distinguishes missing breakfast costs from zero, excludes cancellations and preserves changed currencies", () => {
    const summary = summarizeBreakfast([stay({ breakfast_mode: "hotel_extra", breakfast_total: "0.00", breakfast_currency: "EUR" }), stay({ breakfast_mode: "self" }), stay({ status: "cancelled", breakfast_mode: "included", breakfast_count: 100 }), stay({ breakfast_mode: "hotel_extra", breakfast_total: "20.00", breakfast_currency: "USD" })]);
    expect(summary.hotelPriced).toBe(1); expect(summary.hotelCost).toBe(0n); expect(summary.selfPriced).toBe(0);
    expect(summary.otherCurrency).toBe(1); expect(summary.counts.included).toBe(0); expect(summary.mealsKnown).toBe(0);
  });
  it("counts unique patients across hotels and keeps over 200 bookings", () => {
    const rows = Array.from({ length: 250 }, (_, i) => stay({ id: String(i), patient_id: `p${i % 200}`, provider_id: `h${i % 2}` }));
    const total = summarizeStays(rows, today);
    expect(total.patients).toBe(200); expect(total.bookings).toBe(250);
    expect(total.total).toBe(5000000n); expect(total.roomNights).toBe(500);
    expect(groupHotels(rows, today).reduce((sum, row) => sum + row.total, 0n)).toBe(total.total);
  });
  it("counts calendar nights across daylight saving and rejects missing or invalid dates", () => {
    expect(stayNights(stay())).toBe(2);
    expect(stayNights(stay({ check_in: "2026-10-24", check_out: "2026-10-26" }))).toBe(2);
    expect(stayNights(stay({ check_out: "2026-03-28" }))).toBeNull();
    expect(stayNights(stay({ check_out: null }))).toBeNull();
    expect(stayNights(stay({ check_in: "2026-02-30" }))).toBeNull();
  });
  it("does not guess rooms or replace unknown costs with zero", () => {
    const result = summarizeStays([stay({ room_count: null, actual_cost: null, cost_estimate: null })], today);
    expect(result.roomsKnown).toBe(0); expect(result.averageRoomNight).toBeNull();
    expect(result.costsMissing).toBe(1); expect(result.pricedStays).toBe(0);
    expect(stayCost(stay({ actual_cost: "0.00" }))).toEqual({ cents: 0n, estimated: false });
    expect(stayCost(stay({ actual_cost: null }))).toEqual({ cents: 25000n, estimated: true });
  });
  it("weights the average by room nights of the same priced bookings", () => {
    const result = summarizeStays([stay({ room_count: 2, actual_cost: "400.00" }), stay({ actual_cost: "300.00" }), stay({ room_count: null, actual_cost: "900.00" }), stay({ actual_cost: null, cost_estimate: null })], today);
    expect(result.total).toBe(160000n); expect(result.roomNights).toBe(8);
    expect(result.averageRoomNight).toBe(11667n); // 700 / 6 priced room nights.
  });
  it("retains cancellation fees but excludes cancelled estimated stays and nights", () => {
    const result = summarizeStays([stay({ status: "cancelled", actual_cost: "30.00" }), stay({ status: "cancelled", actual_cost: null })], today);
    expect(result.nights).toBe(0); expect(result.roomNights).toBe(0); expect(result.total).toBe(3000n);
  });
  it("keeps payment flows independent of the stay price and pending submissions", () => {
    const result = summarizeStays([stay({ direct_paid: "100.00", company_paid: "40.00", provider_due: "60.00", pending_cost: "200.00" })], today);
    expect(result.total).toBe(20000n); expect(result.direct).toBe(10000n); expect(result.company).toBe(4000n); expect(result.due).toBe(6000n); expect(result.pending).toBe(20000n);
  });
  it("intersects hotel, city, status, search and currency without mixing currencies", () => {
    const rows = [stay(), stay({ currency: "USD" }), stay({ status: "cancelled" }), stay({ status: "planned" }), stay({ hotel_name: "Other", provider_id: "h2", city: "Munich" })];
    expect(filterHotelStays(rows, initialFilters, today)).toHaveLength(2);
    expect(filterHotelStays(rows, { ...initialFilters, hotel: "h1", city: "Berlin", search: "hotel" }, today)).toHaveLength(1);
    expect(filterHotelStays(rows, { ...initialFilters, status: "all" }, today)).toHaveLength(4);
    expect(filterHotelStays([stay({ status: "confirmed", check_in: "2026-10-01" }), stay({ status: "planned", check_in: "2026-10-01" })], { ...initialFilters, status: "future" }, today)).toHaveLength(1);
  });
  it("attributes entire stays to arrival month and shows gaps for unpriced bookings", () => {
    const months = monthlyCosts([stay({ check_in: "2026-03-31", check_out: "2026-04-04" }), stay({ actual_cost: null, cost_estimate: null, check_in: "2026-04-10" })], "2026-03-01", "2026-05-31");
    expect(months.map(row => [row.actual, row.known, row.bookings])).toEqual([[20000n, 1, 1], [0n, 0, 1], [0n, 0, 0]]);
  });
  it("uses exact cents and exports safe quoted CSV", () => {
    expect(decimal(moneyCents("9999999999.99")! * 1000n)).toBe("9999999999990.00");
    expect(moneyCents("NaN")).toBeNull(); expect(moneyCents("1.001")).toBeNull();
    const csv = hotelsCsv(["Hotel", "Cost"], [["=HYPERLINK(\"bad\")", "10.00"], ["Hotel; A", ""]]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"'); expect(csv).toContain('"Hotel; A";""');
  });
  it("restricts the hotel screen to the corresponding reporting roles", () => {
    for (const role of ["ceo", "ceo_assistant", "billing", "patient_manager", "concierge"]) {
      expect(canAccessStaffRoute(role, "/hotels")).toBe(true);
      expect(canAccessStaffRoute(role, "/reports/hotels")).toBe(true);
    }
    for (const role of ["patient", "sales", "interpreter"]) expect(canAccessStaffRoute(role, "/hotels")).toBe(false);
  });
});
