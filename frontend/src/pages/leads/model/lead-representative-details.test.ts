import { describe, expect, it } from "vitest";

import { mergeRepresentativeDetails, representativeDetailsChanged, representativeDetailsErrors, representativeDetailsOf } from "./lead-representative-details";

const anna = {
  birth_place: "Kyiv",
  birth_country: "UA",
  citizenships: ["ua", "DE"],
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
};

describe("a representative's details staff edit", () => {
  it("load the cabinet's parts, citizenships as codes", () => {
    expect(representativeDetailsOf(anna)).toEqual({ ...anna, citizenships: ["UA", "DE"] });
    expect(representativeDetailsOf({ ...anna, birth_place: null, street: null, citizenships: [] })).toMatchObject({ birth_place: "", street: "", citizenships: [] });
  });

  it("count as changed only when staff typed something else", () => {
    const loaded = representativeDetailsOf(anna);
    expect(representativeDetailsChanged({ ...loaded, city: " Berlin " }, loaded)).toBe(false);
    expect(representativeDetailsChanged({ ...loaded, city: "Potsdam" }, loaded)).toBe(true);
    expect(representativeDetailsChanged({ ...loaded, citizenships: ["UA"] }, loaded)).toBe(true);
  });

  it("follow the shared limits for a changed value", () => {
    const loaded = representativeDetailsOf(anna);
    expect(representativeDetailsErrors({ ...loaded, city: "y".repeat(121) }, loaded)).toEqual({ city: "too_long" });
    expect(representativeDetailsErrors({ ...loaded, city: "y".repeat(121) }, { ...loaded, city: "y".repeat(121) })).toEqual({});
  });
});

describe("a newer server state while staff edit a representative's details", () => {
  const loaded = representativeDetailsOf(anna);

  it("replaces an untouched form and writes nothing", () => {
    const fresh = { ...loaded, city: "Potsdam" };
    const merged = mergeRepresentativeDetails(loaded, loaded, fresh);
    expect(merged.draft).toEqual(fresh);
    expect(merged.loaded).toEqual(fresh);
    expect(representativeDetailsChanged(merged.draft, merged.loaded)).toBe(false);
    expect(merged).toMatchObject({ changedMeanwhile: true, conflict: false });
  });

  it("keeps the typed field with its old base and takes the cabinet's change of another field", () => {
    const draft = { ...loaded, street: "Neuer Weg 2" };
    const fresh = { ...loaded, city: "Potsdam", citizenships: ["UA"] };
    const merged = mergeRepresentativeDetails(draft, loaded, fresh);
    // The typed street stays; city and citizenships follow the server.
    expect(merged.draft).toEqual({ ...fresh, street: "Neuer Weg 2" });
    // Only the street differs from its base: the save writes the street alone.
    expect(merged.loaded).toEqual(fresh);
    expect(representativeDetailsChanged(merged.draft, merged.loaded)).toBe(true);
    expect(representativeDetailsChanged({ ...merged.draft, street: fresh.street }, merged.loaded)).toBe(false);
    expect(merged).toMatchObject({ changedMeanwhile: true, conflict: false });
  });

  it("names a conflict when the server changed the field staff type in", () => {
    const draft = { ...loaded, city: "Dresden" };
    const fresh = { ...loaded, city: "Potsdam" };
    const merged = mergeRepresentativeDetails(draft, loaded, fresh);
    expect(merged.draft.city).toBe("Dresden");
    expect(merged.loaded.city).toBe("Berlin");
    expect(merged).toMatchObject({ changedMeanwhile: true, conflict: true });
  });

  it("changes nothing when the server state is the loaded one", () => {
    const draft = { ...loaded, zip: "10117" };
    const merged = mergeRepresentativeDetails(draft, loaded, { ...loaded, citizenships: ["ua", "DE"] });
    // The same citizenships in another spelling are no change; the untouched field takes the server's spelling.
    expect(merged.draft).toEqual({ ...draft, citizenships: ["ua", "DE"] });
    expect(merged.loaded).toEqual({ ...loaded, citizenships: ["ua", "DE"] });
    expect(merged).toMatchObject({ changedMeanwhile: false, conflict: false });
  });
});
