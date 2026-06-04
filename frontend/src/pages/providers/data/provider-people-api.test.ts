import { describe, expect, it } from "vitest";

import { buildProviderPeopleQuery } from "./provider-people-api";

function paramsFromPath(path: string) {
  return new URL(path, "https://crm.test").searchParams;
}

describe("buildProviderPeopleQuery", () => {
  it("serializes user-facing people filters to API query keys", () => {
    const params = paramsFromPath(
      buildProviderPeopleQuery({
        personType: "doctor",
        providerType: "medical",
        taxonomyNodeId: "0f5ac3c1-0000-4000-9000-000000000001",
        gender: "male",
        fachbereich: "Urologie",
        specialization: "urologie",
        role: "chefarzt",
        patientId: "9d3f7b6a-7d79-4f23-9dc0-2f4cc3435b3a",
      }),
    );

    expect(params.get("person_type")).toBe("doctor");
    expect(params.get("provider_type")).toBe("medical");
    expect(params.get("provider_taxonomy_node_id")).toBe("0f5ac3c1-0000-4000-9000-000000000001");
    expect(params.get("gender")).toBe("male");
    expect(params.get("fachbereich")).toBe("Urologie");
    expect(params.get("specialization")).toBe("urologie");
    expect(params.get("role")).toBe("chefarzt");
    expect(params.get("patient_id")).toBe("9d3f7b6a-7d79-4f23-9dc0-2f4cc3435b3a");
  });
});
