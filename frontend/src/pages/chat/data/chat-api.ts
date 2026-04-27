import {
  apiFetch,
  buildApiUrl,
  buildApiWebSocketUrl,
  clearApiCache,
  getAccessToken,
} from "@/lib/api";

import type { Conversation, Message, UserItem } from "../model/types";

type JsonPayload = Record<string, unknown>;

export function fetchConversations() {
  return apiFetch<Conversation[]>("/messages/conversations");
}

export function fetchPeerMessages(peerId: string) {
  return apiFetch<Message[]>(`/messages/${peerId}?limit=100`);
}

export function markPeerMessagesRead(peerId: string) {
  return apiFetch(`/messages/${peerId}/read`, { method: "POST" });
}

export function fetchAllowedPeers(searchTerm: string) {
  const query = searchTerm.trim()
    ? `/messages/allowed-peers?search=${encodeURIComponent(searchTerm.trim())}`
    : "/messages/allowed-peers";
  return apiFetch<UserItem[]>(query);
}

export function sendPeerMessage(peerId: string, payload: JsonPayload) {
  return apiFetch(`/messages/${peerId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadPeerAttachment(peerId: string, formData: FormData) {
  const token = getAccessToken();
  const response = await fetch(buildApiUrl(`/messages/${peerId}/upload`), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!response.ok) {
    throw new Error("upload");
  }
  clearApiCache();
}

export async function downloadMessageAttachmentBytes(fileKey: string) {
  const token = getAccessToken();
  const response = await fetch(buildApiUrl(`/messages/file/${fileKey}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error("download");
  }
  return response.arrayBuffer();
}

export function getMessageAttachmentUrl(fileKey: string) {
  return buildApiUrl(`/messages/file/${fileKey}`);
}

export function openMessagesSocket() {
  const token = getAccessToken();
  if (!token) return null;
  return new WebSocket(buildApiWebSocketUrl("/messages/ws", { token }));
}
