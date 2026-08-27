export const CONCIERGE_SERVICE_STATUSES = [
  "planned",
  "booked",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
] as const;

export type ConciergeServiceStatus = (typeof CONCIERGE_SERVICE_STATUSES)[number];

export const CONCIERGE_KEY_ACTIONS = [
  "received",
  "stored",
  "handed_over",
  "returned",
] as const;

export type ConciergeKeyAction = (typeof CONCIERGE_KEY_ACTIONS)[number];

export type ConciergeService = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_id: string | null;
  assigned_concierge_name: string | null;
  taxonomy_node_code: string | null;
  taxonomy_node_name_de: string | null;
  taxonomy_node_name_ru: string | null;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  service_address: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
  service_notes?: string | null;
  key_status: ConciergeKeyAction | null;
  key_responsible_user_id: string | null;
  key_responsible_user_name: string | null;
  key_status_at: string | null;
  request_source: string;
  created_at: string;
  updated_at: string;
};

export type ConciergeKeyEvent = {
  id: string;
  concierge_service_id: string;
  action: ConciergeKeyAction;
  responsible_user_id: string;
  responsible_user_name: string;
  occurred_at: string;
  note: string | null;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
};

export type RecordConciergeKeyEventResponse = {
  event: ConciergeKeyEvent;
  key_status: ConciergeKeyAction;
  key_responsible_user_id: string;
  key_responsible_user_name: string;
  key_status_at: string;
};

export const CONCIERGE_PARTNER_CHANNELS = [
  "phone",
  "email",
  "messaging",
  "in_person",
  "other",
] as const;

export type ConciergePartnerChannel = (typeof CONCIERGE_PARTNER_CHANNELS)[number];
export type ConciergePartnerDirection = "outbound" | "inbound";
export type ConciergePartnerOutcome =
  | "no_answer"
  | "reached"
  | "quote_requested"
  | "quote_received"
  | "follow_up_needed"
  | "booking_requested"
  | "booking_confirmed"
  | "declined"
  | "cancelled";

export type ConciergePartnerInteraction = {
  id: string;
  concierge_service_id: string;
  provider_id: string;
  provider_name: string;
  channel: ConciergePartnerChannel;
  direction: ConciergePartnerDirection;
  outcome: ConciergePartnerOutcome;
  occurred_at: string;
  contact_person: string | null;
  note: string | null;
  quoted_cost: string | null;
  quoted_currency: string | null;
  applied_as_cost_estimate_at: string | null;
  applied_by: string | null;
  applied_by_name: string | null;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
};

export type ApplyPartnerQuoteResponse = {
  interaction_id: string;
  cost_estimate: string;
  currency: string;
  applied_as_cost_estimate_at: string;
  applied_by: string;
  applied_by_name: string;
};

export type ConciergeTask = {
  id: string;
  kind: "task" | "event";
  title: string;
  note: string | null;
  assigned_to: string;
  assigned_to_name: string;
  assigned_by: string;
  assigned_by_name: string;
  assigned_by_role?: string | null;
  concierge_service_id: string | null;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  priority: string;
  status: string;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  checklist_total: number;
  checklist_completed: number;
  comment_count: number;
  completed_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
  created_at: string;
  updated_at: string;
  task_audience: "internal" | "external";
  patient_id: string | null;
  patient_name: string | null;
  patient_birth_date: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  provider_email: string | null;
  external_assignee_type: string | null;
  external_assignee_name: string | null;
  external_assignee_phone: string | null;
  external_assignee_email: string | null;
};

export type ConciergeAssignee = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export const TASK_MANAGER_ROLES = [
  "ceo",
  "ceo_assistant",
  "billing",
  "patient_manager",
  "sales",
  "concierge",
  "teamlead_interpreter",
  "interpreter",
] as const;

const TASK_MANAGER_ROLE_SET = new Set<string>(TASK_MANAGER_ROLES);

const TASK_ROLE_LEVEL: Record<string, number> = {
  interpreter: 1,
  concierge: 2,
  teamlead_interpreter: 2,
  ceo_assistant: 3,
  billing: 3,
  patient_manager: 3,
  sales: 3,
  ceo: 4,
};

