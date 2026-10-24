import { cabinetScopeSummary, normalizeScopeCodes, type ConsentRecipientScope } from "@/lib/consent-recipient-scope";
import { isValidEmailAddress, isValidPhoneNumber } from "@/lib/contact-validation";
import { CONSENT_RECIPIENT_RELATIONS, DISCLOSURE_VERSION, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation, type LeadDisclosureInput, type LeadRequest } from "./lead-request-api";
import { mergeSavedDraft } from "./lead-request-autosave";

/** `scope` is the read-only free text of a person named before 2026-10-19; `scopeCodes` the choice. */
export type RecipientDraft = { name: string; relation: ConsentRecipientRelation | ""; contact: string; scope: string; scopeCodes: ConsentRecipientScope[] };
export type DisclosureDraft = { allowDisclosure: boolean | null; consentGiven: boolean; persons: RecipientDraft[] };

export function recipientDrafts(saved: readonly ConsentRecipient[] | undefined): RecipientDraft[] {
  return (saved ?? []).map((person) => ({ name: person.name, relation: person.relation, contact: person.contact ?? "", scope: person.scope ?? "", scopeCodes: normalizeScopeCodes(person.scope_codes) }));
}

/** The chosen scope in the cabinet language; a legacy free text as typed. */
export function personScope(person: Pick<ConsentRecipient, "scope" | "scope_codes">, lang: string): string {
  const codes = normalizeScopeCodes(person.scope_codes);
  return codes.length > 0 ? cabinetScopeSummary(codes, lang) : person.scope?.trim() ?? "";
}

const normalizedName = (name: string) => name.trim().replace(/\s+/g, " ");
const typedPersons = (drafts: readonly RecipientDraft[]) => drafts.filter((person) => person.name.trim() || person.relation || person.contact.trim() || person.scopeCodes.length > 0);

/** Empty rows are not people; incomplete rows must pass validation before saving. */
export function recipientsToSend(drafts: readonly RecipientDraft[]): LeadDisclosureInput["persons"] {
  return typedPersons(drafts).map((person) => ({
    name: normalizedName(person.name), relation: person.relation as ConsentRecipientRelation, contact: person.contact.trim() || null, scope_codes: normalizeScopeCodes(person.scopeCodes),
  }));
}

/**
 * The optional contact: a phone number (digits with + - ( ) / . and spaces,
 * at least 6 digits) or an e-mail address; empty is fine. Same rule as the
 * server (`consent_choices::recipient_contact_valid`).
 */
export function contactValid(contact: string): boolean {
  const value = contact.trim();
  if (!value) return true;
  if ([...value].length > 120) return false;
  if (value.includes("@")) return isValidEmailAddress(value);
  return /^[0-9+\-()/. ]+$/.test(value) && isValidPhoneNumber(value);
}

export type RecipientField = "name" | "relation" | "contact" | "scope";

/** What one person still lacks, field by field (for the inline messages). */
export function recipientProblems(person: RecipientDraft): RecipientField[] {
  const problems: RecipientField[] = [];
  const name = normalizedName(person.name);
  if (!name || [...name].length > 120) problems.push("name");
  if (!CONSENT_RECIPIENT_RELATIONS.includes(person.relation as ConsentRecipientRelation)) problems.push("relation");
  if (!contactValid(person.contact)) problems.push("contact");
  if (normalizeScopeCodes(person.scopeCodes).length === 0) problems.push("scope");
  return problems;
}

export function trustedPersonsProblem(drafts: readonly RecipientDraft[]): "invalid" | null {
  const people = typedPersons(drafts);
  return people.length > MAX_CONSENT_RECIPIENTS || people.some((person) => recipientProblems(person).length > 0) ? "invalid" : null;
}

export function samePersons(left: readonly ConsentRecipient[], right: readonly ConsentRecipient[]): boolean {
  return left.length === right.length && left.every((person, index) =>
    person.name === right[index].name && person.relation === right[index].relation && (person.contact || null) === (right[index].contact || null) &&
    (person.scope || null) === (right[index].scope || null) &&
    normalizeScopeCodes(person.scope_codes).join() === normalizeScopeCodes(right[index].scope_codes).join(),
  );
}

