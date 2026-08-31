export type StaffAccessResourceType = "provider" | "patient" | "document";

export type StaffAccessCapability =
  | "view"
  | "use"
  | "edit"
  | "upload"
  | "download";

export type StaffAccessEffect = "allow" | "deny";

export type StaffAccessRule = {
  resource_type: StaffAccessResourceType;
  scope_type: "all" | "record";
  resource_id: string | null;
  capability: StaffAccessCapability;
  effect: StaffAccessEffect;
};

export type StaffDirectAccessRule = StaffAccessRule & {
  reason: string | null;
  valid_from: string;
  valid_until: string | null;
};

export type StaffDirectAccessRuleInput = StaffAccessRule & {
  reason?: string | null;
  valid_from?: string;
  valid_until?: string | null;
};

export type StaffAccessProfile = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
  roles: string[];
  rules: StaffAccessRule[];
  assigned_user_count: number;
};

export type StaffAccessUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export type StaffUserAccessResponse = {
  user: StaffAccessUser;
  access_revision: number;
  ceo_full_access: boolean;
  profile: StaffAccessProfile | null;
  profile_valid_until: string | null;
  direct_rules: StaffDirectAccessRule[];
};

export type UpdateStaffUserAccessBody = {
  expected_access_revision: number;
  profile_id: string | null;
  profile_valid_until: string | null;
  direct_rules: StaffDirectAccessRuleInput[];
};

export type CreateStaffAccessProfileBody = {
  name: string;
  description?: string | null;
  is_active?: boolean;
  roles: string[];
  rules: StaffAccessRule[];
};

export type StaffAccessResource = {
  id: string;
  label: string;
  description: string;
  isMedical?: boolean;
};
