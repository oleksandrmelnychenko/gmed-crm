import { describe, expect, it } from "vitest";

import {
  filterProvidersForAppointmentScope,
  providerOptionLabel,
  providerSelectionFitsAppointmentScope,
  providerTaxonomyFilterOptions,
  providerTaxonomyTreeOptions,
} from "./provider-taxonomy";
import type { ProviderSummary } from "./types";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";

function taxonomyNode(
  id: string,
  code: string,
  level: ProviderTaxonomyNode["level"],
  providerKind: ProviderTaxonomyNode["provider_kind"],
  parentId: string | null,
  nameDe: string,
): ProviderTaxonomyNode {
  return {
    id,
    code,
    level,
    provider_kind: providerKind,
    parent_id: parentId,
    name_en: nameDe,
    name_de: nameDe,
    name_ru: null,
    description: null,
    filter_keys: [],
    is_leaf: level === "type",
    is_assignable: level === "type",
    is_active: true,
    sort_order: 0,
  };
}

function provider(
  id: string,
  providerType: string,
  taxonomyPath: ProviderSummary["taxonomy_path"],
): ProviderSummary {
  const primary = taxonomyPath?.at(-1) ?? null;
  return {
    id,
    name: id,
    provider_type: providerType,
    address_city: null,
    fachbereich: null,
    taxonomy_node_id: primary?.id ?? null,
    taxonomy_node_code: primary?.code ?? null,
    taxonomy_node_name_de: primary?.name_de ?? null,
    taxonomy_node_name_ru: primary?.name_ru ?? null,
    taxonomy_path: taxonomyPath,
    taxonomy_node_ids: taxonomyPath?.map((node) => node.id) ?? [],
  };
}

const rehaProvider = provider("reha", "medical", [
  { id: "medical", code: "medical_providers", name_de: "Medizinisch", name_ru: "Medical" },
  { id: "reha-group", code: "medical_reha_care", name_de: "Reha", name_ru: "Rehab" },
  { id: "reha-leaf", code: "medical_reha_clinics", name_de: "Reha Kliniken", name_ru: "Rehab clinics" },
]);

const pharmacyProvider = provider("pharmacy", "medical", [
  { id: "medical", code: "medical_providers", name_de: "Medizinisch", name_ru: "Medical" },
  { id: "pharmacy-group", code: "medical_pharmacies_supply", name_de: "Apotheken", name_ru: "Pharmacies" },
  { id: "pharmacy-leaf", code: "medical_pharmacies", name_de: "Apotheken", name_ru: "Pharmacies" },
]);

const chauffeurProvider = provider("chauffeur", "non_medical", [
  { id: "nonmedical", code: "nonmedical_providers", name_de: "Nicht medizinisch", name_ru: "Non medical" },
  { id: "transport-group", code: "nonmedical_transport_logistics", name_de: "Transport", name_ru: "Transport" },
  { id: "chauffeur-leaf", code: "nonmedical_chauffeur", name_de: "Chauffeur", name_ru: "Chauffeur" },
]);

describe("appointment provider taxonomy filters", () => {
  const providers = [rehaProvider, pharmacyProvider, chauffeurProvider];

  it("filters providers by appointment type and taxonomy ancestors", () => {
    expect(
      filterProvidersForAppointmentScope(providers, "medical", "reha-group").map(
        (item) => item.id,
      ),
    ).toEqual(["reha"]);

    expect(
      filterProvidersForAppointmentScope(providers, "non_medical", "transport-group").map(
        (item) => item.id,
      ),
    ).toEqual(["chauffeur"]);
  });

  it("validates selected provider against appointment scope", () => {
    expect(
      providerSelectionFitsAppointmentScope(providers, "reha", "medical", "reha-group"),
    ).toBe(true);
    expect(
      providerSelectionFitsAppointmentScope(providers, "reha", "medical", "pharmacy-group"),
    ).toBe(false);
    expect(
      providerSelectionFitsAppointmentScope(providers, "chauffeur", "medical", ""),
    ).toBe(false);
  });

  it("builds distinct taxonomy options from provider paths", () => {
    const options = providerTaxonomyFilterOptions(providers, "medical", "de");

    expect(options.map((option) => option.id)).toContain("reha-group");
    expect(options.map((option) => option.id)).toContain("pharmacy-group");
    expect(options.map((option) => option.id)).not.toContain("transport-group");
  });

  it("formats provider dropdown labels with localized taxonomy without provider root", () => {
    expect(providerOptionLabel(chauffeurProvider, "ru")).toBe(
      "chauffeur - Transport / Chauffeur",
    );
    expect(providerOptionLabel(rehaProvider, "de")).toBe("reha - Reha / Reha Kliniken");
  });

  it("builds appointment taxonomy options from the full taxonomy tree", () => {
    const taxonomyNodes = [
      taxonomyNode("medical", "medical_providers", "category", "medical", null, "Medizinische Provider"),
      taxonomyNode("reha-group", "medical_reha_care", "group", "medical", "medical", "Reha & Pflege"),
      taxonomyNode("reha-leaf", "medical_reha_clinics", "type", "medical", "reha-group", "Reha-Kliniken"),
      taxonomyNode("unused-leaf", "medical_unused", "type", "medical", "reha-group", "Unused"),
      taxonomyNode("nonmedical", "nonmedical_providers", "category", "non_medical", null, "Nicht-Medizinische Provider"),
      taxonomyNode("transport-group", "nonmedical_transport_logistics", "group", "non_medical", "nonmedical", "Transport"),
    ];

    const options = providerTaxonomyTreeOptions(taxonomyNodes, "medical", "de");

    expect(options.map((option) => option.id)).toEqual([
      "reha-group",
      "reha-leaf",
      "unused-leaf",
    ]);
    expect(options.map((option) => option.label)).toContain("Reha & Pflege / Unused");
    expect(options.map((option) => option.label).join(" ")).not.toContain("Medizinische Provider");
  });
});