/** An explicitly empty stored list must never resurrect historical consent recipients. */
export function storedTrustedPersons(request: Pick<LeadRequest, "trusted_persons" | "consent_form">): ConsentRecipient[] {
  return request.trusted_persons ?? request.consent_form?.recipients ?? [];
}

export function trustedPersonsPath(leadId: string): string {
  // /request is also accepted in lead mode as the wizard's canonical deep link.
  return `/request?lead=${encodeURIComponent(leadId)}&step=disclosure`;
}

export function requestForLead(requests: readonly LeadRequest[], selected: string | null): LeadRequest | null {
  return requests.find((request) => request.lead_id === selected) ?? requests[0] ?? null;
}

/**
 * "Auskunft an Dritte" not answered counts as "no" (owner decision 2026-10-22): no information to
 * third parties, as the server prints it. Only an older choice that named recipients without a
 * disclosure decision still asks for the answer.
 */
export function disclosureDefaultsToNo(request: Pick<LeadRequest, "disclosure" | "consent_form">): boolean {
  return !request.disclosure && request.consent_form?.choices?.named_recipients !== true;
}

export function disclosureDraft(request: Pick<LeadRequest, "disclosure" | "disclosure_company_name" | "trusted_persons" | "consent_form">, viewerId?: string): DisclosureDraft {
  return {
    allowDisclosure: request.disclosure?.allow_disclosure ?? (disclosureDefaultsToNo(request) ? false : null),
    consentGiven: request.disclosure?.allow_disclosure === true && request.disclosure.consent_given === true && request.disclosure.version === DISCLOSURE_VERSION &&
      (!viewerId || request.disclosure.chosen_by === viewerId) && (!request.disclosure_company_name || request.disclosure_company_name === request.disclosure.company_name),
    persons: recipientDrafts(storedTrustedPersons(request)),
  };
}

export function disclosureProblem(draft: DisclosureDraft): "decision" | "required" | "invalid" | "consent" | null {
  if (draft.allowDisclosure === null) return "decision";
  if (!draft.allowDisclosure) return null;
  if (trustedPersonsProblem(draft.persons)) return "invalid";
  if (recipientsToSend(draft.persons).length === 0) return "required";
  return draft.consentGiven ? null : "consent";
}

export function disclosureChanged(draft: DisclosureDraft, request: Pick<LeadRequest, "disclosure" | "disclosure_company_name" | "trusted_persons" | "consent_form">, viewerId?: string): boolean {
  const saved = disclosureDraft(request, viewerId);
  return draft.allowDisclosure !== saved.allowDisclosure || draft.consentGiven !== saved.consentGiven ||
    (draft.allowDisclosure !== false && !samePersons(recipientsToSend(draft.persons), recipientsToSend(saved.persons)));
}

/**
 * The draft after a save answered: the server's state for every part left as
 * it was sent, the newer typing for a part changed while the save ran (it is
 * saved next). `baseline` is the state the save started from.
 */
export function mergeDisclosureDraft(current: DisclosureDraft, sent: DisclosureDraft, fresh: DisclosureDraft, baseline: DisclosureDraft): DisclosureDraft {
  return mergeSavedDraft(current, sent, fresh, baseline, Object.keys(fresh));
}

export function disclosureToSend(draft: DisclosureDraft, language: LeadDisclosureInput["language"]): LeadDisclosureInput {
  if (disclosureProblem(draft)) throw new Error("Incomplete disclosure decision");
  return {
    persons: draft.allowDisclosure ? recipientsToSend(draft.persons) : [],
    allow_disclosure: draft.allowDisclosure === true,
    consent_given: draft.allowDisclosure === true && draft.consentGiven,
    version: DISCLOSURE_VERSION,
    language,
  };
}
