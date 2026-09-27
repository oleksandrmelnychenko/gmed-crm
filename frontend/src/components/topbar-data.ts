import { apiFetch } from "@/lib/api";
import { appDateTimeFormat, formatDateKey } from "@/lib/app-time-zone";
import { notifyChatRead } from "@/lib/chat-read-events";
import { formatMoneyAmount } from "@/lib/money";
import { paymentStatusLabel } from "@/lib/payment-status";
import { localizeTaskTitle } from "@/lib/task-labels";

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  created_at: string;
}

export function localizedNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> {
  if (item.kind === "order_payment_status") {
    try {
      const data = JSON.parse(item.body ?? "{}");
      const due = data.due_at ? new Date(data.due_at) : null;
      const deadline = due && Number.isFinite(due.getTime())
        ? ` · ${lang === "de" ? "Frist" : "Срок"}: ${appDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "short", timeStyle: "short" }).format(due)}` : "";
      return {
        title: `${data.order_number ?? ""} · ${paymentStatusLabel(data.payment_status ?? "awaiting_payment", lang)}`,
        body: `${lang === "de" ? "Erhalten" : "Получено"}: ${formatMoneyAmount(data.received_amount, data.currency)} · ${lang === "de" ? "Offen" : "Остаток"}: ${formatMoneyAmount(data.remaining_amount, data.currency)}${deadline}`,
      };
    } catch {
      return { title: lang === "de" ? "Zahlungsstatus aktualisiert" : "Статус оплаты обновлён", body: null };
    }
  }
  if (item.kind === "medication_ai_ready") {
    return lang === "de"
      ? {
          title: "KI-Entwurf bereit",
          body: "Der de-identifizierte Entwurf kann anhand der Quellen geprüft werden.",
        }
      : {
          title: "AI-черновик готов",
          body: "Обезличенный черновик доступен для проверки по источникам.",
        };
  }
  if (item.kind === "medication_ai_failed") {
    return lang === "de"
      ? {
          title: "KI-Entwurf fehlgeschlagen",
          body: "Die sichere Verarbeitung ist fehlgeschlagen; das lokale Paket blieb unverändert.",
        }
      : {
          title: "AI-черновик не сформирован",
          body: "Безопасная обработка завершилась ошибкой; локальный пакет не изменён.",
        };
  }
  const interpreterCopy = interpreterWorkNotificationCopy(item, lang);
  if (interpreterCopy) return interpreterCopy;
  const expenseCopy = conciergeExpenseNotificationCopy(item, lang);
  if (expenseCopy) return expenseCopy;
  const serviceRequestCopy = conciergeServiceRequestNotificationCopy(item, lang);
  if (serviceRequestCopy) return serviceRequestCopy;
  const taskTitle = taskNotificationTitle(item, lang);
  if (taskTitle) {
    return { title: taskTitle, body: item.body ? localizeTaskTitle(item.body, lang) : null };
  }
  return { title: item.title, body: item.body };
}

