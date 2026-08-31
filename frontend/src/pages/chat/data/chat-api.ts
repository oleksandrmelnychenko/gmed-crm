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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSentMessageReceipt(value: unknown): SentMessageReceipt {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.created_at !== "string" ||
    !value.created_at ||
    Number.isNaN(Date.parse(value.created_at)) ||
    (value.expires_at !== undefined &&
      value.expires_at !== null &&
      (typeof value.expires_at !== "string" || Number.isNaN(Date.parse(value.expires_at)))) ||
    (value.client_message_id !== undefined &&
      value.client_message_id !== null &&
      typeof value.client_message_id !== "string") ||
    (value.duplicate !== undefined && typeof value.duplicate !== "boolean")
  ) {
    throw new Error("Invalid message delivery receipt");
  }
  return value as SentMessageReceipt;
}

export function fetchConversations() {
  return apiFetch<Conversation[]>("/messages/conversations");
}

export function fetchPeerMessages(
  peerId: string,
  before?: Pick<Message, "created_at" | "id">,
) {
  const params = new URLSearchParams({ limit: "100" });
  if (before) {
    params.set("before_created_at", before.created_at);
    params.set("before_id", before.id);
  }
  return apiFetch<Message[]>(`/messages/${peerId}?${params.toString()}`);
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

export async function sendPeerMessage(peerId: string, payload: JsonPayload) {
  const receipt = await apiFetch<unknown>(`/messages/${peerId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseSentMessageReceipt(receipt);
}

export async function uploadPeerAttachment(peerId: string, formData: FormData) {
  const rawReceipt = await apiFetch<unknown>(`/messages/${peerId}/upload`, {
    method: "POST",
    body: formData,
  });
  const receipt = parseSentMessageReceipt(rawReceipt);
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
