import { apiFetch } from "@/lib/api";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { notifyChatRead } from "@/lib/chat-read-events";
import { formatMoneyAmount } from "@/lib/money";
import { paymentStatusLabel } from "@/lib/payment-status";
import { formatUiText, t as translationsFor, uiText } from "@/lib/i18n";
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
      const due = data.due_at ? formatAppDateTime(data.due_at) : "";
      const deadline = due ? ` · ${lang === "de" ? "Frist" : "Срок"}: ${due}` : "";
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
  const reminderCopy = appointmentReminderNotificationCopy(item, lang);
  if (reminderCopy) return reminderCopy;
  if (item.kind === "appointment_request_withdrawn") {
    const data = parseNotificationBody<{ patient_pid?: string | null; patient_name?: string | null; reason?: string | null }>(item.body);
    const patient = [data?.patient_pid, data?.patient_name].filter(Boolean).join(" · ");
    return {
      title: lang === "de" ? "Terminanfrage vom Patienten zurückgezogen" : "Пациент отозвал запрос на приём",
      body: [patient, data?.reason ? `${lang === "de" ? "Grund" : "Причина"}: ${data.reason}` : null]
        .filter(Boolean)
        .join(" — ") || null,
    };
  }
  const leadRetentionCopy = leadRetentionNotificationCopy(item, lang);
  if (leadRetentionCopy) return leadRetentionCopy;
  const personnelCopy = personnelNotificationCopy(item, lang);
  if (personnelCopy) return personnelCopy;
  const digestCopy = complianceDigestNotificationCopy(item, lang);
  if (digestCopy) return digestCopy;
  const overdueSupplierCopy = externalInvoiceOverdueNotificationCopy(item, lang);
  if (overdueSupplierCopy) return overdueSupplierCopy;
  const interpreterCopy = interpreterWorkNotificationCopy(item, lang);
  if (interpreterCopy) return interpreterCopy;
  const expenseCopy = conciergeExpenseNotificationCopy(item, lang);
  if (expenseCopy) return expenseCopy;
  const serviceRequestCopy = conciergeServiceRequestNotificationCopy(item, lang);
  if (serviceRequestCopy) return serviceRequestCopy;
  const bookingDecisionCopy = conciergeBookingDecisionNotificationCopy(item, lang);
  if (bookingDecisionCopy) return bookingDecisionCopy;
  const taskTitle = taskNotificationTitle(item, lang);
  if (taskTitle) {
    return { title: taskTitle, body: item.body ? localizeTaskTitle(item.body, lang) : null };
  }
  return { title: item.title, body: item.body };
}

// Unqualified-lead deletion notices (crates/server/src/routes/leads.rs) are
// stored in English; the deletion date is read back from the stored text.
export function leadRetentionNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind === "lead_retention_warning") {
    const isoDate = /(\d{4}-\d{2}-\d{2})/.exec(item.body ?? "")?.[1];
    const date = isoDate ? formatAppDate(`${isoDate}T12:00:00Z`) : "";
    return lang === "de"
      ? {
          title: "Lead wird automatisch gelöscht",
          body: `Nicht qualifiziert und ohne unterschriebene Einwilligung${date ? `; Löschung am ${date}` : ""}. Alle Dokumente werden mitgelöscht.`,
        }
      : {
          title: "Лид будет удалён автоматически",
          body: `Не квалифицирован и нет подписанного согласия${date ? `; удаление ${date}` : ""}. Все документы удаляются вместе с ним.`,
        };
  }
  if (item.kind === "lead_retention_blocked") {
    return lang === "de"
      ? {
          title: "Lead ist zur Löschung fällig – Entscheidung nötig",
          body: "Es gibt einen Auftrag mit Rechnung oder einen Auftrag, der nicht zurückgezogen werden konnte.",
        }
      : {
          title: "Срок хранения лида истёк — нужно решение",
          body: "У лида есть заказ со счётом или заказ, который не удалось отозвать.",
        };
  }
  return null;
}

const PERSONNEL_NOTIFICATION_TABS: Record<string, string> = {
  personnel_intake: "intake",
  personnel_missing_documents: "completeness",
  personnel_integrity_failed: "integrity",
};

