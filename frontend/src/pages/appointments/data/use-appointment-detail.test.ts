import { describe, expect, it } from "vitest";

import type { AppointmentDetailResourcePayload } from "./detail-resource-groups";
import {
  areAppointmentDetailResourceGroupsSettled,
  createDetailResourceKeyState,
  selectUnattemptedAppointmentDetailResourceGroups,
  settleAppointmentDetailResourceResults,
} from "./use-appointment-detail";

describe("settleAppointmentDetailResourceResults", () => {
  it("marks only fulfilled groups loaded and preserves prior data on failures", () => {
    const results: PromiseSettledResult<AppointmentDetailResourcePayload>[] = [
      {
        status: "fulfilled",
        value: {
          group: "checklist",
          value: [
            {
              id: "checklist-1",
              phase: "preparation",
              item_text: "Confirm documents",
              is_completed: false,
              completed_at: null,
            },
          ],
        },
      },
      {
        status: "rejected",
        reason: new Error("Tasks unavailable"),
      },
    ];

    const settlement = settleAppointmentDetailResourceResults(
      ["checklist", "tasks"],
      results,
    );

    expect(settlement.loadedGroups).toEqual(["checklist"]);
    expect(settlement.detailPatch.detailChecklist).toHaveLength(1);
    expect(settlement.detailPatch).not.toHaveProperty("detailTasks");
    expect(settlement.firstErrorMessage).not.toBe("Tasks unavailable");
  });

  it("does not retry a failed group until refresh or close and reopen", () => {
    const detailKey = "appointment-1:0";
    const attemptedKeys = createDetailResourceKeyState();

    expect(
      selectUnattemptedAppointmentDetailResourceGroups(
        ["tasks"],
        attemptedKeys,
        detailKey,
      ),
    ).toEqual(["tasks"]);

    attemptedKeys.tasks = detailKey;
    const failed = settleAppointmentDetailResourceResults(
      ["tasks"],
      [{ status: "rejected", reason: new Error("Tasks unavailable") }],
    );

    expect(failed.loadedGroups).toEqual([]);
    expect(
      selectUnattemptedAppointmentDetailResourceGroups(
        ["tasks"],
        attemptedKeys,
        detailKey,
      ),
    ).toEqual([]);
    expect(
      selectUnattemptedAppointmentDetailResourceGroups(
        ["tasks"],
        attemptedKeys,
        "appointment-1:1",
      ),
    ).toEqual(["tasks"]);
    expect(
      selectUnattemptedAppointmentDetailResourceGroups(
        ["tasks"],
        createDetailResourceKeyState(),
        detailKey,
      ),
    ).toEqual(["tasks"]);
  });
});

describe("areAppointmentDetailResourceGroupsSettled", () => {
  it("settles failed groups after their request finishes without marking them loaded", () => {
    const detailKey = "appointment-1:0";
    const loadedKeys = createDetailResourceKeyState();
    const attemptedKeys = createDetailResourceKeyState();
    const loadingKeys = createDetailResourceKeyState();

    attemptedKeys.tasks = detailKey;
    loadingKeys.tasks = detailKey;
    expect(
      areAppointmentDetailResourceGroupsSettled(
        ["tasks"],
        loadedKeys,
        attemptedKeys,
        loadingKeys,
        detailKey,
      ),
    ).toBe(false);

    loadingKeys.tasks = "";
    expect(
      areAppointmentDetailResourceGroupsSettled(
        ["tasks"],
        loadedKeys,
        attemptedKeys,
        loadingKeys,
        detailKey,
      ),
    ).toBe(true);
    expect(loadedKeys.tasks).toBe("");
  });
});
