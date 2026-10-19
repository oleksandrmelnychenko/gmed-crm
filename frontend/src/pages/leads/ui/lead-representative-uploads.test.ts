import { describe, expect, it } from "vitest";

import type { LeadRepresentative } from "../data/lead-portal-intake-api";
import { representativeNeedsAuthority } from "./lead-representative-uploads";

const person = (slot: string | null, authority = 0) =>
  ({ slot, authority_documents: Array.from({ length: authority }, (_, index) => ({ id: `a${index}` })) }) as unknown as LeadRepresentative;

describe("the staff upload of a proof of authority", () => {
  it("is offered where the cabinet asks for the proof", () => {
    expect(representativeNeedsAuthority(person("agent"), null)).toBe(true);
    expect(representativeNeedsAuthority(person("guardian"), null)).toBe(true);
    expect(representativeNeedsAuthority(person("rep1"), "guardian")).toBe(true);
    // The cabinet asks a parent with sole custody for the (optional) proof of it.
    expect(representativeNeedsAuthority(person("rep1"), "sole_parent")).toBe(true);
    expect(representativeNeedsAuthority(person("rep1"), "joint")).toBe(false);
    expect(representativeNeedsAuthority(person("rep2"), "joint")).toBe(false);
    expect(representativeNeedsAuthority(person(null), "sole_parent")).toBe(false);
    // A file on record stays in sight.
    expect(representativeNeedsAuthority(person("rep2", 1), "joint")).toBe(true);
  });
});
