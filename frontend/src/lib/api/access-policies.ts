import { get, post } from "./client";
import type { Policy, UpdatePolicyBody } from "./types";

export function fetchPolicies(entityType: string): Promise<Policy[]> {
  return get<Policy[]>(`/access-policies?entity_type=${entityType}`);
}

export function updatePolicy(body: UpdatePolicyBody): Promise<unknown> {
  return post("/access-policies/update", body);
}
