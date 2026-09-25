import { describe, expect, it } from "vitest";

import type {
  AppointmentDetail,
  ChecklistItem,
  ReportSummary,
} from "@/pages/appointments/model/types";
import type { AppointmentDetailResourceGroup } from "@/pages/appointments/model/detail-resource-needs";

import type { AppointmentDetailResourcePayload } from "./detail-resource-groups";
import {
  appointmentDetailReducer,
  applyAppointmentDetailResourceSettlement,
  applyLoadedAppointmentDetail,
  areAppointmentDetailResourceGroupsSettled,
  beginAppointmentDetailLoad,
  createAppointmentDetailState,
  createDetailResourceKeyState,
  markAppointmentDetailResourceGroupsRequested,
  selectUnattemptedAppointmentDetailResourceGroups,
  settleAppointmentDetailResourceResults,
  type AppointmentDetailState,
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

describe("appointment detail refresh ordering", () => {
  const groups: AppointmentDetailResourceGroup[] = ["checklist", "report"];

  function appointment(id: string) {
    return { id, patient_id: `patient-of-${id}` } as AppointmentDetail;
  }

  function checklistItem(id: string, itemText: string): ChecklistItem {
    return {
      id,
      phase: "preparation",
      item_text: itemText,
      is_completed: false,
      completed_at: null,
    } as ChecklistItem;
  }

  function interpreterReport(approvalStatus: string): ReportSummary {
    return {
      id: "report-1",
      interpreter_id: "interpreter-1",
      interpreter_name: "Synthetic Interpreter",
      hours: "2.5",
      report_text: null,
      approval_status: approvalStatus,
      approved_by_name: approvalStatus === "approved" ? "Synthetic Reviewer" : null,
      approved_at: approvalStatus === "approved" ? "2026-09-21T09:00:00Z" : null,
      created_at: "2026-09-20T10:00:00Z",
    };
  }

  function resources(
    checklist: ChecklistItem[],
    report: ReportSummary | null,
  ): PromiseSettledResult<AppointmentDetailResourcePayload>[] {
    return [
      { status: "fulfilled", value: { group: "checklist", value: checklist } },
      { status: "fulfilled", value: { group: "report", value: report } },
    ];
  }

  const begin = (state: AppointmentDetailState) =>
    appointmentDetailReducer(state, beginAppointmentDetailLoad());
  const request = (state: AppointmentDetailState, key: string) =>
    appointmentDetailReducer(state, (current) =>
      markAppointmentDetailResourceGroupsRequested(current, groups, key),
    );
  const settle = (
    state: AppointmentDetailState,
    key: string,
    results: PromiseSettledResult<AppointmentDetailResourcePayload>[],
  ) =>
    appointmentDetailReducer(state, (current) =>
      applyAppointmentDetailResourceSettlement(
        current,
        groups,
        settleAppointmentDetailResourceResults(groups, results),
        key,
      ),
    );
  const loadDetail = (
    state: AppointmentDetailState,
    key: string,
    detail: AppointmentDetail,
  ) =>
    appointmentDetailReducer(state, (current) =>
      applyLoadedAppointmentDetail(
        current,
        { detail, assignments: [], assignmentsError: "" },
        key,
      ),
    );

  function settledFor(state: AppointmentDetailState, key: string) {
    return areAppointmentDetailResourceGroupsSettled(
      groups,
      state.detailResourceKeys,
      state.detailResourceAttemptedKeys,
      state.detailResourceLoadingKeys,
      key,
    );
  }

  function missingFor(state: AppointmentDetailState, key: string) {
    return groups.filter((group) => state.detailResourceKeys[group] !== key);
  }

  /** Appointment 1 opened: pending report, one checklist item, key `appointment-1:0`. */
  function openedAppointment() {
    let state = begin(createAppointmentDetailState());
    state = loadDetail(state, "appointment-1:0", appointment("appointment-1"));
    state = request(state, "appointment-1:0");
    return settle(
      state,
      "appointment-1:0",
      resources([checklistItem("item-1", "Confirm documents")], interpreterReport("pending")),
    );
  }

  it("keeps resources for the refreshed key that settle before the detail itself", () => {
    const refreshedKey = "appointment-1:1";
    // Approving the report (or adding a checklist item) bumps the detail
    // version; the resource groups for the new key are requested while the
    // previous detail is still on screen, in parallel with the detail GET.
    let state = begin(openedAppointment());
    state = request(state, refreshedKey);
    state = settle(
      state,
      refreshedKey,
      resources(
        [
          checklistItem("item-1", "Confirm documents"),
          checklistItem("item-2", "Book the transfer"),
        ],
        interpreterReport("approved"),
      ),
    );
    state = loadDetail(state, refreshedKey, appointment("appointment-1"));

    expect(state.detailLoading).toBe(false);
    expect(state.detailReport?.approval_status).toBe("approved");
    expect(state.detailChecklist.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    // Both groups count as loaded for the new key and are not requested
    // again, so the rows kept here are what the page shows.
    expect(missingFor(state, refreshedKey)).toEqual([]);
    expect(settledFor(state, refreshedKey)).toBe(true);
  });

  it("clears the previous key's rows when the detail answers first, then fills them", () => {
    const refreshedKey = "appointment-1:1";
    let state = begin(openedAppointment());
    state = request(state, refreshedKey);
    state = loadDetail(state, refreshedKey, appointment("appointment-1"));

    expect(state.detailReport).toBeNull();
    expect(state.detailChecklist).toEqual([]);
    expect(settledFor(state, refreshedKey)).toBe(false);

    state = settle(
      state,
      refreshedKey,
      resources([checklistItem("item-1", "Confirm documents")], interpreterReport("approved")),
    );
    expect(state.detailReport?.approval_status).toBe("approved");
    expect(state.detailChecklist).toHaveLength(1);
    expect(settledFor(state, refreshedKey)).toBe(true);
  });

  it("never shows another appointment's rows after switching", () => {
    const nextKey = "appointment-2:0";
    let state = begin(openedAppointment());
    state = request(state, nextKey);
    state = loadDetail(state, nextKey, appointment("appointment-2"));

    expect(state.detail?.id).toBe("appointment-2");
    expect(state.detailReport).toBeNull();
    expect(state.detailChecklist).toEqual([]);
  });

  it("keeps a resource error that arrived before the detail", () => {
    const refreshedKey = "appointment-1:1";
    let state = begin(openedAppointment());
    state = request(state, refreshedKey);
    state = settle(state, refreshedKey, [
      { status: "rejected", reason: new Error("Checklist unavailable") },
      { status: "fulfilled", value: { group: "report", value: interpreterReport("approved") } },
    ]);
    const resourceError = state.detailError;
    state = loadDetail(state, refreshedKey, appointment("appointment-1"));

    expect(resourceError).not.toBe("");
    expect(state.detailError).toBe(resourceError);
    expect(state.detailReport?.approval_status).toBe("approved");
    expect(state.detailChecklist).toEqual([]);
    expect(settledFor(state, refreshedKey)).toBe(true);
  });
});
