import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_CAPABILITIES, ROLE_CAPABILITIES } from "./permissions";
import { ROLE_PRIMARY_MODULES, primaryModuleIds, primaryModulesFor } from "./role-cabinets";
import { ALL_STAFF_ROLES, canAccessStaffRoute } from "./staff-route-access";

/** Capability names of the generated server snapshot. */
function snapshotCapabilities(): Set<string> {
  const path = resolve(__dirname, "../../../docs/backlog/02_rbac-capability-snapshot.md");
  const names = new Set<string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\| `([a-z_.]+)` \|/.exec(line);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

const CABINET_ROLES = ALL_STAFF_ROLES.filter((role) => role !== "ceo");

describe("role cabinets", () => {
  it("gives every staff cabinet at least one primary module", () => {
    for (const role of CABINET_ROLES) {
      expect(ROLE_PRIMARY_MODULES[role]?.length ?? 0, role).toBeGreaterThanOrEqual(1);
      expect(primaryModulesFor(role).length, role).toBeGreaterThanOrEqual(1);
    }
    // The CEO lands on the executive map and keeps the full navigation.
    expect(ROLE_PRIMARY_MODULES.ceo).toEqual([]);
  });

  it("only uses capabilities that exist in the server snapshot", () => {
    const snapshot = snapshotCapabilities();
    for (const [role, modules] of Object.entries(ROLE_PRIMARY_MODULES)) {
      for (const module of modules) {
        expect(snapshot.has(module.capability), `${role}: ${module.capability}`).toBe(true);
        expect(
          (ALL_CAPABILITIES as readonly string[]).includes(module.capability),
          `${role}: ${module.capability}`,
        ).toBe(true);
      }
    }
  });

  it("opens every primary module to its role through the route guard", () => {
    for (const role of CABINET_ROLES) {
      for (const module of primaryModulesFor(role)) {
        expect(canAccessStaffRoute(role, module.to), `${role} -> ${module.to}`).toBe(true);
      }
    }
  });

  it("keeps the IT admin cabinet technical", () => {
    const ids = primaryModuleIds("it_admin");
    expect(ids).toEqual([
      "admin/users",
      "admin/security",
      "admin/settings",
      "admin/activity",
      "admin/health",
      "admin/signatures",
      "admin/datev",
      "incidents",
    ]);
    expect(ids).not.toContain("patients");
    const paths = primaryModulesFor("it_admin").map((module) => module.to);
    expect(paths.some((path) => path.startsWith("/patients"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/chat"))).toBe(false);
  });

  it("matches the cabinet table of the plan", () => {
    expect(primaryModuleIds("billing")).toEqual(["invoices", "orders", "company-finance", "contracts"]);
    expect(primaryModuleIds("concierge")).toEqual(["services", "hotels", "appointments", "leads"]);
    expect(primaryModuleIds("patient_manager")).toEqual(["patients", "leads", "orders", "contracts"]);
    expect(primaryModuleIds("sales")).toEqual(["leads", "providers", "reports", "chat"]);
    expect(primaryModuleIds("ceo_assistant")).toEqual([
      "task-manager",
      "appointments",
      "patients",
      "reports",
    ]);
    expect(primaryModuleIds("teamlead_interpreter")).toEqual([
      "appointments",
      "interpreters",
      "documents",
      "task-manager",
    ]);
    expect(primaryModuleIds("interpreter")).toEqual([
      "appointments",
      "documents",
      "task-manager",
      "hours",
    ]);
  });

  it("filters quick links by the capabilities reported by /me", () => {
    expect(primaryModulesFor("billing", ["invoices.view"]).map((module) => module.id)).toEqual([
      "invoices",
    ]);
    expect(primaryModulesFor("billing", [])).toEqual([]);
    expect(primaryModulesFor("concierge", ["leads.view"]).map((module) => module.id)).toEqual([
      "leads",
    ]);
    // A role without a cabinet has no links even with capabilities.
    expect(primaryModulesFor("unknown", ROLE_CAPABILITIES.ceo)).toEqual([]);
    expect(primaryModulesFor("patient")).toEqual([]);
  });
});
