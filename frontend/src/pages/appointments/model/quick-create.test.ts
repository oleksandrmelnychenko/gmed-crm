import { describe, expect, it } from "vitest";

import { namedConflictLines, quickCreateDuration, quickCreateEnd, quickCreatePopoverPosition } from "./quick-create";

describe("calendar quick create", () => {
  it("starts with the dragged range, else one hour", () => {
    expect(quickCreateDuration("10:00", "10:30")).toBe(30);
    expect(quickCreateDuration("10:00", "12:00")).toBe(120);
    expect(quickCreateDuration("10:00", "")).toBe(60);
    expect(quickCreateDuration("", "")).toBe(60);
    expect(quickCreateDuration("11:00", "10:00")).toBe(60);
  });

  it("computes the end and keeps the visit on its day", () => {
    expect(quickCreateEnd("10:00", 45)).toBe("10:45");
    expect(quickCreateEnd("09:30", 90)).toBe("11:00");
    expect(quickCreateEnd("23:30", 60)).toBe("23:59");
  });

  it("opens next to the click and stays inside the screen", () => {
    expect(quickCreatePopoverPosition({ x: 100, y: 200 }, { width: 1280, height: 800 })).toEqual({ left: 108, top: 200 });
    // Near the right edge it opens to the left of the click.
    expect(quickCreatePopoverPosition({ x: 1200, y: 200 }, { width: 1280, height: 800 })).toEqual({ left: 872, top: 200 });
    // Near the bottom it moves up so it fits.
    expect(quickCreatePopoverPosition({ x: 100, y: 780 }, { width: 1280, height: 800 })).toEqual({ left: 108, top: 272 });
  });
});

describe("named clashes in the quick create", () => {
  it("names the patient's visit, a busy doctor, and hides a blocked title", () => {
    const item = (over: Record<string, unknown>) => ({
      id: "x", title: "Check up-Kardiologie", date: "2026-11-17", time_start: "10:00:00", time_end: "11:00:00",
      type: "medical", status: "planned", patient_name: "", patient_pid: "", provider_name: "Klinik Nord",
      doctor_name: "Dr. Weber", interpreter_name: null, is_blocked: false, ...over,
    });
    const lines = namedConflictLines(
      {
        has_conflicts: true, patient_conflict_count: 1, interpreter_conflict_count: 0, doctor_conflict_count: 1,
        patient_conflicts: [item({})] as never,
        doctor_conflicts: [item({ id: "y", is_blocked: true, title: "Blocked", time_start: "12:00", time_end: null })] as never,
        interpreter_conflicts: [],
      },
      "ru",
    );
    expect(lines).toEqual([
      "пациент уже записан: 10:00–11:00 Check up-Kardiologie (Dr. Weber)",
      "врач занят: 12:00 (Dr. Weber)",
    ]);
    expect(namedConflictLines(null, "de")).toEqual([]);
  });
});
