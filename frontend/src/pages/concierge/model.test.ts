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
  conciergeTaskErrorMessage,
  conciergeTaskCode,
  conciergeOperationalItemsListPath,
  conciergeTasksAssignedToActor,
  conciergeTasksVisibleToActor,
  assignableConciergeTaskUsers,
  availableConciergeTaskStatuses,
  availableConciergeServiceStatuses,
  canAssignConciergeTaskToRole,
  canChangeConciergeTaskStatus,
  canDeleteConciergeTask,
  canModifyConciergeTask,
  filterConciergeServices,
  filterConciergeTasks,
  filterConciergeTaskAssignees,
  filterConciergeProviders,
  eligibleConciergeServicesForProvider,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  nextConciergeTaskStatus,
  nextConciergeKeyActions,
  isConciergeKeyService,
  nextConciergeServiceStatus,
  sortConciergeProviders,
  sortConciergeServices,
  sortConciergeTasks,
  conciergeTaskWorkload,
  unconvertedConciergeServices,
  type ConciergeProvider,
  type ConciergeService,
  type ConciergeTask,
  type ConciergeAssignee,
} from "./model";

describe("filterConciergeTaskAssignees", () => {
  it("keeps every active role in the task hierarchy", () => {
    const users: ConciergeAssignee[] = [
      { id: "1", name: "Concierge", email: "c@test", role: "concierge", is_active: true },
      { id: "2", name: "CEO", email: "ceo@test", role: "ceo", is_active: true },
      { id: "3", name: "Billing", email: "b@test", role: "billing", is_active: true },
      { id: "4", name: "Assistant", email: "a@test", role: "ceo_assistant", is_active: true },
      { id: "5", name: "Manager", email: "m@test", role: "patient_manager", is_active: true },
      { id: "6", name: "Sales", email: "s@test", role: "sales", is_active: true },
      { id: "7", name: "Lead", email: "l@test", role: "teamlead_interpreter", is_active: true },
      { id: "8", name: "Interpreter", email: "i@test", role: "interpreter", is_active: true },
      { id: "9", name: "Patient", email: "p@test", role: "patient", is_active: true },
      { id: "10", name: "Inactive", email: "x@test", role: "billing", is_active: false },
    ];

    expect(filterConciergeTaskAssignees(users).map((user) => user.role).sort()).toEqual([
      "billing",
      "ceo",
      "ceo_assistant",
      "concierge",
      "interpreter",
      "patient_manager",
      "sales",
      "teamlead_interpreter",
    ]);
  });

  it("localizes task permission errors returned by the API", () => {
    const error = new Error(
      "Only the task creator or a higher role can change this task",
    );

    expect(conciergeTaskErrorMessage(error, "ru", "fallback")).toBe(
      "Изменять задачу может только её автор или сотрудник с более высокой ролью.",
    );
    expect(conciergeTaskErrorMessage(error, "de", "fallback")).toBe(
      "Nur der Ersteller oder eine Person mit einer höheren Rolle darf diese Aufgabe ändern.",
    );
    expect(
      conciergeTaskErrorMessage(
        new Error("Only the task assignee, creator, or a higher role can change task status"),
        "ru",
        "fallback",
      ),
    ).toBe("Статус задачи может менять исполнитель, автор или сотрудник с более высокой ролью.");
    expect(
      conciergeTaskErrorMessage(new Error("Specific error"), "ru", "fallback"),
    ).toBe("Specific error");
    expect(
      conciergeTaskErrorMessage(new Error("Operational item not found"), "ru", "fallback"),
    ).toBe("Задача не найдена. Возможно, она была удалена или относится к старому рабочему процессу.");
    expect(
      conciergeTaskErrorMessage(new Error("Invalid task status transition"), "ru", "fallback"),
    ).toBe("Этот переход между статусами недоступен. Используйте следующий этап рабочего процесса.");
    expect(
      conciergeTaskErrorMessage(
        new Error("Only an untouched open task can be deleted; cancel or archive it instead"),
        "ru",
        "fallback",
      ),
    ).toBe("Удалить можно только ошибочно созданную открытую задачу без комментариев, чек-листа и файлов.");
    expect(conciergeTaskErrorMessage(null, "ru", "fallback")).toBe("fallback");
    expect(
      conciergeTaskErrorMessage(
        new Error("concierge_service_id must reference an assigned non-medical service"),
        "ru",
        "fallback",
      ),
    ).toBe("Выбранный сервис не подходит для этой задачи. Выберите немедицинский сервис, назначенный текущему исполнителю.");
    expect(
      conciergeTaskErrorMessage(
        new Error("Concierge service request already converted to a task"),
        "ru",
        "fallback",
      ),
    ).toBe("Этот запрос уже преобразован в задачу. Откройте созданную задачу в менеджере задач.");
  });

  it("keeps concierge and interpreter assignment branches separate", () => {
    const users: ConciergeAssignee[] = [
      { id: "ceo", name: "CEO", email: "ceo@test", role: "ceo", is_active: true },
      { id: "billing", name: "Billing", email: "billing@test", role: "billing", is_active: true },
      { id: "concierge", name: "Concierge", email: "concierge@test", role: "concierge", is_active: true },
      { id: "lead", name: "Lead", email: "lead@test", role: "teamlead_interpreter", is_active: true },
      { id: "interpreter", name: "Interpreter", email: "interpreter@test", role: "interpreter", is_active: true },
    ];

    expect(canAssignConciergeTaskToRole("teamlead_interpreter", "interpreter")).toBe(true);
    expect(canAssignConciergeTaskToRole("teamlead_interpreter", "billing")).toBe(false);
    expect(assignableConciergeTaskUsers(users, "lead", "teamlead_interpreter").map((user) => user.id).sort()).toEqual([
      "interpreter",
      "lead",
    ]);
    expect(canAssignConciergeTaskToRole("concierge", "interpreter")).toBe(false);
    expect(canAssignConciergeTaskToRole("billing", "concierge")).toBe(true);
    expect(canAssignConciergeTaskToRole("billing", "teamlead_interpreter")).toBe(false);
  });

  it("allows only the creator or a strictly higher role to modify a task", () => {
    const createdByConcierge = task({ assigned_by: "creator", assigned_by_role: "concierge" });
    expect(canModifyConciergeTask(createdByConcierge, "creator", "concierge")).toBe(true);
    expect(canModifyConciergeTask(createdByConcierge, "peer", "concierge")).toBe(false);
    expect(canModifyConciergeTask(createdByConcierge, "manager", "patient_manager")).toBe(true);
    expect(canModifyConciergeTask(task({ assigned_by_role: "billing" }), "lead", "teamlead_interpreter")).toBe(false);
    expect(canModifyConciergeTask(task({ assigned_by_role: null }), "ceo", "ceo")).toBe(true);
  });

  it("allows the assignee to change status without granting full edit rights", () => {
    const assignedTask = task({
      assigned_by: "creator",
      assigned_by_role: "patient_manager",
      assigned_to: "assignee",
    });

    expect(canModifyConciergeTask(assignedTask, "assignee", "concierge")).toBe(false);
    expect(canChangeConciergeTaskStatus(assignedTask, "assignee", "concierge")).toBe(true);
    expect(canChangeConciergeTaskStatus(assignedTask, "peer", "concierge")).toBe(false);
    expect(canChangeConciergeTaskStatus(assignedTask, "ceo", "ceo")).toBe(true);
    expect(availableConciergeTaskStatuses(assignedTask, "assignee", "concierge")).toEqual([
      "open",
      "in_progress",
    ]);
    expect(availableConciergeTaskStatuses(
      task({ status: "review", assigned_by: "creator", assigned_by_role: "concierge" }),
      "manager",
      "patient_manager",
    )).toEqual(["review", "in_progress", "completed", "cancelled"]);
  });

  it("deletes only untouched open tasks", () => {
    const untouched = task({ assigned_by: "creator", assigned_by_role: "concierge" });
    expect(canDeleteConciergeTask(untouched, "creator", "concierge")).toBe(true);
    expect(canDeleteConciergeTask({ ...untouched, status: "completed" }, "creator", "concierge")).toBe(false);
    expect(canDeleteConciergeTask({ ...untouched, comment_count: 1 }, "creator", "concierge")).toBe(false);
  });
});

