import { describe, expect, it } from "vitest";

import {
  providerMatchesTaxonomy,
  providerMatchesType,
  selectAvailableTaxonomyNodes,
  type ProviderTaxonomyCarrier,
} from "./provider-selection";
import type { ProviderTaxonomyNode } from "./types";

function node(
  id: string,
  parent_id: string | null,
  level: ProviderTaxonomyNode["level"],
): ProviderTaxonomyNode {
  return {
    id,
    parent_id,
    code: id,
    level,
    provider_kind: "medical",
    name_en: id,
    name_de: null,
    name_ru: null,
    description: null,
    filter_keys: [],
    is_leaf: level === "type",
    is_assignable: true,
    is_active: true,
    sort_order: 0,
  };
}

// Tree: m (root category) -> g1 (clinics), g2 (pharmacies); g1 -> t1 (a clinic type)
const m = node("m", null, "category");
const g1 = node("g1", "m", "group");
const g2 = node("g2", "m", "group");
const t1 = node("t1", "g1", "type");
const nodes = [m, g1, g2, t1];

function provider(
  id: string,
  providerType: string,
  taxonomyIds: string[],
): ProviderTaxonomyCarrier {
  return { id, name: id, provider_type: providerType, taxonomy_filter_ids: taxonomyIds };
}

describe("selectAvailableTaxonomyNodes", () => {
  it("returns all nodes unchanged while providers are still loading (empty list)", () => {
    expect(selectAvailableTaxonomyNodes(nodes, [], "medical", "")).toBe(nodes);
  });

  it("keeps only categories with a matching provider, plus their ancestors", () => {
    const docInClinics = provider("p1", "medical", ["t1", "g1", "m"]);
    const result = selectAvailableTaxonomyNodes(nodes, [docInClinics], "medical", "");
    expect(result.map((n) => n.id).sort()).toEqual(["g1", "m", "t1"]);
    // pharmacies (g2) has no provider -> hidden
    expect(result.some((n) => n.id === "g2")).toBe(false);
  });

  it("hides a category whose providers don't match the type (pharmacy on a medical appt)", () => {
    const pharmacy = provider("p2", "non_medical", ["g2", "m"]);
    // no medical provider anywhere -> nothing offered
    expect(selectAvailableTaxonomyNodes(nodes, [pharmacy], "medical", "")).toEqual([]);
  });

  it("offers the non-medical category when the type is non_medical", () => {
    const pharmacy = provider("p2", "non_medical", ["g2", "m"]);
    const result = selectAvailableTaxonomyNodes(nodes, [pharmacy], "non_medical", "");
    expect(result.map((n) => n.id).sort()).toEqual(["g2", "m"]);
  });

  it("keeps the current selection (and its ancestors) navigable even when empty", () => {
    const docInClinics = provider("p1", "medical", ["t1", "g1", "m"]);
    // g2 (pharmacies) is selected but has no medical provider
    const ids = selectAvailableTaxonomyNodes(nodes, [docInClinics], "medical", "g2")
      .map((n) => n.id)
      .sort();
    expect(ids).toContain("g2"); // selection preserved
    expect(ids).toContain("m"); // its ancestor stays
    expect(ids).toContain("g1"); // the populated clinic branch is still there
  });

  it("treats an empty type filter as 'all types'", () => {
    const pharmacy = provider("p2", "non_medical", ["g2", "m"]);
    const doc = provider("p1", "medical", ["t1", "g1", "m"]);
    const ids = selectAvailableTaxonomyNodes(nodes, [pharmacy, doc], "", "")
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual(["g1", "g2", "m", "t1"]);
  });
});

describe("providerMatchesType", () => {
  it("matches medical/non_medical and allows everything when the type is empty", () => {
    const med = provider("a", "medical", []);
    expect(providerMatchesType(med, "medical")).toBe(true);
    expect(providerMatchesType(med, "non_medical")).toBe(false);
    expect(providerMatchesType(med, "")).toBe(true);
  });
});

describe("providerMatchesTaxonomy", () => {
  it("matches via the assigned node or an ancestor; true when no category is selected", () => {
    const p = provider("a", "medical", ["t1", "g1", "m"]);
    expect(providerMatchesTaxonomy(p, "")).toBe(true);
    expect(providerMatchesTaxonomy(p, "g1")).toBe(true); // ancestor match
    expect(providerMatchesTaxonomy(p, "g2")).toBe(false);
  });
});