// Personnel file notices (crates/server/src/routes/personnel/) are stored in
// English; the counts and the month are read back from the stored text.
export function personnelNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  const tr = translationsFor(lang);
  const numbers = (item.body ?? "").match(/\d+/g) ?? [];
  if (item.kind === "personnel_intake") {
    return {
      title: tr.personnel_notification_intake_title,
      body: tr.personnel_notification_intake_body,
    };
  }
  if (item.kind === "personnel_missing_documents") {
    const month = /(\d{2}\.\d{4})/.exec(item.title)?.[1] ?? "";
    return {
      title: formatUiText(tr.personnel_notification_missing_title, { month }),
      body:
        numbers.length >= 2
          ? formatUiText(tr.personnel_notification_missing_body, {
              documents: numbers[0],
              employees: numbers[1],
            })
          : item.body,
    };
  }
  if (item.kind === "personnel_integrity_failed") {
    return {
      title: tr.personnel_notification_integrity_title,
      body:
        numbers.length >= 1
          ? formatUiText(tr.personnel_notification_integrity_body, { count: numbers[0] })
          : item.body,
    };
  }
  return null;
}

type ComplianceDigestBody = {
  digest_date?: string;
  privacy?: { overdue?: number; due_soon?: number; due_soon_days?: number };
  incidents?: { within_deadline?: number; deadline_missed?: number };
  consents?: { expiring?: number; within_days?: number };
};

// The daily compliance deadline digest (crates/server/src/services/
// compliance_digest.rs) stores its counts as JSON; the wording follows the
// staff language and the date is the German calendar day.
export function complianceDigestNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind !== "compliance_deadline_digest") return null;
  const data = parseNotificationBody<ComplianceDigestBody>(item.body) ?? {};
  const title = `${uiText("digest_title", lang)}${data.digest_date ? ` · ${formatAppDate(data.digest_date)}` : ""}`;
  const lines: string[] = [];
  const privacyOverdue = data.privacy?.overdue ?? 0;
  const privacySoon = data.privacy?.due_soon ?? 0;
  if (privacyOverdue + privacySoon > 0) {
    lines.push(
      uiText("digest_privacy", lang, {
        overdue: privacyOverdue,
        soon: privacySoon,
        days: data.privacy?.due_soon_days ?? 7,
      }),
    );
  }
  const within = data.incidents?.within_deadline ?? 0;
  const missed = data.incidents?.deadline_missed ?? 0;
  if (within + missed > 0) {
    lines.push(uiText("digest_incidents", lang, { within, missed }));
  }
  const expiring = data.consents?.expiring ?? 0;
  if (expiring > 0) {
    lines.push(
      uiText("digest_consents", lang, {
        count: expiring,
        days: data.consents?.within_days ?? 30,
      }),
    );
  }
  return { title, body: lines.join(" · ") || null };
}

// The supplier-invoice overdue scheduler (crates/server/src/routes/orders.rs)
// writes an English title and body; their facts are shown in RU/DE.
function externalInvoiceOverdueNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind !== "external_invoice_overdue") return null;
  const subject = item.title.match(/^External invoice overdue for (.+)$/)?.[1]?.trim() ?? "";
  const facts = (item.body ?? "").match(
    /^External invoice (.+) became overdue on (\d{4}-\d{2}-\d{2}) \((-?[\d.]+) ([A-Z]{3})\)\.$/,
  );
  const title = lang === "de" ? "Eingangsrechnung überfällig" : "Входящий счёт просрочен";
  if (!facts) {
    return { title: subject ? `${title}: ${subject}` : title, body: item.body };
  }
  const [, number, dueDate, amount, currency] = facts;
  const due = formatAppDate(dueDate);
  const money = formatMoneyAmount(amount, currency);
  return {
    title: subject ? `${title}: ${subject}` : title,
    body:
      lang === "de"
        ? `Rechnung ${number}, fällig am ${due}: ${money}`
        : `Счёт ${number}, срок оплаты ${due}: ${money}`,
  };
}

