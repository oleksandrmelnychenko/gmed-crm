import { describe, expect, it } from "vitest";

import {
  closedWithoutCompletionLabel,
  isActuallyCompleted,
  isClosedWithoutCompletion,
} from "./closure";
import { appointmentText } from "./labels";

describe("items closed without completion", () => {
  it("tells a cancellation-closed item apart from a completed one", () => {
    const closed = { is_completed: true, closed_reason: "appointment_cancelled" };
    const done = { is_completed: true, closed_reason: null };
    const open = { is_completed: false };
    expect(isClosedWithoutCompletion(closed)).toBe(true);
    expect(isActuallyCompleted(closed)).toBe(false);
    expect(isActuallyCompleted(done)).toBe(true);
    expect(closedWithoutCompletionLabel(done)).toBeNull();
    expect(closedWithoutCompletionLabel(open)).toBeNull();
    expect(closedWithoutCompletionLabel(closed)).toBe(
      `${appointmentText("appointments_closed_without_completion")} (${appointmentText(
        "appointments_closed_reason_appointment_cancelled",
      )})`,
    );
  });
});
