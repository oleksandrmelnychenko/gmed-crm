import { describe, expect, it } from "vitest";

import {
  localizedNotificationCopy,
  notificationHrefForRole,
  type Notification,
} from "@/components/topbar-data";

const notification: Notification = {
  id: "n-1",
  kind: "sanctions_possible_match",
  title: "Possible EU sanctions list match",
  body: "Review the possible match on the sanctions page.",
  entity_type: "sanctions_hit",
  entity_id: "hit-1",
  is_read: false,
  created_at: "2026-10-03T08:00:00Z",
};

describe("sanctions notifications", () => {
  it("are worded in the staff language and name nobody", () => {
    const ru = localizedNotificationCopy(notification, "ru");
    expect(ru.title).toBe("Возможное совпадение с санкционным списком ЕС");
    const de = localizedNotificationCopy(notification, "de");
    expect(de.title).toBe("Möglicher Treffer der EU-Sanktionsliste");
  });

  it("open the CEO review page", () => {
    expect(notificationHrefForRole(notification, "ceo")).toBe("/sanctions");
    expect(notificationHrefForRole(notification, "patient_manager")).toBeNull();
  });
});
