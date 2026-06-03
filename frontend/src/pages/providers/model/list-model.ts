import type {
  DoctorFormState,
  DoctorSummary,
  LinkedPatient,
  PersonContactFormState,
  ProviderContactFormState,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  ProviderPersonGender,
  ProviderSummary,
  ProviderType,
  ServiceFormState,
  ServiceItem,
  StaffFormState,
} from "./types";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type Lang,
  type TranslationKey,
} from "@/lib/i18n";

const PROVIDER_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
} satisfies Partial<Record<string, TranslationKey>>;

const PROVIDER_CODE_LABEL_KEYS = {
  appointment: "appointments_title",
  leistung: "providers_leistungen",
  concierge_service: "services_title",
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
  active: "common_active",
  inactive: "common_inactive",
  external: "providers_staff_external",
  unknown: "common_unknown",
  internal: "operations_status_internal",
  planned: "operations_status_planned",
  scheduled: "operations_status_planned",
  requested: "documents_requested",
  booked: "operations_status_booked",
  confirmed: "operations_status_confirmed",
  in_progress: "operations_status_in_progress",
  in_service: "operations_status_in_service",
  completed: "common_completed",
  cancelled: "invoices_workspace_status_cancelled",
  draft: "invoices_workspace_status_draft",
  delivered: "operations_status_delivered",
  approved: "operations_status_approved",
  hotel: "services_type_hotel",
  transfer: "services_type_transfer",
  vip_terminal: "services_type_vip_terminal",
  flight: "services_type_flight",
  chauffeur: "services_type_chauffeur",
  translation_support: "services_type_translation_support",
  other: "services_type_other",
  regular: "appointment_care_path_regular",
  preventive: "appointment_care_path_preventive",
  control: "appointment_care_path_control",
  followup: "appointment_care_path_followup",
  follow_up: "appointment_care_path_followup",
} satisfies Partial<Record<string, TranslationKey>>;

type ContactPayload = {
  contact_kind: "phone" | "email";
  contact_type: "work" | "private" | "other";
  value: string;
  is_primary: boolean;
  notes?: string | null;
};

type ProviderContactPayload = {
  contact_kind: "phone" | "email";
  contact_type: "work" | "department" | "other";
  label?: string | null;
  department?: string | null;
  value: string;
  is_primary: boolean;
  notes?: string | null;
};

const DOCTOR_ROLE_LABELS: Record<string, string> = {
  clinical_director: "providers_doctor_role_clinical_director",
  chefarzt: "providers_doctor_role_chefarzt",
  oberarzt: "providers_doctor_role_oberarzt",
  facharzt: "providers_doctor_role_facharzt",
  assistenzarzt: "providers_doctor_role_assistenzarzt",
  other: "providers_doctor_role_other",
};

const DOCTOR_RELATIONSHIP_LABELS: Record<string, string> = {
  professional: "providers_relationship_professional",
  referral: "providers_relationship_referral",
  knows: "providers_relationship_knows",
  approach_via: "providers_relationship_approach_via",
  other: "providers_relationship_other",
};

export const DOCTOR_TITLE_OPTIONS = [
  { value: "Prof.", sortOrder: 10 },
  { value: "Priv.-Doz.", sortOrder: 20 },
  { value: "PD", sortOrder: 30 },
  { value: "Dr. med.", sortOrder: 40 },
  { value: "Dr.", sortOrder: 50 },
  { value: "Dipl.-Med.", sortOrder: 60 },
] as const;

const DOCTOR_TITLE_OPTIONS_BY_KEY = new Map(
  DOCTOR_TITLE_OPTIONS.map((option) => [normalizeDoctorTitleKey(option.value), option]),
);

const DOCTOR_TITLE_PARSE_OPTIONS = DOCTOR_TITLE_OPTIONS.toSorted(
  (left, right) => right.value.length - left.value.length,
);

export function normalizeDoctorTitleKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function splitDoctorTitleSegment(segment: string) {
  const original = segment.trim();
  if (!original) return [];

  const exact = DOCTOR_TITLE_OPTIONS_BY_KEY.get(normalizeDoctorTitleKey(original));
  if (exact) return [exact.value];

  const parts: string[] = [];
  let remaining = original;

  while (remaining) {
    let match: (typeof DOCTOR_TITLE_PARSE_OPTIONS)[number] | undefined;
    const remainingKey = normalizeDoctorTitleKey(remaining);
    for (const option of DOCTOR_TITLE_PARSE_OPTIONS) {
      if (remainingKey.startsWith(normalizeDoctorTitleKey(option.value))) {
        match = option;
        break;
      }
    }
    if (!match) break;
    parts.push(match.value);
    remaining = remaining.slice(match.value.length).trim();
  }

  if (!remaining) return parts;
  return parts.length > 0 ? [...parts, remaining] : [original];
}

export function splitDoctorTitleValue(value: string | null | undefined) {
  const parts: string[] = [];
  for (const segment of (value ?? "").split(",")) {
    for (const item of splitDoctorTitleSegment(segment)) {
      const trimmed = item.trim();
      if (trimmed) parts.push(trimmed);
    }
  }
  return sortDoctorTitleValues(parts);
}

