import { cabinetScopeSummary, normalizeScopeCodes, type ConsentRecipientScope } from "@/lib/consent-recipient-scope";
import { appDateKey } from "@/lib/app-time-zone";
import { isValidEmailAddress, isValidPhoneNumber } from "@/lib/contact-validation";
import { isValidPersonPhone, oneLine } from "@/lib/person-fields";
import { CONSENT_RECIPIENT_RELATIONS, DISCLOSURE_VERSION, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation, type LeadDisclosureInput, type LeadRequest } from "./lead-request-api";
import { mergeSavedDraft } from "./lead-request-autosave";

/**
 * One trusted person as the editor holds it. `phone` is the number the person calls GMED from and
 * `birthDate` ("YYYY-MM-DD") the date of birth, both required for a person named or edited since
 * 2026-10-26 (owner); an institution (family doctor, clinic) has no date of birth. `contact` is the
 * read-only phone or e-mail of a person named before; `scope` the read-only free text of a person
 * named before 2026-10-19; `scopeCodes` the choice. `stored` is the saved person the row shows:
 * while nothing of it is edited it is sent back exactly as stored, legacy contact included.
 */
export type RecipientDraft = {
  name: string; relation: ConsentRecipientRelation | ""; phone: string; birthDate: string;
  contact: string; scope: string; scopeCodes: ConsentRecipientScope[]; stored?: ConsentRecipient;
};
/**
 * `answered`: the person chose an answer on this page. Only then does a "no"
 * that equals the default (nothing stored, "no information to third parties")
 * count as a decision of its own and get saved (QA 2026-10-25, E-13: the step
 * never read "complete" after an explicit "no").
 */
export type DisclosureDraft = { allowDisclosure: boolean | null; consentGiven: boolean; persons: RecipientDraft[]; answered?: boolean };

/** An empty row of the editor. */
export function blankRecipient(): RecipientDraft {
  return { name: "", relation: "", phone: "", birthDate: "", contact: "", scope: "", scopeCodes: [] };
}

/** A family doctor's practice or a clinic: no date of birth (the server drops one). */
export function isInstitution(relation: string): boolean {
  return relation === "family_doctor" || relation === "clinic";
}

/** "YYYY-MM-DD" as DD.MM.YYYY (the format of the whole app); "" for anything else. */
export function formatBirthDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/** A date of birth the server takes: a real calendar day from 1900-01-01 up to `today`. */
export function birthDateValid(value: string, today = appDateKey()): boolean {
  const key = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return key >= "1900-01-01" && key <= today;
}

export function recipientDrafts(saved: readonly ConsentRecipient[] | undefined): RecipientDraft[] {
  return (saved ?? []).map((person) => ({
    name: person.name, relation: person.relation, phone: person.phone ?? "", birthDate: person.birth_date ?? "",
    contact: person.contact ?? "", scope: person.scope ?? "", scopeCodes: normalizeScopeCodes(person.scope_codes), stored: person,
  }));
}

/** The chosen scope in the cabinet language; a legacy free text as typed. */
export function personScope(person: Pick<ConsentRecipient, "scope" | "scope_codes">, lang: string): string {
  const codes = normalizeScopeCodes(person.scope_codes);
  return codes.length > 0 ? cabinetScopeSummary(codes, lang) : person.scope?.trim() ?? "";
}

const normalizedName = (name: string) => name.trim().replace(/\s+/g, " ");

/**
 * The legacy contact of a person named before 2026-10-26: a phone number (digits with + - ( ) / .
 * and spaces, at least 6 digits) or an e-mail address; empty is fine. Same rule as the server
 * (`consent_choices::recipient_contact_valid`): a stored contact that fails it is not sent back.
 */
export function contactValid(contact: string): boolean {
  const value = contact.trim();
  if (!value) return true;
  if ([...value].length > 120) return false;
  if (value.includes("@")) return isValidEmailAddress(value);
  return /^[0-9+\-()/. ]+$/.test(value) && isValidPhoneNumber(value);
}

/**
 * The saved person the row still shows unchanged — name, relation, phone, date of birth and scope as
 * stored, and a legacy contact the server still accepts — or `null`. Such a person is sent back
 * exactly as stored and needs no phone or date of birth (owner 2026-10-26: an old contact stays until
 * the person is edited).
 */
export function unchangedStored(person: RecipientDraft): ConsentRecipient | null {
  const stored = person.stored;
  if (!stored) return null;
  const same = normalizedName(person.name) === stored.name && person.relation === stored.relation &&
    oneLine(person.phone) === (stored.phone ?? "") && person.birthDate.trim() === (stored.birth_date ?? "") &&
    normalizeScopeCodes(person.scopeCodes).join() === normalizeScopeCodes(stored.scope_codes).join() &&
    normalizeScopeCodes(stored.scope_codes).length > 0 && contactValid(stored.contact ?? "");
  return same ? stored : null;
}

