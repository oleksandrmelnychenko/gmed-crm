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
  patient: ["view", "use", "edit"],
  document: ["view", "use", "edit", "upload", "download"],
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
  return MEDICAL_DATA_ROLES.has(role.trim().toLowerCase());
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

export function effectiveProfileRule(
  rules: StaffAccessRule[],
  resourceType: StaffAccessResourceType,
  resourceId: string,
  capability: StaffAccessCapability,
) {
  return rules
    .filter((rule) => ruleMatchesRecord(rule, resourceType, resourceId, capability))
    .sort((left, right) => {
      const specificity = Number(right.scope_type === "record") - Number(left.scope_type === "record");
      if (specificity !== 0) return specificity;
      return Number(right.effect === "deny") - Number(left.effect === "deny");
    })[0];
}

export function effectiveProfileAllRule(
  rules: StaffAccessRule[],
  resourceType: StaffAccessResourceType,
  capability: StaffAccessCapability,
): StaffAccessRule | undefined {
  return rules
    .filter(
      (rule) =>
        rule.resource_type === resourceType &&
        rule.scope_type === "all" &&
        rule.capability === capability,
    )
    .sort((left, right) => Number(right.effect === "deny") - Number(left.effect === "deny"))[0];
}

export function setDirectAllRuleEnabled(
  rules: StaffDirectAccessRuleInput[],
  resourceType: StaffAccessResourceType,
  capability: StaffAccessCapability,
  enabled: boolean,
  inheritedEffect?: "allow" | "deny",
): StaffDirectAccessRuleInput[] {
  const withoutExactRule = rules.filter(
    (rule) =>
      !(
        rule.resource_type === resourceType &&
        rule.scope_type === "all" &&
        rule.capability === capability
      ),
  );
  const inheritedEnabled = inheritedEffect === "allow";
  if (enabled === inheritedEnabled) return withoutExactRule;

  return [
    ...withoutExactRule,
    {
      resource_type: resourceType,
      scope_type: "all" as const,
      resource_id: null,
      capability,
      effect: enabled ? "allow" as const : "deny" as const,
      reason: null,
      valid_until: null,
    },
  ];
}

export function setDirectRuleEnabled(
  rules: StaffDirectAccessRuleInput[],
  resourceType: StaffAccessResourceType,
  resourceId: string,
  capability: StaffAccessCapability,
  enabled: boolean,
  inheritedEffect?: "allow" | "deny",
) {
  const exactRule = rules.find(
    (rule) =>
      rule.resource_type === resourceType &&
      rule.scope_type === "record" &&
      rule.resource_id === resourceId &&
      rule.capability === capability,
  );

  const withoutExactRule = rules.filter((rule) => rule !== exactRule);
  const inheritedEnabled = inheritedEffect === "allow";
  if (enabled === inheritedEnabled) return withoutExactRule;

  return [
    ...withoutExactRule,
    {
      resource_type: resourceType,
      scope_type: "record" as const,
      resource_id: resourceId,
      capability,
      effect: enabled ? "allow" as const : "deny" as const,
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
