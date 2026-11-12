import { describe, expect, it } from "vitest";

import { serviceRequestPlaceholders } from "./portal-service-request-placeholders";

describe("serviceRequestPlaceholders", () => {
  it("fits the requested kind instead of the hotel example", () => {
    expect(serviceRequestPlaceholders("hotel", null, "ru").title).toBe("Отель у аэропорта");
    expect(serviceRequestPlaceholders("transfer", "transfer", "ru")).toMatchObject({
      title: "Трансфер из аэропорта",
      vendor: "Трансферная компания",
    });
    expect(serviceRequestPlaceholders("other", "restaurant", "de").vendor).toBe("Name des Restaurants");
    expect(serviceRequestPlaceholders("other", "tickets", "ru").title).toBe("Билеты в театр");
  });

  it("never shows the hotel wording for a non-hotel request", () => {
    for (const lang of ["ru", "de"] as const) {
      for (const [kind, details] of [["transfer", "transfer"], ["other", "restaurant"], ["other", "tickets"], ["chauffeur", "transfer"]] as const) {
        const placeholders = serviceRequestPlaceholders(kind, details, lang);
        expect(`${placeholders.title} ${placeholders.vendor} ${placeholders.notes}`).not.toMatch(/отел|hotel/i);
      }
    }
  });

  it("falls back to a neutral example for an unknown kind", () => {
    expect(serviceRequestPlaceholders("unknown", null, "de").title).toBe("Was Sie brauchen");
  });
});
