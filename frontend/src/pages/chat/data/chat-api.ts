import {
  apiFetch,
  apiFetchFile,
  clearApiCache,
  getAccessToken,
  openAuthenticatedApiWebSocket,
} from "@/lib/api";

import type { Conversation, Message, UserItem } from "../model/types";

type JsonPayload = Record<string, unknown>;

export type SentMessageReceipt = {
  ok: boolean;
  id: string;
  created_at: string;
  expires_at?: string | null;
  client_message_id?: string | null;
  duplicate?: boolean;
};

export function fetchConversations() {
  return apiFetch<Conversation[]>("/messages/conversations");
}

export function fetchPeerMessages(peerId: string) {
  return apiFetch<Message[]>(`/messages/${peerId}?limit=100`);
}

export function markPeerMessagesRead(peerId: string) {
  return apiFetch(`/messages/${peerId}/read`, { method: "POST" });
}

export async function markAllMessagesRead() {
  await apiFetch("/messages/read-all", { method: "POST" });
  clearApiCache("/messages/unread-total");
  clearApiCache("/messages/conversations");
}

export function fetchAllowedPeers(searchTerm: string) {
  const query = searchTerm.trim()
    ? `/messages/allowed-peers?search=${encodeURIComponent(searchTerm.trim())}`
    : "/messages/allowed-peers";
  return apiFetch<UserItem[]>(query);
}

export function sendPeerMessage(peerId: string, payload: JsonPayload) {
  return apiFetch<SentMessageReceipt>(`/messages/${peerId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadPeerAttachment(peerId: string, formData: FormData) {
  const receipt = await apiFetch<SentMessageReceipt>(`/messages/${peerId}/upload`, {
    method: "POST",
    body: formData,
  });
  clearApiCache();
  return receipt;
}

export async function deletePeerMessage(peerId: string, messageId: string) {
  await apiFetch(`/messages/${peerId}/${messageId}`, { method: "DELETE" });
  clearApiCache();
}

export async function downloadMessageAttachmentBytes(fileKey: string) {
  const { blob } = await apiFetchFile(`/messages/file/${fileKey}`);
  return blob.arrayBuffer();
}

export function openMessagesSocket() {
  const token = getAccessToken();
  if (!token) return null;
  return openAuthenticatedApiWebSocket("/messages/ws", token);
}