function parseNotificationBody<T extends object>(body: string | null): T | null {
  try {
    const value = JSON.parse(body ?? "");
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

const CONCIERGE_EXPENSE_TITLES: Record<string, { de: string; ru: string }> = {
  concierge_expense_submitted: {
    de: "Concierge-Beleg wartet auf Prüfung",
    ru: "Чек консьержа ждёт проверки",
  },
  concierge_expense_posted: {
    de: "Concierge-Beleg bestätigt",
    ru: "Чек консьержа подтверждён",
  },
  concierge_expense_rejected: {
    de: "Concierge-Beleg abgelehnt",
    ru: "Чек консьержа отклонён",
  },
  concierge_expense_reversed: {
    de: "Concierge-Ausgabe storniert",
    ru: "Расход консьержа сторнирован",
  },
};

// Receipt notifications carry vendor, amount and reason as JSON. Rows written
// before that carry an English sentence; its facts are recovered for display.
function conciergeExpenseNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  const titles = CONCIERGE_EXPENSE_TITLES[item.kind];
  if (!titles) return null;
  const data = parseNotificationBody<{
    vendor?: string;
    amount_gross?: string;
    currency?: string;
    reason?: string;
  }>(item.body) ?? legacyExpenseNotificationFacts(item.body ?? "");
  const reasonLabel = lang === "de" ? "Grund" : "Причина";
  if (data.reason) return { title: titles[lang], body: `${reasonLabel}: ${data.reason}` };
  if (data.vendor || data.amount_gross) {
    const amount = data.amount_gross
      ? formatMoneyAmount(data.amount_gross, data.currency ?? "EUR")
      : null;
    return { title: titles[lang], body: [data.vendor, amount].filter(Boolean).join(" · ") };
  }
  return { title: titles[lang], body: item.body };
}

function legacyExpenseNotificationFacts(body: string) {
  const reason = body.match(/Reason: (.*)$/s)?.[1]?.trim();
  if (reason) return { reason };
  const receipt = body.match(/receipt from (.+) for (-?[\d.]+) ([A-Z]{3})/);
  return receipt
    ? { vendor: receipt[1], amount_gross: receipt[2], currency: receipt[3] }
    : {};
}

const SERVICE_KIND_LABELS: Record<string, { de: string; ru: string }> = {
  hotel: { de: "Hotel", ru: "Отель" },
  transfer: { de: "Transfer", ru: "Трансфер" },
  vip_terminal: { de: "VIP-Terminal", ru: "VIP-терминал" },
  flight: { de: "Flug", ru: "Перелёт" },
  chauffeur: { de: "Chauffeur", ru: "Водитель" },
  translation_support: { de: "Übersetzungsunterstützung", ru: "Помощь с переводом" },
  other: { de: "Sonstiges", ru: "Другое" },
};

function conciergeServiceRequestNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind !== "concierge_service_request") return null;
  const data = parseNotificationBody<{
    patient_label?: string;
    service_kind?: string;
    title?: string;
    starts_at?: string | null;
  }>(item.body);
  const patient = data?.patient_label ?? item.title.replace(/^Patient service request:\s*/, "");
  const title = `${lang === "de" ? "Serviceanfrage des Patienten" : "Запрос услуги от пациента"}: ${patient}`;
  if (!data) return { title, body: item.body };
  const start = data.starts_at ? new Date(data.starts_at) : null;
  const slot = start && Number.isFinite(start.getTime())
    ? appDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(start)
    : lang === "de" ? "ohne Wunschtermin" : "без желаемого времени";
  const kind = SERVICE_KIND_LABELS[data.service_kind ?? ""]?.[lang];
  return { title, body: [kind, data.title, slot].filter(Boolean).join(" · ") };
}

const INTERPRETER_WORK_TITLES: Record<string, { de: string; ru: string }> = {
  interpreter_report_submitted: {
    de: "Dolmetscherbericht wartet auf Prüfung",
    ru: "Отчёт переводчика ждёт проверки",
  },
  interpreter_report_approved: {
    de: "Dolmetscherbericht bestätigt",
    ru: "Отчёт переводчика подтверждён",
  },
  interpreter_report_rejected: {
    de: "Dolmetscherbericht zur Überarbeitung zurückgegeben",
    ru: "Отчёт переводчика возвращён на доработку",
  },
  interpreter_clarification_requested: {
    de: "Dolmetscher benötigt eine Klärung",
    ru: "Переводчику нужно уточнение",
  },
};

type InterpreterWorkNotificationBody = {
  appointment_title?: string | null;
  appointment_date?: string | null;
  time_start?: string | null;
  interpreter_name?: string | null;
  hours?: string | null;
  reviewer_name?: string | null;
  notes?: string | null;
  comment?: string | null;
};

