import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..", "..");
const script = path.join(frontendRoot, "scripts", "check-staff-spa-navigation.mjs");

describe("check-staff-spa-navigation.mjs", () => {
  it("exits 0 (no raw navigate(/…) or Link to=/ in staff code)", () => {
    expect(() => {
      execFileSync(process.execPath, [script], {
        cwd: frontendRoot,
        stdio: "pipe",
        encoding: "utf8",
      });
    }).not.toThrow();
  });
});
