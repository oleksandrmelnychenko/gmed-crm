import { describe, expect, it } from "vitest";

import type { ConciergeTask } from "@/pages/concierge/model";

import { openAssignedTaskCount } from "./open-task-queue-link";

describe("openAssignedTaskCount", () => {
  it("counts only unfinished operational tasks", () => {
    const tasks = [
      { status: "open" },
      { status: "in_progress" },
      { status: "completed" },
      { status: "cancelled" },
    ] as ConciergeTask[];

    expect(openAssignedTaskCount(tasks)).toBe(2);
  });
});
