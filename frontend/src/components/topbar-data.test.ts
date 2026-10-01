import { describe, expect, it } from "vitest";

import {
  isAnnouncementDismissible,
  localizedNotificationCopy,
  notificationHrefForRole,
  oldestNewLead,
  sortNewLeadQueue,
  type Notification,
} from "./topbar-data";

const queueLead = (id: string, createdAt: string) => ({
  id,
  first_name: id,
  last_name: "Lead",
  country: null,
  created_at: createdAt,
});

it("renders payment deadlines as localized follow-up notices with the correct currency", () => {
  const notice = { kind: "order_payment_status", body: JSON.stringify({order_number:"A-1",payment_status:"overdue",received_amount:"40",remaining_amount:"60",currency:"USD"}) } as Notification;
  const copy = localizedNotificationCopy(notice,"de");
  expect(copy.title).toContain("Zahlungsfrist überschritten");
  expect(copy.body).toContain("60,00 $");
  expect(localizedNotificationCopy(notice,"ru").title).toContain("Срок оплаты истёк");
  // The deadline is German time: 22:30Z is already 28.09 00:30 in Berlin.
  const due = { ...notice, body: JSON.stringify({ order_number: "A-1", payment_status: "overdue", received_amount: "40", remaining_amount: "60", currency: "EUR", due_at: "2026-09-27T22:30:00Z" }) };
  expect(localizedNotificationCopy(due, "de").body).toContain("Frist: 28.09.2026 00:30");
});

it("words the daily compliance deadline digest in German and Russian", () => {
  const digest = {
    kind: "compliance_deadline_digest",
    title: "Compliance deadlines 04.03.2030",
    entity_type: "compliance_digest",
    entity_id: null,
    body: JSON.stringify({
      digest_date: "2030-03-04",
      privacy: { overdue: 2, due_soon: 1, due_soon_days: 7 },
      incidents: { within_deadline: 0, deadline_missed: 1 },
      consents: { expiring: 3, within_days: 30 },
    }),
  } as Notification;
  const de = localizedNotificationCopy(digest, "de");
  expect(de.title).toBe("Datenschutz-Fristen · 04.03.2030");
  expect(de.body).toContain("2 überfällig");
  expect(de.body).toContain("1 nach der 72-h-Frist");
  expect(de.body).toContain("in 30 Tagen ab: 3");
  const ru = localizedNotificationCopy(digest, "ru");
  expect(ru.title).toBe("Сроки по защите данных · 04.03.2030");
  expect(ru.body).toContain("просрочено 2");
  expect(notificationHrefForRole(digest, "it_admin")).toBe("/admin/compliance");
  expect(notificationHrefForRole(digest, "patient_manager")).toBeNull();
});

it("shows the overdue supplier invoice notice in German and Russian", () => {
  const notice = {
    kind: "external_invoice_overdue",
    title: "External invoice overdue for A-20260901-0007",
    body: "External invoice RE-4711 became overdue on 2026-09-20 (480.00 EUR).",
  } as Notification;
  const de = localizedNotificationCopy(notice, "de");
  expect(de.title).toBe("Eingangsrechnung überfällig: A-20260901-0007");
  expect(de.body).toContain("RE-4711");
  expect(de.body).toContain("20.09.2026");
  expect(de.body).not.toContain("External");
  const ru = localizedNotificationCopy(notice, "ru");
  expect(ru.title).toBe("Входящий счёт просрочен: A-20260901-0007");
  expect(ru.body).toContain("20.09.2026");
});

