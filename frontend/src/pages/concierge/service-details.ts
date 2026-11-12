/**
 * The own fields of a concierge service kind (owner decision 2026-11-12,
 * concierge QA D-6): restaurant (persons, preferred time, dietary notes),
 * transfer (flight or train number, pickup and drop-off place, luggage or
 * wheelchair note) and tickets for an event (event, seats, seat category).
 *
 * The kind is no second picker: rides follow the service kind (transfer,
 * chauffeur), everything else the partner category already chosen
 * (gastronomy → restaurant, culture and sport → tickets). Mirrors
 * `crates/server/src/routes/concierge_services/details.rs`, which validates
 * the same schema; the server is the authority.
 */
import type { Lang } from "@/lib/i18n";

export type ServiceDetailsKind = "restaurant" | "transfer" | "tickets";

export type ServiceDetailsKey =
  | "persons"
  | "preferred_time"
  | "dietary_notes"
  | "flight_number"
  | "pickup_place"
  | "dropoff_place"
  | "luggage_note"
  | "event_name"
  | "seats"
  | "seat_category";

/** The stored fields as the API returns them. */
export type ServiceDetails = Partial<Record<ServiceDetailsKey, string | number>>;

/** The inputs of a form: every field as text. */
export type ServiceDetailsForm = Record<ServiceDetailsKey, string>;

export type ServiceDetailsFieldType = "count" | "time" | "text" | "textarea";

export type ServiceDetailsField = {
  key: ServiceDetailsKey;
  type: ServiceDetailsFieldType;
  /** Longest text, or the largest count. */
  max: number;
};

export const SERVICE_DETAILS_FIELDS: Record<ServiceDetailsKind, ServiceDetailsField[]> = {
  restaurant: [
    { key: "persons", type: "count", max: 100 },
    { key: "preferred_time", type: "time", max: 5 },
    { key: "dietary_notes", type: "textarea", max: 500 },
  ],
  transfer: [
    { key: "flight_number", type: "text", max: 30 },
    { key: "pickup_place", type: "text", max: 300 },
    { key: "dropoff_place", type: "text", max: 300 },
    { key: "luggage_note", type: "textarea", max: 500 },
  ],
  tickets: [
    { key: "event_name", type: "text", max: 300 },
    { key: "seats", type: "count", max: 100 },
    { key: "seat_category", type: "text", max: 100 },
  ],
};

const RESTAURANT_CATEGORIES = new Set([
  "nonmedical_restaurants",
  "nonmedical_cafe",
  "nonmedical_bars",
  "nonmedical_catering",
  "nonmedical_private_cook",
]);
const TICKET_CATEGORIES = new Set(["nonmedical_culture", "nonmedical_sport"]);

/** The kind whose own fields a service has; `null` keeps the generic form. */
export function serviceDetailsKind(
  serviceKind: string | null | undefined,
  taxonomyCode: string | null | undefined,
): ServiceDetailsKind | null {
  if (serviceKind === "transfer" || serviceKind === "chauffeur") return "transfer";
  if (taxonomyCode && RESTAURANT_CATEGORIES.has(taxonomyCode)) return "restaurant";
  if (taxonomyCode && TICKET_CATEGORIES.has(taxonomyCode)) return "tickets";
  return null;
}

/** The code of the chosen category; the stored code when the node is not in the list. */
export function taxonomyCodeOf(
  taxonomyNodeId: string,
  nodes: ReadonlyArray<{ id: string; code: string }>,
  fallback?: { id: string | null | undefined; code: string | null | undefined },
) {
  if (!taxonomyNodeId) return null;
  const node = nodes.find((item) => item.id === taxonomyNodeId);
  if (node) return node.code;
  return fallback && fallback.id === taxonomyNodeId ? fallback.code ?? null : null;
}

export function blankServiceDetailsForm(): ServiceDetailsForm {
  return {
    persons: "",
    preferred_time: "",
    dietary_notes: "",
    flight_number: "",
    pickup_place: "",
    dropoff_place: "",
    luggage_note: "",
    event_name: "",
    seats: "",
    seat_category: "",
  };
}