/** Task manager assignees include every active role participating in the task hierarchy. */
export function filterConciergeTaskAssignees(users: ConciergeAssignee[]) {
  return users
    .filter((user) => user.is_active && TASK_MANAGER_ROLE_SET.has(user.role))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function canAssignConciergeTaskToRole(actorRole: string | null | undefined, targetRole: string) {
  const actorLevel = actorRole ? TASK_ROLE_LEVEL[actorRole] : undefined;
  const targetLevel = TASK_ROLE_LEVEL[targetRole];
  return actorLevel !== undefined && targetLevel !== undefined && actorLevel >= targetLevel;
}

export function assignableConciergeTaskUsers(
  users: ConciergeAssignee[],
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
) {
  return filterConciergeTaskAssignees(users).filter(
    (candidate) => candidate.id === actorId || canAssignConciergeTaskToRole(actorRole, candidate.role),
  );
}

/**
 * Concierge accounts use a personal task queue by default. Management roles
 * keep the shared queue so they can coordinate work across the team.
 */
export function conciergeOperationalItemsListPath(
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
  archive: "active" | "archived" | "all" = "all",
) {
  const params = new URLSearchParams({ archive });
  if (actorRole === "concierge" && actorId) params.set("assigned_to", actorId);
  return `/concierge-operational-items?${params.toString()}`;
}

export function canModifyConciergeTask(
  task: Pick<ConciergeTask, "assigned_by" | "assigned_by_role">,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
) {
  if (!actorId || !actorRole) return false;
  if (task.assigned_by === actorId) return true;
  if (actorRole === "ceo") return true;
  const actorLevel = TASK_ROLE_LEVEL[actorRole];
  const authorLevel = task.assigned_by_role ? TASK_ROLE_LEVEL[task.assigned_by_role] : undefined;
  return actorLevel !== undefined && authorLevel !== undefined && actorLevel > authorLevel;
}

export function canChangeConciergeTaskStatus(
  task: Pick<ConciergeTask, "assigned_to" | "assigned_by" | "assigned_by_role">,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
) {
  return Boolean(
    actorId
    && (task.assigned_to === actorId || canModifyConciergeTask(task, actorId, actorRole)),
  );
}

const TASK_PERMISSION_ERROR_PREFIX =
  "Only the task creator or a higher role can";
const TASK_STATUS_PERMISSION_ERROR =
  "Only the task assignee, creator, or a higher role can change task status";
const TASK_NOT_FOUND_ERROR = "Operational item not found";

export function conciergeTaskErrorMessage(
  error: unknown,
  lang: "de" | "ru",
  fallback: string,
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (message === TASK_STATUS_PERMISSION_ERROR) {
    return lang === "ru"
      ? "Статус задачи может менять исполнитель, автор или сотрудник с более высокой ролью."
      : "Den Aufgabenstatus dürfen der Zuständige, der Ersteller oder eine Person mit einer höheren Rolle ändern.";
  }

  if (message === TASK_NOT_FOUND_ERROR) {
    return lang === "ru"
      ? "Задача не найдена. Возможно, она была удалена или относится к старому рабочему процессу."
      : "Die Aufgabe wurde nicht gefunden. Sie wurde möglicherweise gelöscht oder gehört zu einem früheren Arbeitsablauf.";
  }

  if (message.startsWith(TASK_PERMISSION_ERROR_PREFIX)) {
    return lang === "ru"
      ? "Изменять задачу может только её автор или сотрудник с более высокой ролью."
      : "Nur der Ersteller oder eine Person mit einer höheren Rolle darf diese Aufgabe ändern.";
  }

  return message || fallback;
}

export type ConciergeTaskChecklistItem = {
  id: string;
  label: string;
  position: number;
  is_completed: boolean;
  completed_by: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

export type ConciergeTaskComment = {
  id: string;
  body: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

export type ConciergeTaskHistoryEvent = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ConciergeTaskDetail = {
  item: ConciergeTask;
  checklist: ConciergeTaskChecklistItem[];
  comments: ConciergeTaskComment[];
  history: ConciergeTaskHistoryEvent[];
};

export type ConciergeTaskFilters = {
  query: string;
  assignee: string;
  status: string;
  priority: string;
  kind: string;
  audience: string;
  timing: "all" | "today" | "overdue" | "upcoming";
  archive: "active" | "archived" | "all";
};

export type ConciergeProviderTaxonomyNode = {
  id: string;
  code: string;
  name_de: string | null;
  name_ru: string | null;
};

export type ConciergeProvider = {
  id: string;
  name: string;
  provider_type: string;
  address_street: string | null;
  address_city: string | null;
  address_country: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: string | null;
  taxonomy_node_id: string | null;
  taxonomy_node: ConciergeProviderTaxonomyNode | null;
  taxonomy_path: ConciergeProviderTaxonomyNode[];
  internal_rating: number | null;
  avg_rating: number | null;
  rating_count: number;
  open_concierge_service_count: number;
  is_active: boolean;
};

export type ConciergeAgendaItem = {
  id: string;
  kind: "service" | "task" | "event";
  title: string;
  date: string;
  status: string;
  priority: string | null;
  patientName: string | null;
  providerId: string | null;
  address: string | null;
};

export type ConciergeRouteStop = {
  id: string;
  kind: "service" | "task" | "event";
  title: string;
  scheduledAt: string;
  address: string | null;
};

export type ConciergeRouteSegment = {
  url: string;
  stopIds: string[];
};

export type ConciergeRoutePlan = {
  segments: ConciergeRouteSegment[];
  missingAddressStopIds: string[];
  duplicateAddressStopIds: string[];
  tooLongStopIds: string[];
};

export type ConciergeProviderCategory = "all" | "restaurants" | "drivers" | "hotels" | "other";

export const CONCIERGE_BOARD_COLUMNS = [
  { id: "requests", statuses: ["planned", "booked"] },
  { id: "confirmed", statuses: ["confirmed"] },
  { id: "in_service", statuses: ["in_service"] },
  { id: "completed", statuses: ["completed", "cancelled"] },
] as const;

export type ConciergeBoardColumnId = (typeof CONCIERGE_BOARD_COLUMNS)[number]["id"];

export type ConciergeWorkspaceStats = {
  active: number;
  today: number;
  overdue: number;
  readyForBilling: number;
};

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const PROVIDER_CATEGORY_CODES: Record<Exclude<ConciergeProviderCategory, "all" | "other">, readonly string[]> = {
  restaurants: ["nonmedical_restaurants", "nonmedical_cafe", "nonmedical_bars", "nonmedical_catering", "nonmedical_private_cook"],
  drivers: ["nonmedical_chauffeur", "nonmedical_car_rental", "nonmedical_ground_transport"],
  hotels: ["nonmedical_hotels", "nonmedical_private_accommodation"],
};

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function conciergeServiceCostVariance(service: ConciergeService): number | null {
  if (service.cost_estimate === null || service.actual_cost === null) return null;
  const plannedCost = Number(service.cost_estimate);
  const actualCost = Number(service.actual_cost);
  return Number.isFinite(plannedCost) && Number.isFinite(actualCost)
    ? actualCost - plannedCost
    : null;
}

export function isConciergeServiceOverdue(service: ConciergeService, now: Date): boolean {
  const startsAt = validDate(service.starts_at);
  return Boolean(startsAt && startsAt < now && !TERMINAL_STATUSES.has(service.status));
}

export function isConciergeServiceToday(service: ConciergeService, now: Date): boolean {
  const startsAt = validDate(service.starts_at);
  return Boolean(
    startsAt &&
      startsAt.getFullYear() === now.getFullYear() &&
      startsAt.getMonth() === now.getMonth() &&
      startsAt.getDate() === now.getDate(),
  );
}

export function isConciergeTaskOverdue(task: ConciergeTask, now: Date): boolean {
  const dueAt = validDate(task.kind === "event" ? task.starts_at : task.due_at);
  return Boolean(dueAt && dueAt < now && !TERMINAL_STATUSES.has(task.status));
}

export function isConciergeTaskActive(task: ConciergeTask): boolean {
  return !TERMINAL_STATUSES.has(task.status);
}

export function nextConciergeTaskStatus(status: string): "in_progress" | "completed" | null {
  if (status === "open") return "in_progress";
  if (status === "in_progress") return "completed";
  return null;
}

export function conciergeTaskDisplayTitle(task: ConciergeTask, lang: "de" | "ru"): string {
  void lang;
  return task.title;
}

export function conciergeTaskCode(task: Pick<ConciergeTask, "id">): string {
  const compactId = task.id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `TASK-${compactId.slice(0, 8)}`;
}

export function conciergeWorkspaceStats(
  services: ConciergeService[],
  now: Date,
): ConciergeWorkspaceStats {
  return services.reduce<ConciergeWorkspaceStats>(
    (stats, service) => {
      if (!TERMINAL_STATUSES.has(service.status)) stats.active += 1;
      if (isConciergeServiceToday(service, now)) stats.today += 1;
      if (isConciergeServiceOverdue(service, now)) stats.overdue += 1;
      if (service.billing_status === "ready") stats.readyForBilling += 1;
      return stats;
    },
    { active: 0, today: 0, overdue: 0, readyForBilling: 0 },
  );
}

export function conciergeServiceColumn(service: ConciergeService): ConciergeBoardColumnId {
  const match = CONCIERGE_BOARD_COLUMNS.find((column) =>
    (column.statuses as readonly string[]).includes(service.status),
  );
  return match?.id ?? "requests";
}

export function nextConciergeServiceStatus(status: string): ConciergeServiceStatus | null {
  switch (status) {
    case "confirmed":
      return "in_service";
    case "in_service":
      return "completed";
    default:
      return null;
  }
}

export function nextConciergeKeyActions(
  status: ConciergeKeyAction | null,
): ConciergeKeyAction[] {
  switch (status) {
    case null:
    case "returned":
      return ["received"];
    case "received":
      return ["stored", "handed_over", "returned"];
    case "stored":
      return ["handed_over", "returned"];
    case "handed_over":
      return ["returned"];
  }
}

export function conciergeServiceTaxonomyLabel(
  service: ConciergeService,
  lang: "de" | "ru",
): string {
  return lang === "ru"
    ? service.taxonomy_node_name_ru ||
        service.taxonomy_node_name_de ||
        service.taxonomy_node_code ||
        ""
    : service.taxonomy_node_name_de ||
        service.taxonomy_node_name_ru ||
        service.taxonomy_node_code ||
        "";
}

export function conciergeServiceDisplayTitle(
  service: ConciergeService,
  lang: "de" | "ru",
): string {
  if (service.appointment_id) {
    return conciergeServiceTaxonomyLabel(service, lang) ||
      (lang === "ru" ? "Сервисный запрос" : "Serviceanfrage");
  }
  return service.title;
}

export function filterConciergeServices(
  services: ConciergeService[],
  query: string,
): ConciergeService[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return services;

  return services.filter((service) =>
    [
      service.appointment_id ? null : service.title,
      service.patient_name,
      service.patient_pid,
      service.appointment_id ? null : service.provider_name,
      service.vendor_name,
      service.vendor_contact,
      service.service_address,
      service.booking_reference,
      service.taxonomy_node_code,
      service.taxonomy_node_name_de,
      service.taxonomy_node_name_ru,
    ].some((value) => value?.toLocaleLowerCase().includes(needle)),
  );
}

export function sortConciergeServices(services: ConciergeService[]): ConciergeService[] {
  return [...services].sort((left, right) => {
    const leftDate = validDate(left.starts_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDate = validDate(right.starts_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return left.created_at.localeCompare(right.created_at);
  });
}

export function sortConciergeTasks(tasks: ConciergeTask[]): ConciergeTask[] {
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...tasks].sort((left, right) => {
    const leftTerminal = TERMINAL_STATUSES.has(left.status) ? 1 : 0;
    const rightTerminal = TERMINAL_STATUSES.has(right.status) ? 1 : 0;
    if (leftTerminal !== rightTerminal) return leftTerminal - rightTerminal;
    const priorityDelta = (priorityOrder[left.priority] ?? 4) - (priorityOrder[right.priority] ?? 4);
    if (priorityDelta !== 0) return priorityDelta;
    const leftDate = validDate(left.kind === "event" ? left.starts_at : left.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDate = validDate(right.kind === "event" ? right.starts_at : right.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return right.created_at.localeCompare(left.created_at);
  });
}

export function conciergeTaskScheduledAt(task: ConciergeTask): Date | null {
  return validDate(task.kind === "event" ? task.starts_at : task.due_at);
}

export function filterConciergeTasks(
  tasks: ConciergeTask[],
  filters: ConciergeTaskFilters,
  now: Date,
): ConciergeTask[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (filters.archive === "active" && task.archived_at) return false;
    if (filters.archive === "archived" && !task.archived_at) return false;
    if (filters.assignee !== "all" && task.assigned_to !== filters.assignee) return false;
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.kind !== "all" && task.kind !== filters.kind) return false;
    if (filters.audience !== "all" && task.task_audience !== filters.audience) return false;
    if (query && ![
      conciergeTaskCode(task),
      task.title,
      task.note,
      task.location,
      task.assigned_to_name,
      task.assigned_by_name,
      task.patient_name,
      task.external_assignee_name,
      task.external_assignee_phone,
      task.external_assignee_email,
    ].some((value) => value?.toLocaleLowerCase().includes(query))) return false;
    const scheduled = conciergeTaskScheduledAt(task);
    if (filters.timing === "overdue" && !isConciergeTaskOverdue(task, now)) return false;
    if (filters.timing === "today") {
      if (!scheduled
        || scheduled.getFullYear() !== now.getFullYear()
        || scheduled.getMonth() !== now.getMonth()
        || scheduled.getDate() !== now.getDate()) return false;
    }
    if (filters.timing === "upcoming") {
      if (!scheduled || scheduled < now || TERMINAL_STATUSES.has(task.status)) return false;
    }
    return true;
  });
}

export function conciergeTaskWorkload(
  tasks: ConciergeTask[],
  assignees: ConciergeAssignee[],
  now: Date,
) {
  return assignees.map((assignee) => {
    const assigned = tasks.filter((task) => task.assigned_to === assignee.id);
    return {
      assignee,
      active: assigned.filter(isConciergeTaskActive).length,
      overdue: assigned.filter((task) => isConciergeTaskOverdue(task, now)).length,
      today: assigned.filter((task) => {
        const scheduled = conciergeTaskScheduledAt(task);
        return Boolean(
          scheduled
          && scheduled.getFullYear() === now.getFullYear()
          && scheduled.getMonth() === now.getMonth()
          && scheduled.getDate() === now.getDate()
          && isConciergeTaskActive(task)
        );
      }).length,
    };
  });
}

export function conciergeProviderAddress(provider: ConciergeProvider | null | undefined): string {
  if (!provider) return "";
  return [provider.address_street, provider.address_city, provider.address_country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

export function googleMapsSearchUrl(address: string): string | null {
  const query = address.trim();
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}

export function googleMapsDirectionsUrl(address: string): string | null {
  const destination = address.trim();
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : null;
}

const GOOGLE_MAPS_ROUTE_MAX_STOPS = 9;
const GOOGLE_MAPS_ROUTE_MAX_URL_LENGTH = 1_900;

function normalizedRouteAddress(address: string) {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function googleMapsRouteUrl(addresses: string[], origin?: string): string | null {
  if (addresses.length === 0) return null;
  const params = new URLSearchParams({
    api: "1",
    destination: addresses.at(-1) ?? "",
    travelmode: "driving",
  });
  if (origin) params.set("origin", origin);
  if (addresses.length > 1) params.set("waypoints", addresses.slice(0, -1).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildGoogleMapsRoutePlan(
  stops: ConciergeRouteStop[],
  maxStops = GOOGLE_MAPS_ROUTE_MAX_STOPS,
  maxUrlLength = GOOGLE_MAPS_ROUTE_MAX_URL_LENGTH,
): ConciergeRoutePlan {
  const missingAddressStopIds: string[] = [];
  const duplicateAddressStopIds: string[] = [];
  const tooLongStopIds: string[] = [];
  const seenAddresses = new Set<string>();
  const routable: Array<{ id: string; address: string }> = [];

  for (const stop of stops) {
    const address = stop.address?.trim() ?? "";
    if (!address) {
      missingAddressStopIds.push(stop.id);
      continue;
    }
    const key = normalizedRouteAddress(address);
    if (seenAddresses.has(key)) {
      duplicateAddressStopIds.push(stop.id);
      continue;
    }
    seenAddresses.add(key);
    routable.push({ id: stop.id, address });
  }

  const safeMaxStops = Math.max(1, Math.min(GOOGLE_MAPS_ROUTE_MAX_STOPS, maxStops));
  const safeMaxUrlLength = Math.max(256, maxUrlLength);
  const segments: ConciergeRouteSegment[] = [];
  let index = 0;
  let previousDestination: string | undefined;

  while (index < routable.length) {
    const segmentStops: Array<{ id: string; address: string }> = [];
    while (index < routable.length && segmentStops.length < safeMaxStops) {
      const candidate = [...segmentStops, routable[index]];
      const candidateUrl = googleMapsRouteUrl(
        candidate.map((stop) => stop.address),
        previousDestination,
      );
      if (!candidateUrl || candidateUrl.length > safeMaxUrlLength) {
        if (segmentStops.length === 0) {
          tooLongStopIds.push(routable[index].id);
          index += 1;
        }
        break;
      }
      segmentStops.push(routable[index]);
      index += 1;
    }

    if (segmentStops.length === 0) continue;
    const url = googleMapsRouteUrl(
      segmentStops.map((stop) => stop.address),
      previousDestination,
    );
    if (!url) continue;
    segments.push({ url, stopIds: segmentStops.map((stop) => stop.id) });
    previousDestination = segmentStops.at(-1)?.address;
  }

  return {
    segments,
    missingAddressStopIds,
    duplicateAddressStopIds,
    tooLongStopIds,
  };
}

export function conciergePartnerPhoneUrl(phone: string | null | undefined): string | null {
  const normalized = phone?.trim().replace(/[^\d+*#,;]/g, "") ?? "";
  return normalized ? `tel:${normalized}` : null;
}

export function conciergePartnerEmailUrl(email: string | null | undefined): string | null {
  const normalized = email?.trim() ?? "";
  if (!normalized || /[\s\r\n]/.test(normalized) || !normalized.includes("@")) return null;
  return `mailto:${normalized}`;
}

export function conciergeProviderTaxonomyLabel(
  provider: ConciergeProvider,
  lang: "de" | "ru",
): string {
  const node = provider.taxonomy_node ?? provider.taxonomy_path.at(-1) ?? null;
  if (!node) return "";
  return lang === "ru"
    ? node.name_ru || node.name_de || node.code
    : node.name_de || node.name_ru || node.code;
}

export function conciergeProviderCategory(provider: ConciergeProvider): ConciergeProviderCategory {
  const codes = new Set(
    [provider.taxonomy_node?.code, ...provider.taxonomy_path.map((node) => node.code)].filter(Boolean),
  );
  for (const [category, categoryCodes] of Object.entries(PROVIDER_CATEGORY_CODES)) {
    if (categoryCodes.some((code) => codes.has(code))) {
      return category as Exclude<ConciergeProviderCategory, "all" | "other">;
    }
  }
  return "other";
}

export function filterConciergeProviders(
  providers: ConciergeProvider[],
  category: ConciergeProviderCategory,
  query: string,
): ConciergeProvider[] {
  const needle = query.trim().toLocaleLowerCase();
  return providers.filter((provider) => {
    if (category !== "all" && conciergeProviderCategory(provider) !== category) return false;
    if (!needle) return true;
    return [
      provider.name,
      provider.address_street,
      provider.address_city,
      provider.address_country,
      provider.phone,
      provider.email,
      provider.taxonomy_node?.code,
      provider.taxonomy_node?.name_de,
      provider.taxonomy_node?.name_ru,
    ].some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function sortConciergeProviders(providers: ConciergeProvider[]): ConciergeProvider[] {
  return [...providers].sort((left, right) => {
    const ratingDelta = (right.internal_rating ?? right.avg_rating ?? -1) -
      (left.internal_rating ?? left.avg_rating ?? -1);
    if (ratingDelta !== 0) return ratingDelta;
    const activityDelta = right.open_concierge_service_count - left.open_concierge_service_count;
    if (activityDelta !== 0) return activityDelta;
    return left.name.localeCompare(right.name);
  });
}

export function eligibleConciergeServicesForProvider(
  services: ConciergeService[],
  providerId: string,
): ConciergeService[] {
  return sortConciergeServices(
    services.filter(
      (service) =>
        ["planned", "booked"].includes(service.status) &&
        (service.provider_id === null || service.provider_id === providerId),
    ),
  );
}

export function conciergeServiceRouteAddress(
  service: ConciergeService,
  provider: ConciergeProvider | null | undefined,
): string | null {
  const serviceAddress = service.service_address?.trim();
  return serviceAddress || conciergeProviderAddress(provider);
}

function localDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildConciergeRouteStops(
  services: ConciergeService[],
  tasks: ConciergeTask[],
  providersById: Map<string, ConciergeProvider>,
  dateKey: string,
  lang: "de" | "ru" = "de",
): ConciergeRouteStop[] {
  const stops: ConciergeRouteStop[] = [];
  for (const service of services) {
    if (
      !service.starts_at ||
      localDateKey(service.starts_at) !== dateKey ||
      ["completed", "cancelled"].includes(service.status)
    ) continue;
    stops.push({
      id: `service:${service.id}`,
      kind: "service",
      title: conciergeServiceDisplayTitle(service, lang),
      scheduledAt: service.starts_at,
      address: conciergeServiceRouteAddress(
        service,
        service.provider_id ? providersById.get(service.provider_id) : null,
      ) || null,
    });
  }
  for (const task of tasks) {
    const scheduledAt = task.kind === "event" ? task.starts_at : task.due_at;
    if (!scheduledAt || localDateKey(scheduledAt) !== dateKey || !isConciergeTaskActive(task)) {
      continue;
    }
    stops.push({
      id: `${task.kind}:${task.id}`,
      kind: task.kind,
      title: conciergeTaskDisplayTitle(task, lang),
      scheduledAt,
      address: task.location?.trim() || null,
    });
  }
  return stops.sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt) || left.id.localeCompare(right.id),
  );
}

export function buildConciergeAgenda(
  services: ConciergeService[],
  tasks: ConciergeTask[],
  patientNames: Map<string, string> = new Map(),
  lang: "de" | "ru" = "de",
): ConciergeAgendaItem[] {
  const items: ConciergeAgendaItem[] = [];
  for (const service of services) {
    if (!service.starts_at) continue;
    items.push({
      id: service.id,
      kind: "service",
      title: conciergeServiceDisplayTitle(service, lang),
      date: service.starts_at,
      status: service.status,
      priority: null,
      patientName: service.patient_name,
      providerId: service.provider_id,
      address: service.service_address,
    });
  }
  for (const task of tasks) {
    const scheduledAt = task.kind === "event" ? task.starts_at : task.due_at;
    if (!scheduledAt || !isConciergeTaskActive(task)) continue;
    items.push({
      id: task.id,
      kind: task.kind,
      title: conciergeTaskDisplayTitle(task, lang),
      date: scheduledAt,
      status: task.status,
      priority: task.priority,
      patientName:
        task.patient_name ??
        (task.patient_id ? patientNames.get(task.patient_id) ?? null : null),
      providerId: null,
      address: task.location,
    });
  }
  return items.sort((left, right) => left.date.localeCompare(right.date));
}
