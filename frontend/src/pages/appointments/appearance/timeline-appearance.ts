import {
  appDateKey,
  appDateKeyOf,
  appDateTimeFormat,
  dateOrInstant,
  daysBetweenDateKeys,
} from "@/lib/app-time-zone";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentTimelineKind,
  AppointmentTimelineTone,
} from "@/pages/appointments/model/types";

const TIMELINE_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "2-digit",
  month: "short",
};

const TIMELINE_DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>([
  [
    "de-DE:current",
    appDateTimeFormat("de-DE", TIMELINE_DATE_FORMAT_OPTIONS),
  ],
  [
    "de-DE:year",
    appDateTimeFormat("de-DE", {
      ...TIMELINE_DATE_FORMAT_OPTIONS,
      year: "numeric",
    }),
  ],
  [
    "ru-RU:current",
    appDateTimeFormat("ru-RU", TIMELINE_DATE_FORMAT_OPTIONS),
  ],
  [
    "ru-RU:year",
    appDateTimeFormat("ru-RU", {
      ...TIMELINE_DATE_FORMAT_OPTIONS,
      year: "numeric",
    }),
  ],
  [
    "en-GB:current",
    appDateTimeFormat("en-GB", TIMELINE_DATE_FORMAT_OPTIONS),
  ],
  [
    "en-GB:year",
    appDateTimeFormat("en-GB", {
      ...TIMELINE_DATE_FORMAT_OPTIONS,
      year: "numeric",
    }),
  ],
]);

function getTimelineDateFormatter(locale: string, includeYear: boolean) {
  const formatterKey = `${locale}:${includeYear ? "year" : "current"}`;
  return (
    TIMELINE_DATE_FORMATTERS.get(formatterKey) ??
    TIMELINE_DATE_FORMATTERS.get(`en-GB:${includeYear ? "year" : "current"}`)!
  );
}

export function appointmentTimelineToneBadgeClassName(
  tone: AppointmentTimelineTone,
) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

export function appointmentTimelineSurfaceClassName(
  tone: AppointmentTimelineTone,
) {
  switch (tone) {
    case "success":
      return "border-emerald-200/80 bg-emerald-50/35";
    case "warning":
      return "border-amber-200/80 bg-amber-50/40";
    case "danger":
      return "border-rose-200/80 bg-rose-50/40";
    case "info":
      return "border-sky-200/80 bg-sky-50/40";
    default:
      return "border-border/50 bg-background";
  }
}

export function appointmentTimelineKindDotClassName(
  kind: AppointmentTimelineKind,
) {
  switch (kind) {
    case "workflow":
      return "bg-sky-500";
    case "communication":
      return "bg-amber-500";
    case "interpreter":
      return "bg-violet-500";
    case "clinical":
      return "bg-emerald-500";
    case "followup":
      return "bg-rose-500";
    case "concierge":
      return "bg-cyan-500";
    default:
      return "bg-[var(--brand)]";
  }
}

export function appointmentTimelineKindBadgeClassName(
  kind: AppointmentTimelineKind,
) {
  switch (kind) {
    case "workflow":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "communication":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "interpreter":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "clinical":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "followup":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "concierge":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-border/60 bg-muted/25 text-muted-foreground";
  }
}

export function appointmentTimelineKindLabel(kind: AppointmentTimelineKind) {
  switch (kind) {
    case "workflow":
      return appointmentText("appointments_workflow");
    case "communication":
      return appointmentText("appointments_communication");
    case "interpreter":
      return appointmentText("appointments_interpreter");
    case "clinical":
      return appointmentText("appointments_clinical");
    case "followup":
      return appointmentText("appointments_follow_up");
    case "concierge":
      return appointmentText("timeline_source_concierge");
    default:
      return kind;
  }
}

export function appointmentTimelineToneLabel(tone: AppointmentTimelineTone) {
  switch (tone) {
    case "success":
      return appointmentText("appointments_done");
    case "warning":
      return appointmentText("appointments_attention");
    case "danger":
      return appointmentText("appointments_critical");
    case "info":
      return appointmentText("appointments_info");
    default:
      return appointmentText("appointments_planned");
  }
}

/** The Berlin day an entry happened on, "YYYY-MM-DD". */
export function appointmentTimelineDateGroupKey(value?: string | null) {
  return appDateKeyOf(value) || "unknown";
}

export function appointmentTimelineDateGroupLabel(
  value: string | null | undefined,
  options: { lang: string; locale: string },
) {
  const key = appointmentTimelineDateGroupKey(value);
  if (key === "unknown") {
    return appointmentText("timeline_date_unknown");
  }

  const today = appDateKey();
  const diffInDays = daysBetweenDateKeys(key, today);

  if (diffInDays === 0) {
    return appointmentText("timeline_date_today");
  }
  if (diffInDays === 1) {
    return appointmentText("timeline_date_yesterday");
  }

  try {
    return getTimelineDateFormatter(
      options.locale,
      key.slice(0, 4) !== today.slice(0, 4),
    ).format(dateOrInstant(value!));
  } catch {
    return key;
  }
}
