import { describe, expect, it } from "vitest";

import { taskRealtimeBatchAffects } from "@/pages/concierge/use-task-realtime";

import type { AppointmentRequestItem } from "../model/types";
import {
  APPOINTMENT_REQUEST_QUEUE_EVENTS,
  settleAppointmentRequestQueueResults,
} from "./use-appointment-requests-queue";

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

describe("APPOINTMENT_REQUEST_QUEUE_EVENTS", () => {
  it("re-reads the queue on every request change and after a reconnect", () => {
    expect(APPOINTMENT_REQUEST_QUEUE_EVENTS).toEqual(
      expect.arrayContaining([
        "appointment_request.created",
        "appointment_request.reviewed",
        "appointment_request.converted",
        "appointment_request.cancelled",
        "realtime.connected",
        "realtime.resync_required",
      ]),
    );
  });

  it("treats any request event as affecting the queue", () => {
    expect(
      taskRealtimeBatchAffects([
        { type: "appointment_request.created", entity_type: "appointment_request", entity_id: "request-2" },
      ]),
    ).toBe(true);
  });
});
