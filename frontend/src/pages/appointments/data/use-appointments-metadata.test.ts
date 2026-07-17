import { describe, expect, it } from "vitest";

import { buildAppointmentsMetadataState } from "./use-appointments-metadata";

describe("buildAppointmentsMetadataState", () => {
  it("keeps first-load providers even when unrelated metadata falls back", () => {
    const state = buildAppointmentsMetadataState({
      failedLoadMessage: "Failed to load metadata",
      patientResult: { rows: [], error: "Failed to load metadata" },
      providerResult: {
        rows: [
          {
            id: "provider-1",
            name: "Clinic QA",
            provider_type: "medical",
            address_city: "Munich",
            fachbereich: null,
            taxonomy_filter_ids: ["taxonomy-1"],
          },
        ],
        error: "",
      },
      taxonomyRows: [],
      interpreterResult: { rows: [], error: "" },
      staffResult: { rows: [], error: "Failed to load metadata" },
    });

    expect(state.metadataLoading).toBe(false);
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "provider-1",
        name: "Clinic QA",
      }),
    ]);
    expect(state.providersError).toBe("");
    expect(state.metadataError).toBe("Failed to load metadata");
  });

  it("surfaces taxonomy failure without discarding the flat provider list", () => {
    const state = buildAppointmentsMetadataState({
      failedLoadMessage: "Failed to load metadata",
      patientResult: { rows: [], error: "" },
      providerResult: {
        rows: [
          {
            id: "provider-1",
            name: "Clinic QA",
            provider_type: "medical",
            address_city: "Munich",
            fachbereich: null,
            taxonomy_filter_ids: [],
          },
        ],
        error: "",
      },
      taxonomyRows: [],
      taxonomyError: "Failed to load metadata",
      interpreterResult: { rows: [], error: "" },
      staffResult: { rows: [], error: "" },
    });

    expect(state.providers).toHaveLength(1);
    expect(state.taxonomyNodes).toEqual([]);
    expect(state.providersError).toBe("Failed to load metadata");
    expect(state.metadataError).toBe("Failed to load metadata");
  });
});