/** A row with anything typed in it; an empty row is no person. */
export function typedRecipient(person: RecipientDraft): boolean {
  return Boolean(person.name.trim() || person.relation || person.phone.trim() || person.birthDate.trim() || person.contact.trim() || person.scopeCodes.length > 0);
}
const typedPersons = (drafts: readonly RecipientDraft[]) => drafts.filter(typedRecipient);

/**
 * Empty rows are not people; incomplete rows must pass validation before saving. An unchanged saved
 * person goes back exactly as stored; a new or edited one with the phone and (unless an institution)
 * the date of birth, and without the legacy contact.
 */
export function recipientsToSend(drafts: readonly RecipientDraft[]): LeadDisclosureInput["persons"] {
  return typedPersons(drafts).map((person) => {
    const stored = unchangedStored(person);
    if (stored) {
      return {
        name: stored.name, relation: stored.relation, contact: stored.contact ?? null, phone: stored.phone ?? null,
        birth_date: stored.birth_date ?? null, scope_codes: normalizeScopeCodes(stored.scope_codes),
      };
    }
    return {
      name: normalizedName(person.name), relation: person.relation as ConsentRecipientRelation, contact: null,
      phone: oneLine(person.phone) || null, birth_date: isInstitution(person.relation) ? null : person.birthDate.trim() || null,
      scope_codes: normalizeScopeCodes(person.scopeCodes),
    };
  });
}

export type RecipientField = "name" | "relation" | "phone" | "birth_date" | "scope";

/**
 * What one person still lacks, field by field (for the inline messages): name, relation, the phone
 * the person calls from and the date of birth (not of an institution) — the last two not for a saved
 * person shown unchanged (owner 2026-10-26) — and at least one scope.
 */
export function recipientProblems(person: RecipientDraft, today = appDateKey()): RecipientField[] {
  const problems: RecipientField[] = [];
  const name = normalizedName(person.name);
  if (!name || [...name].length > 120) problems.push("name");
  if (!CONSENT_RECIPIENT_RELATIONS.includes(person.relation as ConsentRecipientRelation)) problems.push("relation");
  const legacy = unchangedStored(person) !== null;
  if (!legacy && !isValidPersonPhone(person.phone)) problems.push("phone");
  if (!legacy && !isInstitution(person.relation) && !birthDateValid(person.birthDate, today)) problems.push("birth_date");
  if (normalizeScopeCodes(person.scopeCodes).length === 0) problems.push("scope");
  return problems;
}

/**
 * The draft index of the person a server refusal names (`index` counts the persons sent, without
 * empty rows); `null` when it names none.
 */
export function draftIndexOfSent(drafts: readonly RecipientDraft[], sentIndex: unknown): number | null {
  if (typeof sentIndex !== "number") return null;
  let seen = -1;
  for (let index = 0; index < drafts.length; index += 1) {
    if (typedRecipient(drafts[index]) && ++seen === sentIndex) return index;
  }
  return null;
}

/** The editor field of a refusal's `field` (422 `consent_recipients_invalid`). */
export function recipientFieldOfServer(field: unknown): RecipientField | null {
  if (field === "phone" || field === "contact") return "phone";
  if (field === "birth_date") return "birth_date";
  if (field === "scope_codes") return "scope";
  if (field === "name" || field === "relation") return field;
  return null;
}

export function trustedPersonsProblem(drafts: readonly RecipientDraft[]): "invalid" | null {
  const people = typedPersons(drafts);
  return people.length > MAX_CONSENT_RECIPIENTS || people.some((person) => recipientProblems(person).length > 0) ? "invalid" : null;
}

export function samePersons(left: readonly ConsentRecipient[], right: readonly ConsentRecipient[]): boolean {
  return left.length === right.length && left.every((person, index) =>
    person.name === right[index].name && person.relation === right[index].relation && (person.contact || null) === (right[index].contact || null) &&
    (person.phone || null) === (right[index].phone || null) && (person.birth_date || null) === (right[index].birth_date || null) &&
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
  // An answer given on the page while nothing is stored is a decision to save, also the "no"
  // the default already shows.
  if (draft.answered && !request.disclosure && draft.allowDisclosure !== null) return true;
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

/**
 * After the request is sent the decision can only be withdrawn (owner 2026-10-26): "no" for
 * everybody, or fewer of the saved persons with the consent kept. `false` when `draft` would add or
 * change somebody.
 */
export function onlyWithdraws(draft: DisclosureDraft, request: Pick<LeadRequest, "trusted_persons" | "consent_form">): boolean {
  if (draft.allowDisclosure !== true) return true;
  const stored = storedTrustedPersons(request);
  return recipientsToSend(draft.persons).every((sent) => stored.some((person) => samePersons([{ ...person, scope_codes: normalizeScopeCodes(person.scope_codes) }], [sent])));
}
