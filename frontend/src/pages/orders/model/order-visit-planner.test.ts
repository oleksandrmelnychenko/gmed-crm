import { describe, expect, it } from "vitest";

import {
  batchFailureText,
  batchPayload,
  draftConflicts,
  gridDays,
  gridSlots,
  minutesToTime,
  newDraft,
  timeToMinutes,
  type BusySlot,
} from "./order-visit-planner";

const mueller = { providerId: "p1", providerName: "Charité", doctorId: "d1", doctorName: "Dr. Müller" };
const schmidt = { providerId: "p2", providerName: "Helios", doctorId: "d2", doctorName: "Dr. Schmidt" };
const mri = { providerId: "p3", providerName: "Radiologie Mitte", doctorId: null, doctorName: null };

function busy(partial: Partial<BusySlot>): BusySlot {
  return {
    id: null,
    date: "2026-11-16",
    time_start: "10:00",
    time_end: "11:00",
    scopes: ["doctor"],
    doctor_id: null,
    interpreter_id: null,
    title: null,
    same_order: false,
    ...partial,
  };
}

describe("order visit planner grid", () => {
  it("lays out 07:00–20:00 in half hours over five days across a month end", () => {
    const slots = gridSlots();
    expect(minutesToTime(slots[0])).toBe("07:00");
    expect(minutesToTime(slots.at(-1)!)).toBe("19:30");
    expect(gridDays("2026-11-29")).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
    ]);
    expect(timeToMinutes("09:30:00")).toBe(570);
    expect(timeToMinutes(null)).toBeNull();
  });

  it("a new draft lasts an hour, shortened to end by 20:00, titled after the doctor", () => {
    expect(newDraft("a", mueller, "2026-11-16", 9 * 60)).toMatchObject({
      duration: 60,
      title: "Dr. Müller",
      interpreterNeeded: false,
    });
    expect(newDraft("b", mri, "2026-11-16", 19 * 60 + 30).duration).toBe(30);
    expect(newDraft("c", mri, "2026-11-16", 8 * 60).title).toBe("Radiologie Mitte");
  });
});

describe("draftConflicts", () => {
  it("marks the patient for overlapping drafts and the shared doctor and interpreter", () => {
    const a = { ...newDraft("a", mueller, "2026-11-16", 540), interpreterNeeded: true, interpreterId: "i1" };
    const b = { ...newDraft("b", mueller, "2026-11-16", 570), interpreterNeeded: true, interpreterId: "i1" };
    const c = newDraft("c", schmidt, "2026-11-16", 600); // touches a at 10:00
    const d = newDraft("d", schmidt, "2026-11-17", 570); // other day
    const conflicts = draftConflicts([a, b, c, d], []);
    expect([...conflicts.get("a")!].sort()).toEqual(["doctor", "interpreter", "patient"]);
    expect([...conflicts.get("c")!]).toEqual(["patient"]); // overlaps b (09:30–10:30)
    expect(conflicts.has("d")).toBe(false);
  });

  it("uses the server's taken time only for the same doctor or interpreter", () => {
    const a = newDraft("a", mueller, "2026-11-16", 600);
    const b = newDraft("b", schmidt, "2026-11-17", 600);
    const conflicts = draftConflicts(
      [a, b],
      [
        busy({ doctor_id: "d1" }),
        busy({ doctor_id: "d9", date: "2026-11-17" }),
        busy({ scopes: ["patient"], date: "2026-11-17", time_start: "10:30", time_end: "11:30" }),
      ],
    );
    expect([...conflicts.get("a")!]).toEqual(["doctor"]);
    expect([...conflicts.get("b")!]).toEqual(["patient"]);
  });
});

describe("batchPayload", () => {
  it("sends Berlin wall-clock times and drops the interpreter when none is needed", () => {
    const a = { ...newDraft("a", mueller, "2026-11-16", 540), duration: 45, title: "  Echo  " };
    const b = { ...newDraft("b", mri, "2026-11-16", 840), interpreterNeeded: false, interpreterId: "i1" };
    const c = { ...newDraft("c", schmidt, "2026-11-17", 600), interpreterNeeded: true, interpreterId: "i2" };
    expect(batchPayload([a, b, c], true)).toEqual({
      dry_run: true,
      items: [
        expect.objectContaining({
          provider_id: "p1",
          doctor_id: "d1",
          title: "Echo",
          date: "2026-11-16",
          time_start: "09:00",
          time_end: "09:45",
          interpreter_id: null,
          location: "Charité",
        }),
        expect.objectContaining({ doctor_id: null, interpreter_needed: null, interpreter_id: null }),
        expect.objectContaining({ interpreter_needed: true, interpreter_id: "i2" }),
      ],
    });
  });
});

describe("batchFailureText", () => {
  it("translates refusals instead of showing the server's English", () => {
    expect(
      batchFailureText({ index: 0, code: "conflict", conflicts: { doctor_conflict_count: 1 } }, "ru"),
    ).toBe("Время уже занято (врач)");
    expect(
      batchFailureText({ index: 0, code: "batch_overlap", scopes: ["patient", "interpreter"] }, "de"),
    ).toBe("Überschneidet sich mit einem anderen Termin dieses Plans (Patient, Dolmetscher)");
    expect(batchFailureText({ index: 0, code: "invalid", message: "Doctor does not belong" }, "ru")).not.toMatch(
      /Doctor/,
    );
  });
});

describe("grid drafts of a lead's order", () => {
  it("restores saved lines and drops unreadable ones", async () => {
    const { draftsFromSaved, draftSavePayload } = await import("./order-visit-planner");
    const restored = draftsFromSaved([
      { id: "s1", provider_id: "p1", provider_name: "Charité", doctor_id: "d1", doctor_name: "Dr. Müller",
        title: "Echo", date: "2026-11-20", time_start: "09:00", time_end: "10:30", interpreter_needed: true, interpreter_id: null },
      { id: "s2", provider_id: "p1", provider_name: "Charité", doctor_id: null, doctor_name: null,
        title: "Broken", date: "2026-11-20", time_start: "11:00", time_end: "10:00", interpreter_needed: false, interpreter_id: null },
    ]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ start: 540, duration: 90, interpreterNeeded: true, interpreterId: "" });
    expect(draftSavePayload(restored)).toEqual({
      items: [{
        provider_id: "p1", doctor_id: "d1", title: "Echo", date: "2026-11-20", time_start: "09:00", time_end: "10:30",
        interpreter_needed: true, interpreter_id: null,
      }],
    });
  });
});
