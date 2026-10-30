/** Who answers a request in the cabinet, as `LeadRequest.access_kind` says it. */
type AccessOf = { access_kind?: string | null; minor?: boolean | null };

/**
 * The form is answered from the representative's side: a parent's or
 * representative's own login, or staff filling in a minor's form for the
 * client (owner 2026-10-30). Staff then act for the child as the parents do —
 * the texts speak of the child, the parents' choices and uploads are offered —
 * but are none of the parents themselves (no person is `mine`), so "I" never
 * names a parent for staff. Staff on an adult's form answer as the patient.
 */
export function actsAsGuardian(request: AccessOf): boolean {
  return request.access_kind === "guardian" || staffForChild(request);
}

/** Staff fill in a minor's form for the client: for the child, as the parents, without being one of them. */
export function staffForChild(request: AccessOf): boolean {
  return request.access_kind === "staff" && request.minor === true;
}
