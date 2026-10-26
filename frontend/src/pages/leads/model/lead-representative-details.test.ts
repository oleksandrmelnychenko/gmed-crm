import { describe, expect, it } from "vitest";

import {
  EMPTY_REPRESENTATIVE_DETAILS,
  fillEmptyRepresentativeDetails,
  guardianCandidateDetails,
  mergeRepresentativeDetails,
  pendingRepresentativeDetailsReady,
  representativeDetailsChanged,
  representativeDetailsErrors,
  representativeDetailsOf,
} from "./lead-representative-details";

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

  // Walk-through 2026-10-24: a parent entered in mode «Заполняю сам» had no
  // citizenship and structured address, so the framework contract was refused.
  it("write the details of a new card once its parent is on file", () => {
    const entered = { ...EMPTY_REPRESENTATIVE_DETAILS, citizenships: ["UA"], street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE" };
    const pending = new Map([["mother", entered], ["father", EMPTY_REPRESENTATIVE_DETAILS]]);
    const onFile = (id: string) => ({ id, birth_place: null, birth_country: null, citizenships: [], street: null, zip: null, city: null, country: null });
    // Not on file yet: nothing is written.
    expect(pendingRepresentativeDetailsReady(pending, [])).toEqual([]);
    const ready = pendingRepresentativeDetailsReady(pending, [onFile("mother"), onFile("father")] as never);
    expect(ready).toEqual([{ id: "mother", values: entered, base: EMPTY_REPRESENTATIVE_DETAILS }]);
    // Already stored the same: no write.
    expect(pendingRepresentativeDetailsReady(new Map([["mother", entered]]), [{ ...onFile("mother"), ...entered }] as never)).toEqual([]);
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

// DEV 2026-10-26: a father picked from the patients left the GwG block empty.
describe("a picked guardian candidate", () => {
  const father = {
    contact_hidden: false,
    street: "Testova 13",
    zip: "29000",
    city: "Lwiw",
    country: "UA",
    citizenships: ["UA"],
    birth_place: "Lwiw",
    birth_country: "UA",
  };

  it("brings its address, birth data and citizenships", () => {
    expect(guardianCandidateDetails(father)).toEqual({
      street: "Testova 13",
      zip: "29000",
      city: "Lwiw",
      country: "UA",
      citizenships: ["UA"],
      birth_place: "Lwiw",
      birth_country: "UA",
    });
  });

  it("brings nothing when the role may not see the data or none are held", () => {
    expect(guardianCandidateDetails({ ...father, contact_hidden: true })).toBeNull();
    expect(guardianCandidateDetails({ contact_hidden: false })).toBeNull();
    expect(guardianCandidateDetails({ street: null, citizenships: [] })).toBeNull();
  });

  it("fills only the empty fields and never what staff typed", () => {
    const typed = { ...EMPTY_REPRESENTATIVE_DETAILS, street: "Typed street 1", citizenships: ["DE"] };
    const { details, filled } = fillEmptyRepresentativeDetails(typed, guardianCandidateDetails(father)!);
    expect(details).toEqual({
      street: "Typed street 1",
      zip: "29000",
      city: "Lwiw",
      country: "UA",
      citizenships: ["DE"],
      birth_place: "Lwiw",
      birth_country: "UA",
    });
    expect(filled.sort()).toEqual(["birth_country", "birth_place", "city", "country", "zip"]);
  });

  it("replaces the previous pick's values but keeps a field staff changed since", () => {
    const first = guardianCandidateDetails(father)!;
    const afterFirst = fillEmptyRepresentativeDetails(EMPTY_REPRESENTATIVE_DETAILS, first).details;
    const edited = { ...afterFirst, city: "Lviv (typed)" };
    const second = guardianCandidateDetails({ street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", citizenships: ["DE"] })!;
    const { details } = fillEmptyRepresentativeDetails(edited, second, first);
    expect(details).toEqual({
      street: "Musterweg 1",
      zip: "10115",
      city: "Lviv (typed)",
      country: "DE",
      citizenships: ["DE"],
      // The first pick's birth data leave with it: the second has none.
      birth_place: "",
      birth_country: "",
    });
  });
});
