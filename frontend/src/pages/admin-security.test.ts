import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  customMaintenanceMessage,
  isValidIpWhitelistEntry,
  securityActorName,
  securityEventRoute,
  securityReasonLabel,
  securitySessionStatus,
} from "./admin-security";

describe("security page leftovers (QA E2-01, E2-06)", () => {
  it("shows the request route of an event, not its reason", () => {
    expect(securityEventRoute({ method: "POST", route: "/api/v1/auth/login" })).toBe(
      "POST /api/v1/auth/login",
    );
    expect(securityEventRoute({ route: "/api/v1/patients/{id}" })).toBe("/api/v1/patients/{id}");
    expect(securityEventRoute({ method: null, route: null })).toBe("—");
  });

  it("names a single revoked session in the singular", () => {
    expect(securitySessionStatus(true, ru)).toBe("Отозвана");
    expect(securitySessionStatus(true, de)).toBe("Widerrufen");
    // Same gender as "Отозвана" (a session), not "Активен" (QA E2-06 leftover).
    expect(securitySessionStatus(false, ru)).toBe("Активна");
    expect(securitySessionStatus(false, de)).toBe("Aktiv");
  });

  it("never names a portal login the server anonymised", () => {
    expect(securityActorName({ user_name: null, user_role: "patient" }, ru)).toBe(ru.activity_portal_actor);
    expect(securityActorName({ user_name: null, user_role: null }, de)).toBe(de.security_anonymous);
    expect(securityActorName({ user_name: "Ben Muster", user_role: "patient_manager" }, ru)).toBe("Ben Muster");
  });
});

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

describe("IP allow-list entry (QA 2026-11-12 E-4)", () => {
  it("accepts addresses and networks only, as the server does", () => {
    for (const valid of ["203.0.113.7", "203.0.113.0/24", " 10.0.0.1/8 ", "0.0.0.0/0", "2001:db8::/32", "::1"]) {
      expect(isValidIpWhitelistEntry(valid), valid).toBe(true);
    }
    for (const invalid of ["", "abc.def", "203.0.113.0/33", "203.0.113.0/", "203.0.113/24", "2001:db8::/129", "10.0.0.1/-1", "1.2.3.4 5", "256.1.1.1"]) {
      expect(isValidIpWhitelistEntry(invalid), invalid).toBe(false);
    }
  });

  it("explains the format in Russian and German", () => {
    expect(ru.uiText.api_ip_whitelist_cidr_invalid).toContain("203.0.113.0/24");
    expect(de.uiText.api_ip_whitelist_cidr_invalid).toContain("203.0.113.0/24");
  });
});