// Interpreter report and clarification notifications store their facts as
// JSON; the wording follows the staff language.
function interpreterWorkNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  const titles = INTERPRETER_WORK_TITLES[item.kind];
  if (!titles) return null;
  let data: InterpreterWorkNotificationBody = {};
  try {
    data = JSON.parse(item.body ?? "{}") ?? {};
  } catch {
    data = {};
  }
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const date = formatDateKey(data.appointment_date, locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  const when = [
    date || null,
    data.time_start,
  ].filter(Boolean).join(" ");
  const parts = [[data.appointment_title, when].filter(Boolean).join(" · ")];
  const hours = Number(data.hours);
  if (item.kind === "interpreter_report_submitted") {
    parts.push([
      data.interpreter_name,
      Number.isFinite(hours) && hours > 0
        ? `${hours.toLocaleString(locale)} ${lang === "de" ? "Std." : "ч"}`
        : null,
    ].filter(Boolean).join(" · "));
  }
  if (item.kind === "interpreter_report_approved" && data.reviewer_name) {
    parts.push(`${lang === "de" ? "Bestätigt von" : "Подтвердил(а)"}: ${data.reviewer_name}`);
  }
  if (item.kind === "interpreter_report_rejected" && data.notes) {
    parts.push(`${lang === "de" ? "Hinweis" : "Замечание"}: ${data.notes}`);
  }
  if (item.kind === "interpreter_clarification_requested") {
    parts.push([data.interpreter_name, data.comment].filter(Boolean).join(": "));
  }
  const body = parts.filter(Boolean).join(" — ");
  return { title: titles[lang], body: body || null };
}

// The server stores task notification titles as English templates; the body
// carries the task title, which may itself be a generated checklist template.
const TASK_NOTIFICATION_TITLES: Record<string, { de: string; ru: string }> = {
  "New task": { de: "Neue Aufgabe", ru: "Новая задача" },
  "Task updated": { de: "Aufgabe aktualisiert", ru: "Задача обновлена" },
  "Task status changed": { de: "Aufgabenstatus geändert", ru: "Статус задачи изменён" },
  "Task attachment added": { de: "Anhang zur Aufgabe hinzugefügt", ru: "К задаче добавлен файл" },
  "Task attachment deleted": { de: "Anhang der Aufgabe gelöscht", ru: "Файл задачи удалён" },
  "Task archived": { de: "Aufgabe archiviert", ru: "Задача перенесена в архив" },
  "Task restored from archive": { de: "Aufgabe aus dem Archiv wiederhergestellt", ru: "Задача восстановлена из архива" },
  "Task deleted": { de: "Aufgabe gelöscht", ru: "Задача удалена" },
  "New task comment": { de: "Neuer Kommentar zur Aufgabe", ru: "Новый комментарий к задаче" },
  "Task reminder": { de: "Aufgabenerinnerung", ru: "Напоминание о задаче" },
};

function taskNotificationTitle(item: Notification, lang: "ru" | "de"): string | null {
  if (!item.kind.startsWith("operational_task_") && item.kind !== "concierge_task_reminder") {
    return null;
  }
  return TASK_NOTIFICATION_TITLES[item.title]?.[lang] ?? null;
}

export interface ActiveSession {
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
}

export interface ActiveAnnouncement {
  id: string;
  title: string;
  message: string;
  variant: string;
}

export interface ChatMessage {
  from_user: string;
  message: string;
  created_at: string;
}

export interface NewLeadQueueItem {
  id: string;
  first_name: string;
  last_name: string;
  country: string | null;
  created_at: string;
}

export function oldestNewLead(items: NewLeadQueueItem[]) {
  return items.reduce<NewLeadQueueItem | null>((oldest, item) => {
    if (!oldest) return item;
    const oldestTime = Date.parse(oldest.created_at);
    const itemTime = Date.parse(item.created_at);
    if (!Number.isFinite(itemTime)) return oldest;
    if (!Number.isFinite(oldestTime) || itemTime < oldestTime) return item;
    return oldest;
  }, null);
}

export function sortNewLeadQueue(items: NewLeadQueueItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.created_at);
    const rightTime = Date.parse(right.created_at);
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return leftTime - rightTime;
  });
}

export async function fetchNewLeadQueue() {
  const items = await apiFetch<NewLeadQueueItem[]>("/leads?status=new", {
    forceFresh: true,
  });
  return sortNewLeadQueue(items);
}

export async function fetchOldestNewLead() {
  const items = await fetchNewLeadQueue();
  return oldestNewLead(items);
}

