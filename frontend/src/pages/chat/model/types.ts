export interface Conversation {
  user_id: string;
  name: string;
  email: string;
  role: string;
  last_message: string;
  last_at: string;
  is_read: boolean;
  last_read_at?: string | null;
  is_mine: boolean;
  unread: number;
  is_e2e?: boolean;
}

export interface Message {
  id: string;
  from_user: string;
  to_user: string;
  message: string | null;
  is_e2e?: boolean;
  e2e_algorithm?: string | null;
  e2e_ciphertext?: string | null;
  e2e_nonce?: string | null;
  e2e_salt?: string | null;
  sender_key_fingerprint?: string | null;
  recipient_key_fingerprint?: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  attachment_filename: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_key: string | null;
  attachment_is_e2e?: boolean;
  attachment_e2e_algorithm?: string | null;
  attachment_e2e_nonce?: string | null;
  attachment_e2e_salt?: string | null;
}

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface ChatStreamEvent {
  type: "message_created" | "conversation_read";
  user_id: string;
  peer_id: string;
  message_id?: string | null;
}
