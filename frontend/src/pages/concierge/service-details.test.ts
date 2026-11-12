import { describe, expect, it } from "vitest";

import {
  blankServiceDetailsForm,
  serviceDetailsError,
  serviceDetailsFormFrom,
  serviceDetailsKind,
  serviceDetailsPayload,
  serviceDetailsRows,
  taxonomyCodeOf,
} from "./service-details";

describe("own fields of a concierge service kind (owner decision 2026-11-12)", () => {
  it("takes the kind from rides and from the partner category, no second picker", () => {
    expect(serviceDetailsKind("transfer", null)).toBe("transfer");
    expect(serviceDetailsKind("chauffeur", "nonmedical_restaurants")).toBe("transfer");
    expect(serviceDetailsKind("hotel", "nonmedical_restaurants")).toBe("restaurant");
    expect(serviceDetailsKind("other", "nonmedical_cafe")).toBe("restaurant");
    expect(serviceDetailsKind("other", "nonmedical_culture")).toBe("tickets");
    expect(serviceDetailsKind("other", "nonmedical_sport")).toBe("tickets");
    expect(serviceDetailsKind("other", "nonmedical_strip_clubs_bordelle")).toBeNull();
    expect(serviceDetailsKind("hotel", "nonmedical_hotels")).toBeNull();
    expect(serviceDetailsKind("flight", null)).toBeNull();
  });

  it("finds the category code, falling back to the stored one", () => {
    const nodes = [{ id: "n1", code: "nonmedical_restaurants" }];
    expect(taxonomyCodeOf("n1", nodes)).toBe("nonmedical_restaurants");
    expect(taxonomyCodeOf("", nodes)).toBeNull();
    expect(taxonomyCodeOf("n2", nodes, { id: "n2", code: "nonmedical_culture" })).toBe("nonmedical_culture");
    expect(taxonomyCodeOf("n3", nodes, { id: "n2", code: "nonmedical_culture" })).toBeNull();
  });

  it("sends only the filled fields of the kind, counts as numbers", () => {
    const form = {
      ...blankServiceDetailsForm(),
      persons: "4",
      preferred_time: "19:30",
      dietary_notes: "  vegetarisch ",
      flight_number: "LH 1234",
    };
    expect(serviceDetailsPayload("restaurant", form)).toEqual({
      persons: 4,
      preferred_time: "19:30",
      dietary_notes: "vegetarisch",
    });
    expect(serviceDetailsPayload("transfer", form)).toEqual({ flight_number: "LH 1234" });
    expect(serviceDetailsPayload(null, form)).toEqual({});
  });

  it("refuses what the server refuses, in the form's language", () => {
    const form = { ...blankServiceDetailsForm(), seats: "0" };
    expect(serviceDetailsError("tickets", form, "ru")).toMatch(/целое число от 1 до 100/);
    expect(serviceDetailsError("tickets", { ...form, seats: "2.5" }, "de")).toMatch(/ganze Zahl/);
    expect(serviceDetailsError("tickets", { ...form, seats: "2" }, "de")).toBeNull();
    expect(
      serviceDetailsError("restaurant", { ...blankServiceDetailsForm(), preferred_time: "25:00" }, "ru"),
    ).toMatch(/ЧЧ:ММ/);
    expect(
      serviceDetailsError("transfer", { ...blankServiceDetailsForm(), flight_number: "x".repeat(31) }, "de"),
    ).toMatch(/höchstens 30 Zeichen/);
    expect(serviceDetailsError(null, form, "ru")).toBeNull();
  });

  it("shows the filled fields of the current kind only", () => {
    const details = { persons: 2, flight_number: "LH 1", dietary_notes: "" };
    expect(serviceDetailsRows("restaurant", details, "ru")).toEqual([
      { key: "persons", label: "Количество человек", value: "2" },
    ]);
    expect(serviceDetailsRows("transfer", details, "de")).toEqual([
      { key: "flight_number", label: "Flug- oder Zugnummer", value: "LH 1" },
    ]);
    expect(serviceDetailsRows(null, details, "ru")).toEqual([]);
    expect(serviceDetailsFormFrom({ persons: 3 }).persons).toBe("3");
  });
});
