import { describe, expect, it } from "vitest";

import {
  LEAD_QUESTIONNAIRE_SERVICE_OPTIONS,
  formatDateTime,
  normalizeLeadServiceValue,
} from "./leads-model";

describe("lead questionnaire services", () => {
  it("keeps every service option from the questionnaire contract", () => {
    expect(LEAD_QUESTIONNAIRE_SERVICE_OPTIONS).toEqual([
      "driver",
      "concierge",
      "medical-transport",
      "air-ambulance",
      "business-aviation",
      "none",
      "not-sure",
    ]);
  });

  it("normalizes transport aliases without rewriting legacy custom values", () => {
    expect(normalizeLeadServiceValue("medical_transport")).toBe("medical-transport");
    expect(normalizeLeadServiceValue("AIR_AMBULANCE")).toBe("air-ambulance");
    expect(normalizeLeadServiceValue("not_sure")).toBe("not-sure");
    expect(normalizeLeadServiceValue("medical_support")).toBe("medical_support");
  });
});

describe("lead received timestamp", () => {
  it("formats both the date and minute-level time", () => {
    expect(formatDateTime("2026-04-02T09:45:00", "de-DE", "-")).toBe(
      "02.04.2026, 09:45",
    );
  });

  it("keeps the configured fallback for a missing value", () => {
    expect(formatDateTime(null, "ru-RU", "-")).toBe("-");
  });
});
