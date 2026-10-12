import { describe, expect, it } from "vitest";

import { filterColumnGroupLabel } from "./filter-builder";

describe("filterColumnGroupLabel", () => {
  const groups = { identity: "Идентификация", audit: "Аудит" };

  it("names a column group in the UI language", () => {
    expect(filterColumnGroupLabel("identity", groups)).toBe("Идентификация");
    expect(filterColumnGroupLabel("audit", groups)).toBe("Аудит");
  });

  it("never prints a raw group key", () => {
    expect(filterColumnGroupLabel("metadata", groups)).toBeNull();
    expect(filterColumnGroupLabel("insurance")).toBeNull();
    expect(filterColumnGroupLabel("identity", { identity: "  " })).toBeNull();
    expect(filterColumnGroupLabel(undefined, groups)).toBeNull();
  });

  it("keeps a group that already carries its translated name", () => {
    expect(filterColumnGroupLabel("Kontakt")).toBe("Kontakt");
    expect(filterColumnGroupLabel("Контакты")).toBe("Контакты");
  });
});
