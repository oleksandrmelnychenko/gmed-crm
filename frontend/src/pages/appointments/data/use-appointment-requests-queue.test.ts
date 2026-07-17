import { describe, expect, it } from "vitest";

import type { AppointmentRequestItem } from "../model/types";
import { settleAppointmentRequestQueueResults } from "./use-appointment-requests-queue";

const request = (
  id: string,
  status: AppointmentRequestItem["status"],
  requestedAt: string,
) =>
  ({
    id,
    status,
    requested_at: requestedAt,
  }) as AppointmentRequestItem;

describe("settleAppointmentRequestQueueResults", () => {
  it("keeps the previous failed scope and merges the successful scope", () => {
    const previousRequested = request(
      "requested-1",
      "requested",
      "2026-07-17T09:00:00Z",
    );
    const approved = request(
      "approved-1",
      "approved",
      "2026-07-17T10:00:00Z",
    );

    const state = settleAppointmentRequestQueueResults(
      { status: "rejected", reason: new Error("Unavailable") },
      { status: "fulfilled", value: [approved] },
      [previousRequested],
      "Queue unavailable",
    );

    expect(state.appointmentRequests.map((item) => item.id)).toEqual([
      "approved-1",
      "requested-1",
    ]);
    expect(state.appointmentRequestsError).toBe("Queue unavailable");
    expect(state.appointmentRequestsLoading).toBe(false);
  });
});