describe("task notifications", () => {
  const taskNotice = (kind: string, title: string, body: string | null) =>
    ({ id: "n-1", kind, title, body, entity_type: "concierge_task", entity_id: "task-1", is_read: false, created_at: "2026-09-26T10:00:00Z" }) as Notification;

  it("localizes the stored English task titles for staff", () => {
    expect(localizedNotificationCopy(taskNotice("operational_task_assigned", "New task", "Flowers"), "ru"))
      .toEqual({ title: "Новая задача", body: "Flowers" });
    expect(localizedNotificationCopy(taskNotice("operational_task_updated", "Task status changed", "Flowers"), "de").title)
      .toBe("Aufgabenstatus geändert");
    expect(localizedNotificationCopy(taskNotice("operational_task_comment_added", "New task comment", "Flowers"), "ru").title)
      .toBe("Новый комментарий к задаче");
    expect(localizedNotificationCopy(taskNotice("concierge_task_reminder", "Task reminder", "Flowers"), "de").title)
      .toBe("Aufgabenerinnerung");
  });

  it("localizes generated checklist task titles in the body", () => {
    const copy = localizedNotificationCopy(
      taskNotice("operational_task_assigned", "New task", "Order checklist: Review order scope and convert needs into service blocks"),
      "ru",
    );
    expect(copy.body).not.toContain("Order checklist");
  });

  it("words the author's review decision for the assignee", () => {
    expect(localizedNotificationCopy(taskNotice("operational_task_review_decision", "Task returned for rework", "Flowers"), "ru").title)
      .toBe("Задача возвращена на доработку");
    expect(localizedNotificationCopy(taskNotice("operational_task_review_decision", "Task accepted", "Flowers"), "de").title)
      .toBe("Aufgabe angenommen");
  });

  it("keeps unknown titles and other notification kinds unchanged", () => {
    expect(localizedNotificationCopy(taskNotice("operational_task_updated", "Something new", "Flowers"), "ru").title)
      .toBe("Something new");
    expect(localizedNotificationCopy(taskNotice("update", "New task", "Body"), "ru"))
      .toEqual({ title: "New task", body: "Body" });
  });
});

