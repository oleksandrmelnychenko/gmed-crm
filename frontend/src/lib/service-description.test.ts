import { describe, expect, it } from "vitest";
import { legacyServiceDescriptionItems, serviceDescriptionItems, serviceDescriptionText } from "./service-description";

describe("catalog description items", () => {
  it("converts legacy paragraphs and numbered lists using document boundaries", () => {
    const items = legacyServiceDescriptionItems("First paragraph\ncontinued\n\n2) Second point\n- Third point");
    expect(items).toEqual([
      { id: "legacy-1", text: "First paragraph continued" },
      { id: "legacy-2", text: "Second point" },
      { id: "legacy-3", text: "Third point" },
    ]);
  });
  it("preserves explicit items, internal newlines, and an intentionally empty list", () => {
    const items = [{ id: "second", text: "One point\n\nwith another paragraph" }];
    expect(serviceDescriptionItems(items, "old text")).toEqual(items);
    expect(serviceDescriptionItems([], "old text")).toEqual([]);
    expect(serviceDescriptionText(items)).toBe(items[0].text);
  });
});
