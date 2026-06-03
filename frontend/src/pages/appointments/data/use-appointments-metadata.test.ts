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
    expect(state.metadataError).toBe("");
  });
});
