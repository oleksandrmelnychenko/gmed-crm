import { describe, expect, it } from "vitest";

import { localizedOrderGroupError, orderGroupStatusLabel } from "./order-group-panel";

const tx = (...texts: [ru: string, de: string]) => texts[0];
const txDe = (...texts: [ru: string, de: string]) => texts[1];

describe("orderGroupStatusLabel", () => {
  it("shows order statuses in the staff language instead of raw values", () => {
    expect(orderGroupStatusLabel("active", tx)).toBe("Активен");
    expect(orderGroupStatusLabel("cancelled", tx)).toBe("Отменён");
    expect(orderGroupStatusLabel("paused", txDe)).toBe("Pausiert");
    expect(orderGroupStatusLabel("future_status", tx)).toBe("future_status");
  });
});

describe("localizedOrderGroupError", () => {
  it("translates grouping errors of the server", () => {
    expect(
      localizedOrderGroupError("Only a standalone order can be grouped under a head", tx),
    ).toBe("В группу можно добавить только отдельный заказ.");
    expect(localizedOrderGroupError("Insufficient permissions", txDe)).toBe(
      "Für diese Aktion fehlen die Berechtigungen.",
    );
    expect(localizedOrderGroupError("Unexpected", tx)).toBe("Unexpected");
  });
});
