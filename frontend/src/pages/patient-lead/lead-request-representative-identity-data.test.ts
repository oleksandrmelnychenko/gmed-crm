import { describe, expect, it } from "vitest";

import {
  mergeIncomingRepresentativeId,
  representativeIdDraft,
  representativeIdPatch,
} from "./lead-request-representative-identity-data";

// Synthetic values of the ICAO Doc 9303 specimen, never a real document.
const empty = representativeIdDraft(null);
const stored = representativeIdDraft({
  id_document_type: "passport",
  id_document_number: " L898902C3 ",
  id_issuing_authority: null,
  id_issuing_country: "de",
  id_issued_on: null,
  id_valid_until: "2032-04-15T00:00:00Z",
} as never);

describe("a representative's document data in the cabinet", () => {
  it("reads the stored values as the fields hold them", () => {
    expect(stored).toEqual({
      id_document_type: "passport",
      id_document_number: "L898902C3",
      id_issuing_authority: "",
      id_issuing_country: "DE",
      id_issued_on: "",
      id_valid_until: "2032-04-15",
    });
  });

  it("sends only what changed, and never a value the server refused", () => {
    const draft = { ...stored, id_issuing_authority: " Stadt Musterstadt ", id_valid_until: "2020-01-01" };
    expect(representativeIdPatch(stored, draft)).toEqual({ id_issuing_authority: "Stadt Musterstadt", id_valid_until: "2020-01-01" });
    expect(
      representativeIdPatch(stored, draft, { id_valid_until: { value: "2020-01-01", code: "id_document_expired" } }),
    ).toEqual({ id_issuing_authority: "Stadt Musterstadt" });
    // A cleared field is sent empty.
    expect(representativeIdPatch(stored, { ...stored, id_document_number: "" })).toEqual({ id_document_number: "" });
    expect(representativeIdPatch(empty, empty)).toEqual({});
  });

  it("follows what was saved elsewhere, but keeps what is being typed", () => {
    const typing = { ...empty, id_document_number: "X1" };
    expect(mergeIncomingRepresentativeId(typing, empty, stored)).toEqual({ ...stored, id_document_number: "X1" });
  });
});
