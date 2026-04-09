import { get, post, postNoBody, uploadFile } from "./client";
import type {
  Conversation,
  ChatMessage,
  SendMessageResponse,
  UploadResponse,
  ChatUserItem,
} from "./types";

export function fetchConversations(): Promise<Conversation[]> {
  return get<Conversation[]>("/messages/conversations");
}

export function fetchMessages(peerId: string, limit = 100): Promise<ChatMessage[]> {
  return get<ChatMessage[]>(`/messages/${peerId}?limit=${limit}`);
}

export function markRead(peerId: string): Promise<void> {
  return postNoBody(`/messages/${peerId}/read`);
}

export function sendMessage(peerId: string, message: string): Promise<SendMessageResponse> {
  return post<SendMessageResponse>(`/messages/${peerId}`, { message });
}

export function uploadAttachment(peerId: string, file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return uploadFile<UploadResponse>(`/messages/${peerId}/upload`, formData);
}

export function fetchChatUsers(): Promise<ChatUserItem[]> {
  return get<ChatUserItem[]>("/users");
}