// A due appointment reminder, delivered by the server scheduler at its German
// time; the reminder title (and possibly a generated follow-up template) is
// shown with the visit it belongs to.
function appointmentReminderNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind !== "appointment_reminder") return null;
  const title = lang === "de" ? "Terminerinnerung" : "Напоминание по приёму";
  const data = parseNotificationBody<{
    reminder_title?: string | null;
    description?: string | null;
    appointment_title?: string | null;
    appointment_date?: string | null;
    time_start?: string | null;
  }>(item.body);
  if (!data) return { title, body: item.body };
  const when = [data.appointment_date ? formatAppDate(data.appointment_date) : null, data.time_start]
    .filter(Boolean)
    .join(" ");
  const visit = [data.appointment_title, when].filter(Boolean).join(" · ");
  const reminder = data.reminder_title ? localizeTaskTitle(data.reminder_title, lang) : null;
  return { title, body: [reminder, visit].filter(Boolean).join(" — ") || null };
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
  const slot = (data.starts_at ? formatAppDateTime(data.starts_at) : "")
    || (lang === "de" ? "ohne Wunschtermin" : "без желаемого времени");
  const kind = SERVICE_KIND_LABELS[data.service_kind ?? ""]?.[lang];
  return { title, body: [kind, data.title, slot].filter(Boolean).join(" · ") };
}

// A partner booking whose appointment was cancelled is not cancelled
// automatically; its concierge decides (keep the booking or cancel the service).
function conciergeBookingDecisionNotificationCopy(
  item: Notification,
  lang: "ru" | "de",
): Pick<Notification, "title" | "body"> | null {
  if (item.kind !== "concierge_booking_decision") return null;
  const data = parseNotificationBody<{
    title?: string;
    vendor_name?: string | null;
    starts_at?: string | null;
    reason?: string;
  }>(item.body);
  const changed = data?.reason === "appointment_type_changed";
  const title = lang === "de"
    ? changed
      ? "Termin geändert – Concierge-Buchung prüfen"
      : "Termin abgesagt – Concierge-Buchung prüfen"
    : changed
      ? "Термин изменён — проверьте бронирование консьержа"
      : "Термин отменён — проверьте бронирование консьержа";
  if (!data) return { title, body: item.body };
  const slot = data.starts_at ? formatAppDateTime(data.starts_at) : "";
  const hint = lang === "de"
    ? "Buchung behalten oder Service stornieren"
    : "Сохраните бронирование или отмените услугу";
  return {
    title,
    body: [[data.title, data.vendor_name, slot].filter(Boolean).join(" · "), hint]
      .filter(Boolean)
      .join(". "),
  };
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
  interpreter_booking_declined: {
    de: "Dolmetscher hat den Einsatz abgelehnt",
    ru: "Переводчик отказался от назначения",
  },
  // Changes of the interpreter's own booking (sent to the interpreter).
  interpreter_booking_assigned: {
    de: "Sie wurden als Dolmetscher gebucht",
    ru: "Вас назначили переводчиком",
  },
  interpreter_booking_removed: {
    de: "Ihre Dolmetscherbuchung wurde aufgehoben",
    ru: "Вас сняли с назначения",
  },
  interpreter_appointment_cancelled: {
    de: "Gebuchter Termin abgesagt",
    ru: "Приём, на который вы назначены, отменён",
  },
  interpreter_appointment_rescheduled: {
    de: "Gebuchter Termin geändert",
    ru: "Приём, на который вы назначены, изменён",
  },
  interpreter_report_auto_rejected: {
    de: "Dolmetscherbericht automatisch zurückgewiesen",
    ru: "Отчёт переводчика отклонён автоматически",
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
  location?: string | null;
  previous_date?: string | null;
  previous_time_start?: string | null;
  previous_location?: string | null;
  response_reset?: boolean | null;
  reason?: string | null;
  occurrence_count?: number | null;
  deleted?: boolean | null;
};

const AUTO_REJECTION_REASONS: Record<string, { de: string; ru: string }> = {
  appointment_cancelled: { de: "Termin abgesagt", ru: "приём отменён" },
  interpreter_changed: { de: "anderer Dolmetscher gebucht", ru: "назначен другой переводчик" },
};

/** The booking-change lines of a notification sent to the interpreter. */
function interpreterBookingNoticeParts(
  kind: string,
  data: InterpreterWorkNotificationBody,
  lang: "ru" | "de",
): string[] {
  const parts: string[] = [];
  if (kind === "interpreter_appointment_rescheduled") {
    const previous = [
      data.previous_date ? formatAppDate(data.previous_date) : null,
      data.previous_time_start,
    ].filter(Boolean).join(" ");
    if (previous) parts.push(`${lang === "de" ? "Vorher" : "Было"}: ${previous}`);
    if (data.previous_location && data.previous_location !== data.location) {
      parts.push(`${lang === "de" ? "Ort vorher" : "Место было"}: ${data.previous_location}`);
    }
    if (data.response_reset) {
      parts.push(lang === "de" ? "Bitte den Einsatz erneut bestätigen" : "Подтвердите участие ещё раз");
    }
  }
  if (kind === "interpreter_booking_assigned") {
    parts.push(lang === "de" ? "Bitte den Einsatz bestätigen oder ablehnen" : "Подтвердите или отклоните участие");
  }
  if (kind === "interpreter_appointment_cancelled" && data.deleted) {
    parts.push(lang === "de" ? "Termin gelöscht" : "Приём удалён");
  }
  if (kind === "interpreter_report_auto_rejected" && data.reason) {
    const reason = AUTO_REJECTION_REASONS[data.reason]?.[lang] ?? data.reason;
    parts.push(`${lang === "de" ? "Grund" : "Причина"}: ${reason}`);
  }
  const count = Number(data.occurrence_count);
  if (Number.isFinite(count) && count > 1) {
    parts.push(lang === "de" ? `Serie: ${count} Termine` : `Серия: ${count} приёмов`);
  }
  return parts;
}

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
  const date = data.appointment_date ? formatAppDate(data.appointment_date) : "";
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
  if (
    item.kind === "interpreter_clarification_requested" ||
    item.kind === "interpreter_booking_declined"
  ) {
    parts.push([data.interpreter_name, data.comment].filter(Boolean).join(": "));
  }
  parts.push(...interpreterBookingNoticeParts(item.kind, data, lang));
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
  // Review decisions of the author, sent to the assignee.
  "Task accepted": { de: "Aufgabe angenommen", ru: "Задача принята" },
  "Task returned for rework": { de: "Aufgabe zur Nacharbeit zurückgegeben", ru: "Задача возвращена на доработку" },
  "Task cancelled after review": { de: "Aufgabe nach Prüfung storniert", ru: "Задача отменена после проверки" },
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
  /** False for an error announcement: it stays visible while it is active. */
  dismissible?: boolean;
}

