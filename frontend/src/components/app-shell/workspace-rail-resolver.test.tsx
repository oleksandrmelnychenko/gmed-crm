import { describe, expect, it } from "vitest";

import { resolveWorkspaceRailKind } from "./workspace-rail-resolver";

describe("resolveWorkspaceRailKind", () => {
  it("returns the patient rail for patient workspace routes", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/patients/123",
        search: "",
        userRole: "patient",
      }),
    ).toBe("patient");
  });

  it("returns the case rail for case workspace routes", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/cases/case-1",
        search: "",
        userRole: "doctor",
      }),
    ).toBe("case");
  });

  it("returns the appointment rail for staffed appointment workspace routes", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/appointments",
        search: "?appointment=appt-42",
        userRole: "doctor",
      }),
    ).toBe("appointment");
  });

  it("does not return the appointment rail for patient users", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/appointments",
        search: "?appointment=appt-42",
        userRole: "patient",
      }),
    ).toBeNull();
  });

  it("returns null when no workspace rail matches", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/dashboard",
        search: "",
        userRole: "doctor",
      }),
    ).toBeNull();
  });
});
