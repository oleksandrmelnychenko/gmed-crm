import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { notifyChatRead } from "@/lib/chat-read-events";
import { markTopbarChatRead } from "@/components/topbar-data";
import { markAllMessagesRead, markPeerMessagesRead } from "./chat-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), clearApiCache: vi.fn() }));
vi.mock("@/lib/chat-read-events", () => ({ notifyChatRead: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("chat read badge refresh", () => {
  for (const [name, read, path] of [
    ["conversation", () => markPeerMessagesRead("peer"), "/messages/peer/read"],
    ["topbar", () => markTopbarChatRead("peer"), "/messages/peer/read"],
    ["all conversations", () => markAllMessagesRead(), "/messages/read-all"],
  ] as const) {
    it(`refreshes badges after the ${name} receipt succeeds`, async () => {
      vi.mocked(apiFetch).mockResolvedValue({ ok: true });
      await read();
      expect(apiFetch).toHaveBeenCalledWith(path, { method: "POST" });
      expect(notifyChatRead).toHaveBeenCalledTimes(1);
    });

    it(`preserves badges if the ${name} receipt fails`, async () => {
      vi.mocked(apiFetch).mockRejectedValue(new Error("offline"));
      await expect(read()).rejects.toThrow("offline");
      expect(notifyChatRead).not.toHaveBeenCalled();
    });
  }
});
