export type SopItem = {
  id: string;
  title: string;
  category: string;
  summary?: string | null;
  body_markdown: string;
  status: string;
  approval_required_role?: string | null;
  target_roles: string[];
  requires_ack: boolean;
  revision_no: number;
  created_by_name?: string | null;
  created_by_role: string;
  approved_by_name?: string | null;
  approved_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
  assigned_user_count: number;
  target_user_ids: string[];
  my_ack_status?: string | null;
  my_acknowledged_at?: string | null;
  pending_ack_count: number;
  acknowledged_count: number;
  can_edit: boolean;
  can_review: boolean;
  can_request_ack: boolean;
  can_acknowledge: boolean;
};

export type EligibleUser = {
  id: string;
  name: string;
  role: string;
};

export type EligibleUsersPayload = {
  allowed_target_roles: string[];
  eligible_users: EligibleUser[];
};

export type SopFormState = {
  title: string;
  category: string;
  summary: string;
  bodyMarkdown: string;
  requiresAck: boolean;
  targetRoles: string[];
  targetUserIds: string[];
};