export function serviceDetailsFormFrom(details: ServiceDetails | null | undefined): ServiceDetailsForm {
  const form = blankServiceDetailsForm();
  for (const key of Object.keys(form) as ServiceDetailsKey[]) {
    const value = details?.[key];
    if (value !== undefined && value !== null) form[key] = String(value);
  }
  return form;
}

/**
 * What the form sends: the trimmed fields of the kind, counts as numbers,
 * empty fields left out; a service without own fields sends `{}`.
 */
export function serviceDetailsPayload(
  kind: ServiceDetailsKind | null,
  form: ServiceDetailsForm,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  if (!kind) return payload;
  for (const field of SERVICE_DETAILS_FIELDS[kind]) {
    const value = form[field.key].trim();
    if (!value) continue;
    payload[field.key] = field.type === "count" ? Number(value) : value;
  }
  return payload;
}

const LABELS: Record<ServiceDetailsKey, Record<Lang, string>> = {
  persons: { ru: "Количество человек", de: "Anzahl Personen" },
  preferred_time: { ru: "Желаемое время", de: "Gewünschte Uhrzeit" },
  dietary_notes: { ru: "Пожелания по питанию (диета, аллергии)", de: "Ernährungswünsche (Diät, Allergien)" },
  flight_number: { ru: "Номер рейса или поезда", de: "Flug- oder Zugnummer" },
  pickup_place: { ru: "Место подачи", de: "Abholort" },
  dropoff_place: { ru: "Место назначения", de: "Zielort" },
  luggage_note: { ru: "Багаж, кресло-коляска", de: "Gepäck, Rollstuhl" },
  event_name: { ru: "Мероприятие", de: "Veranstaltung" },
  seats: { ru: "Количество мест", de: "Anzahl Plätze" },
  seat_category: { ru: "Категория мест", de: "Platzkategorie" },
};

const TITLES: Record<ServiceDetailsKind, Record<Lang, string>> = {
  restaurant: { ru: "Детали бронирования столика", de: "Angaben zur Tischreservierung" },
  transfer: { ru: "Детали трансфера", de: "Angaben zum Transfer" },
  tickets: { ru: "Детали билетов", de: "Angaben zu den Tickets" },
};

export function serviceDetailsLabel(key: ServiceDetailsKey, lang: Lang) {
  return LABELS[key][lang];
}

export function serviceDetailsTitle(kind: ServiceDetailsKind, lang: Lang) {
  return TITLES[kind][lang];
}

/** The first input the server would refuse, said in the form's language; `null` when all fit. */
export function serviceDetailsError(
  kind: ServiceDetailsKind | null,
  form: ServiceDetailsForm,
  lang: Lang,
): string | null {
  if (!kind) return null;
  for (const field of SERVICE_DETAILS_FIELDS[kind]) {
    const value = form[field.key].trim();
    if (!value) continue;
    const label = LABELS[field.key][lang];
    if (field.type === "count") {
      const count = Number(value);
      if (!/^\d+$/.test(value) || count < 1 || count > field.max) {
        return lang === "de"
          ? `${label}: bitte eine ganze Zahl von 1 bis ${field.max} angeben.`
          : `${label}: укажите целое число от 1 до ${field.max}.`;
      }
    } else if (field.type === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return lang === "de"
          ? `${label}: bitte eine Uhrzeit im Format HH:MM angeben.`
          : `${label}: укажите время в формате ЧЧ:ММ.`;
      }
    } else if (value.length > field.max) {
      return lang === "de"
        ? `${label}: höchstens ${field.max} Zeichen.`
        : `${label}: не более ${field.max} символов.`;
    }
  }
  return null;
}

export type ServiceDetailsRow = { key: ServiceDetailsKey; label: string; value: string };

/** The filled fields of the service's kind, for a detail view or the portal. */
export function serviceDetailsRows(
  kind: string | null | undefined,
  details: ServiceDetails | null | undefined,
  lang: Lang,
): ServiceDetailsRow[] {
  if (kind !== "restaurant" && kind !== "transfer" && kind !== "tickets") return [];
  const rows: ServiceDetailsRow[] = [];
  for (const field of SERVICE_DETAILS_FIELDS[kind]) {
    const value = details?.[field.key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    rows.push({ key: field.key, label: LABELS[field.key][lang], value: String(value) });
  }
  return rows;
}
