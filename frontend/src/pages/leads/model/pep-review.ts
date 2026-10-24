/**
 * PEP and sanctions answers per person, and staff's PEP review per person
 * (owner decision 2026-10-23). Every person answers for themself: the
 * patient in the cabinet, each parent or representative in block R, the
 * payer in the own statement. Staff's "PEP status checked" is a review layer
 * on top, never an answer of the person, and is kept per subject in
 * `wizard_state.aml_enhanced_due_diligence`:
 *
 * - `patient`: the fields `pepStatusChecked`, `pepContractPartner`,
 *   `pepBeneficialOwner` of the form; the day and the reviewer in
 *   `pepReviews.patient`;
 * - `representative:<trusted contact id>` and `payer`: `pepReviews[subject]`.
 *
 * The server sets `checkedOn` / `checkedBy` when staff change a review
 * (`services::pep_review::stamp_reviews`); what the client sends there is
 * ignored. The lead's answer stays display-only (owner 2026-10-06).
 */

export const PEP_SUBJECT_PATIENT = "patient";
export const PEP_SUBJECT_PAYER = "payer";

export const representativePepSubject = (id: string) => `representative:${id}`;

export type PepReviewEntry = {
  checked: boolean;
  isPep: boolean;
  /** `YYYY-MM-DD`, set by the server. */
  checkedOn: string | null;
  checkedBy: string | null;
};

export type PepReviews = Record<string, PepReviewEntry>;

/** The answers of one person; null while unanswered. */
export type PepPersonAnswers = {
  pepSelf: boolean | null;
  pepRelated: boolean | null;
  sanctionsLinks: boolean | null;
};

export type PepPersonKind = "patient" | "representative" | "payer";

/** One person of the PEP panel: who answered what, and staff's review. */
export type PepPerson = {
  subject: string;
  kind: PepPersonKind;
  name: string;
  /** `legal_representative`, `authorised_representative`, `legal_guardian`; representatives only. */
  role: string | null;
  answers: PepPersonAnswers;
  review: PepReviewEntry;
};

/** The staff fields of the form the patient's review lives in. */
export type PatientPepReviewFields = {
  pepContractPartner: boolean;
  pepBeneficialOwner: boolean;
  pepStatusChecked: boolean;
  pepReviews: PepReviews;
};

const blankEntry = (): PepReviewEntry => ({ checked: false, isPep: false, checkedOn: null, checkedBy: null });

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const answer = (value: boolean | null | undefined) => (typeof value === "boolean" ? value : null);

