/**
 * Additions of the trigger flow to `GET /leads/{id}/portal-intake`
 * (contract 2026-10-07): the identity document data are entered by staff from
 * the scan (who and when, "Ausweis unleserlich"), the follow-up answers of
 * blocks F / B / H / J, and the lead's own "Grund der Anfrage" (13.1). All
 * optional: an older server sends none of them.
 */

/** Who entered the identity document data (staff) and whether the scan is unreadable. */
export type LeadStaffIdDataMarks = {
  id_document_unreadable?: boolean;
  id_data_entered_by_name?: string | null;
  id_data_entered_at?: string | null;
};

/** The lead's follow-up answers of blocks F (stay), B (relationship), H (PEP), J (sanctions link). */
export type LeadGwgFollowUpAnswers = {
  residence_since?: string | null;
  other_residences?: string | null;
  /** ISO 3166-1 alpha-2. */
  former_citizenships?: string[];
  /** `work`, `study`, `family`, `other`. */
  stay_reason?: string | null;
  stay_reason_details?: string | null;
  relationship_since?: string | null;
  pep_office?: string | null;
  /** ISO 3166-1 alpha-2. */
  pep_country?: string | null;
  pep_period?: string | null;
  pep_relationship?: string | null;
  pep_wealth_origin?: string | null;
  sanctions_link_name?: string | null;
  /** `family`, `business`, `ownership`, `other`. */
  sanctions_link_kind?: string | null;
  sanctions_link_since_extent?: string | null;
};

/** The lead's own reason for the request (cabinet, 13.1); never staff's `concern`. */
export type LeadPortalRequestReason = { text: string; updated_at: string | null };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const codes = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim() !== "")
        .map((item) => item.trim().toUpperCase())
    : [];

/**
 * The staff marks of the identity document data. "Unreadable" is present only
 * when set: an unset flag must not count as an answer of the lead
 * (`hasGwgStatements` treats every boolean as one).
 */
export function normalizeStaffIdDataMarks(raw: Record<string, unknown>): LeadStaffIdDataMarks {
  return {
    ...(raw.id_document_unreadable === true ? { id_document_unreadable: true } : {}),
    id_data_entered_by_name: text(raw.id_data_entered_by_name),
    id_data_entered_at: text(raw.id_data_entered_at),
  };
}

/** The follow-up answers with every key present. */
export function normalizeFollowUpAnswers(raw: Record<string, unknown>): Required<LeadGwgFollowUpAnswers> {
  return {
    residence_since: text(raw.residence_since),
    other_residences: text(raw.other_residences),
    former_citizenships: codes(raw.former_citizenships),
    stay_reason: text(raw.stay_reason),
    stay_reason_details: text(raw.stay_reason_details),
    relationship_since: text(raw.relationship_since),
    pep_office: text(raw.pep_office),
    pep_country: text(raw.pep_country)?.toUpperCase() ?? null,
    pep_period: text(raw.pep_period),
    pep_relationship: text(raw.pep_relationship),
    pep_wealth_origin: text(raw.pep_wealth_origin),
    sanctions_link_name: text(raw.sanctions_link_name),
    sanctions_link_kind: text(raw.sanctions_link_kind),
    sanctions_link_since_extent: text(raw.sanctions_link_since_extent),
  };
}

/**
 * The lead's reason text from the portal state: `patient_request_reason` or `request_reason` as
 * `{text, updated_at}` (or a plain string with `request_reason_updated_at`);
 * `portal_concern` is read the same way. Null when the lead entered nothing
 * or the role may not read medical data.
 */
export function normalizeRequestReason(intake: Record<string, unknown>): LeadPortalRequestReason | null {
  for (const key of ["patient_request_reason", "request_reason", "portal_concern"]) {
    const value = intake[key];
    const nested = record(value);
    const body = nested ? text(nested.text) : text(value);
    if (body) {
      const updatedAt = nested
        ? text(nested.updated_at) ?? text(nested.at)
        : text(intake[`${key}_updated_at`]);
      return { text: body, updated_at: updatedAt };
    }
  }
  return null;
}
