import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProviderOrganizationLevel, ProviderSummary } from "../model/types";
import {
  buildProviderTimelineTree,
  flattenProviderTimelineTree,
  ProviderHierarchyTimeline,
} from "./provider-hierarchy-timeline";

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

  it("hides descendants of collapsed providers at every tree depth", () => {
    const tree = buildProviderTimelineTree([
      provider("root", "TUM", "organization"),
      provider("clinic", "Cardiology", "clinic", "root"),
      provider("unit", "Cath Lab", "unit", "clinic"),
      provider("external", "External", "organization"),
      provider("external-child", "External Child", "clinic", "external"),
    ]);

    expect(flattenProviderTimelineTree(tree).map((item) => item.node.provider.id)).toEqual([
      "external",
      "external-child",
      "root",
      "clinic",
      "unit",
    ]);
    expect(
      flattenProviderTimelineTree(tree, {
        collapsedNodeIds: new Set(["root"]),
      }).map((item) => item.node.provider.id),
    ).toEqual(["external", "external-child", "root"]);

    expect(
      flattenProviderTimelineTree(tree, {
        collapsedNodeIds: new Set(["clinic"]),
      }).map((item) => item.node.provider.id),
    ).toEqual(["external", "external-child", "root", "clinic"]);
  });

  it("renders expand controls for every node that has children", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderHierarchyTimeline, {
        lang: "ru",
        onProviderClick: () => undefined,
        providers: [
          provider("root", "TUM", "organization"),
          provider("clinic", "Cardiology", "clinic", "root"),
          provider("unit", "Cath Lab", "unit", "clinic"),
        ],
        tr: {
          providers_tree_collapse: "Свернуть ветку провайдера",
          providers_tree_expand: "Развернуть ветку провайдера",
        },
      }),
    );

    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
  });

  it("renders staff instead of doctors for non-medical providers", () => {
    const nonMedicalProvider: ProviderSummary = {
      ...provider("andreiver", "Andreiver", "organization"),
      provider_type: "non_medical",
      doctor_count: 5,
      staff_count: 2,
    };
    const html = renderToStaticMarkup(
      createElement(ProviderHierarchyTimeline, {
        lang: "ru",
        onProviderClick: () => undefined,
        providers: [nonMedicalProvider],
        tr: {
          providers_doctors: "Doctors",
          providers_staff: "Staff",
        },
      }),
    );

    expect(html).toContain("2 Staff");
    expect(html).not.toContain("Doctors");
  });
});
