import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { customMaintenanceMessage, securityReasonLabel } from "./admin-security";

describe("security page texts (QA E-06)", () => {
  it("translates the reason of a suspicious event by its code", () => {
    expect(securityReasonLabel({ reason_code: "login_failure", reason: "Failed login attempt" }, ru)).toBe(
      "Неудачная попытка входа",
    );
    expect(securityReasonLabel({ reason_code: "off_hours_read", reason: "Off-hours sensitive read" }, de)).toBe(
      "Zugriff auf sensible Daten außerhalb der Arbeitszeit",
    );
  });

  it("maps the English reason of an older server, keeps any other text", () => {
    expect(
      securityReasonLabel({ reason: "Refresh attempted on revoked session family" }, ru),
    ).toBe("Попытка продолжить отозванную сессию");
    expect(securityReasonLabel({ reason: "Something else" }, de)).toBe("Something else");
  });

  it("treats the seeded English maintenance message as no custom message", () => {
    expect(customMaintenanceMessage("System maintenance in progress")).toBe("");
    expect(customMaintenanceMessage("  Update 22:00–23:00 ")).toBe("Update 22:00–23:00");
    expect(ru.security_maintenance_default_msg).toBe("Идут технические работы");
    expect(de.security_maintenance_default_msg).toBe("Wartungsarbeiten laufen");
  });
});