describe("interpreter work notifications", () => {
  const notice = (kind: string, body: Record<string, unknown>) =>
    ({ id: "n-2", kind, title: "English fallback", body: JSON.stringify(body), entity_type: "appointment", entity_id: "apt-1", is_read: false, created_at: "2026-09-26T10:00:00Z" }) as Notification;

  it("tells approvers which report waits and interpreters how it was decided", () => {
    const submitted = localizedNotificationCopy(notice("interpreter_report_submitted", {
      appointment_title: "Kardiologie", appointment_date: "2026-09-26", time_start: "09:30", interpreter_name: "Iwan", hours: "2.50",
    }), "ru");
    expect(submitted.title).toBe("Отчёт переводчика ждёт проверки");
    expect(submitted.body).toContain("Kardiologie · 26.09.2026 09:30");
    expect(submitted.body).toContain("Iwan · 2,5 ч");

    const rejected = localizedNotificationCopy(notice("interpreter_report_rejected", {
      appointment_title: "Kardiologie", appointment_date: "2026-09-26", notes: "Stunden prüfen",
    }), "de");
    expect(rejected.title).toBe("Dolmetscherbericht zur Überarbeitung zurückgegeben");
    expect(rejected.body).toContain("Hinweis: Stunden prüfen");

    expect(localizedNotificationCopy(notice("interpreter_report_approved", { reviewer_name: "Anna" }), "ru").body)
      .toBe("Подтвердил(а): Anna");
    expect(localizedNotificationCopy(notice("interpreter_clarification_requested", { interpreter_name: "Iwan", comment: "Adresse?" }), "de").body)
      .toBe("Iwan: Adresse?");
    const declined = localizedNotificationCopy(notice("interpreter_booking_declined", {
      appointment_title: "Kardiologie", appointment_date: "2026-09-26", interpreter_name: "Iwan", comment: "Krank",
    }), "ru");
    expect(declined.title).toBe("Переводчик отказался от назначения");
    expect(declined.body).toBe("Kardiologie · 26.09.2026 — Iwan: Krank");
  });

  it("tells the interpreter about changes of the own booking in RU and DE", () => {
    const booked = localizedNotificationCopy(notice("interpreter_booking_assigned", {
      appointment_title: "Kardiologie", appointment_date: "2026-10-02", time_start: "09:30", occurrence_count: 3,
    }), "de");
    expect(booked.title).toBe("Sie wurden als Dolmetscher gebucht");
    expect(booked.body).toBe("Kardiologie · 02.10.2026 09:30 — Bitte den Einsatz bestätigen oder ablehnen — Serie: 3 Termine");

    expect(localizedNotificationCopy(notice("interpreter_booking_removed", { appointment_title: "Kardiologie" }), "ru").title)
      .toBe("Вас сняли с назначения");

    const moved = localizedNotificationCopy(notice("interpreter_appointment_rescheduled", {
      appointment_title: "Kardiologie", appointment_date: "2026-10-03", time_start: "11:00",
      previous_date: "2026-10-02", previous_time_start: "09:30", response_reset: true,
    }), "ru");
    expect(moved.title).toBe("Приём, на который вы назначены, изменён");
    expect(moved.body).toBe("Kardiologie · 03.10.2026 11:00 — Было: 02.10.2026 09:30 — Подтвердите участие ещё раз");

    const deleted = localizedNotificationCopy(notice("interpreter_appointment_cancelled", {
      appointment_title: "Kardiologie", appointment_date: "2026-10-02", deleted: true,
    }), "de");
    expect(deleted.title).toBe("Gebuchter Termin abgesagt");
    expect(deleted.body).toBe("Kardiologie · 02.10.2026 — Termin gelöscht");

    expect(localizedNotificationCopy(notice("interpreter_report_auto_rejected", {
      appointment_title: "Kardiologie", reason: "interpreter_changed",
    }), "ru").body).toBe("Kardiologie — Причина: назначен другой переводчик");
  });

  it("shows a delivered appointment reminder with its visit", () => {
    const reminder = localizedNotificationCopy(notice("appointment_reminder", {
      reminder_title: "Unterlagen mitnehmen", appointment_title: "Kardiologie", appointment_date: "2026-10-02", time_start: "09:30",
    }), "ru");
    expect(reminder.title).toBe("Напоминание по приёму");
    expect(reminder.body).toBe("Unterlagen mitnehmen — Kardiologie · 02.10.2026 09:30");
    expect(localizedNotificationCopy(notice("appointment_reminder", {}), "de").title).toBe("Terminerinnerung");
  });

  it("survives a body that is not JSON", () => {
    const broken = { ...notice("interpreter_report_approved", {}), body: "plain text" };
    expect(localizedNotificationCopy(broken, "ru")).toEqual({ title: "Отчёт переводчика подтверждён", body: null });
  });
});

