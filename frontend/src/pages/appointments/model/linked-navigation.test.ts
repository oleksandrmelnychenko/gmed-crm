import { describe, expect, it } from "vitest";

import { buildLinkedOrderWorkspaceHref } from "./linked-navigation";

describe("buildLinkedOrderWorkspaceHref", () => {
  it("opens the real order workspace with patient context", () => {
    expect(buildLinkedOrderWorkspaceHref("order-1", "patient-1")).toBe(
      "/orders/order-1?patient=patient-1",
    );
  });

  it("omits empty patient context and blocks empty order ids", () => {
    expect(buildLinkedOrderWorkspaceHref("order-1", "")).toBe("/orders/order-1");
    expect(buildLinkedOrderWorkspaceHref("", "patient-1")).toBe("");
  });
});
