import { describe, expect, it } from "vitest";

import {
  canMarkLoadedMessagesRead,
  chatMessageDateKey,
  isSameChatMessageGroup,
  mergeChatMessages,
  reconcileChatMessages,
  timeAgo,
} from "./chat-model";
import type { Message } from "./types";

function message(id: string, minute: number, overrides: Partial<Message> = {}): Message {
  return {
    id, created_at: new Date(Date.UTC(2026, 8, 5, 12, minute)).toISOString(),
    from_user: "me", to_user: "peer", message: id, is_read: false, read_at: null,
    attachment_filename: null, attachment_key: null, attachment_mime: null, attachment_size: null,
    ...overrides,
  };
}

describe("chat synchronization", () => {
  it("does not let already-read undecryptable history block a new readable message", () => {
    expect(canMarkLoadedMessagesRead([
      message("old", 1, { to_user: "me", is_read: true, decryption_failed: true }),
      message("new", 2, { to_user: "me" }),
    ], "me")).toBe(true);
  });

  it("acknowledges displayed unavailable messages without trapping the unread badge", () => {
    expect(canMarkLoadedMessagesRead([
      message("new", 2, { to_user: "me", decryption_failed: true }),
      message("readable", 3, { to_user: "me" }),
    ], "me")).toBe(true);
    expect(canMarkLoadedMessagesRead([
      message("unavailable", 2, { to_user: "me", decryption_failed: true }),
    ], "me")).toBe(true);
  });

  it("does not acknowledge a page with no unread incoming messages", () => {
    expect(canMarkLoadedMessagesRead([message("outgoing", 2)], "me")).toBe(false);
    expect(canMarkLoadedMessagesRead([message("read", 2, { to_user: "me", is_read: true })], "me")).toBe(false);
    expect(canMarkLoadedMessagesRead([], "me")).toBe(false);
  });

  it("keeps failed sends when refreshing and replaces the optimistic row by client id", () => {
    const failed = message("local-retry", 5, { client_message_id: "retry", delivery_state: "failed" });
    const sending = message("local-send", 6, { client_message_id: "send", delivery_state: "sending" });
    const accepted = message("server-send", 6, { client_message_id: "send" });
    expect(reconcileChatMessages([failed, sending], [accepted]).map((item) => item.id))
      .toEqual(["server-send", "local-retry"]);
  });

  it("removes deleted rows from the latest page without dropping older loaded history", () => {
    const old = message("old", 1);
    const removed = message("deleted", 5);
    const latest = [message("latest", 6), message("boundary", 4)];
    expect(reconcileChatMessages([old, removed], latest, 2).map((item) => item.id))
      .toEqual(["latest", "boundary", "old"]);
    expect(reconcileChatMessages([old, removed], [], 2)).toEqual([]);
  });

  it("orders overlapping pages consistently, including equal timestamps", () => {
    const read = message("b", 2, { is_read: true });
    const merged = mergeChatMessages([message("b", 2), message("old", 0)], [message("a", 2), read]);
    expect(merged.map((item) => item.id)).toEqual(["b", "a", "old"]);
    expect(merged[0].is_read).toBe(true);
  });

  it("shows German time instead of slicing the UTC timestamp or using the browser zone", () => {
    const now = new Date("2026-09-27T21:45:00Z");
    // 21:30Z is 23:30 on 27 Sep in Berlin (already 28 Sep in Kyiv): same day, time only.
    expect(timeAgo("2026-09-27T21:30:00Z", "de", now)).toBe("23:30");
    // 22:30Z is already 28 Sep in Berlin (still 27 Sep in UTC): another day.
    expect(timeAgo("2026-09-27T22:30:00Z", "de", now)).toBe("28.09.2026 00:30");
    expect(timeAgo("2025-12-31T22:30:00Z", "de", now)).toBe("31.12.2025 23:30");
    expect(timeAgo("invalid")).toBe("—");
  });
});

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

  it("keys messages by the German calendar day", () => {
    expect(chatMessageDateKey("2026-08-23T10:00:00Z")).toBe("2026-08-23");
    expect(chatMessageDateKey("2026-09-27T21:30:00Z")).toBe("2026-09-27");
    expect(chatMessageDateKey("2026-09-27T22:30:00Z")).toBe("2026-09-28");
  });
});
