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

  it("does not mount a case rail while legacy case routes redirect", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/cases/case-1",
        search: "",
        userRole: "doctor",
      }),
    ).toBeNull();
  });

  it("returns the order rail for order workspace routes", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/orders/order-1",
        search: "",
        userRole: "doctor",
      }),
    ).toBe("order");
  });

  it("returns patient and order rails for patient-bound order workspace routes", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/orders/order-1",
        search: "?patient=patient-1",
        userRole: "doctor",
      }),
    ).toBe("patient-order");
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

  it.each([
    "/documents",
    "/documents/intake",
    "/documents/translation-requests",
    "/documents/doc-1",
  ])("keeps document navigation inside the page for staffed document routes: %s", (pathname) => {
    expect(
      resolveWorkspaceRailKind({
        pathname,
        search: "",
        userRole: "ceo",
      }),
    ).toBeNull();
  });

  it("does not return the documents rail for patient users", () => {
    expect(
      resolveWorkspaceRailKind({
        pathname: "/documents",
        search: "",
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
