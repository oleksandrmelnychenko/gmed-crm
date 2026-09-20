import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { ROLE_PRIMARY_MODULES } from "@/lib/role-cabinets";

import { roleDashboardDefinition } from "./role-dashboard-config";

const STAFF_DASHBOARD_ROLES = [
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "sales",
  "it_admin",
] as const;

describe("roleDashboardDefinition", () => {
  it.each(STAFF_DASHBOARD_ROLES)("defines a complete %s dashboard", (role) => {
    for (const lang of ["ru", "de"] as const) {
      const definition = roleDashboardDefinition(role, lang);
      expect(definition.eyebrow).not.toBe("");
      expect(definition.subtitle).toBe(t(lang)[`cabinet_subtitle_${role}`]);
      expect(definition.metrics.length).toBeGreaterThanOrEqual(5);
      expect(definition.focus).toHaveLength(3);
      for (const metric of definition.metrics) {
        expect(metric.label).not.toBe("");
        expect(metric.hint).not.toBe("");
        expect(definition.preview).toHaveProperty(metric.key);
      }
      expect(definition.primaryModules.length).toBeGreaterThanOrEqual(1);
      expect(definition.primaryModules).toBe(ROLE_PRIMARY_MODULES[role]);
    }
  });

  it("gives an unknown role a neutral cabinet instead of the patient manager preset", () => {
    for (const lang of ["ru", "de"] as const) {
      const definition = roleDashboardDefinition("unknown_role", lang);
      expect(definition.eyebrow).toBe(t(lang).cabinet_eyebrow_default);
      expect(definition.subtitle).toBe(t(lang).cabinet_subtitle_default);
      expect(definition.metrics).toEqual([]);
      expect(definition.focus).toEqual([]);
      expect(definition.preview).toEqual({});
      expect(definition.primaryModules).toEqual([]);
      expect(definition).not.toEqual(roleDashboardDefinition("patient_manager", lang));
    }
  });

  it("keeps the IT admin preset technical", () => {
    const definition = roleDashboardDefinition("it_admin", "de");
    const keys = definition.metrics.map((metric) => metric.key);
    expect(keys).toEqual([
      "active_sessions",
      "locked_accounts",
      "pending_logins",
      "failed_logins_24h",
      "active_users",
      "blocked_logins_24h",
      "db_active_connections",
      "audit_events_24h",
    ]);
    expect(keys.some((key) => key.includes("patient"))).toBe(false);
    expect(definition.primaryModules.map((module) => module.id)).not.toContain("patients");
  });
});
