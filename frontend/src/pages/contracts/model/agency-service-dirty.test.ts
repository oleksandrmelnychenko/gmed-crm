import { describe, expect, it } from "vitest";
import { blankAgencyServiceForm, hasAgencyServiceFormChanges } from "./contracts-model";
import { legacyServiceDescriptionItems, serviceDescriptionText } from "@/lib/service-description";

describe("catalog draft changes", () => {
  it("becomes clean after restoring legacy description rows", () => {
    const description = "1) First point\n2) Second point";
    const initial = { ...blankAgencyServiceForm("Tag"), description, descriptionItems: legacyServiceDescriptionItems(description) };
    const restored = { ...initial, description: serviceDescriptionText(initial.descriptionItems) };
    expect(hasAgencyServiceFormChanges(restored, initial)).toBe(false);
    expect(hasAgencyServiceFormChanges({ ...restored, descriptionItems: [...initial.descriptionItems].reverse() }, initial)).toBe(true);
    expect(hasAgencyServiceFormChanges({ ...restored, serviceName: "Changed" }, initial)).toBe(true);
  });
});
