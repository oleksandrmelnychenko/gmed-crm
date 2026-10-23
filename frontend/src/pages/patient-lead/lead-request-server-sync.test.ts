import { describe, expect, it } from "vitest";

import { serverDraftChanges } from "./lead-request-server-sync";

describe("a newer server state of a form (owner 2026-10-23)", () => {
  const saved = { city: "Berlin", zip: "10115", citizenships: ["DE"] };

  it("takes untouched fields and reports nothing while nobody types", () => {
    expect(serverDraftChanges(saved, { ...saved, zip: "80331" }, saved)).toEqual({ changed: ["zip"], conflicts: [] });
  });

  it("names a field typed in that the server changed to another value", () => {
    const current = { ...saved, city: "Hamburg" };
    const incoming = { ...saved, city: "München" };
    expect(serverDraftChanges(saved, incoming, current)).toEqual({ changed: ["city"], conflicts: ["city"] });
  });

  it("is no conflict when the typing and the server agree, or the server kept the field", () => {
    const current = { ...saved, city: "München", zip: "20095" };
    expect(serverDraftChanges(saved, { ...saved, city: "München" }, current)).toEqual({ changed: ["city"], conflicts: [] });
  });

  it("compares lists by their values", () => {
    const current = { ...saved, citizenships: ["DE", "AT"] };
    expect(serverDraftChanges(saved, { ...saved, citizenships: ["DE"] }, current)).toEqual({ changed: [], conflicts: [] });
    expect(serverDraftChanges(saved, { ...saved, citizenships: ["UA"] }, current).conflicts).toEqual(["citizenships"]);
  });
});
