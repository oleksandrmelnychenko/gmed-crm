import { describe, expect, it } from "vitest";

import { portalServiceContext } from "./portal-service-context";

const base = {
  title: "Dinner",
  provider_name: "Partner Restaurant GmbH",
  assigned_concierge_name: "Concierge Anna",
  appointment_title: null,
};

describe("portalServiceContext", () => {
  it("names the supplier by the kept vendor name, not the partner's own name", () => {
    expect(portalServiceContext({ ...base, vendor_name: "Restaurant Am Markt" }))
      .toBe("Restaurant Am Markt / Concierge Anna");
  });

  it("leaves the vendor out when the card has its own supplier row", () => {
    expect(portalServiceContext({ ...base, vendor_name: "Restaurant Am Markt" }, { vendorShownSeparately: true }))
      .toBe("Concierge Anna");
  });

  it("uses the partner's name when no vendor name was given", () => {
    expect(portalServiceContext({ ...base, vendor_name: null }, { vendorShownSeparately: true }))
      .toBe("Partner Restaurant GmbH / Concierge Anna");
  });
});
