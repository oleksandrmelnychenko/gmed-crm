/**
 * Test fixture: the server's `role x capability` snapshot
 * (`docs/backlog/02_rbac-capability-snapshot.md`), parsed from Markdown so
 * permission-model tests run against what the backend actually grants.
 * Node-only (reads the file system); import it from tests, never from app code.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CapabilityHolder } from "@/lib/permissions";

export const SNAPSHOT_PATH = resolve(
  __dirname,
  "../../../docs/backlog/02_rbac-capability-snapshot.md",
);

/** Parses the generated Markdown table into role -> capabilities (snapshot order). */
export function readServerSnapshot(): Map<string, string[]> {
  const lines = readFileSync(SNAPSHOT_PATH, "utf8").split(/\r?\n/);
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

/** One `/me`-shaped user per staff role, carrying the snapshot's capability list. */
export function snapshotUsers(): Array<CapabilityHolder & { role: string; capabilities: string[] }> {
  return [...readServerSnapshot()].map(([role, capabilities]) => ({ role, capabilities }));
}
