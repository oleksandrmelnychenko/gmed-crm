import { describe, expect, it } from "vitest";

import { dashboardProviderHref } from "./staff-dashboard-formatters";

describe("dashboardProviderHref", () => {
  it("keeps dashboard as the provider detail return target", () => {
    expect(dashboardProviderHref("provider-1")).toBe(
      "/providers/provider-1?return_to=/",
    );
  });

  it("encodes provider ids before placing them into the route", () => {
    expect(dashboardProviderHref("provider/with space")).toBe(
      "/providers/provider%2Fwith%20space?return_to=/",
    );
  });
});
