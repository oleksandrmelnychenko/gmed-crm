import { describe, expect, it } from "vitest";

import { buildPatientOrderCreateHref } from "./patient-order-navigation";

describe("buildPatientOrderCreateHref", () => {
  it("opens a new order for the existing patient without routing through leads", () => {
    const href = buildPatientOrderCreateHref("patient/id 42");

    expect(href).toBe("/orders?create=1&patient=patient%2Fid%2042");
    expect(href).not.toContain("/leads");
  });
});