function doctorTitleSortOrder(value: string) {
  const key = normalizeDoctorTitleKey(value);
  return DOCTOR_TITLE_OPTIONS_BY_KEY.get(key)?.sortOrder ?? 1000;
}

function sortDoctorTitleValues(values: readonly string[]) {
  const seen = new Set<string>();
  const normalized: {
    value: string;
    key: string;
    sortOrder: number;
    index: number;
  }[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]?.trim() ?? "";
    const key = normalizeDoctorTitleKey(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      value,
      key,
      sortOrder: doctorTitleSortOrder(value),
      index,
    });
  }

  return normalized
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.index - right.index)
    .map((item) => {
      const canonical = DOCTOR_TITLE_OPTIONS_BY_KEY.get(item.key);
      return canonical?.value ?? item.value;
    });
}

export function joinDoctorTitleValue(values: readonly string[]) {
  return sortDoctorTitleValues(values).join(" ");
}

export function formatDoctorTitleValue(value: string | null | undefined) {
  return joinDoctorTitleValue(splitDoctorTitleValue(value));
}

function doctorGermanSalutation(gender: ProviderPersonGender) {
  if (gender === "male") return "Herr";
  if (gender === "female") return "Frau";
  return "";
}

export function doctorListDisplayName(
  doctor: { name: string; title?: string | null; gender?: ProviderPersonGender | null },
  lang: Lang,
) {
  const salutation = lang === "de" && doctor.gender ? doctorGermanSalutation(doctor.gender) : "";
  return [salutation, formatDoctorTitleValue(doctor.title), doctor.name.trim()]
    .filter(Boolean)
    .join(" ");
}

export type WeeklyAvailabilityDayCode =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type WeeklyAvailabilityInterval = {
  start: string;
  end: string;
};

export type WeeklyAvailabilityDay = {
  day: WeeklyAvailabilityDayCode;
  enabled: boolean;
  intervals: WeeklyAvailabilityInterval[];
};

