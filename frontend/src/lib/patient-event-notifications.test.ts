import { describe, expect, it } from "vitest";

import { localizedNotificationCopy, notificationHrefForRole, type Notification } from "@/components/topbar-data";

import { notificationCopyFromFacts } from "./notification-copy";
import { patientEventFamily, patientEventNotificationCopy } from "./patient-event-notifications";

function notice(
  kind: string,
  entityType: string | null,
  params: Record<string, unknown> | null,
  title = "English fallback title",
  body: string | null = "English fallback body",
): Notification {
  return {
    id: "n-1",
    kind,
    title,
    body,
    params,
    entity_type: entityType,
    entity_id: "00000000-0000-0000-0000-000000000001",
    is_read: false,
    created_at: "2026-11-10T15:00:00Z",
  };
}

describe("patient notices about visits, services and money (owner decision 2026-11-10)", () => {
  it("places a code by its words and its entity, whatever its exact name", () => {
    expect(patientEventFamily({ kind: "patient_appointment_cancelled", entity_type: "appointment" })).toBe("appointment");
    expect(patientEventFamily({ kind: "appointment_moved", entity_type: null })).toBe("appointment");
    expect(patientEventFamily({ kind: "concierge_service_status_changed", entity_type: "concierge_service" })).toBe("service");
    expect(patientEventFamily({ kind: "invoice_payment_registered", entity_type: "invoice" })).toBe("money");
    expect(patientEventFamily({ kind: "credit_note_issued", entity_type: null })).toBe("money");
    // Requests, documents, chat and the rest keep their own notices.
    expect(patientEventFamily({ kind: "appointment_request_update", entity_type: "appointment_request" })).toBeNull();
    expect(patientEventFamily({ kind: "document_release", entity_type: "document" })).toBeNull();
    expect(patientEventFamily({ kind: "direct_message", entity_type: "message_peer" })).toBeNull();
    expect(patientEventFamily({ kind: "privacy_erasure_completed", entity_type: null })).toBeNull();
  });

  it("words a moved visit with its old and new time", () => {
    const moved = notice("patient_appointment_moved", "appointment", {
      title: "MRT Kontrolle",
      old_date: "2026-11-12",
      old_time_start: "08:15",
      date: "2026-11-13",
      time_start: "16:30",
    });
    expect(patientEventNotificationCopy(moved, "ru")).toEqual({
      title: "Визит перенесён",
      body: "MRT Kontrolle · 12.11.2026 08:15 → 13.11.2026 16:30",
    });
    expect(patientEventNotificationCopy(moved, "de")?.title).toBe("Termin verschoben");
  });

  it("words added, confirmed and cancelled visits", () => {
    const facts = { title: "Kardiologie", date: "2026-11-23", time_start: "14:00" };
    expect(patientEventNotificationCopy(notice("patient_appointment_created", "appointment", facts), "ru")).toEqual({
      title: "Новый визит в вашем расписании",
      body: "Kardiologie · 23.11.2026 14:00",
    });
    expect(patientEventNotificationCopy(notice("patient_appointment_confirmed", "appointment", facts), "de")?.title)
      .toBe("Termin bestätigt");
    expect(patientEventNotificationCopy(notice("patient_appointment_cancelled", "appointment", facts), "ru")?.title)
      .toBe("Визит отменён");
  });

  it("keeps the stored text when the notice carries no facts it knows", () => {
    const bare = notice("appointment_changed", "appointment", null, "Appointment changed", "See your schedule.");
    expect(patientEventNotificationCopy(bare, "ru")).toEqual({ title: "Визит изменён", body: "See your schedule." });
  });

  it("words a service change with its status and time", () => {
    const service = notice("concierge_service_status_changed", "concierge_service", {
      title: "Трансфер из аэропорта",
      status: "in_service",
      starts_at: "2026-11-15T14:30:00Z",
    });
    const copy = patientEventNotificationCopy(service, "ru");
    expect(copy?.title).toBe("Статус сервиса изменён");
    expect(copy?.body).toContain("Трансфер из аэропорта");
    expect(copy?.body).toContain("15.11.2026 15:30");
    expect(patientEventNotificationCopy(notice("concierge_service_cancelled", "concierge_service", {}), "de")?.title)
      .toBe("Service storniert");
  });

  it("words a registered payment, a new invoice and a correction", () => {
    const payment = notice("invoice_payment_registered", "invoice", { invoice_number: "INV-1", amount: "400.00", currency: "EUR" });
    const copy = patientEventNotificationCopy(payment, "de");
    expect(copy?.title).toBe("Zahlung verbucht");
    expect(copy?.body).toContain("INV-1");
    expect(copy?.body).toContain("400,00");
    expect(patientEventNotificationCopy(notice("invoice_released", "invoice", { invoice_number: "INV-2" }), "ru"))
      .toEqual({ title: "Новый счёт", body: "INV-2" });
    expect(patientEventNotificationCopy(notice("invoice_credit_note_created", "invoice", {}), "ru")?.title)
      .toBe("Корректировка счёта");
  });

  it("applies in the patient's portal only: staff keep the stored notice", () => {
    const cancelled = notice("patient_appointment_cancelled", "appointment", { title: "Kardiologie", date: "2026-11-23" });
    expect(localizedNotificationCopy(cancelled, "ru", "patient").title).toBe("Визит отменён");
    expect(localizedNotificationCopy(cancelled, "ru", "patient_manager").title).toBe("English fallback title");
    expect(localizedNotificationCopy(cancelled, "ru").title).toBe("English fallback title");
  });

  it("opens the page of the notice's family", () => {
    expect(notificationHrefForRole(notice("patient_appointment_cancelled", "appointment", null), "patient")).toBe("/appointments");
    expect(notificationHrefForRole(notice("concierge_service_status_changed", "concierge_service", null), "patient")).toBe("/services");
    expect(notificationHrefForRole(notice("invoice_payment_registered", "invoice", null), "patient")).toBe("/invoices");
    // An entity type the portal does not know yet, or none at all: by the code's family.
    expect(notificationHrefForRole(notice("invoice_payment_registered", "invoice_payment", null), "patient")).toBe("/invoices");
    expect(notificationHrefForRole(notice("appointment_moved", null, null), "patient")).toBe("/appointments");
    expect(notificationHrefForRole(notice("privacy_request_completed", "privacy_request", null), "patient")).toBe("/privacy");
    expect(notificationHrefForRole(notice("privacy_erasure_completed", null, null), "patient")).toBeNull();
  });
});

