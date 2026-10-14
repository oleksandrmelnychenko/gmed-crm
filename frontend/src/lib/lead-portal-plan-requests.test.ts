import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { fetchLeadPortalPlanCatalogue, requestLeadPortalPlan } from "./lead-portal-plan-requests";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

describe("lead package interest API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the current catalogue for the explicitly selected request", async () => {
    const catalogue = {
      packages: [{ id: "package-reserve-child", package_key: "reserve-child", name: "GMED Reserve Junior", kind: "gmed_reserve", description: null }],
      requests: [],
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(catalogue);
    expect(await fetchLeadPortalPlanCatalogue("child/one")).toEqual(catalogue);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/me/lead-requests/child%2Fone/plan-requests", { forceFresh: true });
  });

  it("sends only catalogue package and module IDs without access, price or activation fields", async () => {
    const response = { request: { id: "interest" }, created: false };
    vi.mocked(apiFetch).mockResolvedValueOnce(response);
    expect(await requestLeadPortalPlan("child-two", "package-reserve-child", "invoices")).toEqual(response);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/me/lead-requests/child-two/plan-requests", {
      method: "POST",
      body: JSON.stringify({ package_id: "package-reserve-child", module_id: "invoices" }),
    });
  });

  it("keeps API refusals as failures instead of synthesizing a receipt", async () => {
    const refusal = new Error("No active staff recipient");
    vi.mocked(apiFetch).mockRejectedValueOnce(refusal);
    await expect(requestLeadPortalPlan("child", "plan", "chat")).rejects.toBe(refusal);
  });
});
