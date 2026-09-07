/** Refresh local chat badges only after the server accepts a read receipt. */
export const CHAT_READ_REFRESH_EVENT = "gmed:chat-read-refresh";

export function notifyChatRead() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHAT_READ_REFRESH_EVENT));
  }
}