/** The stored `pepReviews` of the wizard state; unknown entries are kept as they are. */
export function parsePepReviews(value: unknown): PepReviews {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const reviews: PepReviews = {};
  for (const [subject, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    reviews[subject] = {
      checked: entry.checked === true,
      isPep: entry.isPep === true,
      checkedOn: text(entry.checkedOn),
      checkedBy: text(entry.checkedBy),
    };
  }
  return reviews;
}

/** Staff's review of one subject, as the server reads it. */
export function pepReviewOf(fields: PatientPepReviewFields, subject: string): PepReviewEntry {
  const stored = fields.pepReviews[subject];
  if (subject === PEP_SUBJECT_PATIENT) {
    return {
      checked: fields.pepStatusChecked,
      isPep: fields.pepContractPartner || fields.pepBeneficialOwner,
      checkedOn: stored?.checkedOn ?? null,
      checkedBy: stored?.checkedBy ?? null,
    };
  }
  return stored ? { ...stored } : blankEntry();
}

/**
 * `pepReviews` with one subject's decision changed (never the patient's:
 * those are the form fields). The old day and reviewer no longer describe the
 * new decision: they are dropped until the server stamps the saved one.
 */
export function withPepReview(reviews: PepReviews, subject: string, patch: Partial<Pick<PepReviewEntry, "checked" | "isPep">>): PepReviews {
  const current = reviews[subject] ?? blankEntry();
  return { ...reviews, [subject]: { ...current, ...patch, checkedOn: null, checkedBy: null } };
}

/** `pepReviews` without the day and reviewer of one subject (its decision is being changed). */
export function withoutPepReviewStamp(reviews: PepReviews, subject: string): PepReviews {
  const current = reviews[subject];
  if (!current) return reviews;
  return { ...reviews, [subject]: { ...current, checkedOn: null, checkedBy: null } };
}

type RepresentativeInput = {
  id: string;
  slot: string | null;
  role: string;
  first_name: string | null;
  last_name: string | null;
  pep_self?: boolean | null;
  pep_related?: boolean | null;
  sanctions_links?: boolean | null;
};

export type PepPersonsInput = {
  fields: PatientPepReviewFields;
  patientName: string;
  /** The patient's own cabinet answers; null when not readable. */
  patientAnswers: { pep_self: boolean | null; pep_related: boolean | null; sanctions_links: boolean | null } | null;
  /** The persons the cabinet lists; only those who act for the lead (a slot) count. */
  representatives: readonly RepresentativeInput[];
  /**
   * A third party pays (a person or an organisation). False for a paying
   * parent, also one stored as a third-party row of before (the server's
   * `paying_parent`): the parent is already listed as a representative.
   */
  thirdPartyPayer: boolean;
  payerName: string;
  /** The payer's own answers from the sent statement; null while nothing was sent. */
  payerAnswers: { pep_self: boolean | null; pep_related: boolean | null; sanctions_links: boolean | null } | null;
};

/** The persons of the PEP panel in sheet order: patient, representatives, payer. */
export function pepPersons(input: PepPersonsInput): PepPerson[] {
  const persons: PepPerson[] = [{
    subject: PEP_SUBJECT_PATIENT,
    kind: "patient",
    name: input.patientName.trim(),
    role: null,
    answers: {
      pepSelf: answer(input.patientAnswers?.pep_self),
      pepRelated: answer(input.patientAnswers?.pep_related),
      sanctionsLinks: answer(input.patientAnswers?.sanctions_links),
    },
    review: pepReviewOf(input.fields, PEP_SUBJECT_PATIENT),
  }];
  for (const person of input.representatives) {
    if (person.slot === null) continue;
    const subject = representativePepSubject(person.id);
    persons.push({
      subject,
      kind: "representative",
      name: [person.first_name, person.last_name].map((part) => part?.trim() ?? "").filter(Boolean).join(" "),
      role: person.role,
      answers: {
        pepSelf: answer(person.pep_self),
        pepRelated: answer(person.pep_related),
        sanctionsLinks: answer(person.sanctions_links),
      },
      review: pepReviewOf(input.fields, subject),
    });
  }
  if (input.thirdPartyPayer) {
    persons.push({
      subject: PEP_SUBJECT_PAYER,
      kind: "payer",
      name: input.payerName.trim(),
      role: null,
      answers: {
        pepSelf: answer(input.payerAnswers?.pep_self),
        pepRelated: answer(input.payerAnswers?.pep_related),
        sanctionsLinks: answer(input.payerAnswers?.sanctions_links),
      },
      review: pepReviewOf(input.fields, PEP_SUBJECT_PAYER),
    });
  }
  return persons;
}

export type PepAnswerValue = "yes" | "no" | "open";

/** The person's PEP answer: "yes" when one question is answered yes, "no" when both are no. */
export function pepAnswerValue(answers: PepPersonAnswers): PepAnswerValue {
  if (answers.pepSelf === true || answers.pepRelated === true) return "yes";
  if (answers.pepSelf === false && answers.pepRelated === false) return "no";
  return "open";
}

export function sanctionsAnswerValue(answers: PepPersonAnswers): PepAnswerValue {
  if (answers.sanctionsLinks === true) return "yes";
  if (answers.sanctionsLinks === false) return "no";
  return "open";
}

/** Staff reviewed the person: the box is ticked or staff concluded "PEP". */
export const pepReviewed = (review: PepReviewEntry) => review.checked || review.isPep;

/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
export function pepReviewDate(value: string | null): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}
