import { describe, expect, it } from "vitest";

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
      expect(definition.subtitle).not.toBe("");
      expect(definition.metrics.length).toBeGreaterThanOrEqual(5);
      expect(definition.focus).toHaveLength(3);
      for (const metric of definition.metrics) {
        expect(metric.label).not.toBe("");
        expect(metric.hint).not.toBe("");
        expect(definition.preview).toHaveProperty(metric.key);
      }
    }
  });
});
