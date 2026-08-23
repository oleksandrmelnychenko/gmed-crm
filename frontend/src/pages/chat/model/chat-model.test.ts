import { describe, expect, it } from "vitest";

import {
  chatMessageDateKey,
  isSameChatMessageGroup,
} from "./chat-model";

describe("chat message grouping", () => {
  it("groups consecutive messages from the same sender within five minutes", () => {
    expect(
      isSameChatMessageGroup(
        { from_user: "a", created_at: "2026-08-23T10:00:00Z" },
        { from_user: "a", created_at: "2026-08-23T10:04:59Z" },
      ),
    ).toBe(true);
  });

  it("starts a new group for another sender, another day, or a long pause", () => {
    const first = { from_user: "a", created_at: "2026-08-23T10:00:00Z" };

    expect(
      isSameChatMessageGroup(first, {
        from_user: "b",
        created_at: "2026-08-23T10:01:00Z",
      }),
    ).toBe(false);
    expect(
      isSameChatMessageGroup(first, {
        from_user: "a",
        created_at: "2026-08-23T10:05:01Z",
      }),
    ).toBe(false);
    expect(
      isSameChatMessageGroup(first, {
        from_user: "a",
        created_at: "2026-08-24T10:01:00Z",
      }),
    ).toBe(false);
  });

  it("creates a stable local date key", () => {
    expect(chatMessageDateKey("2026-08-23T10:00:00Z")).toMatch(/^2026-08-(22|23)$/);
  });
});