const WEEKLY_AVAILABILITY_DAYS: readonly WeeklyAvailabilityDayCode[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

const WEEKLY_DAY_INDEX = new Map(
  WEEKLY_AVAILABILITY_DAYS.map((day, index) => [day, index]),
);

const WEEKLY_DAY_CANONICAL_LABELS: Record<WeeklyAvailabilityDayCode, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const WEEKLY_DAY_LABELS: Record<Lang, Record<WeeklyAvailabilityDayCode, string>> = {
  de: {
    mon: "Mo",
    tue: "Di",
    wed: "Mi",
    thu: "Do",
    fri: "Fr",
    sat: "Sa",
    sun: "So",
  },
  ru: {
    mon: "Пн",
    tue: "Вт",
    wed: "Ср",
    thu: "Чт",
    fri: "Пт",
    sat: "Сб",
    sun: "Вс",
  },
};

const WEEKLY_DAY_ALIASES = new Map<string, WeeklyAvailabilityDayCode>([
  ["mon", "mon"],
  ["monday", "mon"],
  ["mo", "mon"],
  ["montag", "mon"],
  ["пн", "mon"],
  ["понедельник", "mon"],
  ["tue", "tue"],
  ["tues", "tue"],
  ["tuesday", "tue"],
  ["di", "tue"],
  ["dienstag", "tue"],
  ["вт", "tue"],
  ["вторник", "tue"],
  ["wed", "wed"],
  ["wednesday", "wed"],
  ["mi", "wed"],
  ["mittwoch", "wed"],
  ["ср", "wed"],
  ["среда", "wed"],
  ["thu", "thu"],
  ["thur", "thu"],
  ["thurs", "thu"],
  ["thursday", "thu"],
  ["do", "thu"],
  ["donnerstag", "thu"],
  ["чт", "thu"],
  ["четверг", "thu"],
  ["fri", "fri"],
  ["friday", "fri"],
  ["fr", "fri"],
  ["freitag", "fri"],
  ["пт", "fri"],
  ["пятница", "fri"],
  ["sat", "sat"],
  ["saturday", "sat"],
  ["sa", "sat"],
  ["samstag", "sat"],
  ["сб", "sat"],
  ["суббота", "sat"],
  ["sun", "sun"],
  ["sunday", "sun"],
  ["so", "sun"],
  ["sonntag", "sun"],
  ["вс", "sun"],
  ["воскресенье", "sun"],
]);

export function weeklyAvailabilityDayLabel(day: WeeklyAvailabilityDayCode, lang: Lang) {
  return WEEKLY_DAY_LABELS[lang][day];
}

function blankWeeklyAvailability(): WeeklyAvailabilityDay[] {
  return WEEKLY_AVAILABILITY_DAYS.map((day) => ({
    day,
    enabled: false,
    intervals: [],
  }));
}

function normalizeWeeklyDayToken(value: string) {
  return value.trim().replace(/\./g, "").toLocaleLowerCase();
}

function weeklyDayFromToken(value: string) {
  return WEEKLY_DAY_ALIASES.get(normalizeWeeklyDayToken(value));
}

function weeklyDayRange(
  startDay: WeeklyAvailabilityDayCode,
  endDay: WeeklyAvailabilityDayCode,
) {
  const startIndex = WEEKLY_DAY_INDEX.get(startDay) ?? 0;
  const endIndex = WEEKLY_DAY_INDEX.get(endDay) ?? startIndex;
  if (startIndex <= endIndex) {
    return WEEKLY_AVAILABILITY_DAYS.slice(startIndex, endIndex + 1);
  }
  return [
    ...WEEKLY_AVAILABILITY_DAYS.slice(startIndex),
    ...WEEKLY_AVAILABILITY_DAYS.slice(0, endIndex + 1),
  ];
}

function normalizeAvailabilityTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function normalizeAvailabilityEditorIntervals(
  intervals: readonly WeeklyAvailabilityInterval[],
) {
  return intervals.flatMap((interval) => {
    const start = normalizeAvailabilityTime(interval.start);
    const end = normalizeAvailabilityTime(interval.end);
    if (!start || !end) return [];
    return [{ start, end }];
  });
}

export function normalizeWeeklyAvailabilitySchedule(
  schedule: readonly WeeklyAvailabilityDay[],
) {
  return schedule.map((row) => {
    const intervals = normalizeAvailabilityEditorIntervals(row.intervals);
    return {
      ...row,
      enabled: row.enabled && intervals.length > 0,
      intervals,
    };
  });
}

export function updateWeeklyAvailabilityIntervalValue(
  value: string,
  day: WeeklyAvailabilityDayCode,
  index: number,
  field: "start" | "end",
  nextValue: string,
) {
  const nextSchedule = parseWeeklyAvailability(value).map((row) =>
    row.day === day
      ? {
          ...row,
          intervals: row.intervals.map((interval, intervalIndex) =>
            intervalIndex === index ? { ...interval, [field]: nextValue } : interval,
          ),
        }
      : row,
  );
  return formatWeeklyAvailabilityValue(
    normalizeWeeklyAvailabilitySchedule(nextSchedule),
  );
}

function normalizeAvailabilityIntervals(
  intervals: readonly WeeklyAvailabilityInterval[],
) {
  const seen = new Set<string>();
  return intervals.flatMap((interval) => {
    const start = normalizeAvailabilityTime(interval.start);
    const end = normalizeAvailabilityTime(interval.end);
    const key = `${start}-${end}`;
    if (!start || !end || seen.has(key)) return [];
    seen.add(key);
    return [{ start, end }];
  });
}

function formatWeeklyAvailabilityRows(
  days: readonly WeeklyAvailabilityDay[],
  dayLabel: (day: WeeklyAvailabilityDayCode) => string,
  options: { displayMidnightEndAs24?: boolean } = {},
) {
  const groups: Array<{
    startDay: WeeklyAvailabilityDayCode;
    endDay: WeeklyAvailabilityDayCode;
    intervalsKey: string;
    hours: string;
  }> = [];

  for (const day of WEEKLY_AVAILABILITY_DAYS) {
    const row = days.find((item) => item.day === day);
    const intervals = row?.enabled ? normalizeAvailabilityIntervals(row.intervals) : [];
    if (intervals.length === 0) {
      continue;
    }

    const hours = intervals
      .map((interval) => {
        const displayEnd =
          options.displayMidnightEndAs24 && interval.end === "00:00"
            ? "24:00"
            : interval.end;
        return `${interval.start}-${displayEnd}`;
      })
      .join(", ");
    const intervalsKey = hours;
    const previous = groups.at(-1);
    const previousEndIndex = previous ? WEEKLY_DAY_INDEX.get(previous.endDay) : undefined;
    const currentIndex = WEEKLY_DAY_INDEX.get(day);
    if (
      previous?.intervalsKey === intervalsKey &&
      previousEndIndex !== undefined &&
      currentIndex === previousEndIndex + 1
    ) {
      previous.endDay = day;
      continue;
    }

    groups.push({
      startDay: day,
      endDay: day,
      intervalsKey,
      hours,
    });
  }

  return groups
    .map((group) => {
      const daysLabel =
        group.startDay === group.endDay
          ? dayLabel(group.startDay)
          : `${dayLabel(group.startDay)}-${dayLabel(group.endDay)}`;
      return `${daysLabel} ${group.hours}`;
    })
    .join("; ");
}

function parseAvailabilityIntervals(value: string) {
  const intervals: WeeklyAvailabilityInterval[] = [];
  const matcher = /(\d{1,2}:\d{1,2})\s*[-–]\s*(\d{1,2}:\d{1,2})/g;
  let match = matcher.exec(value);
  while (match) {
    intervals.push({
      start: match[1] ?? "",
      end: match[2] ?? "",
    });
    match = matcher.exec(value);
  }
  return normalizeAvailabilityIntervals(intervals);
}

function applyAvailabilitySegment(
  schedule: Map<WeeklyAvailabilityDayCode, WeeklyAvailabilityDay>,
  days: readonly WeeklyAvailabilityDayCode[],
  intervals: readonly WeeklyAvailabilityInterval[],
) {
  const normalizedIntervals = normalizeAvailabilityIntervals(intervals);
  if (normalizedIntervals.length === 0) return false;
  for (const day of days) {
    schedule.set(day, {
      day,
      enabled: true,
      intervals: normalizedIntervals,
    });
  }
  return true;
}

export function parseWeeklyAvailability(value: string | null | undefined) {
  const schedule = new Map<WeeklyAvailabilityDayCode, WeeklyAvailabilityDay>(
    blankWeeklyAvailability().map((day) => [day.day, day]),
  );
  const source = (value ?? "").trim();
  if (!source) return Array.from(schedule.values());

  let parsedAny = false;
  for (const segment of source.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const rangeMatch = trimmed.match(/^([^\d\s,;:]+)\s*[-–]\s*([^\d\s,;:]+)\s+(.+)$/u);
    if (rangeMatch) {
      const startDay = weeklyDayFromToken(rangeMatch[1] ?? "");
      const endDay = weeklyDayFromToken(rangeMatch[2] ?? "");
      const intervals = parseAvailabilityIntervals(rangeMatch[3] ?? "");
      if (startDay && endDay) {
        parsedAny = applyAvailabilitySegment(
          schedule,
          weeklyDayRange(startDay, endDay),
          intervals,
        ) || parsedAny;
        continue;
      }
    }

    const singleMatch = trimmed.match(/^([^\d\s,;:]+)\s+(.+)$/u);
    if (!singleMatch) continue;
    const day = weeklyDayFromToken(singleMatch[1] ?? "");
    if (!day) continue;
    parsedAny = applyAvailabilitySegment(
      schedule,
      [day],
      parseAvailabilityIntervals(singleMatch[2] ?? ""),
    ) || parsedAny;
  }

  return parsedAny ? Array.from(schedule.values()) : blankWeeklyAvailability();
}

export function formatWeeklyAvailabilityValue(days: readonly WeeklyAvailabilityDay[]) {
  return formatWeeklyAvailabilityRows(days, (day) => WEEKLY_DAY_CANONICAL_LABELS[day]);
}

export function formatWeeklyAvailabilityDisplay(
  value: string | null | undefined,
  lang: Lang,
) {
  const source = (value ?? "").trim();
  if (!source) return "";
  const formatted = formatWeeklyAvailabilityRows(
    parseWeeklyAvailability(source),
    (day) => weeklyAvailabilityDayLabel(day, lang),
    { displayMidnightEndAs24: true },
  );
  return formatted || source;
}

const COMPACT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string) {
  const normalizedCurrency = currency || "EUR";
  const cached = moneyFormatters.get(normalizedCurrency);
  if (cached) return cached;
  const formatter = Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  moneyFormatters.set(normalizedCurrency, formatter);
  return formatter;
}

