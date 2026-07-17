import { describe, expect, it } from "vitest";

import { buildConflictQuery } from "./query-builders";

describe("buildConflictQuery", () => {
  it("includes the doctor id in appointment conflict prechecks", () => {
    const url = new URL(
      buildConflictQuery(
        "patient-1",
        "appointment-1",
        "2026-06-18",
        "09:00",
        "10:00",
        "interpreter-1",
        "doctor-1",
      ),
      "http://localhost",
    );

    expect(url.pathname).toBe("/appointments/meta/conflicts");
    expect(url.searchParams.get("patient_id")).toBe("patient-1");
    expect(url.searchParams.get("appointment_id")).toBe("appointment-1");
    expect(url.searchParams.get("interpreter_id")).toBe("interpreter-1");
    expect(url.searchParams.get("doctor_id")).toBe("doctor-1");
  });

  it("omits both time parameters when only one time is provided", () => {
    const url = new URL(
      buildConflictQuery(
        "patient-1",
        "",
        "2026-06-18",
        "09:00",
        "",
        "",
      ),
      "http://localhost",
    );

    expect(url.searchParams.has("time_start")).toBe(false);
    expect(url.searchParams.has("time_end")).toBe(false);
  });
});