describe("concierge expense and service request notifications", () => {
  const notice = (kind: string, body: string | null, title = "English fallback") =>
    ({ id: "n-3", kind, title, body, entity_type: "concierge_expense", entity_id: "e-1", is_read: false, created_at: "2026-09-26T10:00:00Z" }) as Notification;

  it("words receipt decisions in the staff language", () => {
    const submitted = localizedNotificationCopy(notice("concierge_expense_submitted", JSON.stringify({ vendor: "Blumen Koch", amount_gross: "45.50", currency: "EUR" })), "de");
    expect(submitted.title).toBe("Concierge-Beleg wartet auf Prüfung");
    expect(submitted.body).toContain("Blumen Koch");
    expect(submitted.body).toContain("45,50");
    expect(localizedNotificationCopy(notice("concierge_expense_rejected", JSON.stringify({ reason: "Unleserlich" })), "ru"))
      .toEqual({ title: "Чек консьержа отклонён", body: "Причина: Unleserlich" });
  });

  it("recovers the facts of receipts notified before the change", () => {
    const legacy = localizedNotificationCopy(notice("concierge_expense_submitted", "A new receipt from Blumen Koch for 45.50 EUR is waiting for financial review."), "ru");
    expect(legacy.title).toBe("Чек консьержа ждёт проверки");
    expect(legacy.body).toContain("Blumen Koch");
    expect(localizedNotificationCopy(notice("concierge_expense_reversed", "The posted expense was reversed. Reason: Doppelt"), "de").body)
      .toBe("Grund: Doppelt");
  });

  it("names the requested service kind and slot", () => {
    const copy = localizedNotificationCopy(
      notice("concierge_service_request", JSON.stringify({ patient_label: "PT-1 · Anna", service_kind: "transfer", title: "Airport pickup", starts_at: null }), "Patient service request: PT-1 · Anna"),
      "ru",
    );
    expect(copy.title).toBe("Запрос услуги от пациента: PT-1 · Anna");
    expect(copy.body).toBe("Трансфер · Airport pickup · без желаемого времени");
  });

  it("asks for a decision on a concierge booking whose appointment was cancelled", () => {
    const body = JSON.stringify({ title: "Hotel Adlon", vendor_name: "Adlon", starts_at: null, reason: "appointment_cancelled" });
    expect(localizedNotificationCopy(notice("concierge_booking_decision", body), "de")).toEqual({
      title: "Termin abgesagt – Concierge-Buchung prüfen",
      body: "Hotel Adlon · Adlon. Buchung behalten oder Service stornieren",
    });
    expect(localizedNotificationCopy(notice("concierge_booking_decision", body), "ru").title)
      .toBe("Термин отменён — проверьте бронирование консьержа");
  });
});

describe("oldestNewLead", () => {
  it("selects the earliest unprocessed lead for FIFO handling", () => {
    expect(
      oldestNewLead([
        queueLead("lead-newest", "2026-09-04T10:00:00Z"),
        queueLead("lead-oldest", "2026-08-30T10:00:00Z"),
        queueLead("lead-middle", "2026-09-01T10:00:00Z"),
      ])?.id,
    ).toBe("lead-oldest");
  });

  it("returns null for an empty queue", () => {
    expect(oldestNewLead([])).toBeNull();
  });
});

describe("sortNewLeadQueue", () => {
  it("orders the selectable queue from oldest to newest", () => {
    expect(
      sortNewLeadQueue([
        queueLead("lead-newest", "2026-09-04T10:00:00Z"),
        queueLead("lead-oldest", "2026-08-30T10:00:00Z"),
        queueLead("lead-middle", "2026-09-01T10:00:00Z"),
      ]).map((lead) => lead.id),
    ).toEqual(["lead-oldest", "lead-middle", "lead-newest"]);
  });
});

function notification(entityType: string, entityId = "entity-1"): Notification {
  return {
    id: "notification-1",
    kind: "update",
    title: "Update",
    body: null,
    entity_type: entityType,
    entity_id: entityId,
    is_read: false,
    created_at: "2026-08-19T12:00:00Z",
  };
}