export function notificationHrefForRole(item: Notification, role: string) {
  if (!item.entity_type) return null;

  if (role === "patient") {
    switch (item.entity_type) {
      case "message_peer":
        return item.entity_id ? `/chat?peer=${item.entity_id}` : "/chat";
      case "appointment":
      case "appointment_request":
        return "/appointments";
      case "concierge_service":
        return "/services";
      case "document":
      case "translation_request":
        return "/documents";
      case "invoice":
        return "/invoices";
      case "recommendation":
        return "/recommendations";
      case "service_package":
      case "patient_service_package":
        return "/subscriptions";
      case "privacy_request":
        return "/privacy";
      case "feedback":
        return "/feedback";
      default:
        return null;
    }
  }

  if (!item.entity_id) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient" && item.kind.startsWith("medication_ai_")) {
    return `/patients/${item.entity_id}?tab=clinical`;
  }
  if (item.entity_type === "patient") return `/patients?patient=${item.entity_id}`;
  if (item.entity_type === "provider") return `/providers/${item.entity_id}`;
  if (item.entity_type === "order") return `/orders?order=${item.entity_id}`;
  if (item.entity_type === "appointment") return `/appointments?appointment=${item.entity_id}`;
  if (item.entity_type === "appointment_request") return "/appointments";
  if (item.entity_type === "concierge_service") {
    return role === "concierge" ? "/concierge" : "/services";
  }
  if (item.entity_type === "concierge_task") {
    return [
      "ceo",
      "ceo_assistant",
      "billing",
      "patient_manager",
      "sales",
      "concierge",
      "teamlead_interpreter",
      "interpreter",
    ].includes(role)
      ? `/task-manager?task=${item.entity_id}`
      : null;
  }
  if (item.entity_type === "concierge_expense") {
    if (role === "ceo" || role === "billing") {
      return `/company-finance?tab=concierge-expenses&expense=${item.entity_id}`;
    }
    return role === "concierge" ? "/concierge" : null;
  }
  if (item.entity_type === "document") return `/documents?document=${item.entity_id}`;
  if (item.entity_type === "invoice") return `/invoices?invoice=${item.entity_id}`;
  if (item.entity_type === "external_invoice") {
    return `/company-finance?provider_invoice=${item.entity_id}`;
  }
  if (item.entity_type === "privacy_request") return "/admin/compliance";
  if (item.entity_type === "feedback") return "/feedback";
  if (item.entity_type === "case") return "/patients";
  return null;
}

const TOPBAR_FAST_CACHE_TTL_MS = 10_000;
const TOPBAR_PANEL_CACHE_TTL_MS = 15_000;
const TOPBAR_STATIC_CACHE_TTL_MS = 60_000;

export async function fetchTopbarPresence() {
  const [countPayload, onlineUsers] = await Promise.all([
    apiFetch<{ count: number }>("/notifications/unread-count", {
      cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
    }).catch(() => null),
    apiFetch<ActiveSession[]>("/users/online", {
      cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return {
    unreadCount: countPayload?.count ?? 0,
    onlineUsers,
  };
}

export async function fetchUnreadNotificationCount() {
  const payload = await apiFetch<{ count: number }>("/notifications/unread-count", {
    cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
  }).catch(() => null);
  return payload?.count ?? 0;
}

export function fetchUserNotifications(options: { forceFresh?: boolean } = {}) {
  return apiFetch<Notification[]>("/notifications", {
    cacheTtlMs: options.forceFresh ? undefined : TOPBAR_PANEL_CACHE_TTL_MS,
    forceFresh: options.forceFresh,
  });
}

export async function fetchNotificationPanelWorkspace() {
  const [notifications, announcements] = await Promise.all([
    fetchUserNotifications().catch(() => []),
    apiFetch<ActiveAnnouncement[]>("/announcements/active", {
      cacheTtlMs: TOPBAR_STATIC_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return { notifications, announcements };
}

export function markAllNotificationsRead() {
  return apiFetch("/notifications/read-all", { method: "POST" });
}

export function markNotificationRead(id: string) {
  return apiFetch(`/notifications/${id}/read`, { method: "POST" });
}

export function dismissActiveAnnouncement(id: string) {
  return apiFetch(`/announcements/${id}/dismiss`, { method: "POST" });
}

export function fetchTopbarChatMessages(userId: string) {
  return apiFetch<ChatMessage[]>(`/messages/${userId}`);
}

export async function markTopbarChatRead(userId: string) {
  const receipt = await apiFetch(`/messages/${userId}/read`, { method: "POST" });
  notifyChatRead();
  return receipt;
}

export function sendTopbarChatMessage(userId: string, message: string) {
  return apiFetch(`/messages/${userId}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
