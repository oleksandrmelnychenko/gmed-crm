import type {
  StaffAccessCapability,
  StaffAccessResourceType,
  StaffAccessRule,
  StaffDirectAccessRuleInput,
  UpdateStaffUserAccessBody,
} from "./staff-access-types";

export const STAFF_ACCESS_CAPABILITIES: Record<
  StaffAccessResourceType,
  readonly StaffAccessCapability[]
> = {
  provider: ["view", "use", "edit"],
  patient: ["view", "use"],
  document: ["view", "download", "upload"],
};

const MEDICAL_DATA_ROLES = new Set([
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
]);

export function canManageStaffAccess(currentRole: string | null | undefined) {
  return currentRole === "ceo";
}

export function canRoleUseMedicalDocuments(role: string) {
  return MEDICAL_DATA_ROLES.has(role);
}

export function ruleMatchesRecord(
  rule: StaffAccessRule,
  resourceType: StaffAccessResourceType,
  resourceId: string,
  capability: StaffAccessCapability,
) {
  return (
    rule.resource_type === resourceType &&
    rule.capability === capability &&
    (rule.scope_type === "all" || rule.resource_id === resourceId)
  );
}

export function toggleDirectAllowRule(
  rules: StaffDirectAccessRuleInput[],
  resourceType: StaffAccessResourceType,
  resourceId: string,
  capability: StaffAccessCapability,
) {
  const exactRule = rules.find(
    (rule) =>
      rule.resource_type === resourceType &&
      rule.scope_type === "record" &&
      rule.resource_id === resourceId &&
      rule.capability === capability,
  );

  const withoutExactRule = rules.filter((rule) => rule !== exactRule);
  if (exactRule?.effect === "allow") return withoutExactRule;

  return [
    ...withoutExactRule,
    {
      resource_type: resourceType,
      scope_type: "record" as const,
      resource_id: resourceId,
      capability,
      effect: "allow" as const,
      reason: null,
      valid_until: null,
    },
  ];
}

function comparableRule(rule: StaffDirectAccessRuleInput) {
  return {
    resource_type: rule.resource_type,
    scope_type: rule.scope_type,
    resource_id: rule.resource_id,
    capability: rule.capability,
    effect: rule.effect,
    reason: rule.reason ?? null,
    valid_from: rule.valid_from ?? null,
    valid_until: rule.valid_until ?? null,
  };
}

function sortRules(rules: StaffDirectAccessRuleInput[]) {
  return rules
    .map(comparableRule)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function accessDraftSignature(body: Omit<UpdateStaffUserAccessBody, "expected_access_revision">) {
  return JSON.stringify({
    profile_id: body.profile_id,
    profile_valid_until: body.profile_valid_until,
    direct_rules: sortRules(body.direct_rules),
  });
}

export function profileRulesFromDirectRules(rules: StaffDirectAccessRuleInput[]) {
  return rules.map<StaffAccessRule>((rule) => ({
    resource_type: rule.resource_type,
    scope_type: rule.scope_type,
    resource_id: rule.resource_id,
    capability: rule.capability,
    effect: rule.effect,
  }));
}
