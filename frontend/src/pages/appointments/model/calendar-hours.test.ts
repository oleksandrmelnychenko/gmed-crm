import { describe, expect, it } from "vitest";

import { resolveTimeGridHours } from "./calendar-hours";

describe("resolveTimeGridHours", () => {
  it("keeps 06:00-22:00 when every visit lies inside", () => {
    expect(
      resolveTimeGridHours([
        { id: "a", start: "2027-04-06T09:00", end: "2027-04-06T10:00" },
        { id: "b", start: "2027-04-07", allDay: true },
      ]),
    ).toEqual({ slotMinTime: "06:00:00", slotMaxTime: "22:00:00" });
  });

  it("widens to the earliest start and the latest end of the period", () => {
    expect(
      resolveTimeGridHours(
        [
          { id: "night", start: "2027-03-28T01:30", end: "2027-03-28T03:30" },
          { id: "late", start: "2027-03-28T23:00", end: "2027-03-28T23:45" },
          // Outside the shown week: ignored.
          { id: "other", start: "2027-04-06T00:15", end: "2027-04-06T00:45" },
        ],
        "2027-03-22",
        "2027-03-29",
      ),
    ).toEqual({ slotMinTime: "01:00:00", slotMaxTime: "24:00:00" });
  });

  it("shows a visit that ends after 22:00 in full", () => {
    expect(
      resolveTimeGridHours([
        { id: "a", start: "2027-04-06T21:30", end: "2027-04-06T22:30" },
      ]),
    ).toEqual({ slotMinTime: "06:00:00", slotMaxTime: "23:00:00" });
  });

  it("counts a visit without an end as one hour", () => {
    expect(
      resolveTimeGridHours([{ id: "a", start: "2027-04-06T05:30" }]),
    ).toEqual({ slotMinTime: "05:00:00", slotMaxTime: "22:00:00" });
  });
});
