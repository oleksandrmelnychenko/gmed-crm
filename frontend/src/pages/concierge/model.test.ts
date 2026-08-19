import { describe, expect, it } from "vitest";

import {
  buildConciergeAgenda,
  conciergeServiceColumn,
  conciergeWorkspaceStats,
  conciergeProviderAddress,
  conciergeProviderCategory,
  conciergePartnerEmailUrl,
  conciergePartnerPhoneUrl,
  conciergeServiceCostVariance,
  conciergeServiceDisplayTitle,
  conciergeTaskDisplayTitle,
  filterConciergeServices,
  filterConciergeProviders,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  nextConciergeTaskStatus,
  nextConciergeKeyActions,
  nextConciergeServiceStatus,
  sortConciergeProviders,
  sortConciergeServices,
  sortConciergeTasks,
  type ConciergeProvider,
  type ConciergeService,
  type ConciergeTask,
} from "./model";

function service(overrides: Partial<ConciergeService> = {}): ConciergeService {
  return {
    id: "service-1",
    patient_id: "patient-1",
    patient_name: "Anna Weber",
    patient_pid: "GM-101",
    appointment_id: null,
    appointment_title: null,
    provider_id: "provider-1",
    provider_name: "Berlin Mobility",
    taxonomy_node_code: "transfer",
    taxonomy_node_name_de: "Transfer",
    taxonomy_node_name_ru: "Трансфер",
    title: "Flughafentransfer",
    status: "planned",
    booking_reference: "BOOK-1",
    vendor_name: "City Driver",
    vendor_contact: "+49 30 123456",
    starts_at: "2026-08-19T08:00:00.000Z",
    ends_at: null,
    cost_estimate: "120.00",
    actual_cost: null,
    currency: "EUR",
    billing_status: "draft",
    key_status: null,
    key_responsible_user_id: null,
    key_responsible_user_name: null,
    key_status_at: null,
    request_source: "patient_portal",
    created_at: "2026-08-18T08:00:00.000Z",
    updated_at: "2026-08-18T08:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<ConciergeTask> = {}): ConciergeTask {
  return {
    id: "task-1",
    kind: "task",
    title: "Fahrer bestätigen",
    note: "Nur operative Angaben",
    assigned_to: "concierge-1",
    assigned_to_name: "Hans Becker",
    assigned_by: "manager-1",
    assigned_by_name: "Eva Manager",
    concierge_service_id: "service-1",
    due_at: "2026-08-19T10:00:00.000Z",
    starts_at: null,
    ends_at: null,
    location: null,
    priority: "high",
    status: "open",
    completed_at: null,
    created_at: "2026-08-18T08:00:00.000Z",
    updated_at: "2026-08-18T08:00:00.000Z",
    ...overrides,
  };
}

function provider(overrides: Partial<ConciergeProvider> = {}): ConciergeProvider {
  return {
    id: "provider-1",
    name: "City Driver",
    provider_type: "non_medical",
    address_street: "Leopoldstr. 1",
    address_city: "München",
    address_country: "Deutschland",
    phone: "+49 89 123",
    email: "office@example.test",
    opening_hours: null,
    taxonomy_node_id: "taxonomy-1",
    taxonomy_node: {
      id: "taxonomy-1",
      code: "nonmedical_chauffeur",
      name_de: "Chauffeur",
      name_ru: "Шофёр",
    },
    taxonomy_path: [],
    internal_rating: 4.8,
    avg_rating: 4.5,
    rating_count: 8,
    open_concierge_service_count: 3,
    is_active: true,
    ...overrides,
  };
}

describe("concierge workspace model", () => {
  it("groups operational statuses into the board columns", () => {
    expect(conciergeServiceColumn(service({ status: "planned" }))).toBe("requests");
    expect(conciergeServiceColumn(service({ status: "confirmed" }))).toBe("confirmed");
    expect(conciergeServiceColumn(service({ status: "in_service" }))).toBe("in_service");
    expect(conciergeServiceColumn(service({ status: "completed" }))).toBe("completed");
  });

  it("moves only active services through the supported workflow", () => {
    expect(nextConciergeServiceStatus("planned")).toBe("booked");
    expect(nextConciergeServiceStatus("booked")).toBe("confirmed");
    expect(nextConciergeServiceStatus("confirmed")).toBe("in_service");
    expect(nextConciergeServiceStatus("in_service")).toBe("completed");
    expect(nextConciergeServiceStatus("completed")).toBeNull();
    expect(nextConciergeServiceStatus("cancelled")).toBeNull();
  });

  it("offers only valid key custody transitions, including a new cycle after return", () => {
    expect(nextConciergeKeyActions(null)).toEqual(["received"]);
    expect(nextConciergeKeyActions("received")).toEqual([
      "stored",
      "handed_over",
      "returned",
    ]);
    expect(nextConciergeKeyActions("stored")).toEqual(["handed_over", "returned"]);
    expect(nextConciergeKeyActions("handed_over")).toEqual(["returned"]);
    expect(nextConciergeKeyActions("returned")).toEqual(["received"]);
  });

  it("calculates the queue without treating completed work as overdue", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const stats = conciergeWorkspaceStats(
      [
        service({ id: "overdue", starts_at: "2026-08-19T08:00:00.000Z" }),
        service({ id: "future", starts_at: "2026-08-20T08:00:00.000Z", billing_status: "ready" }),
        service({ id: "done", status: "completed", starts_at: "2026-08-19T07:00:00.000Z" }),
      ],
      now,
    );

    expect(stats).toEqual({ active: 2, today: 2, overdue: 1, readyForBilling: 1 });
  });

  it("calculates actual cost variance only when both amounts are valid", () => {
    expect(
      conciergeServiceCostVariance(
        service({ cost_estimate: "120.00", actual_cost: "135.50" }),
      ),
    ).toBe(15.5);
    expect(
      conciergeServiceCostVariance(
        service({ cost_estimate: "120.00", actual_cost: "110.00" }),
      ),
    ).toBe(-10);
    expect(conciergeServiceCostVariance(service({ actual_cost: null }))).toBeNull();
    expect(
      conciergeServiceCostVariance(
        service({ cost_estimate: "invalid", actual_cost: "110.00" }),
      ),
    ).toBeNull();
  });

  it("searches only operational contact and service fields", () => {
    const services = [service(), service({ id: "service-2", patient_name: "Max Bauer" })];
    expect(filterConciergeServices(services, "city driver").map((item) => item.id)).toEqual([
      "service-1",
      "service-2",
    ]);
    expect(filterConciergeServices(services, "anna").map((item) => item.id)).toEqual([
      "service-1",
    ]);
  });

  it("redacts appointment-linked service titles while retaining their service category", () => {
    const appointmentService = service({
      appointment_id: "appointment-1",
      title: "Sensitive medical detail",
      provider_name: "Sensitive clinic",
    });
    expect(conciergeServiceDisplayTitle(appointmentService, "de")).toBe("Transfer");
    expect(filterConciergeServices([appointmentService], "sensitive")).toEqual([]);
    expect(filterConciergeServices([appointmentService], "clinic")).toEqual([]);
    expect(
      conciergeServiceDisplayTitle(
        appointmentService,
        "ru",
      ),
    ).toBe("Трансфер");
  });

  it("orders scheduled work chronologically and leaves unscheduled work last", () => {
    const rows = sortConciergeServices([
      service({ id: "unscheduled", starts_at: null }),
      service({ id: "later", starts_at: "2026-08-20T08:00:00.000Z" }),
      service({ id: "earlier", starts_at: "2026-08-19T08:00:00.000Z" }),
    ]);
    expect(rows.map((item) => item.id)).toEqual(["earlier", "later", "unscheduled"]);
  });

  it("advances and sorts the concierge task queue", () => {
    expect(nextConciergeTaskStatus("open")).toBe("in_progress");
    expect(nextConciergeTaskStatus("in_progress")).toBe("completed");
    expect(nextConciergeTaskStatus("completed")).toBeNull();

    const rows = sortConciergeTasks([
      task({ id: "done", status: "completed", priority: "urgent" }),
      task({ id: "normal", priority: "normal" }),
      task({ id: "urgent", priority: "urgent" }),
    ]);
    expect(rows.map((item) => item.id)).toEqual(["urgent", "normal", "done"]);
  });

  it("builds a combined service and operational task agenda without clinical context", () => {
    const agenda = buildConciergeAgenda(
      [service()],
      [task(), task({ id: "cancelled", status: "cancelled" })],
      new Map(),
    );
    expect(agenda.map((item) => item.kind)).toEqual(["service", "task"]);
    expect(agenda[1]).toMatchObject({ title: "Fahrer bestätigen", patientName: null });
    expect(agenda[1]).not.toHaveProperty("description");
  });

  it("uses the dedicated operational title without introducing clinical links", () => {
    expect(conciergeTaskDisplayTitle(task({ title: "Sensitive medical detail" }), "de")).toBe(
      "Sensitive medical detail",
    );
    const operational = task();
    expect(operational).not.toHaveProperty("patient_id");
    expect(operational).not.toHaveProperty("order_id");
    expect(operational).not.toHaveProperty("appointment_id");
  });

  it("creates encoded Google Maps links without an API key", () => {
    const address = conciergeProviderAddress(provider());
    expect(address).toBe("Leopoldstr. 1, München, Deutschland");
    expect(googleMapsSearchUrl(address)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Leopoldstr.%201%2C%20M%C3%BCnchen%2C%20Deutschland",
    );
    expect(googleMapsDirectionsUrl(address)).toContain(
      "destination=Leopoldstr.%201%2C%20M%C3%BCnchen%2C%20Deutschland",
    );
    expect(googleMapsDirectionsUrl("")).toBeNull();
  });

  it("creates safe partner call and email actions", () => {
    expect(conciergePartnerPhoneUrl("+49 (89) 123-45")).toBe("tel:+498912345");
    expect(conciergePartnerPhoneUrl("  ")).toBeNull();
    expect(conciergePartnerEmailUrl("booking@example.test")).toBe(
      "mailto:booking@example.test",
    );
    expect(conciergePartnerEmailUrl("bad address@example.test")).toBeNull();
  });

  it("categorizes, filters and ranks non-medical recommendations", () => {
    const restaurant = provider({
      id: "restaurant",
      name: "Bavaria Restaurant",
      internal_rating: 5,
      taxonomy_node: {
        id: "taxonomy-restaurant",
        code: "nonmedical_restaurants",
        name_de: "Restaurants",
        name_ru: "Рестораны",
      },
    });
    const driver = provider({ id: "driver", internal_rating: 4.8 });
    expect(conciergeProviderCategory(restaurant)).toBe("restaurants");
    expect(conciergeProviderCategory(driver)).toBe("drivers");
    expect(filterConciergeProviders([driver, restaurant], "restaurants", "bavaria")).toEqual([
      restaurant,
    ]);
    expect(sortConciergeProviders([driver, restaurant]).map((item) => item.id)).toEqual([
      "restaurant",
      "driver",
    ]);
  });
});
