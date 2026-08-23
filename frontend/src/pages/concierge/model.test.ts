import { describe, expect, it } from "vitest";

import {
  buildConciergeAgenda,
  buildConciergeRouteStops,
  buildGoogleMapsRoutePlan,
  conciergeServiceColumn,
  conciergeWorkspaceStats,
  conciergeProviderAddress,
  conciergeServiceRouteAddress,
  conciergeProviderCategory,
  conciergePartnerEmailUrl,
  conciergePartnerPhoneUrl,
  conciergeServiceCostVariance,
  conciergeServiceDisplayTitle,
  conciergeTaskDisplayTitle,
  filterConciergeServices,
  filterConciergeTasks,
  filterConciergeTaskAssignees,
  filterConciergeProviders,
  eligibleConciergeServicesForProvider,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  nextConciergeTaskStatus,
  nextConciergeKeyActions,
  nextConciergeServiceStatus,
  sortConciergeProviders,
  sortConciergeServices,
  sortConciergeTasks,
  conciergeTaskWorkload,
  type ConciergeProvider,
  type ConciergeService,
  type ConciergeTask,
  type ConciergeAssignee,
} from "./model";

describe("filterConciergeTaskAssignees", () => {
  it("keeps active Concierge, CEO and accounting users", () => {
    const users: ConciergeAssignee[] = [
      { id: "1", name: "Concierge", email: "c@test", role: "concierge", is_active: true },
      { id: "2", name: "CEO", email: "ceo@test", role: "ceo", is_active: true },
      { id: "3", name: "Billing", email: "b@test", role: "billing", is_active: true },
      { id: "4", name: "Patient", email: "p@test", role: "patient", is_active: true },
      { id: "5", name: "Inactive", email: "i@test", role: "billing", is_active: false },
    ];

    expect(filterConciergeTaskAssignees(users).map((user) => user.role).sort()).toEqual([
      "billing",
      "ceo",
      "concierge",
    ]);
  });
});

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
    assigned_concierge_id: "concierge-1",
    assigned_concierge_name: "Hans Becker",
    taxonomy_node_code: "transfer",
    taxonomy_node_name_de: "Transfer",
    taxonomy_node_name_ru: "Трансфер",
    title: "Flughafentransfer",
    status: "planned",
    booking_reference: "BOOK-1",
    vendor_name: "City Driver",
    vendor_contact: "+49 30 123456",
    service_address: null,
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
    reminder_at: null,
    reminder_sent_at: null,
    checklist_total: 0,
    checklist_completed: 0,
    comment_count: 0,
    completed_at: null,
    created_at: "2026-08-18T08:00:00.000Z",
    updated_at: "2026-08-18T08:00:00.000Z",
    task_audience: "internal",
    patient_id: null,
    patient_name: null,
    external_assignee_type: null,
    external_assignee_name: null,
    external_assignee_phone: null,
    external_assignee_email: null,
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
  it("filters task-manager rows by assignee, timing and plain-language search", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const rows = [
      task({ id: "overdue", assigned_to: "concierge-1", due_at: "2026-08-19T10:00:00.000Z" }),
      task({ id: "other", assigned_to: "concierge-2", assigned_to_name: "Maria", title: "Restaurant bestätigen", due_at: "2026-08-20T10:00:00.000Z" }),
    ];
    expect(filterConciergeTasks(rows, {
      query: "fahrer",
      assignee: "concierge-1",
      status: "all",
      priority: "all",
      kind: "all",
      audience: "all",
      timing: "overdue",
    }, now).map((item) => item.id)).toEqual(["overdue"]);
  });

  it("calculates manager workload for each Concierge", () => {
    const assignees: ConciergeAssignee[] = [
      { id: "concierge-1", name: "Hans", email: "hans@example.test", role: "concierge", is_active: true },
      { id: "concierge-2", name: "Maria", email: "maria@example.test", role: "concierge", is_active: true },
    ];
    const workload = conciergeTaskWorkload([
      task({ id: "a", assigned_to: "concierge-1", due_at: "2026-08-19T10:00:00.000Z" }),
      task({ id: "b", assigned_to: "concierge-1", due_at: "2026-08-20T10:00:00.000Z" }),
      task({ id: "c", assigned_to: "concierge-2", status: "completed" }),
    ], assignees, new Date("2026-08-19T12:00:00.000Z"));
    expect(workload.map(({ assignee, active, overdue }) => ({ id: assignee.id, active, overdue }))).toEqual([
      { id: "concierge-1", active: 2, overdue: 1 },
      { id: "concierge-2", active: 0, overdue: 0 },
    ]);
  });

  it("groups operational statuses into the board columns", () => {
    expect(conciergeServiceColumn(service({ status: "planned" }))).toBe("requests");
    expect(conciergeServiceColumn(service({ status: "confirmed" }))).toBe("confirmed");
    expect(conciergeServiceColumn(service({ status: "in_service" }))).toBe("in_service");
    expect(conciergeServiceColumn(service({ status: "completed" }))).toBe("completed");
  });

  it("moves only active services through the supported workflow", () => {
    expect(nextConciergeServiceStatus("planned")).toBeNull();
    expect(nextConciergeServiceStatus("booked")).toBeNull();
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
    expect(
      filterConciergeServices(
        [service({ service_address: "Terminal 1, München" })],
        "terminal 1",
      ),
    ).toHaveLength(1);
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

  it("uses the operational title and allows an optional patient link", () => {
    expect(conciergeTaskDisplayTitle(task({ title: "Sensitive medical detail" }), "de")).toBe(
      "Sensitive medical detail",
    );
    const operational = task();
    expect(operational.patient_id).toBeNull();
    expect(operational).not.toHaveProperty("order_id");
    expect(operational).not.toHaveProperty("appointment_id");

    const patientTask = task({ patient_id: "patient-1", patient_name: "Anna Weber" });
    expect(patientTask).toMatchObject({
      patient_id: "patient-1",
      patient_name: "Anna Weber",
    });
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

  it("builds chronological route stops from active services, tasks and events only", () => {
    const selectedProvider = provider();
    const stops = buildConciergeRouteStops(
      [
        service({ id: "later-service", starts_at: "2026-08-19T11:00:00.000Z" }),
        service({ id: "done-service", status: "completed", starts_at: "2026-08-19T07:00:00.000Z" }),
        service({ id: "other-day", starts_at: "2026-08-20T08:00:00.000Z" }),
      ],
      [
        task({ id: "early-task", due_at: "2026-08-19T08:00:00.000Z", location: "Terminal 1" }),
        task({ id: "event", kind: "event", starts_at: "2026-08-19T09:00:00.000Z", location: "Hotel Mitte" }),
        task({ id: "cancelled", status: "cancelled", due_at: "2026-08-19T06:00:00.000Z" }),
      ],
      new Map([[selectedProvider.id, selectedProvider]]),
      "2026-08-19",
    );

    expect(stops.map((stop) => stop.id)).toEqual([
      "task:early-task",
      "event:event",
      "service:later-service",
    ]);
    expect(stops[2].address).toBe("Leopoldstr. 1, München, Deutschland");
    expect(stops.every((stop) => !("patientName" in stop))).toBe(true);
  });

  it("deduplicates route addresses and reports missing or oversized stops", () => {
    const plan = buildGoogleMapsRoutePlan([
      { id: "a", kind: "service", title: "Transfer", scheduledAt: "2026-08-19T08:00:00Z", address: "Terminal 1, München" },
      { id: "b", kind: "task", title: "Fahrer treffen", scheduledAt: "2026-08-19T09:00:00Z", address: " terminal 1,   MÜNCHEN " },
      { id: "missing", kind: "event", title: "Übergabe", scheduledAt: "2026-08-19T10:00:00Z", address: null },
      { id: "long", kind: "service", title: "Lang", scheduledAt: "2026-08-19T11:00:00Z", address: "x".repeat(500) },
    ], 9, 300);

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].stopIds).toEqual(["a"]);
    expect(plan.duplicateAddressStopIds).toEqual(["b"]);
    expect(plan.missingAddressStopIds).toEqual(["missing"]);
    expect(plan.tooLongStopIds).toEqual(["long"]);
  });

  it("splits long daily routes into ordered Google Maps segments", () => {
    const stops = ["A", "B", "C", "D", "E"].map((address, index) => ({
      id: address.toLocaleLowerCase(),
      kind: "task" as const,
      title: address,
      scheduledAt: `2026-08-19T${String(index + 8).padStart(2, "0")}:00:00Z`,
      address: `${address} Straße 1, Berlin`,
    }));
    const plan = buildGoogleMapsRoutePlan(stops, 2);

    expect(plan.segments.map((segment) => segment.stopIds)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
    expect(plan.segments[1].url).toContain("origin=B+Stra%C3%9Fe+1%2C+Berlin");
    expect(plan.segments.every((segment) => segment.url.length <= 1_900)).toBe(true);
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

  it("offers only planned or requested services that can use the selected partner", () => {
    const rows = eligibleConciergeServicesForProvider(
      [
        service({ id: "unlinked", provider_id: null, starts_at: "2026-08-19T07:00:00.000Z" }),
        service({ id: "same", status: "booked", provider_id: "provider-1" }),
        service({ id: "other", provider_id: "provider-2" }),
        service({ id: "confirmed", status: "confirmed", provider_id: "provider-1" }),
      ],
      "provider-1",
    );

    expect(rows.map((item) => item.id)).toEqual(["unlinked", "same"]);
  });

  it("uses a service-specific destination before the provider profile address", () => {
    const selectedProvider = provider();
    expect(
      conciergeServiceRouteAddress(
        service({ service_address: "Terminal 1, München" }),
        selectedProvider,
      ),
    ).toBe("Terminal 1, München");
    expect(conciergeServiceRouteAddress(service(), selectedProvider)).toBe(
      "Leopoldstr. 1, München, Deutschland",
    );
  });
});
