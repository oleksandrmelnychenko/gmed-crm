import { formatAppDateTime } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";

import type { ConciergeTaskChecklistItem, ConciergeTaskHistoryEvent } from "./model";

/**
 * What a history entry of a task changed, in one line: old → new status,
 * moved dates (DD.MM.YYYY HH:mm, Berlin), the checklist step or file it
 * names (concierge QA 2026-11-12 A F1 / B S3-2). Null when the entry has
 * nothing to add to its title.
 */

const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  de: {
    open: "Offen",
    in_progress: "In Arbeit",
    on_hold: "Pausiert",
    review: "Zur Prüfung",
    completed: "Erledigt",
    cancelled: "Storniert",
  },
  ru: {
    open: "Открыто",
    in_progress: "В работе",
    on_hold: "На паузе",
    review: "На проверке",
    completed: "Выполнено",
    cancelled: "Отменено",
  },
};

const copy = {
  de: {
    title: "Titel",
    due: "Frist",
    starts: "Beginn",
    ends: "Ende",
    reminder: "Erinnerung",
    ticked: "erledigt",
    unticked: "wieder offen",
    withParent: "mit der übergeordneten Aufgabe",
    system: "automatisch angelegt",
    fromService: "aus dem Concierge-Service",
    fromOrder: "aus der Auftrags-Checkliste",
  },
  ru: {
    title: "Название",
    due: "Срок",
    starts: "Начало",
    ends: "Окончание",
    reminder: "Напоминание",
    ticked: "выполнен",
    unticked: "снова открыт",
    withParent: "вместе с основной задачей",
    system: "создана автоматически",
    fromService: "из консьерж-сервиса",
    fromOrder: "из чек-листа заказа",
  },
} as const;

export function conciergeTaskStatusLabel(status: string, lang: Lang) {
  return STATUS_LABELS[lang][status] ?? status;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function has(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function sameInstant(left: string | null, right: string | null) {
  if (!left || !right) return left === right;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime === rightTime : left === right;
}

function when(value: string | null) {
  return value ? formatAppDateTime(value) || value : "—";
}

/** "Срок: 12.11.2026 10:00 → 11.11.2026 09:00" when the date moved. */
function dateMove(payload: Record<string, unknown>, key: string, label: string): string | null {
  const previousKey = `previous_${key}`;
  if (!has(payload, previousKey)) return null;
  const previous = text(payload[previousKey]);
  const current = text(payload[key]);
  if (sameInstant(previous, current)) return null;
  return `${label}: ${when(previous)} → ${when(current)}`;
}

function statusMove(payload: Record<string, unknown>, lang: Lang): string | null {
  const previous = text(payload.previous_status);
  const current = text(payload.status);
  if (!previous || !current || previous === current) return null;
  return `${conciergeTaskStatusLabel(previous, lang)} → ${conciergeTaskStatusLabel(current, lang)}`;
}

function checklistLabel(
  payload: Record<string, unknown>,
  checklist: Pick<ConciergeTaskChecklistItem, "id" | "label">[],
): string | null {
  const stored = text(payload.label) ?? text(payload.previous_label);
  if (stored) return stored;
  // Entries written before the label was stored: the step may still exist.
  const id = text(payload.checklist_id);
  return id ? checklist.find((item) => item.id === id)?.label ?? null : null;
}

export function conciergeTaskHistoryDetail(
  event: Pick<ConciergeTaskHistoryEvent, "event_type" | "payload">,
  lang: Lang,
  checklist: Pick<ConciergeTaskChecklistItem, "id" | "label">[] = [],
): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const labels = copy[lang];
  switch (event.event_type) {
    case "status_changed":
    case "updated":
    case "reassigned":
    case "reminder_changed": {
      const parts: string[] = [];
      const status = statusMove(payload, lang);
      if (status) {
        parts.push(payload.reason === "parent_closed" ? `${status} (${labels.withParent})` : status);
      }
      const previousTitle = text(payload.previous_title);
      const title = text(payload.title);
      if (previousTitle && title && previousTitle !== title) {
        parts.push(`${labels.title}: «${previousTitle}» → «${title}»`);
      }
      for (const [key, label] of [
        ["due_at", labels.due],
        ["starts_at", labels.starts],
        ["ends_at", labels.ends],
        ["reminder_at", labels.reminder],
      ] as const) {
        const moved = dateMove(payload, key, label);
        if (moved) parts.push(moved);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "checklist_item_added":
    case "checklist_item_deleted": {
      const label = checklistLabel(payload, checklist);
      return label ? `«${label}»` : null;
    }
    case "checklist_item_edited": {
      const previous = text(payload.previous_label);
      const current = text(payload.label);
      if (previous && current) return `«${previous}» → «${current}»`;
      return current ? `«${current}»` : null;
    }
    case "checklist_item_toggled": {
      const label = checklistLabel(payload, checklist);
      const state = payload.completed === true ? labels.ticked : payload.completed === false ? labels.unticked : null;
      return [label ? `«${label}»` : null, state].filter(Boolean).join(" — ") || null;
    }
    case "attachment_added":
    case "attachment_deleted":
      return text(payload.file_name);
    case "expense_submitted":
      return text(payload.vendor_name);
    case "created": {
      if (payload.system !== true) return null;
      const source = payload.concierge_service_id ? labels.fromService : payload.order_id ? labels.fromOrder : null;
      return [labels.system, source].filter(Boolean).join(" ");
    }
    default:
      return null;
  }
}