/**
 * Whether the user may hide an announcement. An error announcement cannot be
 * dismissed while it is active (announcements.rs `is_dismissible`, owner
 * decision 2026-09-28); older servers do not send the flag.
 */
export function isAnnouncementDismissible(
  announcement: Pick<ActiveAnnouncement, "variant" | "dismissible">,
): boolean {
  return announcement.dismissible ?? announcement.variant !== "error";
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

  // The daily deadline digest opens the DSGVO register (requests, consents,
  // incidents are all reachable from there).
  if (item.entity_type === "compliance_digest") {
    return role === "ceo" || role === "it_admin" ? "/admin/compliance" : null;
  }
  // Personnel file notices open the matching tab of the personnel files page.
  if (item.entity_type === "personnel" || item.entity_type === "personnel_integrity_run") {
    const tab = PERSONNEL_NOTIFICATION_TABS[item.kind];
    return tab ? `/personnel?tab=${tab}` : "/personnel";
  }
  if (!item.entity_id) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient" && item.kind.startsWith("medication_ai_")) {
    return `/patients/${item.entity_id}?tab=clinical`;
  }
  // Privacy requests (also the ones the retention sweep raises) are decided
  // in the DSGVO register; IT admin cannot open patient files.
  if (item.kind === "privacy_request" && (role === "ceo" || role === "it_admin")) {
    return "/admin/compliance";
  }
  if (item.entity_type === "security_incident") return "/incidents";
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
