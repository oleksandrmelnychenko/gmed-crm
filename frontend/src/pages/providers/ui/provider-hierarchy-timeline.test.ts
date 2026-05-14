import { describe, expect, it } from "vitest";

import type { ProviderOrganizationLevel, ProviderSummary } from "../model/types";
import { buildProviderTimelineTree } from "./provider-hierarchy-timeline";

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

describe("buildProviderTimelineTree", () => {
  it("builds nested provider branches by parent_provider_id", () => {
    const tree = buildProviderTimelineTree([
      provider("unit", "Cath Lab", "unit", "clinic"),
      provider("root", "TUM", "organization"),
      provider("clinic", "Cardiology", "clinic", "root"),
      provider("orphan", "Travel", "organization"),
    ]);

    expect(tree.map((node) => node.provider.id)).toEqual(["orphan", "root"]);
    expect(tree[1].children.map((node) => node.provider.id)).toEqual(["clinic"]);
    expect(tree[1].children[0].children.map((node) => node.provider.id)).toEqual(["unit"]);
  });

  it("keeps providers with missing parents as roots", () => {
    const tree = buildProviderTimelineTree([
      provider("missing-child", "External unit", "unit", "missing-parent"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].provider.id).toBe("missing-child");
    expect(tree[0].children).toEqual([]);
  });
});
