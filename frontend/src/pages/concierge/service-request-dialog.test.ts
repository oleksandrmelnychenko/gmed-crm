import { describe, expect, it } from "vitest";

import { requestStatusOptions } from "./service-request-dialog";

describe("requestStatusOptions", () => {
  it("keeps direct operational statuses editable", () => {
    const options = requestStatusOptions("ru");

    expect(options.find((option) => option.value === "planned")?.disabled).toBe(false);
    expect(options.find((option) => option.value === "in_service")?.disabled).toBe(false);
    expect(options.find((option) => option.value === "completed")?.disabled).toBe(false);
    expect(options.find((option) => option.value === "cancelled")?.disabled).toBe(false);
  });

  it("keeps booking lifecycle statuses inside the booking flow", () => {
    const options = requestStatusOptions("de");

    expect(options.find((option) => option.value === "booked")?.disabled).toBe(true);
    expect(options.find((option) => option.value === "confirmed")?.disabled).toBe(true);
  });

  it("prevents lifecycle jumps and allows a privileged reopen", () => {
    const planned = requestStatusOptions("ru", { status: "planned" });
    expect(planned.find((option) => option.value === "completed")?.disabled).toBe(true);
    expect(planned.find((option) => option.value === "in_service")?.disabled).toBe(false);

    const completed = requestStatusOptions("ru", { status: "completed" }, true);
    expect(completed.find((option) => option.value === "in_service")?.disabled).toBe(false);
  });
});
