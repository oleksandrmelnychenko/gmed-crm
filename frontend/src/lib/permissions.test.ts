import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_CAPABILITIES,
  ROLE_CAPABILITIES,
  capabilitiesFor,
  hasAnyCapability,
  hasCapability,
} from "./permissions";

/** Parses the generated `role x capability` Markdown table into role -> set. */
function readServerSnapshot(): Map<string, string[]> {
  const path = resolve(__dirname, "../../../docs/backlog/02_rbac-capability-snapshot.md");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines.find((line) => line.startsWith("| Capability |"));
  if (!header) {
    throw new Error("snapshot header not found");
  }
  const roles = header
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .slice(1);
  const byRole = new Map<string, string[]>(roles.map((role) => [role, []]));
  for (const line of lines) {
    const match = /^\| `([a-z_.]+)` \|(.*)\|$/.exec(line);
    if (!match) {
      continue;
    }
    const cells = match[2].split("|").map((cell) => cell.trim());
    cells.forEach((cell, index) => {
      if (cell === "x") {
        byRole.get(roles[index])?.push(match[1]);
      }
    });
  }
  return byRole;
}

describe("capability mirror", () => {
  it("matches the server snapshot for every staff role", () => {
    const snapshot = readServerSnapshot();
    expect([...snapshot.keys()]).toEqual([
      "ceo",
      "ceo_assistant",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
      "billing",
      "sales",
      "it_admin",
    ]);
    const registryOrder = (capabilities: readonly string[]) =>
      [...capabilities].sort(
        (a, b) =>
          (ALL_CAPABILITIES as readonly string[]).indexOf(a) -
          (ALL_CAPABILITIES as readonly string[]).indexOf(b),
      );
    for (const [role, expected] of snapshot) {
      expect(registryOrder(ROLE_CAPABILITIES[role] ?? []), role).toEqual(expected);
    }
    expect(ROLE_CAPABILITIES.patient).toEqual([]);
  });

  it("lists every capability of the snapshot exactly once", () => {
    const snapshot = readServerSnapshot();
    expect([...ALL_CAPABILITIES]).toEqual(snapshot.get("ceo"));
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it("prefers the capabilities reported by /me over the role mirror", () => {
    expect(capabilitiesFor("it_admin")).toEqual(ROLE_CAPABILITIES.it_admin);
    expect(capabilitiesFor("it_admin", ["patients.view"])).toEqual(["patients.view"]);
    expect(capabilitiesFor("unknown")).toEqual([]);

    expect(hasCapability({ role: "sales" }, "leads.edit")).toBe(true);
    expect(hasCapability({ role: "sales" }, "patients.view")).toBe(false);
    expect(hasCapability({ role: "sales", capabilities: ["patients.view"] }, "patients.view")).toBe(true);
    expect(hasCapability({ role: "ceo", capabilities: [] }, "patients.view")).toBe(false);
    expect(hasCapability(null, "patients.view")).toBe(false);
    expect(hasAnyCapability({ role: "billing" }, ["datev.admin", "datev.read"])).toBe(true);
    expect(hasAnyCapability({ role: "it_admin" }, ["patients.view", "chat.use"])).toBe(false);
  });

  it("keeps the cabinet decisions: CEO-only powers and read-only assistant", () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(hasCapability({ role }, "users.manage_ceo"), role).toBe(role === "ceo");
    }
    expect(hasCapability({ role: "it_admin" }, "users.manage")).toBe(true);
    for (const capability of ROLE_CAPABILITIES.ceo_assistant) {
      expect(/\.(view|use)$/.test(capability), capability).toBe(true);
    }
  });
});
