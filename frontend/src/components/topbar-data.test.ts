import { describe, expect, it } from "vitest";

import {
  localizedNotificationCopy,
  notificationHrefForRole,
  type Notification,
} from "./topbar-data";

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