export const DEFAULT_FILTERS: ProviderFilters = {
  search: "",
  providerType: "",
  activeOnly: "true",
  city: "",
  country: "",
  fachbereich: "",
  specializations: "",
  doctorName: "",
  doctorFachbereich: "",
  serviceName: "",
  hasContract: "",
  ratingGte: "",
  taxonomyNodeId: "",
  taxonomyAttributeKey: "",
  taxonomyAttributeValue: "",
  internalRatingGte: "",
};

export function providerPermissions(role?: string): ProviderPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return { canViewPage: true, canManageRegistry: true, forceNonMedical: false };
    case "concierge":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: true };
    case "billing":
    case "sales":
      return { canViewPage: true, canManageRegistry: false, forceNonMedical: false };
    default:
      return { canViewPage: false, canManageRegistry: false, forceNonMedical: false };
  }
}

export function blankProviderForm(providerType: ProviderType = "medical"): ProviderFormState {
  return {
    name: "",
    providerType,
    legalName: "",
    taxId: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    addressCountry: "",
    phone: "",
    email: "",
    contacts: [],
    website: "",
    openingHours: "",
    fachbereich: "",
    specializations: "",
    parentProviderId: "",
    organizationLevel: "organization",
    taxonomyNodeId: "",
    taxonomyAttributes: "{}",
    internalRating: "",
    internalRatingNote: "",
    contractText: "",
    notes: "",
  };
}

export function blankDoctorForm(): DoctorFormState {
  return {
    id: "",
    name: "",
    firstName: "",
    lastName: "",
    title: "",
    roleCode: "",
    roleLabel: "",
    subrole: "",
    gender: "unknown",
    openingHours: "",
    fachbereich: "",
    specializations: "",
    languages: "",
    phone: "",
    email: "",
    privatePhone: "",
    privateEmail: "",
    contacts: [],
    licenseNumber: "",
    licensingCountry: "",
    licensingValidUntil: "",
    notes: "",
  };
}

export function blankServiceForm(priceType: ServiceFormState["priceType"] = "fixed"): ServiceFormState {
  return {
    id: "",
    serviceName: "",
    description: "",
    taxonomyNodeId: "",
    taxonomyAttributes: "{}",
    price: "",
    priceType,
    priceFrom: "",
    priceTo: "",
    priceNote: "",
    currency: "EUR",
    validFrom: new Date().toLocaleDateString("en-CA"),
    validTo: "",
  };
}

