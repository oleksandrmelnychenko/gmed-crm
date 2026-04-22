import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentTimelineKind,
  AppointmentTimelineTone,
} from "@/pages/appointments/model/types";

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
      return appointmentText("Workflow", "Воркфлоу", "Workflow");
    case "communication":
      return appointmentText("Kommunikation", "Коммуникация", "Communication");
    case "interpreter":
      return appointmentText("Dolmetscher", "Переводчик", "Interpreter");
    case "clinical":
      return appointmentText("Klinisch", "Клиническое", "Clinical");
    case "followup":
      return appointmentText("Follow-up", "Фоллоу-ап", "Follow-up");
    case "concierge":
      return "Concierge";
    default:
      return kind;
  }
}

export function appointmentTimelineToneLabel(tone: AppointmentTimelineTone) {
  switch (tone) {
    case "success":
      return appointmentText("Erledigt", "Готово", "Done");
    case "warning":
      return appointmentText("Aufmerksamkeit", "Внимание", "Attention");
    case "danger":
      return appointmentText("Kritisch", "Критично", "Critical");
    case "info":
      return appointmentText("Info", "Инфо", "Info");
    default:
      return appointmentText("Geplant", "Запланировано", "Planned");
  }
}

export function appointmentTimelineDateGroupKey(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function appointmentTimelineDateGroupLabel(
  value: string | null | undefined,
  options: { lang: string; locale: string },
) {
  const key = appointmentTimelineDateGroupKey(value);
  if (key === "unknown") {
    if (options.lang === "de") return "Unbekanntes Datum";
    if (options.lang === "ru") return "Дата не указана";
    return "Unknown date";
  }

  const date = new Date(value!);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffInDays = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffInDays === 0) {
    if (options.lang === "de") return "Heute";
    if (options.lang === "ru") return "Сегодня";
    return "Today";
  }
  if (diffInDays === 1) {
    if (options.lang === "de") return "Gestern";
    if (options.lang === "ru") return "Вчера";
    return "Yesterday";
  }

  try {
    return new Intl.DateTimeFormat(options.locale, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year:
        startOfTarget.getFullYear() === startOfToday.getFullYear()
          ? undefined
          : "numeric",
    }).format(date);
  } catch {
    return key;
  }
}
