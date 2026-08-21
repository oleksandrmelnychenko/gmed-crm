import { describe, expect, it } from "vitest";

import type { ConciergeAssignee } from "./model";
import { selectTaskAssigneeId } from "./task-event-dialog";

const assignees: ConciergeAssignee[] = [
  { id: "concierge-1", name: "Anna", email: "anna@example.com", role: "concierge", is_active: true },
  { id: "concierge-2", name: "Max", email: "max@example.com", role: "concierge", is_active: true },
];

describe("selectTaskAssigneeId", () => {
  it("does not submit the current CEO as the Concierge assignee", () => {
    expect(selectTaskAssigneeId(null, "ceo-1", assignees)).toBe("concierge-1");
  });

  it("keeps the current Concierge or an existing active assignee", () => {
    expect(selectTaskAssigneeId(null, "concierge-2", assignees)).toBe("concierge-2");
    expect(selectTaskAssigneeId("concierge-2", "ceo-1", assignees)).toBe("concierge-2");
  });

  it("does not keep an assignee that is absent from the active Concierge list", () => {
    expect(selectTaskAssigneeId("inactive-concierge", "ceo-1", assignees)).toBe("concierge-1");
  });
});
