/**
 * The name staff see for a lead. Deleting a lead with anonymisation keeps the
 * row for the audit log and overwrites the name with the server's sentinel
 * "Deleted" / "Lead"; staff read «Удалённый лид» / «Gelöschter Lead» instead
 * of that English placeholder (QA 2026-10-11, N-17).
 */

type Tx = (ru: string, de: string) => string;

type NamedLead = {
  first_name?: string | null;
  last_name?: string | null;
  qualification_status?: string | null;
  failed_outcome?: { status?: string | null } | null;
};

/** The server's name sentinels of an anonymised lead (`ANONYMIZED_FIRST_NAME` / `_LAST_NAME`). */
const ANONYMIZED_FIRST_NAME = "Deleted";
const ANONYMIZED_LAST_NAME = "Lead";

/** Whether the lead was deleted with anonymisation (its personal data is gone). */
export function isAnonymizedLead(lead: NamedLead | null | undefined): boolean {
  if (!lead) return false;
  if (lead.failed_outcome?.status === "delete_anonymized") return true;
  return lead.qualification_status === "deleted"
    && lead.first_name === ANONYMIZED_FIRST_NAME
    && lead.last_name === ANONYMIZED_LAST_NAME;
}

export function deletedLeadLabel(tx: Tx): string {
  return tx("Удалённый лид", "Gelöschter Lead");
}

/** First and last name, or «Удалённый лид» for an anonymised lead. */
export function leadDisplayName(lead: NamedLead, tx: Tx): string {
  if (isAnonymizedLead(lead)) return deletedLeadLabel(tx);
  return [lead.first_name, lead.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The value the «Лиды» column sorts by (QA 2026-10-25, N-4): last name, then
 * first name, so a locale compare orders the list like a register.
 */
export function leadSortName(lead: NamedLead, tx: Tx): string {
  if (isAnonymizedLead(lead)) return deletedLeadLabel(tx);
  return [lead.last_name, lead.first_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}
