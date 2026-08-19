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
  taxonomy_node_code: string | null;
  taxonomy_node_name_de: string | null;
  taxonomy_node_name_ru: string | null;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
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
  concierge_service_id: string | null;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  priority: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
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
    case "planned":
      return "booked";
    case "booked":
      return "confirmed";
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

export function buildConciergeAgenda(
  services: ConciergeService[],
  tasks: ConciergeTask[],
  patientNames: Map<string, string> = new Map(),
  lang: "de" | "ru" = "de",
): ConciergeAgendaItem[] {
  void patientNames;
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
      patientName: null,
      providerId: null,
    });
  }
  return items.sort((left, right) => left.date.localeCompare(right.date));
}