describe("notificationHrefForRole", () => {
  it("routes patient notifications only to portal-safe destinations", () => {
    expect(notificationHrefForRole(notification("document"), "patient")).toBe("/documents");
    expect(notificationHrefForRole(notification("recommendation"), "patient")).toBe("/recommendations");
    expect(notificationHrefForRole(notification("invoice"), "patient")).toBe("/invoices");
    expect(notificationHrefForRole(notification("privacy_request"), "patient")).toBe("/privacy");
  });

  it("opens an overdue company invoice in company finance", () => {
    expect(notificationHrefForRole(notification("external_invoice", "invoice-1"), "billing")).toBe(
      "/company-finance?provider_invoice=invoice-1",
    );
    expect(notificationHrefForRole(notification("external_invoice", "invoice-1"), "patient")).toBeNull();
  });

  it("opens Medication AI notifications on the patient's clinical workspace", () => {
    const item = notification("patient", "patient-1");
    item.kind = "medication_ai_ready";

    expect(notificationHrefForRole(item, "ceo")).toBe(
      "/patients/patient-1?tab=clinical",
    );
    expect(notificationHrefForRole(item, "patient")).toBeNull();
  });

  it("does not expose staff-only entities to patients", () => {
    expect(notificationHrefForRole(notification("patient"), "patient")).toBeNull();
    expect(notificationHrefForRole(notification("order"), "patient")).toBeNull();
    expect(notificationHrefForRole(notification("provider"), "patient")).toBeNull();
  });

  it("keeps entity-specific staff destinations", () => {
    expect(notificationHrefForRole(notification("order"), "ceo")).toBe("/orders?order=entity-1");
    expect(notificationHrefForRole(notification("concierge_service"), "concierge")).toBe("/concierge");
    expect(notificationHrefForRole(notification("concierge_task"), "concierge")).toBe("/task-manager?task=entity-1");
    expect(notificationHrefForRole(notification("concierge_task"), "billing")).toBe("/task-manager?task=entity-1");
    expect(notificationHrefForRole(notification("concierge_task"), "patient_manager")).toBe("/task-manager?task=entity-1");
    expect(notificationHrefForRole(notification("concierge_task"), "teamlead_interpreter")).toBe("/task-manager?task=entity-1");
    expect(notificationHrefForRole(notification("concierge_task"), "interpreter")).toBe("/task-manager?task=entity-1");
    expect(notificationHrefForRole(notification("concierge_expense"), "billing")).toBe(
      "/company-finance?tab=concierge-expenses&expense=entity-1",
    );
    expect(notificationHrefForRole(notification("concierge_expense"), "ceo")).toBe(
      "/company-finance?tab=concierge-expenses&expense=entity-1",
    );
    expect(notificationHrefForRole(notification("concierge_expense"), "concierge")).toBe("/concierge");
    expect(notificationHrefForRole(notification("concierge_expense"), "patient_manager")).toBeNull();
  });

  it("opens compliance notifications where the recipient decides them", () => {
    const retention = notification("patient", "patient-1");
    retention.kind = "privacy_request";
    expect(notificationHrefForRole(retention, "it_admin")).toBe("/admin/compliance");
    expect(notificationHrefForRole(retention, "ceo")).toBe("/admin/compliance");
    expect(notificationHrefForRole(retention, "patient_manager")).toBe("/patients?patient=patient-1");

    const incident = notification("security_incident", "incident-1");
    incident.kind = "security_incident";
    expect(notificationHrefForRole(incident, "it_admin")).toBe("/incidents");
  });
});

describe("localizedNotificationCopy", () => {
  it("localizes successful Medication AI notifications without bilingual text", () => {
    const item = notification("patient");
    item.kind = "medication_ai_ready";
    item.title = "server fallback";
    item.body = "server fallback body";

    expect(localizedNotificationCopy(item, "ru")).toEqual({
      title: "AI-черновик готов",
      body: "Обезличенный черновик доступен для проверки по источникам.",
    });
    expect(localizedNotificationCopy(item, "de")).toEqual({
      title: "KI-Entwurf bereit",
      body: "Der de-identifizierte Entwurf kann anhand der Quellen geprüft werden.",
    });
  });

  it("localizes failed Medication AI notifications and preserves unrelated notifications", () => {
    const failed = notification("patient");
    failed.kind = "medication_ai_failed";
    expect(localizedNotificationCopy(failed, "de").title).toBe("KI-Entwurf fehlgeschlagen");

    const regular = notification("document");
    expect(localizedNotificationCopy(regular, "ru")).toEqual({
      title: regular.title,
      body: regular.body,
    });
  });
});

