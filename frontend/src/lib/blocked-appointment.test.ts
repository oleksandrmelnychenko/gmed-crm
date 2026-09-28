import { describe, expect, it } from "vitest";

import { uiText } from "./i18n";
import {
  BLOCKED_MEDICAL_SLOT_TITLE,
  localizeBlockedAppointmentTitle,
} from "./blocked-appointment";

describe("localizeBlockedAppointmentTitle", () => {
  it("shows a concierge's blocked medical slot in the UI language", () => {
    const blocked = { id: "a", title: BLOCKED_MEDICAL_SLOT_TITLE, is_blocked: true };
    expect(localizeBlockedAppointmentTitle(blocked, "ru").title).toBe("Заблокированный слот");
    expect(localizeBlockedAppointmentTitle(blocked, "de").title).toBe(
      uiText("appointments_blocked_slot", "de"),
    );
    expect(localizeBlockedAppointmentTitle(blocked, "ru").title).not.toBe(
      BLOCKED_MEDICAL_SLOT_TITLE,
    );
  });

  it("leaves real appointment titles alone", () => {
    const visible = { id: "b", title: "Blocked medical slot", is_blocked: false };
    expect(localizeBlockedAppointmentTitle(visible, "ru")).toBe(visible);
    const other = { id: "c", title: "Kardiologie", is_blocked: true };
    expect(localizeBlockedAppointmentTitle(other, "ru")).toBe(other);
  });
});
