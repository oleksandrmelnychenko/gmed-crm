import { describe, expect, it } from "vitest";

import { moveCatalogItemBy, moveCatalogItemTo, sameCatalogOrder } from "./finance-catalog-order";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id).join("");

describe("finance catalog manual order", () => {
  it("moves an item down and up to the place of another", () => {
    expect(ids(moveCatalogItemTo(items, "a", "c"))).toBe("bcad");
    expect(ids(moveCatalogItemTo(items, "d", "b"))).toBe("adbc");
    expect(ids(moveCatalogItemTo(items, "b", "b"))).toBe("abcd");
    expect(ids(moveCatalogItemTo(items, "x", "b"))).toBe("abcd");
  });

  it("moves by one place and stops at the ends", () => {
    expect(ids(moveCatalogItemBy(items, "b", -1))).toBe("bacd");
    expect(ids(moveCatalogItemBy(items, "b", 1))).toBe("acbd");
    expect(ids(moveCatalogItemBy(items, "a", -1))).toBe("abcd");
    expect(ids(moveCatalogItemBy(items, "d", 1))).toBe("abcd");
  });

  it("never changes the given list", () => {
    const copy = items.slice();
    moveCatalogItemTo(items, "a", "d");
    expect(sameCatalogOrder(items, copy)).toBe(true);
    expect(sameCatalogOrder(items, moveCatalogItemBy(items, "a", 1))).toBe(false);
  });
});