describe("privacy request outcome for the patient (owner decision 2026-11-10)", () => {
  it("says that a copy of the data is fetched with the export", () => {
    const done = notice("privacy_request_completed", "privacy_request", { request_type: "access" });
    const ru = notificationCopyFromFacts(done, "ru");
    expect(ru?.title).toBe("Запрос по приватности выполнен");
    expect(ru?.body).toContain("Получить копию моих данных");
    expect(ru?.body).toContain("Экспортировать мои данные");
    const de = notificationCopyFromFacts(done, "de");
    expect(de?.title).toBe("Datenschutzanfrage erledigt");
    expect(de?.body).toContain("Meine Daten exportieren");
  });

  it("names the request and nothing else for the other types", () => {
    const done = notice("privacy_request_completed", "privacy_request", { request_type: "rectification" });
    expect(notificationCopyFromFacts(done, "ru")?.body).toBe("Запрос «Исправить мои данные» выполнен.");
  });

  it("points a refused request to its reason on the privacy page", () => {
    const refused = notice("privacy_request_rejected", "privacy_request", { request_type: "rectification" });
    const ru = notificationCopyFromFacts(refused, "ru");
    expect(ru?.title).toBe("Запрос по приватности отклонён");
    expect(ru?.body).toContain("Причина указана на странице");
    expect(notificationCopyFromFacts(refused, "de")?.title).toBe("Datenschutzanfrage abgelehnt");
    // Old rows without facts still read in the portal's language.
    expect(notificationCopyFromFacts({ ...refused, params: null }, "ru")?.body).toContain("отклонён");
  });
});