it("keeps an error announcement on screen while it is active", () => {
  expect(isAnnouncementDismissible({ variant: "error", dismissible: false })).toBe(false);
  expect(isAnnouncementDismissible({ variant: "warning", dismissible: true })).toBe(true);
  // Without the flag (older server) the level decides.
  expect(isAnnouncementDismissible({ variant: "error" })).toBe(false);
  expect(isAnnouncementDismissible({ variant: "info" })).toBe(true);
});

describe("personnel file notifications", () => {
  const personnel = (kind: string, title: string, body: string, entityType = "personnel") =>
    ({
      id: kind,
      kind,
      title,
      body,
      entity_type: entityType,
      entity_id: entityType === "personnel" ? null : "run-1",
      is_read: false,
      created_at: "2026-10-01T06:00:00Z",
    }) as Notification;

  it("opens the matching tab of the personnel files page", () => {
    expect(
      notificationHrefForRole(personnel("personnel_intake", "Personnel file: new scan to file", ""), "ceo"),
    ).toBe("/personnel?tab=intake");
    expect(
      notificationHrefForRole(personnel("personnel_missing_documents", "x", ""), "ceo"),
    ).toBe("/personnel?tab=completeness");
    expect(
      notificationHrefForRole(
        personnel("personnel_integrity_failed", "x", "", "personnel_integrity_run"),
        "ceo",
      ),
    ).toBe("/personnel?tab=integrity");
    expect(notificationHrefForRole(personnel("personnel_intake", "x", ""), "patient")).toBeNull();
  });

  it("words the stored English notices in German and Russian", () => {
    const missing = personnel(
      "personnel_missing_documents",
      "Personnel files: documents missing for 09.2026",
      "3 expected monthly documents for 2 employees have not been archived.",
    );
    const de = localizedNotificationCopy(missing, "de");
    expect(de.title).toBe("Personalakten: Dokumente fehlen für 09.2026");
    expect(de.body).toContain("3");
    expect(de.body).toContain("2");
    expect(localizedNotificationCopy(missing, "ru").title).toContain("09.2026");

    const integrity = personnel(
      "personnel_integrity_failed",
      "Personnel files: integrity check failed",
      "4 problems found in the personnel archive. Open Personnel files → Integrity.",
      "personnel_integrity_run",
    );
    expect(localizedNotificationCopy(integrity, "de").body).toContain("Abweichungen im Archiv: 4");
    expect(localizedNotificationCopy(personnel("personnel_intake", "x", "y"), "ru").title).toBe(
      "Личные дела: новый скан",
    );
  });
});

describe("lead retention notifications", () => {
  const retention = (kind: string, title: string, body: string) =>
    ({
      id: kind,
      kind,
      title,
      body,
      entity_type: "lead",
      entity_id: "lead-1",
      is_read: false,
      created_at: "2026-10-01T06:00:00Z",
    }) as Notification;

  it("announces the automatic deletion with the date in the app format", () => {
    const warning = retention(
      "lead_retention_warning",
      "Lead will be deleted automatically",
      "Not qualified and no signed consent; deletion on 2026-10-15.",
    );
    expect(localizedNotificationCopy(warning, "ru")).toEqual({
      title: "Лид будет удалён автоматически",
      body: "Не квалифицирован и нет подписанного согласия; удаление 15.10.2026. Все документы удаляются вместе с ним.",
    });
    expect(localizedNotificationCopy(warning, "de").body).toContain("Löschung am 15.10.2026");
    expect(notificationHrefForRole(warning, "ceo")).toBe("/leads?lead=lead-1");
  });

  it("asks for a decision when a due lead cannot be deleted automatically", () => {
    const blocked = retention(
      "lead_retention_blocked",
      "Lead is due for deletion and needs a decision",
      "It has an order with an invoice or an order that could not be withdrawn.",
    );
    expect(localizedNotificationCopy(blocked, "ru").title).toBe("Срок хранения лида истёк — нужно решение");
    expect(localizedNotificationCopy(blocked, "de").title).toBe("Lead ist zur Löschung fällig – Entscheidung nötig");
  });
});
