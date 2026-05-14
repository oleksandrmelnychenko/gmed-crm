import { describe, expect, it } from "vitest";

import type { SortStack } from "@/components/data-table/types";

import type { ProviderOrganizationLevel, ProviderSummary } from "../../model/types";
import { buildProviderTreeRows } from "./use-providers-list-table-model";

const providerSort: SortStack = [{ field: "provider", dir: "asc" }];
const accessors = {
  provider: (row: ProviderSummary) => row.name,
  organization_level: (row: ProviderSummary) => row.organization_level,
};

function provider(
  id: string,
  name: string,
  organizationLevel: ProviderOrganizationLevel,
  parentProviderId: string | null = null,
): ProviderSummary {
  return {
    id,
    name,
    provider_type: "medical",
    legal_name: null,
    tax_id: null,
    address_city: null,
    address_country: null,
    fachbereich: null,
    phone: null,
    email: null,
    parent_provider_id: parentProviderId,
    parent_provider_name: null,
    organization_level: organizationLevel,
    specializations: [],
    is_active: true,
    has_contract: false,
    doctor_count: 0,
    patient_count: 0,
    appointment_count: 0,
    service_count: 0,
    concierge_service_count: 0,
    open_concierge_service_count: 0,
    rating_count: 0,
    avg_rating: null,
    last_interaction_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("buildProviderTreeRows", () => {
  it("flattens provider hierarchy with sorted siblings", () => {
    const rows = [
      provider("department", "Cardiology", "department", "clinic"),
      provider("beta", "Beta Org", "organization"),
      provider("clinic", "Main Clinic", "clinic", "alpha"),
      provider("alpha", "Alpha Org", "organization"),
    ];

    const result = buildProviderTreeRows({
      accessors,
      collapsedProviderIds: new Set(),
      hasActiveTableQuery: false,
      matchedProviders: rows,
      providers: rows,
      sortStack: providerSort,
    });

    expect(result.rows.map((row) => row.id)).toEqual(["alpha", "clinic", "department", "beta"]);
    expect(result.treeMetaById.get("clinic")).toMatchObject({
      childCount: 1,
      depth: 1,
      isExpanded: true,
    });
    expect(result.treeMetaById.get("department")).toMatchObject({
      childCount: 0,
      depth: 2,
    });
  });

  it("hides descendants of a collapsed branch", () => {
    const rows = [
      provider("alpha", "Alpha Org", "organization"),
      provider("clinic", "Main Clinic", "clinic", "alpha"),
      provider("department", "Cardiology", "department", "clinic"),
    ];

    const result = buildProviderTreeRows({
      accessors,
      collapsedProviderIds: new Set(["alpha"]),
      hasActiveTableQuery: false,
      matchedProviders: rows,
      providers: rows,
      sortStack: providerSort,
    });

    expect(result.rows.map((row) => row.id)).toEqual(["alpha"]);
    expect(result.treeMetaById.get("alpha")).toMatchObject({
      childCount: 1,
      depth: 0,
      isExpanded: false,
    });
  });

  it("keeps ancestors visible and expanded for a matched descendant", () => {
    const alpha = provider("alpha", "Alpha Org", "organization");
    const clinic = provider("clinic", "Main Clinic", "clinic", "alpha");
    const department = provider("department", "Cardiology", "department", "clinic");
    const rows = [alpha, clinic, department];

    const result = buildProviderTreeRows({
      accessors,
      collapsedProviderIds: new Set(["alpha", "clinic"]),
      hasActiveTableQuery: true,
      matchedProviders: [department],
      providers: rows,
      sortStack: providerSort,
    });

    expect(result.rows.map((row) => row.id)).toEqual(["alpha", "clinic", "department"]);
    expect(result.treeMetaById.get("alpha")).toMatchObject({
      isExpanded: true,
      isMatched: false,
    });
    expect(result.treeMetaById.get("department")).toMatchObject({
      depth: 2,
      isMatched: true,
    });
  });
});
