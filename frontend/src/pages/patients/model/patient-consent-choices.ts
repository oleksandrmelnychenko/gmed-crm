import { normalizeScopeCodes } from "@/lib/consent-recipient-scope";
import {
  CONSENT_FORM_CHANNELS,
  NO_CONSENT_FORM_CHOICES,
  type ConsentFormChoices,
  type ConsentRecipient,
  type StaffConsentRecord,
} from "@/pages/patient-lead/lead-request-api";
import { recipientDrafts, recipientsToSend, type RecipientDraft } from "@/pages/patient-lead/lead-trusted-persons-model";
import type { PatientConsentChange, PatientConsentState } from "../data/patient-consent-choices-api";

/** What the editor holds: the options and the trusted persons. */
export type PatientConsentDraft = {
  choices: ConsentFormChoices;
  persons: RecipientDraft[];
  consentGiven: boolean;
};

export function consentDraftOf(state: PatientConsentState): PatientConsentDraft {
  return {
    choices: { ...(state.requested?.choices ?? NO_CONSENT_FORM_CHOICES) },
    persons: recipientDrafts(state.requested?.recipients ?? []),
    consentGiven: false,
  };
}

/** Who a trusted person is, as the server compares them: the name (case, spaces) and the date of birth. */
export function personKey(person: Pick<ConsentRecipient, "name" | "birth_date">): string {
  return `${person.name.trim().replace(/\s+/g, " ").toLowerCase()}|${person.birth_date ?? ""}`;
}

const DETAILED = ["medical", "organisational", "financial"] as const;

function scopeSet(person: Pick<ConsentRecipient, "scope_codes">): Set<string> {
  const codes = normalizeScopeCodes(person.scope_codes);
  if (codes.length === 0 || codes.includes("all")) return new Set(DETAILED);
  return new Set(codes.filter((code) => (DETAILED as readonly string[]).includes(code)));
}

/**
 * Whether the change only withdraws (`consent_choices::patient::only_withdraws`): no channel is
 * ticked that was not, nobody is named who was not, no scope is wider. A withdrawal applies at once
 * and needs no new consent text.
 */
export function onlyWithdraws(choices: ConsentFormChoices, persons: readonly ConsentRecipient[], state: PatientConsentState): boolean {
  const before = state.requested;
  if (!before) return false;
  const keys = Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof ConsentFormChoices)[];
  if (keys.some((key) => key !== "named_recipients" && choices[key] && !before.choices[key])) return false;
  return persons.every((person) => {
    const earlier = before.recipients.find((candidate) => personKey(candidate) === personKey(person));
    if (!earlier) return false;
    const wider = scopeSet(earlier);
    return [...scopeSet(person)].every((code) => wider.has(code));
  });
}

/** The body of the save; `named_recipients` follows the persons. */
export function changeToSend(
  draft: PatientConsentDraft,
  state: PatientConsentState,
  language: string,
  recorded?: StaffConsentRecord | null,
): PatientConsentChange {
  const recipients = recipientsToSend(draft.persons) as ConsentRecipient[];
  return {
    choices: { ...draft.choices, named_recipients: recipients.length > 0 },
    recipients,
    consent_given: draft.consentGiven,
    version: state.version,
    language,
    ...(recorded ? { recorded_how: recorded.how, recorded_note: recorded.note.trim() || undefined } : {}),
  };
}

/** Whether the draft differs from the newest choice. */
export function draftChanged(draft: PatientConsentDraft, state: PatientConsentState): boolean {
  const before = state.requested;
  const sent = recipientsToSend(draft.persons) as ConsentRecipient[];
  const beforeChoices = before?.choices ?? NO_CONSENT_FORM_CHOICES;
  if (CONSENT_FORM_CHANNELS.some((key) => draft.choices[key] !== beforeChoices[key])) return true;
  if (!before) return true;
  const earlier = before.recipients;
  if (sent.length !== earlier.length) return true;
  return sent.some((person, index) => JSON.stringify(person) !== JSON.stringify(stripEmpty(earlier[index])));
}

function stripEmpty(person: ConsentRecipient): ConsentRecipient {
  return recipientsToSend(recipientDrafts([person]))[0] as ConsentRecipient;
}

/** The persons the screens list: what applies, then the additions waiting for the signature. */
export function listedPersons(state: PatientConsentState): { applies: ConsentRecipient[]; waiting: ConsentRecipient[] } {
  const requested = state.requested?.recipients ?? [];
  const waiting = requested.filter((_, index) => state.pending.recipients[index]);
  return { applies: state.effective.recipients, waiting };
}

/** The consent forms staff renew after a change. */
export function documentsToRenew(state: PatientConsentState): string[] {
  return state.documents.filter((document) => document.needs_new_version).map((document) => document.id);
}