export function blankStaffForm(): StaffFormState {
  return {
    id: "",
    firstName: "",
    lastName: "",
    displayName: "",
    role: "staff",
    department: "",
    gender: "unknown",
    openingHours: "",
    status: "active",
    phone: "",
    email: "",
    privatePhone: "",
    privateEmail: "",
    contacts: [],
    notes: "",
  };
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCommaList(value: string) {
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

function specializationsToText(items?: { name_en?: string | null; code?: string }[], fallback = "") {
  const labels: string[] = [];
  for (const item of items ?? []) {
    const label = item.code || item.name_en || "";
    if (label) labels.push(label);
  }
  return labels.length ? labels.join(", ") : fallback;
}

function contactValue(
  contacts: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[] | undefined,
  kind: "phone" | "email",
  type: "work" | "private",
  fallback = "",
) {
  const typed = contacts?.find((contact) => contact.contact_kind === kind && contact.contact_type === type);
  const primary = contacts?.find((contact) => contact.contact_kind === kind && contact.is_primary);
  return typed?.value ?? primary?.value ?? fallback;
}

export function makeContactFormId(prefix = "contact") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toContactForms(
  contacts: {
    id?: string | null;
    contact_kind: string;
    contact_type: string;
    value: string;
    is_primary?: boolean;
    notes?: string | null;
  }[] | undefined,
  fallbackPhone = "",
  fallbackEmail = "",
) {
  const normalized = (contacts ?? []).flatMap((contact, index): PersonContactFormState[] => {
    const contactKind = contact.contact_kind === "email" ? "email" : "phone";
    const contactType =
      contact.contact_type === "private" || contact.contact_type === "other"
        ? contact.contact_type
        : "work";
    const value = contact.value?.trim() ?? "";
    if (!value) return [];
    return [{
      id: contact.id ?? makeContactFormId(`contact-${index}`),
      contactKind,
      contactType,
      value,
      isPrimary: Boolean(contact.is_primary),
      notes: contact.notes ?? "",
    }];
  });

  if (normalized.length > 0) {
    return ensureContactPrimary(normalized);
  }

  return ensureContactPrimary([
    fallbackPhone && {
      id: makeContactFormId("legacy-phone"),
      contactKind: "phone" as const,
      contactType: "work" as const,
      value: fallbackPhone,
      isPrimary: true,
      notes: "",
    },
    fallbackEmail && {
      id: makeContactFormId("legacy-email"),
      contactKind: "email" as const,
      contactType: "work" as const,
      value: fallbackEmail,
      isPrimary: true,
      notes: "",
    },
  ].filter(Boolean) as PersonContactFormState[]);
}

function toProviderContactForms(
  contacts: {
    id?: string | null;
    contact_kind: string;
    contact_type: string;
    label?: string | null;
    department?: string | null;
    value: string;
    is_primary?: boolean;
    notes?: string | null;
  }[] | undefined,
  fallbackPhone = "",
  fallbackEmail = "",
) {
  const normalized = (contacts ?? []).flatMap((contact, index): ProviderContactFormState[] => {
    const contactKind = contact.contact_kind === "email" ? "email" : "phone";
    const contactType =
      contact.contact_type === "department" || contact.contact_type === "other"
        ? contact.contact_type
        : "work";
    const value = contact.value?.trim() ?? "";
    if (!value) return [];
    return [{
      id: contact.id ?? makeContactFormId(`provider-contact-${index}`),
      contactKind,
      contactType,
      label: contact.label ?? "",
      department: contact.department ?? "",
      value,
      isPrimary: Boolean(contact.is_primary),
      notes: contact.notes ?? "",
    }];
  });

  if (normalized.length > 0) {
    return ensureProviderContactPrimary(normalized);
  }

  return ensureProviderContactPrimary([
    fallbackPhone && {
      id: makeContactFormId("provider-legacy-phone"),
      contactKind: "phone" as const,
      contactType: "work" as const,
      label: "",
      department: "",
      value: fallbackPhone,
      isPrimary: true,
      notes: "",
    },
    fallbackEmail && {
      id: makeContactFormId("provider-legacy-email"),
      contactKind: "email" as const,
      contactType: "work" as const,
      label: "",
      department: "",
      value: fallbackEmail,
      isPrimary: true,
      notes: "",
    },
  ].filter(Boolean) as ProviderContactFormState[]);
}

function ensureContactPrimary<T extends PersonContactFormState>(contacts: T[]) {
  return contacts.map((contact, _index, all) => {
    const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
    const firstPrimary = sameKind.find((item) => item.isPrimary);
    if (firstPrimary) {
      return { ...contact, isPrimary: contact.id === firstPrimary.id };
    }
    return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
  });
}

function ensureProviderContactPrimary<T extends ProviderContactFormState>(contacts: T[]) {
  return contacts.map((contact, _index, all) => {
    const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
    const firstPrimary = sameKind.find((item) => item.isPrimary);
    if (firstPrimary) {
      return { ...contact, isPrimary: contact.id === firstPrimary.id };
    }
    return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
  });
}

function buildDynamicContacts(contacts: PersonContactFormState[]): ContactPayload[] {
  return contacts.flatMap((contact): ContactPayload[] => {
    const value = toOptional(contact.value);
    if (!value) return [];
    return [{
      contact_kind: contact.contactKind,
      contact_type: contact.contactType,
      value,
      is_primary: contact.isPrimary,
      notes: toOptional(contact.notes),
    }];
  });
}

function buildProviderContacts(contacts: ProviderContactFormState[]): ProviderContactPayload[] {
  return contacts.flatMap((contact): ProviderContactPayload[] => {
    const value = toOptional(contact.value);
    if (!value) return [];
    return [{
      contact_kind: contact.contactKind,
      contact_type: contact.contactType,
      label: toOptional(contact.label),
      department: toOptional(contact.department),
      value,
      is_primary: contact.isPrimary,
      notes: toOptional(contact.notes),
    }];
  });
}

function buildDoctorContacts(form: DoctorFormState): ContactPayload[] {
  return buildDynamicContacts(form.contacts);
}

function buildStaffContacts(form: StaffFormState): ContactPayload[] {
  return buildDynamicContacts(form.contacts);
}

function primaryContact(
  contacts: ContactPayload[],
  kind: "phone" | "email",
) {
  return (
    contacts.find((contact) => contact.contact_kind === kind && contact.is_primary)?.value ??
    contacts.find((contact) => contact.contact_kind === kind)?.value ??
    null
  );
}

function primaryProviderContact(
  contacts: ProviderContactPayload[],
  kind: "phone" | "email",
) {
  return (
    contacts.find((contact) => contact.contact_kind === kind && contact.is_primary)?.value ??
    contacts.find((contact) => contact.contact_kind === kind)?.value ??
    null
  );
}

function normalizeGender(value?: string | null): ProviderPersonGender {
  return value === "male" || value === "female" ? value : "unknown";
}

export function providerTypeLabel(value: string, tr: Record<string, string>) {
  const translations = translateCatalog(getLang());
  return formatEnumLabelFromKeys(value, PROVIDER_TYPE_LABEL_KEYS, {
    ...translations,
    providers_type_medical:
      tr.providers_type_medical ?? translations.providers_type_medical,
    providers_type_non_medical:
      tr.providers_type_non_medical ?? translations.providers_type_non_medical,
  });
}

export function doctorRoleLabel(value?: string | null) {
  if (!value) return translateCatalog(getLang()).common_not_set;
  const translations = translateCatalog(getLang());
  const key = DOCTOR_ROLE_LABELS[value];
  return (key ? translations.uiText[key] : undefined) ?? humanizeCode(value);
}

export function doctorRelationshipTypeLabel(value?: string | null) {
  if (!value) return translateCatalog(getLang()).common_not_set;
  const translations = translateCatalog(getLang());
  const key = DOCTOR_RELATIONSHIP_LABELS[value];
  return (key ? translations.uiText[key] : undefined) ?? humanizeCode(value);
}

export function personGenderLabel(value?: string | null) {
  const translations = translateCatalog(getLang());
  switch (value) {
    case "male":
      return translations.gender_male;
    case "female":
      return translations.gender_female;
    default:
      return translations.common_unknown;
  }
}

export function providerOrganizationLevelLabel(value?: string | null) {
  const translations = translateCatalog(getLang());
  const key = value ? `providers_level_${value}` : "";
  return (key ? translations.uiText[key] : undefined) ?? humanizeCode(value ?? "");
}

export function compactDateTime(
  value?: string | null,
  fallback = translateCatalog(getLang()).common_not_set,
) {
  if (!value) return fallback;
  try {
    return COMPACT_DATE_TIME_FORMATTER.format(new Date(value));
  } catch {
    return value;
  }
}

export function compactDate(
  value?: string | null,
  fallback = translateCatalog(getLang()).common_not_set,
) {
  if (!value) return fallback;
  try {
    return COMPACT_DATE_FORMATTER.format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function stringifyContract(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "summary" in value) {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseContract(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return { summary: trimmed };
}

function stringifyJsonRecord(value: Record<string, unknown> | null | undefined) {
  if (!value || Object.keys(value).length === 0) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

export function parseTaxonomyAttributes(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function taxonomyAttributeValue(value: string, key: string) {
  const raw = parseTaxonomyAttributes(value)[key];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  return String(raw);
}

export function updateTaxonomyAttributeValue(value: string, key: string, nextValue: string) {
  const next = parseTaxonomyAttributes(value);
  if (nextValue.trim()) {
    next[key] = nextValue;
  } else {
    delete next[key];
  }
  return JSON.stringify(next, null, 2);
}

function parseJsonRecord(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const record: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawValue === "string") {
      const trimmedValue = rawValue.trim();
      if (trimmedValue) {
        record[key] = trimmedValue;
      }
    } else if (rawValue !== null && rawValue !== undefined) {
      record[key] = rawValue;
    }
  }
  return record;
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildProvidersQuery(filters: ProviderFilters, forceNonMedical: boolean) {
  const params = new URLSearchParams();
  const providerType = forceNonMedical ? "non_medical" : filters.providerType;
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (providerType) params.set("provider_type", providerType);
  if (filters.activeOnly) params.set("active_only", filters.activeOnly);
  if (filters.city.trim()) params.set("city", filters.city.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.fachbereich.trim()) params.set("fachbereich", filters.fachbereich.trim());
  if (filters.specializations.trim()) params.set("specializations", filters.specializations.trim());
  if (filters.doctorName.trim()) params.set("doctor_name", filters.doctorName.trim());
  if (filters.doctorFachbereich.trim()) {
    params.set("doctor_fachbereich", filters.doctorFachbereich.trim());
  }
  if (filters.serviceName.trim()) params.set("service_name", filters.serviceName.trim());
  if (filters.hasContract) params.set("has_contract", filters.hasContract);
  if (filters.ratingGte) params.set("rating_gte", filters.ratingGte);
  if (filters.taxonomyNodeId.trim()) params.set("taxonomy_node_id", filters.taxonomyNodeId.trim());
  if (filters.taxonomyAttributeKey.trim()) {
    params.set("taxonomy_attribute_key", filters.taxonomyAttributeKey.trim());
  }
  if (filters.taxonomyAttributeValue.trim()) {
    params.set("taxonomy_attribute_value", filters.taxonomyAttributeValue.trim());
  }
  if (filters.internalRatingGte) params.set("internal_rating_gte", filters.internalRatingGte);
  const query = params.toString();
  return query ? `/providers?${query}` : "/providers";
}

export function providerToForm(detail: ProviderDetail): ProviderFormState {
  return {
    name: detail.name,
    providerType: detail.provider_type,
    legalName: detail.legal_name ?? "",
    taxId: detail.tax_id ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    contacts: toProviderContactForms(detail.contacts, detail.phone ?? "", detail.email ?? ""),
    website: detail.website ?? "",
    openingHours: detail.opening_hours ?? "",
    fachbereich: detail.fachbereich ?? "",
    specializations: specializationsToText(detail.specializations, detail.fachbereich ?? ""),
    parentProviderId: detail.parent_provider_id ?? "",
    organizationLevel: detail.organization_level ?? "organization",
    taxonomyNodeId: detail.taxonomy_node_id ?? detail.taxonomy_node?.id ?? "",
    taxonomyAttributes: stringifyJsonRecord(detail.taxonomy_attributes),
    internalRating: detail.internal_rating == null ? "" : String(detail.internal_rating),
    internalRatingNote: detail.internal_rating_note ?? "",
    contractText: stringifyContract(detail.kooperationsvertrag),
    notes: detail.notes ?? "",
  };
}

export function doctorToForm(doctor: DoctorSummary): DoctorFormState {
  return {
    id: doctor.id,
    name: doctor.name,
    firstName: doctor.first_name ?? "",
    lastName: doctor.last_name ?? "",
    title: doctor.title ?? "",
    roleCode: doctor.role_code ?? "",
    roleLabel: doctor.role_label ?? "",
    subrole: doctor.subrole ?? "",
    gender: normalizeGender(doctor.gender),
    openingHours: doctor.opening_hours ?? "",
    fachbereich: doctor.fachbereich ?? "",
    specializations: specializationsToText(doctor.specializations, doctor.fachbereich ?? ""),
    languages: doctor.languages?.join(", ") ?? "",
    phone: contactValue(doctor.contacts, "phone", "work", doctor.phone ?? ""),
    email: contactValue(doctor.contacts, "email", "work", doctor.email ?? ""),
    privatePhone: contactValue(doctor.contacts, "phone", "private"),
    privateEmail: contactValue(doctor.contacts, "email", "private"),
    contacts: toContactForms(doctor.contacts, doctor.phone ?? "", doctor.email ?? ""),
    licenseNumber: doctor.license_number ?? "",
    licensingCountry: doctor.licensing_country ?? "",
    licensingValidUntil: doctor.licensing_valid_until ?? "",
    notes: doctor.notes ?? "",
  };
}

export function serviceToForm(service: ServiceItem): ServiceFormState {
  return {
    id: service.id,
    serviceName: service.service_name,
    description: service.description ?? "",
    taxonomyNodeId: service.taxonomy_node_id ?? service.taxonomy_node?.id ?? "",
    taxonomyAttributes: stringifyJsonRecord(service.taxonomy_attributes),
    price: service.price,
    priceType: service.price_type || "fixed",
    priceFrom: service.price_from ?? service.price ?? "",
    priceTo: service.price_to ?? service.price ?? "",
    priceNote: service.price_note ?? "",
    currency: service.currency || "EUR",
    validFrom: service.valid_from || new Date().toLocaleDateString("en-CA"),
    validTo: service.valid_to ?? "",
  };
}

export function staffToForm(staff: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  role: string;
  department: string | null;
  gender?: string | null;
  opening_hours?: string | null;
  status: StaffFormState["status"];
  phone?: string | null;
  email?: string | null;
  contacts?: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[];
  notes: string | null;
}): StaffFormState {
  const contacts = toContactForms(staff.contacts, staff.phone ?? "", staff.email ?? "");
  return {
    id: staff.id,
    firstName: staff.first_name ?? "",
    lastName: staff.last_name ?? "",
    displayName: staff.display_name ?? "",
    role: staff.role ?? "staff",
    department: staff.department ?? "",
    gender: normalizeGender(staff.gender),
    openingHours: staff.opening_hours ?? "",
    status: staff.status ?? "active",
    phone: contactValue(staff.contacts, "phone", "work", staff.phone ?? ""),
    email: contactValue(staff.contacts, "email", "work", staff.email ?? ""),
    privatePhone: contactValue(staff.contacts, "phone", "private"),
    privateEmail: contactValue(staff.contacts, "email", "private"),
    contacts,
    notes: staff.notes ?? "",
  };
}

export function toProviderPayload(form: ProviderFormState, forceNonMedical: boolean) {
  const providerType = forceNonMedical ? "non_medical" : form.providerType;
  const isMedical = providerType === "medical";
  const contacts = buildProviderContacts(form.contacts);
  return {
    name: form.name.trim(),
    provider_type: providerType,
    legal_name: toOptional(form.legalName),
    tax_id: toOptional(form.taxId),
    address_street: toOptional(form.addressStreet),
    address_city: toOptional(form.addressCity),
    address_zip: toOptional(form.addressZip),
    address_country: toOptional(form.addressCountry),
    phone: primaryProviderContact(contacts, "phone"),
    email: primaryProviderContact(contacts, "email"),
    contacts,
    website: toOptional(form.website),
    opening_hours: toOptional(form.openingHours),
    fachbereich: isMedical ? toOptional(form.fachbereich) : null,
    specializations: isMedical ? parseCommaList(form.specializations || form.fachbereich) : [],
    parent_provider_id: toOptional(form.parentProviderId),
    organization_level: form.organizationLevel,
    taxonomy_node_id: toOptional(form.taxonomyNodeId),
    taxonomy_attributes: parseJsonRecord(form.taxonomyAttributes),
    internal_rating: parseOptionalNumber(form.internalRating),
    internal_rating_note: toOptional(form.internalRatingNote),
    kooperationsvertrag: parseContract(form.contractText),
    notes: toOptional(form.notes),
  };
}

export function toDoctorPayload(form: DoctorFormState) {
  const nameFromParts = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ");
  const name = form.name.trim() || nameFromParts;
  const contacts = buildDoctorContacts(form);
  return {
    name,
    first_name: toOptional(form.firstName),
    last_name: toOptional(form.lastName),
    display_name: name,
    title: toOptional(formatDoctorTitleValue(form.title)),
    role_code: toOptional(form.roleCode),
    role_label: form.roleCode === "other" ? toOptional(form.roleLabel) : null,
    subrole: toOptional(form.subrole),
    gender: form.gender,
    opening_hours: toOptional(form.openingHours),
    fachbereich: toOptional(form.fachbereich),
    specializations: parseCommaList(form.specializations || form.fachbereich),
    languages: parseCommaList(form.languages),
    phone: primaryContact(contacts, "phone"),
    email: primaryContact(contacts, "email"),
    contacts,
    license_number: toOptional(form.licenseNumber),
    licensing_country: toOptional(form.licensingCountry),
    licensing_valid_until: toOptional(form.licensingValidUntil),
    notes: toOptional(form.notes),
  };
}

export function toServicePayload(form: ServiceFormState) {
  const priceType = form.priceType || "fixed";
  const fixedPrice = Number.parseFloat(form.price || form.priceFrom || "0");
  const priceFrom = Number.parseFloat(form.priceFrom || form.price || "0");
  const priceTo = Number.parseFloat(form.priceTo || form.priceFrom || form.price || "0");
  return {
    service_name: form.serviceName.trim(),
    description: toOptional(form.description),
    price: priceType === "on_request" ? 0 : priceType === "range" ? priceFrom : fixedPrice,
    price_type: priceType,
    price_from: priceType === "on_request" ? null : priceFrom,
    price_to: priceType === "on_request" ? null : priceTo,
    price_note: toOptional(form.priceNote),
    currency: toOptional(form.currency) ?? "EUR",
    valid_from: toOptional(form.validFrom),
    valid_to: toOptional(form.validTo),
    taxonomy_node_id: toOptional(form.taxonomyNodeId),
    taxonomy_attributes: parseJsonRecord(form.taxonomyAttributes),
  };
}

export function toStaffPayload(form: StaffFormState) {
  const displayName =
    form.displayName.trim() ||
    [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ");
  return {
    first_name: toOptional(form.firstName),
    last_name: toOptional(form.lastName),
    display_name: displayName,
    role: toOptional(form.role) ?? "staff",
    department: toOptional(form.department),
    gender: form.gender,
    opening_hours: toOptional(form.openingHours),
    status: form.status,
    notes: toOptional(form.notes),
    contacts: buildStaffContacts(form),
  };
}

export function humanizeCode(value: string) {
  const translations = translateCatalog(getLang());
  return formatEnumLabelFromKeys(value, PROVIDER_CODE_LABEL_KEYS, translations);
}

function moneyLabel(price: string, currency: string) {
  const numeric = Number.parseFloat(price);
  if (!Number.isFinite(numeric)) return `${price} ${currency}`.trim();
  try {
    return moneyFormatter(currency).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`.trim();
  }
}

export function servicePriceLabel(service: ServiceItem) {
  if (service.price_type === "on_request") {
    return (
      service.price_note ||
      translateCatalog(getLang()).uiText.providers_price_on_request ||
      "providers_price_on_request"
    );
  }
  if (service.price_type === "range") {
    const from = moneyLabel(service.price_from ?? service.price, service.currency);
    const to = moneyLabel(service.price_to ?? service.price_from ?? service.price, service.currency);
    return from === to ? from : `${from} - ${to}`;
  }
  return moneyLabel(service.price, service.currency);
}

export function patientLabel(patient: LinkedPatient) {
  return `${patient.patient_id} · ${patient.first_name} ${patient.last_name}`;
}

export function providerMeta(provider: ProviderSummary | ProviderDetail) {
  return [provider.address_city, provider.address_country].filter(Boolean).join(", ");
}