describe("conciergeOperationalItemsListPath", () => {
  it("delegates task visibility to the server-side permission scope", () => {
    expect(conciergeOperationalItemsListPath("concierge-1", "concierge")).toBe(
      "/concierge-operational-items?archive=all",
    );
  });

  it("keeps the shared task queue for management roles", () => {
    expect(conciergeOperationalItemsListPath("ceo-1", "ceo")).toBe(
      "/concierge-operational-items?archive=all",
    );
  });
});

describe("personal task scopes", () => {
  const rows = [
    task({ id: "assigned", assigned_to: "actor", assigned_by: "manager" }),
    task({ id: "created", assigned_to: "other", assigned_by: "actor" }),
    task({ id: "foreign", assigned_to: "other", assigned_by: "manager" }),
  ];

  it("keeps an executor task manager limited to assigned or created tasks", () => {
    expect(conciergeTasksVisibleToActor(rows, "actor", "concierge").map((item) => item.id)).toEqual([
      "assigned",
      "created",
    ]);
    expect(conciergeTasksVisibleToActor(rows, "actor", "interpreter").map((item) => item.id)).toEqual([
      "assigned",
      "created",
    ]);
  });

  it("keeps the workspace preview strictly limited to assigned tasks", () => {
    expect(conciergeTasksAssignedToActor(rows, "actor").map((item) => item.id)).toEqual([
      "assigned",
    ]);
  });

  it("leaves management queues to the server-side hierarchy", () => {
    expect(conciergeTasksVisibleToActor(rows, "manager", "patient_manager")).toEqual(rows);
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
    archived_at: null,
    archived_by: null,
    archived_by_name: null,
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
  it("builds a stable human-readable task code", () => {
    expect(conciergeTaskCode(task({ id: "cba1c6d0-e03d-4087-88d0-9eb825893864" }))).toBe("TASK-CBA1C6D0");
  });

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
      archive: "active",
    }, now).map((item) => item.id)).toEqual(["overdue"]);

    expect(filterConciergeTasks(rows, {
      query: "TASK-OVERDUE",
      assignee: "all",
      status: "all",
      priority: "all",
      kind: "all",
      audience: "all",
      timing: "all",
      archive: "active",
    }, now).map((item) => item.id)).toEqual(["overdue"]);
  });

  it("separates active, archived and combined task-manager rows", () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const rows = [
      task({ id: "active", status: "completed" }),
      task({
        id: "archived",
        status: "completed",
        archived_at: "2026-08-23T11:00:00.000Z",
        archived_by: "manager-1",
      }),
    ];
    const filters = {
      query: "",
      assignee: "all",
      status: "all",
      priority: "all",
      kind: "all",
      audience: "all",
      timing: "all" as const,
    };

    expect(filterConciergeTasks(rows, { ...filters, archive: "active" }, now).map((item) => item.id)).toEqual(["active"]);
    expect(filterConciergeTasks(rows, { ...filters, archive: "archived" }, now).map((item) => item.id)).toEqual(["archived"]);
    expect(filterConciergeTasks(rows, { ...filters, archive: "all" }, now).map((item) => item.id)).toEqual(["active", "archived"]);
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
    expect(conciergeServiceColumn(service({ status: "planned" }))).toBe("planned");
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

  it("exposes only valid service lifecycle transitions and privileged reopen actions", () => {
    expect(availableConciergeServiceStatuses(service({ status: "planned" }))).toEqual([
      "planned",
      "in_service",
      "cancelled",
    ]);
    expect(availableConciergeServiceStatuses(service({ status: "completed" }))).toEqual(["completed"]);
    expect(availableConciergeServiceStatuses(service({ status: "completed" }), true)).toEqual([
      "completed",
      "in_service",
    ]);
  });

  it("shows key custody only for explicitly key-related services", () => {
    expect(isConciergeKeyService(service({ title: "Schlüssel vom Hotel abholen" }))).toBe(true);
    expect(isConciergeKeyService(service({ title: "Restaurant reservieren" }))).toBe(false);
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

  it("removes a converted request from the service intake workspace", () => {
    const rows = [
      service({ id: "new-request", linked_task_id: null }),
      service({ id: "converted-request", linked_task_id: "task-1" }),
    ];
    expect(unconvertedConciergeServices(rows).map((item) => item.id)).toEqual(["new-request"]);
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
    expect(nextConciergeTaskStatus("in_progress")).toBe("review");
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
    const medical = provider({ id: "medical", provider_type: "medical" });
    expect(
      filterConciergeProviders([driver, medical], "all", "", "medical").map((item) => item.id),
    ).toEqual(["medical"]);
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
