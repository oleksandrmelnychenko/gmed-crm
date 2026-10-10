import type { Lang } from "@/lib/i18n";

import type {
  Custody,
  FollowUpBlock,
  InvoiceTo,
  PaymentMethod,
  PaymentRouteBy,
  PayerType,
  RepresentativeSlot,
} from "./lead-request-api";
import {
  BILLING_SUBMIT_FIELDS,
  INVOICE_FIELDS,
  type BillingExtrasField,
  type BillingField,
  type VIA_THIRD_PARTY_KINDS,
} from "./lead-request-billing-model";
import { blockAKey, type StatedFundsSource } from "./lead-request-follow-up-model";
import {
  SUBMIT_FIELDS,
  organisationPayerType,
  type SANCTIONS_LINK_KINDS,
  type STAY_REASONS,
  type ContactChannel,
  type IdentificationField,
  type LegalQuestion,
  type OrganisationPayerType,
  type PayerField,
  type PersonalField,
  type RelationshipKind,
  type SubmitField,
} from "./lead-request-model";
import type { FundsSource, PAYER_LEGAL_DETAILS, PayerLegalQuestion } from "./lead-request-payer-questionnaire-model";
import type { StepId } from "./lead-request-steps";
import {
  authorityProofOf,
  representativeSubmitPart,
  type AuthorityProof,
  type RepresentativeField,
} from "./lead-request-representation-model";

/**
 * Texts of the lead cabinet in DE, EN, UA and RU (the rest of the patient
 * portal speaks DE and RU; owner request 2026-10-04 for UA and EN).
 */
export type LeadRequestText = {
  title: string;
  titleGuardian: string;
  /** The account label of a parent's login in the side bar, instead of "Patient". */
  accountLabelGuardian: string;
  intro: string;
  introGuardian: string;
  deadline: (date: string) => string;
  deadlineNote: string;
  /**
   * The cabinet as a stepper of short tabs (trigger flow 2026-10-07): the
   * name of each step, the badge of what it still misses, and the list of
   * those keys in the step.
   */
  steps: Record<StepId, string>;
  stepsLabel: string;
  stepMissingBadge: (count: number) => string;
  stepComplete: string;
  stepMissingTitle: string;
  fields: Record<PersonalField, string>;
  legalSexOptions: Record<"female" | "male" | "diverse" | "no_entry", string>;
  choose: string;
  citizenshipsPlaceholder: string;
  required: string;
  saving: string;
  saved: string;
  notSaved: string;
  invalidField: string;
  minorNeedsGuardian: string;
  next: string;
  back: string;
  inquiryConsentLabel: string;
  privacyLink: string;
  consentGivenAt: (dateTime: string) => string;
  consentWithdraw: string;
  consentWithdrawConfirm: string;
  documentsIntro: string;
  healthConsentTitle: string;
  healthConsentLabel: string;
  uploadButton: string;
  uploading: string;
  uploadNeedsConsent: string;
  fileTooLarge: (name: string) => string;
  noDocuments: string;
  documentsOptional: string;
  removeDocument: string;
  documentTakenOver: string;
  maxDocuments: (count: number) => string;
  sendTitle: string;
  missingTitle: string;
  inquiryConsentMissing: string;
  sendButton: string;
  sending: string;
  sentTitle: string;
  sentBody: (dateTime: string) => string;
  /** After sending: what the person can expect, in order. */
  nextTitle: string;
  nextSteps: readonly string[];
  sentSummaryTitle: string;
  sendAgain: string;
  editData: string;
  addDocuments: string;
  loadFailed: string;
  retry: string;
  noRequest: string;
  requestFor: string;
  language: string;
  sectionPerson: string;
  sectionAddress: string;
  sectionContact: string;
  sectionConsent: string;
  sectionUpload: string;
  stepOf: (index: number, total: number) => string;
  sectionInsurance: string;
  notStated: string;
  insuranceAnswerOptions: { yes: string; no: string };
  insuranceTypeOptions: { private: string; public: string; foreign: string };
  insuranceCoverageOptions: { yes: string; no: string; not_sure: string };
  /** After sending, when the request was changed: why to send again. */
  changedAfterSend: string;
  /** "Who pays" (owner request 2026-10-05). */
  sectionPayer: string;
  payerQuestion: string;
  payerOptions: { self: string; third_party: string };
  /**
   * The same answers when a parent fills in the request of a child; `guardian`
   * ("I pay") is offered when the parent's own data are on file.
   */
  payerOptionsGuardian: { self: string; guardian: string; third_party: string };
  payerIntro: string;
  /** For a natural person as payer: that person has to be told. */
  payerInformHint: string;
  /** Prefix of a payer field in the list of what is still missing. */
  payerPerson: string;
  /** What the third party is, and the name of one that is not a natural person. */
  payerTypeQuestion: string;
  payerTypeOptions: Record<PayerType, string>;
  payerOrganisationName: Record<OrganisationPayerType, string>;
  payerRelationship: string;
  payerRelationshipOptions: Record<RelationshipKind, string>;
  /** The relationship in words, asked with "other". */
  payerRelationshipOther: string;
  /** Address labels of a company, organisation or insurer: its seat. */
  payerSeatStreet: string;
  payerSeatCountry: string;
  payerEmail: string;
  /** The consent that GMED contacts the payer and tells them the patient's name. */
  payerConsentLabel: string;
  /** The same when a parent fills in the request of a child: the name is the child's. */
  payerConsentLabelGuardian: string;
  payerConsentHint: string;
  /** The consent in the summary and in the list of what is still missing. */
  payerConsentShort: string;
  /**
   * The consent that GMED sends the payer the cost estimate (contract phase
   * 3b, 11.7): saved at once and on its own, also once the payer answered.
   */
  payerCostEstimateConsentLabel: string;
  payerCostEstimateConsentHint: string;
  /** The same consent in the summary and in the list of what is still missing. */
  payerCostEstimateConsentShort: string;
  /** The payer answered on the own link: "who pays" is read-only, only GMED changes it. */
  payerAnsweredByPayer: string;
  /** Own economic interest (GwG), part of "who pays". */
  ownAccountQuestion: string;
  beneficialOwner: string;
  /** The same two when a parent fills in the request of a child. */
  ownAccountQuestionGuardian: string;
  beneficialOwnerGuardian: string;
  /** The payer's messenger number, the box that copies the phone, and the heading of the residence. */
  payerMessenger: string;
  payerMessengerSameAsPhone: string;
  payerResidence: string;
  /** The cards of the payer step (owner 2026-10-09). */
  payerBlockPerson: string;
  payerBlockContact: string;
  payerBlockConsent: string;
  /**
   * "Ergänzende Angaben" (trigger flow, contract 3.1 and 6): the neutral
   * heading, the intro, the title of each block, and sending the answers.
   * Never why the blocks are asked (no points, level or reason).
   */
  followUpTitle: string;
  followUpIntro: string;
  followUpBlocks: Record<FollowUpBlock, string>;
  followUpSubmit: string;
  followUpSending: string;
  followUpIncomplete: string;
  followUpAnsweredAt: (dateTime: string) => string;
  /** In step "send" while blocks are open: a pointer to the step. */
  followUpOpen: string;
  followUpGo: string;
  /** The neutral notice after sending, for every request alike (contract 3.1). */
  reviewNotice: string;
  /** Block A: the source of funds (one source chosen from a list, then the words). */
  extraFields: Record<
    | "payer_funds_source"
    | "payer_funds_description"
    | "funds_source"
    | "funds_description"
    | "occupation"
    | "sector"
    | "funds_proof",
    string
  >;
  extraPayerStatesFunds: string;
  /** The paying parent states the profession in the own payer section. */
  extraOccupationElsewhere: string;
  selfFundsProofHint: string;
  /** Block B: the proof of the relationship to the payer. */
  relationshipProofTitle: string;
  relationshipProofHint: string;
  noRelationshipProof: string;
  /** Block F: why the patient lives in the country; block J: the kind of link. */
  stayReasonOptions: Record<(typeof STAY_REASONS)[number], string>;
  sanctionsLinkKindOptions: Record<(typeof SANCTIONS_LINK_KINDS)[number], string>;
  /** Block C: through whom the payment goes and the expected total. */
  billingExtrasFields: Record<BillingExtrasField, string>;
  viaThirdPartyKindOptions: Record<(typeof VIA_THIRD_PARTY_KINDS)[number], string>;
  expectedTotalHint: string;
  /** Block I: a new copy of the identity document. */
  identityRenewIntro: string;
  /** Step "Ausweis": the copy only, GMED enters the data from it. */
  identityIntro: string;
  /** Step "Anliegen & Unterlagen" (13.1): the reason of the request. */
  sectionRequest: string;
  requestReasonHint: string;
  /** The organisation mask of "who pays". */
  payerLegalForm: string;
  payerRegisterNumber: string;
  payerContactName: string;
  payerEmailOrPhone: string;
  payerEmailOrPhoneHint: string;
  /** The statements for the GwG identification (owner spec 2026-10-05) and the follow-up blocks. */
  identificationFields: Record<IdentificationField, string>;
  /** Questions that say "you", for a parent who fills in the request of a child. */
  identificationFieldsGuardian: Partial<Record<IdentificationField, string>>;
  /** Short names of the legal questions for the list of what is still missing. */
  legalTopics: Record<LegalQuestion, string>;
  yesNo: { yes: string; no: string };
  salutationOptions: { mr: string; ms: string; none: string };
  contactChannelOptions: Record<ContactChannel, string>;
  idDocumentTypeOptions: { passport: string; id_card: string; residence_permit: string };
  sectionIdentity: string;
  identityUploadButton: string;
  identityUploadHint: string;
  identityUploadNeedsConsent: string;
  identityNote: string;
  noIdentityDocuments: string;
  /** The uploaded copies in the summary and, when none is there, in the missing list. */
  identityFiles: string;
  idDocumentExpired: string;
  /** Who acts for the lead (owner spec section 3): an adult's representative and legal guardian. */
  sectionRepresentation: string;
  hasRepresentativeQuestion: string;
  underGuardianshipQuestion: string;
  /** The same block for a minor: the legal representatives. */
  sectionLegalRepresentatives: string;
  legalRepresentativesIntro: string;
  /** Who gives the consent and the signatures, by the custody chosen. */
  custodySignatureNote: Record<Custody, string>;
  custodyQuestion: string;
  custodyOptions: Record<Custody, string>;
  /** A person of the block: the heading of the form, and the prefix in the list of what is still missing. */
  representativeCaptions: Record<RepresentativeSlot, string>;
  /** Added to the caption: the person who fills in the form, and the other parent. */
  representativeYou: string;
  representativeOtherParent: string;
  /** The first person of a minor whom a guardian (Vormund / Pfleger) represents. */
  representativeGuardianOfChild: string;
  /** A person with custody on file at GMED whom the form does not ask for. */
  representativeOnFile: (name: string) => string;
  /** The same while a guardian represents the child: not "the other parent". */
  representativeOnFileGuardian: (name: string) => string;
  copyChildAddress: string;
  /**
   * Below an e-mail that is a sign-in address (the own one, or the other
   * parent's), and below the one the invitation goes to.
   */
  representativeEmailIsLogin: string;
  representativeEmailIsTheirLogin: string;
  representativeInviteHint: string;
  representativeInformHint: string;
  representativeRemove: string;
  /** `who` is the person's name, or the caption while there is none. */
  representativeRemoveConfirm: (who: string) => string;
  /** The uploads of a person: the copy of a guardian's identity document, and the proofs of authority. */
  representativeGuardianIdentity: string;
  representativeAuthority: Record<AuthorityProof, string>;
  noAuthorityDocuments: string;
  representativeUploadNeedsPerson: string;
  /** What the server refuses about a person. */
  representativeInUse: string;
  representativeLimit: string;
  representativeEmailLocked: string;
  representativeEmailDuplicate: string;
  /** A representative must be of full age (the server refuses a younger one). */
  representativeMinor: string;
  /** Invoice recipient and payment route (owner spec sections 7 and 8, contract phase 2). */
  sectionBilling: string;
  sectionPaymentRoute: string;
  /** The two sections as one group of the summary. */
  sectionBillingSummary: string;
  billingFields: Record<BillingField, string>;
  /** Where the invoice goes; a parent reads the first answer about the patient. */
  invoiceToOptions: Record<InvoiceTo, string>;
  invoiceToOptionsGuardian: Record<InvoiceTo, string>;
  /** The answer "to the payer" when the parent who fills in the form is the one who pays. */
  invoiceToMeAsPayer: string;
  invoiceEmailHint: string;
  vatHint: string;
  paymentMethodOptions: Record<PaymentMethod, string>;
  /** Cash and cryptocurrency are checked separately (money laundering act). */
  cashCryptoNote: string;
  totalAmountHint: string;
  /** Section 8 when the payer answers it: nothing is asked here. */
  paymentRouteByPayer: string;
  /** The same in the summary, as the value of the row "payment route". */
  paymentRouteByPayerShort: string;
  sectionLegal: string;
  legalIntro: string;
  /** Prefix of a legal question in the list of what is still missing. */
  legalShort: string;
  /** Step "send": what will be sent, and the confirmation. */
  summaryIntro: string;
  summaryEmpty: string;
  declarationTitle: string;
  declarationLabel: string;
  declarationRequired: string;
  declarationGivenAt: (dateTime: string) => string;
  /**
   * The paying parent's own questionnaire (contract phase 3a, 5.2): the
   * questions only a payer is asked, after the payment route. `section` is the
   * title of the block with the parent's name, address and identity document.
   */
  payerQuestionnaireTitle: string;
  payerQuestionnaireIntro: (section: string) => string;
  /** The payer notice (Art. 13/14 DSGVO), the same content as the payer's invitation e-mail. */
  payerNoticeTitle: string;
  payerNotice: string;
  payerNoticeAck: string;
  payerNoticeAckAt: (dateTime: string) => string;
  payerNoticeFirst: string;
  payerContactChannels: string;
  payerQuestionnaireFields: Record<"language" | "occupation" | "funds_sources" | "funds_description", string>;
  /** The paying parent's own legal questions with their details (phase 3a, unchanged by the trigger flow). */
  payerLegalFields: Record<PayerLegalQuestion | (typeof PAYER_LEGAL_DETAILS)[PayerLegalQuestion], string>;
  /** The high-risk question of the paying parent in short, for the list of what is still missing. */
  payerHighRiskTopic: string;
  fundsSourceOptions: Record<FundsSource, string>;
  /** Block A's single choice of the source of funds. */
  statedFundsSourceOptions: Record<StatedFundsSource, string>;
  payerFundsProofTitle: string;
  payerFundsProofRequired: string;
  payerFundsProofOptional: string;
  payerFundsProofRequiredNote: string;
  payerFundsProofHint: string;
  payerFundsProofUpload: string;
  noPayerFundsProof: string;
  /** Where a missing key is answered instead: "Please add in the section „…“:". */
  payerElsewhere: (section: string) => string;
  payerOwnMissingTitle: string;
  payerNoticeMissing: string;
  payerDeclarationLabel: string;
  payerDeclarationRequired: string;
  payerSubmitButton: string;
  payerSubmittedAt: (dateTime: string) => string;
  payerSubmittedNote: string;
  payerQuestionnaireLoadFailed: string;
  payerQuestionnaireLocked: string;
  /**
   * The paying parent's signature package (contract phase 3b, 6.3): sent to
   * Skribble, or signed and back at GMED. `date` is "DD.MM.YYYY", or "" when
   * the server does not say when.
   */
  payerSignatureSent: (date: string) => string;
  payerSignatureSigned: (date: string) => string;
};

/**
 * A key of the paying parent's questionnaire in the lists of what is still
 * missing (contract 3.5): the parent's own questions, the notice and the
 * proof of funds, and the keys answered elsewhere with the labels of there.
 */
export function payerQuestionnaireFieldLabel(text: LeadRequestText, field: string): string {
  switch (field) {
    case "privacy_ack":
      return text.payerNoticeMissing;
    case "funds_proof_upload":
      return text.payerFundsProofTitle;
    case "language":
    case "occupation":
    case "funds_sources":
    case "funds_description":
      return text.payerQuestionnaireFields[field];
    case "salutation":
    case "former_names":
    case "habitual_residence_country":
      return text.identificationFields[field];
    case "street":
      return text.fields.street_address;
    case "zip":
      return text.fields.zip_code;
    case "relationship_kind":
      return text.payerRelationship;
    case "relationship":
      return `${text.payerRelationship} – ${text.payerRelationshipOther}`;
    // The paying parent's own legal questions keep their details (phase 3a).
    case "high_risk_country":
      return `${text.legalShort}: ${text.payerHighRiskTopic}`;
    case "pep_self_details":
    case "pep_related_details":
    case "high_risk_country_code":
    case "sanctions_links_details":
      return `${text.legalShort}: ${text.payerLegalFields[field]}`;
    default:
      return (SUBMIT_FIELDS as readonly string[]).includes(field) ? submitFieldLabel(text, field as SubmitField) : field;
  }
}

/**
 * Label of a payer field; identity and address reuse the patient's labels.
 * `payerType` is what the third party is: a company, organisation or insurer
 * has a name of its kind and a seat instead of a residence.
 */
export function payerFieldLabel(
  text: LeadRequestText,
  field: PayerField,
  guardian = false,
  payerType: string | null | undefined = null,
): string {
  const organisation = organisationPayerType(payerType);
  switch (field) {
    case "payer_kind":
      return text.payerQuestion;
    case "payer_type":
      return text.payerTypeQuestion;
    case "payer_organisation_name":
      return text.payerOrganisationName[organisation ?? "organisation"];
    case "payer_legal_form":
      return text.payerLegalForm;
    case "payer_register_number":
      return text.payerRegisterNumber;
    case "payer_contact_name":
      return text.payerContactName;
    case "payer_email_or_phone":
      return text.payerEmailOrPhone;
    case "payer_first_name":
      return text.fields.first_name;
    case "payer_last_name":
      return text.fields.last_name;
    case "payer_date_of_birth":
      return text.fields.date_of_birth;
    case "payer_citizenships":
      return text.fields.citizenships;
    case "payer_relationship_kind":
    case "payer_relationship":
      return text.payerRelationship;
    case "payer_street":
      return organisation ? text.payerSeatStreet : text.fields.street_address;
    case "payer_zip":
      return text.fields.zip_code;
    case "payer_city":
      return text.fields.city;
    case "payer_country":
      return organisation ? text.payerSeatCountry : text.fields.country;
    case "payer_phone":
      return text.fields.phone;
    case "payer_email":
      return text.payerEmail;
    case "payer_messenger":
      return text.payerMessenger;
    // The name passed on is the patient's: a parent reads it so.
    case "payer_contact_consent":
      return guardian ? text.payerConsentLabelGuardian : text.payerConsentLabel;
    case "payer_cost_estimate_consent":
      return text.payerCostEstimateConsentLabel;
    // The own economic interest is asked about the patient: a parent reads it so.
    case "payer_own_account":
      return guardian ? text.ownAccountQuestionGuardian : text.ownAccountQuestion;
    case "payer_beneficial_owner":
      return guardian ? text.beneficialOwnerGuardian : text.beneficialOwner;
  }
}

/**
 * Label of a statement for the identification. A parent who fills in the
 * request of a child reads the questions about the patient, not about "you".
 */
export function identificationFieldLabel(text: LeadRequestText, field: IdentificationField, guardian = false): string {
  const forGuardian: Partial<Record<IdentificationField, string>> = text.identificationFieldsGuardian;
  return (guardian ? forGuardian[field] : undefined) ?? text.identificationFields[field];
}

/** Label of a field of a representative: the labels of the patient's own fields. */
export function representativeFieldLabel(text: LeadRequestText, field: RepresentativeField): string {
  switch (field) {
    case "first_name":
    case "last_name":
    case "date_of_birth":
    case "citizenships":
    case "city":
    case "country":
    case "phone":
      return text.fields[field];
    case "street":
      return text.fields.street_address;
    case "zip":
      return text.fields.zip_code;
    case "email":
      return text.payerEmail;
    default:
      return text.identificationFields[field];
  }
}

/**
 * Heading of a person's form. The parent who fills in the form reads "you";
 * the second representative of a minor is the other parent. While a guardian
 * (Vormund / Pfleger) represents the child, the first person is named so.
 */
export function representativeHeading(
  text: LeadRequestText,
  slot: RepresentativeSlot,
  mine = false,
  custody: Custody | null | undefined = null,
): string {
  const caption =
    slot === "rep1" && custody === "guardian" ? text.representativeGuardianOfChild : text.representativeCaptions[slot];
  if (mine) return `${caption} – ${text.representativeYou}`;
  return slot === "rep2" ? `${caption} – ${text.representativeOtherParent}` : caption;
}

/** The note on a person with custody on file whom the form does not ask for, by the custody chosen. */
export function representativeOnFileNote(text: LeadRequestText, name: string, custody: Custody | null | undefined): string {
  return custody === "guardian" ? text.representativeOnFileGuardian(name) : text.representativeOnFile(name);
}

/**
 * Label of an upload of a person: the copy of the identity document, or the
 * proof of authority that the person's place in the form (and, for a minor,
 * the custody) asks for.
 */
export function representativeUploadLabel(
  text: LeadRequestText,
  slot: RepresentativeSlot,
  kind: "identity" | "authority",
  custody: Custody | null | undefined = null,
): string {
  if (kind === "identity") return slot === "guardian" ? text.representativeGuardianIdentity : text.identityFiles;
  // Without a custody the first representative is named the proof the request needs: a guardian's.
  return text.representativeAuthority[authorityProofOf(slot, custody ?? "guardian")?.proof ?? "power_of_attorney"];
}

/**
 * An answer to "where does the invoice go" as the form offers it. A parent
 * reads "to me" as "to the patient"; a parent who pays reads "to the payer"
 * as "to me (I pay)".
 */
export function invoiceToLabel(
  text: LeadRequestText,
  target: InvoiceTo,
  guardian = false,
  routeBy: PaymentRouteBy = "patient",
): string {
  if (target === "payer" && routeBy === "guardian") return text.invoiceToMeAsPayer;
  return (guardian ? text.invoiceToOptionsGuardian : text.invoiceToOptions)[target];
}

/** The three questions of the two billing sections: they stand alone in the list of what is still missing. */
const BILLING_QUESTIONS: readonly BillingField[] = ["invoice_to", "payment_method", "via_third_party"];

/**
 * A billing field in the list of what is still missing: the questions stand
 * alone, the other fields carry their section (an "Ort" alone would be the
 * address's). The details of "other" name that answer.
 */
function billingSubmitLabel(text: LeadRequestText, field: BillingField): string {
  const label = text.billingFields[field];
  if (BILLING_QUESTIONS.includes(field)) return label;
  if (field === "payment_method_details") return `${text.sectionPaymentRoute}: ${text.paymentMethodOptions.other} – ${label}`;
  return `${INVOICE_FIELDS.includes(field) ? text.sectionBilling : text.sectionPaymentRoute}: ${label}`;
}

const LEGAL_TOPIC_OF: Partial<Record<SubmitField, LegalQuestion>> = {
  pep_self: "pep_self",
  pep_related: "pep_related",
  sanctions_links: "sanctions_links",
};

/**
 * A key of a follow-up block in its list of what is still missing: block A's
 * questions, block B's proof, block C's extras and the payment route, block
 * G's persons, block I's copy, the statements of F, B, H and J. The block's
 * own title is the heading of the list, so no prefix is added. An unknown key
 * is shown as it is.
 */
export function followUpFieldLabel(text: LeadRequestText, key: string, guardian = false): string {
  const blockA = blockAKey(key);
  if (blockA === "funds_proof_upload") return text.extraFields.funds_proof;
  if (blockA in text.extraFields) return text.extraFields[blockA as keyof LeadRequestText["extraFields"]];
  if (key === "relationship_proof_upload") return text.relationshipProofTitle;
  if (key === "via_third_party_kind" || key === "expected_total_eur") return text.billingExtrasFields[key];
  if (key === "id_document_upload") return text.identityFiles;
  if ((BILLING_SUBMIT_FIELDS as readonly string[]).includes(key)) return text.billingFields[key as BillingField];
  if (key in text.identificationFields) return identificationFieldLabel(text, key as IdentificationField, guardian);
  if ((SUBMIT_FIELDS as readonly string[]).includes(key)) return submitFieldLabel(text, key as SubmitField, guardian);
  return key;
}

/**
 * A field in the list of what is still missing before sending. Fields of a
 * section whose labels do not speak for themselves carry the section's name.
 * `payerType` is what the stated third-party payer is (see `payerFieldLabel`).
 */
export function submitFieldLabel(
  text: LeadRequestText,
  field: SubmitField,
  guardian = false,
  payerType: string | null | undefined = null,
): string {
  if (field in text.fields) return text.fields[field as PersonalField];
  if (field === "payer_kind" || field === "payer_own_account" || field === "payer_beneficial_owner") {
    return payerFieldLabel(text, field, guardian);
  }
  // The consent is a sentence: the list names it. "Other" still needs the relationship in words.
  if (field === "payer_contact_consent") return `${text.payerPerson}: ${text.payerConsentShort}`;
  if (field === "payer_cost_estimate_consent") return `${text.payerPerson}: ${text.payerCostEstimateConsentShort}`;
  if (field === "payer_relationship") return `${text.payerPerson}: ${text.payerRelationship} – ${text.payerRelationshipOther}`;
  if (field.startsWith("payer_")) {
    return `${text.payerPerson}: ${payerFieldLabel(text, field as PayerField, guardian, payerType)}`;
  }
  if (field === "id_document_upload") return `${text.sectionIdentity}: ${text.identityFiles}`;
  if (field === "request_reason") return text.identificationFields.request_reason;
  if (field === "has_representative") return text.hasRepresentativeQuestion;
  if (field === "under_guardianship") return text.underGuardianshipQuestion;
  if ((BILLING_SUBMIT_FIELDS as readonly string[]).includes(field)) return billingSubmitLabel(text, field as BillingField);
  // A field or an upload of a representative carries the caption of that person.
  const person = representativeSubmitPart(field);
  if (person) {
    const label =
      person.part === "id_upload"
        ? representativeUploadLabel(text, person.slot, "identity")
        : person.part === "authority_upload"
          ? representativeUploadLabel(text, person.slot, "authority")
          : representativeFieldLabel(text, person.part);
    return `${text.representativeCaptions[person.slot]}: ${label}`;
  }
  // A missing answer names the question in short.
  const topic = LEGAL_TOPIC_OF[field];
  if (topic) return `${text.legalShort}: ${text.legalTopics[topic]}`;
  // A key of an older or newer server the cabinet has no words for is shown as it is.
  return text.identificationFields[field as IdentificationField] ?? field;
}

const de: LeadRequestText = {
  title: "Ihre Anfrage",
  titleGuardian: "Anfrage für Ihr Kind",
  accountLabelGuardian: "Elternteil / gesetzliche Vertretung",
  intro: "Bitte tragen Sie Ihre persönlichen Daten ein und laden Sie Ihre Unterlagen hoch. Alles wird automatisch gespeichert.",
  introGuardian:
    "Bitte tragen Sie die persönlichen Daten Ihres Kindes ein und laden Sie die Unterlagen hoch. Alles wird automatisch gespeichert.",
  deadline: (date) => `Bitte bis ${date} ausfüllen.`,
  deadlineNote:
    "Aus Datenschutzgründen löschen wir Anfragen, die bis dahin nicht weiterbearbeitet werden, nach diesem Datum automatisch.",
  steps: {
    person: "Einwilligung & Person",
    contact: "Kontakt & Wohnsitz",
    identity: "Ausweis",
    payer: "Wer zahlt",
    billing: "Versicherung & Rechnung",
    declarations: "Erklärungen",
    follow_up: "Ergänzende Angaben",
    documents: "Anliegen & Unterlagen",
    send: "Prüfen & Senden",
  },
  stepsLabel: "Schritte der Anfrage",
  stepMissingBadge: (count) => (count === 1 ? "1 Angabe fehlt" : `${count} Angaben fehlen`),
  stepComplete: "Vollständig",
  stepMissingTitle: "In diesem Schritt fehlt noch:",
  fields: {
    first_name: "Vorname",
    middle_name: "Zweiter Vorname",
    last_name: "Nachname",
    date_of_birth: "Geburtsdatum",
    legal_sex: "Geschlecht laut Ausweis",
    citizenships: "Staatsangehörigkeit(en)",
    street_address: "Straße und Hausnummer",
    zip_code: "Postleitzahl",
    city: "Ort",
    country: "Wohnsitzland",
    phone: "Telefon",
    primary_language: "Bevorzugte Sprache",
    has_insurance: "Krankenversicherung vorhanden?",
    insurance_type: "Versicherungsart",
    insurance_provider: "Versicherer",
    insurance_number: "Versicherungsnummer",
    insurance_covers_germany: "Deckt Behandlung in Deutschland",
  },
  legalSexOptions: {
    female: "Weiblich",
    male: "Männlich",
    diverse: "Divers",
    no_entry: "Keine Angabe",
  },
  choose: "Auswählen",
  citizenshipsPlaceholder: "Land hinzufügen",
  required: "Pflichtfeld",
  saving: "Wird gespeichert…",
  saved: "Gespeichert",
  notSaved: "Nicht gespeichert",
  invalidField: "Bitte prüfen Sie diese Angabe.",
  minorNeedsGuardian:
    "Für Personen unter 18 Jahren füllen die Eltern oder der gesetzliche Vertreter die Anfrage aus. Wir haben Ihr Team informiert und melden uns.",
  next: "Weiter",
  back: "Zurück",
  inquiryConsentLabel: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden.",
  privacyLink: "Datenschutzhinweise",
  consentGivenAt: (dateTime) => `Zugestimmt am ${dateTime}`,
  consentWithdraw: "Einwilligung widerrufen",
  consentWithdrawConfirm:
    "Einwilligung wirklich widerrufen? Der Widerruf gilt für die Zukunft; wir werden informiert.",
  documentsIntro:
    "Laden Sie ärztliche Unterlagen hoch, die Sie bereits haben (Arztbriefe, Befunde, Bilder, Laborwerte). PDF, JPG oder PNG, bis 25 MB pro Datei.",
  healthConsentTitle: "Einwilligung zu Gesundheitsdaten",
  healthConsentLabel: "Ich willige ein (Pflicht vor dem ersten Hochladen).",
  uploadButton: "Dateien auswählen",
  uploading: "Wird hochgeladen…",
  uploadNeedsConsent: "Zum Hochladen bitte zuerst die Einwilligung oben bestätigen.",
  fileTooLarge: (name) => `${name} ist größer als 25 MB.`,
  noDocuments: "Noch keine Unterlagen hochgeladen.",
  documentsOptional: "Sie können die Anfrage auch ohne Unterlagen senden.",
  removeDocument: "Entfernen",
  documentTakenOver: "Von uns übernommen",
  maxDocuments: (count) => `Höchstens ${count} Dateien pro Anfrage.`,
  sendTitle: "An Ihren Ansprechpartner senden",
  missingTitle: "Bitte noch ergänzen:",
  inquiryConsentMissing: "Bitte stimmen Sie unter „Einwilligung & Person“ der Verarbeitung Ihrer Angaben zu.",
  sendButton: "An den Manager senden",
  sending: "Wird gesendet…",
  sentTitle: "Vielen Dank!",
  sentBody: (dateTime) => `Ihre Angaben wurden am ${dateTime} gesendet. Wir melden uns bei Ihnen.`,
  nextTitle: "So geht es weiter",
  nextSteps: [
    "Ihre Ansprechperson prüft Ihre Angaben und Unterlagen.",
    "Wir melden uns bei Ihnen und besprechen die nächsten Schritte.",
    "Bis dahin müssen Sie nichts weiter tun. Hat sich etwas geändert oder haben Sie neue Unterlagen, ergänzen Sie Ihre Anfrage und senden Sie sie erneut.",
  ],
  sentSummaryTitle: "Das haben wir erhalten",
  sendAgain: "Erneut senden",
  editData: "Angaben ändern",
  addDocuments: "Unterlagen ergänzen",
  loadFailed: "Die Anfrage konnte nicht geladen werden.",
  retry: "Erneut versuchen",
  noRequest: "Für Ihr Konto ist derzeit keine offene Anfrage vorhanden.",
  requestFor: "Anfrage für",
  language: "Sprache",
  sectionPerson: "Persönliche Daten",
  sectionAddress: "Adresse",
  sectionContact: "Kontakt",
  sectionConsent: "Datenschutz und Einwilligung",
  sectionUpload: "Ihre Unterlagen",
  stepOf: (index, total) => `Schritt ${index} von ${total}`,
  sectionInsurance: "Versicherung",
  notStated: "Keine Angabe",
  insuranceAnswerOptions: { yes: "Ja", no: "Nein" },
  insuranceTypeOptions: { private: "Privat", public: "Gesetzlich", foreign: "Ausländische Versicherung" },
  insuranceCoverageOptions: { yes: "Ja", no: "Nein", not_sure: "Weiß ich nicht" },
  changedAfterSend:
    "Sie haben Ihre Anfrage nach dem Senden geändert. Senden Sie sie erneut, damit Ihre Ansprechperson die Änderungen erhält.",
  sectionPayer: "Wer zahlt",
  payerQuestion: "Wer übernimmt die Kosten der Behandlung?",
  payerOptions: { self: "Ich selbst", third_party: "Eine andere Person oder Organisation" },
  payerOptionsGuardian: {
    self: "Die Patientin / der Patient selbst",
    guardian: "Ich zahle (als Elternteil)",
    third_party: "Eine andere Person oder Organisation",
  },
  payerIntro: "Bitte nennen Sie, wer die Kosten übernimmt. Wir sind gesetzlich verpflichtet zu wissen, wer zahlt.",
  payerInformHint:
    "Bitte sagen Sie dieser Person, dass Sie uns ihre Daten für die Kostenübernahme mitgeteilt haben.",
  payerPerson: "Zahler",
  payerTypeQuestion: "Wer ist der Zahler?",
  payerTypeOptions: {
    person: "Privatperson",
    company: "Unternehmen",
    organisation: "Organisation",
    insurance: "Versicherung",
  },
  payerOrganisationName: {
    company: "Name des Unternehmens",
    organisation: "Name der Organisation",
    insurance: "Name der Versicherung",
  },
  payerRelationship: "Beziehung zur Patientin / zum Patienten",
  payerRelationshipOptions: {
    spouse: "Ehepartner/in",
    parent: "Elternteil",
    child: "Kind",
    sibling: "Bruder / Schwester",
    grandparent: "Großmutter / Großvater",
    relative: "Anderer Verwandter",
    employer: "Arbeitgeber",
    friend: "Freund/in",
    business_partner: "Geschäftspartner/in",
    other: "Sonstige",
  },
  payerRelationshipOther: "In welcher Beziehung genau?",
  payerSeatStreet: "Sitz (Straße und Hausnummer)",
  payerSeatCountry: "Land des Sitzes",
  payerEmail: "E-Mail",
  payerConsentLabel:
    "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr meinen Namen mitteilt.",
  payerConsentLabelGuardian:
    "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr den Namen der Patientin / des Patienten mitteilt.",
  payerConsentHint: "Ohne dieses Einverständnis dürfen wir den Zahler nicht ansprechen.",
  payerConsentShort: "Einverständnis zur Kontaktaufnahme",
  payerCostEstimateConsentLabel:
    "Ich willige ein, dass GMED der zahlenden Person den Kostenvoranschlag mit den voraussichtlichen Kosten übermittelt – nur Leistungsarten und Beträge, ohne Diagnosen und Behandlungsnamen.",
  payerCostEstimateConsentHint:
    "Ohne diese Einwilligung können wir der zahlenden Person die Unterlagen zur Kostenübernahme nicht zur Unterschrift senden.",
  payerCostEstimateConsentShort: "Einwilligung zur Weitergabe des Kostenvoranschlags",
  payerAnsweredByPayer: "Die zahlende Person hat ihre Angaben selbst gemacht. Änderungen nur über GMED.",
  ownAccountQuestion: "Handeln Sie im eigenen wirtschaftlichen Interesse?",
  beneficialOwner: "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  ownAccountQuestionGuardian: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?",
  beneficialOwnerGuardian:
    "In wessen Interesse handelt die Patientin / der Patient? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  payerMessenger: "WhatsApp / Messenger",
  payerMessengerSameAsPhone: "gleich wie Telefon",
  payerResidence: "Wohnort",
  payerBlockPerson: "Angaben zur zahlenden Person",
  payerBlockContact: "Kontakt",
  payerBlockConsent: "Einwilligungen",
  followUpTitle: "Wir benötigen ergänzende Angaben",
  followUpIntro:
    "Bitte ergänzen Sie die folgenden Angaben und senden Sie sie anschließend ab. Alles wird automatisch gespeichert.",
  followUpBlocks: {
    A: "Herkunft der Mittel",
    B: "Beziehung zur zahlenden Person",
    C: "Zahlungsweg",
    F: "Wohnsitz und Staatsangehörigkeit",
    G: "Wer für Sie handelt",
    H: "Angaben zum öffentlichen Amt",
    I: "Ausweisdokument",
    J: "Angaben zu den Verbindungen",
    K: "Angaben zur Person",
    L: "Fragen nach dem Geldwäschegesetz",
  },
  followUpSubmit: "Angaben senden",
  followUpSending: "Wird gesendet…",
  followUpIncomplete: "Bitte ergänzen Sie zuerst die noch offenen Angaben.",
  followUpAnsweredAt: (dateTime) => `Ihre ergänzenden Angaben wurden am ${dateTime} gesendet. Ihre Angaben werden geprüft.`,
  followUpOpen: "Bitte ergänzen Sie noch einige Angaben.",
  followUpGo: "Zu den ergänzenden Angaben",
  reviewNotice: "Vielen Dank. Ihre Angaben werden geprüft. Wir melden uns bei Ihnen.",
  extraFields: {
    payer_funds_source: "Woher stammen die Mittel der zahlenden Person? (soweit Ihnen bekannt)",
    payer_funds_description: "Bitte beschreiben Sie die Herkunft der Mittel der zahlenden Person",
    funds_source: "Herkunft der Mittel",
    funds_description: "Bitte beschreiben Sie die Herkunft der Mittel",
    occupation: "Beruf",
    sector: "Branche / Sektor",
    funds_proof: "Nachweise zur Herkunft der Mittel",
  },
  extraPayerStatesFunds:
    "Angaben zur Herkunft der Mittel und die Nachweise macht die zahlende Person über ihren eigenen Link.",
  extraOccupationElsewhere: "Ihren Beruf geben Sie im Abschnitt „Angaben als zahlende Person“ an.",
  selfFundsProofHint: "Zum Beispiel Kontoauszug oder Gehaltsnachweis. PDF, JPG oder PNG, bis 25 MB pro Datei.",
  relationshipProofTitle: "Nachweis der Beziehung",
  relationshipProofHint: "Zum Beispiel Heirats- oder Geburtsurkunde. PDF, JPG oder PNG, bis 25 MB pro Datei.",
  noRelationshipProof: "Noch kein Nachweis hochgeladen.",
  stayReasonOptions: { work: "Arbeit", study: "Studium", family: "Familie", other: "Sonstiges" },
  sanctionsLinkKindOptions: {
    family: "Familiär",
    business: "Geschäftlich",
    ownership: "Beteiligung / Eigentum",
    other: "Sonstiges",
  },
  billingExtrasFields: {
    via_third_party_kind: "Über wen erfolgt die Zahlung?",
    expected_total_eur: "Voraussichtlicher Gesamtbetrag (EUR)",
  },
  viaThirdPartyKindOptions: { person: "Über eine andere Person", psp: "Über einen Zahlungsdienstleister" },
  expectedTotalHint: "Soweit bekannt, zum Beispiel aus dem Kostenvoranschlag.",
  identityRenewIntro: "Bitte laden Sie ein aktuelles, gut lesbares Foto oder einen Scan Ihres Ausweisdokuments hoch.",
  identityIntro:
    "Bitte laden Sie ein Foto oder einen Scan Ihres Ausweisdokuments hoch (bei einem Personalausweis Vorder- und Rückseite). Die Angaben aus dem Dokument trägt GMED ein.",
  sectionRequest: "Ihr Anliegen",
  requestReasonHint: "Beschreiben Sie kurz, wobei wir Ihnen helfen sollen.",
  payerLegalForm: "Rechtsform",
  payerRegisterNumber: "Registernummer (falls vorhanden)",
  payerContactName: "Ansprechperson",
  payerEmailOrPhone: "E-Mail oder Telefon",
  payerEmailOrPhoneHint: "Bitte geben Sie mindestens eine E-Mail-Adresse oder eine Telefonnummer an.",
  identificationFields: {
    salutation: "Anrede",
    former_names: "Geburtsname (falls abweichend)",
    birth_place: "Geburtsort",
    birth_country: "Geburtsland",
    habitual_residence_country: "Land des gewöhnlichen Aufenthalts (falls abweichend)",
    contact_channels: "Wie dürfen wir Sie kontaktieren?",
    pep_self: "Üben Sie ein hochrangiges öffentliches Amt aus oder haben Sie es in den letzten 12 Monaten ausgeübt?",
    pep_related: "Ist ein unmittelbares Familienmitglied oder eine Ihnen nahestehende Person politisch exponiert?",
    sanctions_links: "Bestehen Verbindungen zu Personen oder Unternehmen, die Sanktionen unterliegen?",
    payment_background: "Warum übernimmt diese Person bzw. Organisation die Kosten?",
    relationship_since: "Seit wann besteht die Beziehung?",
    residence_since: "Seit wann wohnen Sie in Ihrem Wohnsitzland?",
    other_residences: "Weitere Wohnsitze in den letzten fünf Jahren",
    former_citizenships: "Frühere Staatsangehörigkeiten",
    stay_reason: "Grund des Aufenthalts im Wohnsitzland",
    stay_reason_details: "Bitte beschreiben",
    pep_office: "Amt bzw. Funktion",
    pep_country: "Land",
    pep_period: "Zeitraum",
    pep_relationship: "Beziehung zur Person mit dem Amt (falls nicht Sie selbst)",
    pep_wealth_origin: "Herkunft des Vermögens",
    sanctions_link_name: "Name der Person bzw. des Unternehmens",
    sanctions_link_kind: "Art der Verbindung",
    sanctions_link_since_extent: "Seit wann und in welchem Umfang?",
    request_reason: "Grund der Anfrage",
  },
  identificationFieldsGuardian: {
    pep_self:
      "Übt die Patientin / der Patient ein hochrangiges öffentliches Amt aus oder hat sie / er es in den letzten 12 Monaten ausgeübt?",
    pep_related:
      "Ist ein unmittelbares Familienmitglied der Patientin / des Patienten oder eine ihr / ihm nahestehende Person politisch exponiert?",
    residence_since: "Seit wann wohnt die Patientin / der Patient im Wohnsitzland?",
  },
  legalTopics: {
    pep_self: "Öffentliches Amt",
    pep_related: "Politisch exponierte nahestehende Person",
    sanctions_links: "Sanktionen",
  },
  yesNo: { yes: "Ja", no: "Nein" },
  salutationOptions: { mr: "Herr", ms: "Frau", none: "Keine Angabe" },
  contactChannelOptions: { email: "E-Mail", phone: "Telefon", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Reisepass", id_card: "Personalausweis", residence_permit: "Aufenthaltstitel" },
  sectionIdentity: "Ausweisdokument",
  identityUploadButton: "Foto oder Scan des Ausweises hochladen",
  identityUploadHint: "PDF, JPG oder PNG, bis 25 MB pro Datei.",
  identityUploadNeedsConsent:
    "Zum Hochladen bitte zuerst im Schritt „Einwilligung & Person“ der Verarbeitung Ihrer Angaben zustimmen.",
  identityNote:
    "Eine Kopie allein reicht möglicherweise nicht aus, wenn die Person nicht persönlich anwesend ist. Wir melden uns bei Ihnen wegen der Identifizierung.",
  noIdentityDocuments: "Noch kein Ausweis hochgeladen.",
  identityFiles: "Foto oder Scan des Ausweises",
  idDocumentExpired: "Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.",
  sectionRepresentation: "Vertretung",
  hasRepresentativeQuestion: "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?",
  underGuardianshipQuestion: "Stehen Sie unter rechtlicher Betreuung?",
  sectionLegalRepresentatives: "Gesetzliche Vertreter",
  legalRepresentativesIntro: "Für Minderjährige handeln die gesetzlichen Vertreter.",
  custodySignatureNote: {
    joint: "Einwilligung und Unterschriften werden von beiden Elternteilen benötigt.",
    sole_parent: "Einwilligung und Unterschrift gibt der allein sorgeberechtigte Elternteil.",
    guardian: "Einwilligung und Unterschrift gibt der Vormund / die Pflegerin.",
  },
  custodyQuestion: "Wer vertritt das Kind?",
  custodyOptions: {
    joint: "Beide Eltern gemeinsam",
    sole_parent: "Ein Elternteil allein (alleiniges Sorgerecht)",
    guardian: "Vormund oder Pfleger",
  },
  representativeCaptions: {
    rep1: "1. Vertreter/in",
    rep2: "2. Vertreter/in",
    agent: "Angaben zur vertretenden Person",
    guardian: "Betreuer/in",
  },
  representativeYou: "Sie",
  representativeOtherParent: "anderer Elternteil",
  representativeGuardianOfChild: "Vormund / Pfleger/in",
  representativeOnFile: (name) =>
    `Bei GMED ist eine weitere sorgeberechtigte Person hinterlegt: ${name}. Bitte sprechen Sie uns an.`,
  representativeOnFileGuardian: (name) =>
    `Bei GMED ist eine weitere Person mit Sorgerecht hinterlegt: ${name}. Bitte sprechen Sie uns an.`,
  copyChildAddress: "Adresse des Kindes übernehmen",
  representativeEmailIsLogin: "Ihre Anmeldeadresse",
  representativeEmailIsTheirLogin: "Anmeldeadresse dieser Person",
  representativeInviteHint: "An diese Adresse senden wir die Einladung zur Unterschrift.",
  representativeInformHint: "Bitte informieren Sie diese Person darüber, dass Sie ihre Daten angeben.",
  representativeRemove: "Entfernen",
  representativeRemoveConfirm: (who) =>
    `${who}: Alle Angaben und hochgeladenen Dateien zu dieser Person werden entfernt. Fortfahren?`,
  representativeGuardianIdentity: "Ausweis der Betreuerin / des Betreuers",
  representativeAuthority: {
    power_of_attorney: "Nachweis der Vertretungsmacht (z. B. Vollmacht)",
    guardianship_certificate: "Bestellungsurkunde oder Betreuerausweis",
    appointment_certificate: "Bestallungsurkunde",
    sole_custody: "Nachweis des alleinigen Sorgerechts",
  },
  noAuthorityDocuments: "Noch kein Nachweis hochgeladen.",
  representativeUploadNeedsPerson: "Zum Hochladen bitte zuerst den Nachnamen dieser Person eintragen.",
  representativeInUse: "Diese Person kann hier nicht entfernt werden. Bitte sprechen Sie uns an.",
  representativeLimit: "Für diese Anfrage kann keine weitere Person angegeben werden.",
  representativeEmailLocked: "Diese Adresse ist eine Anmeldeadresse und kann hier nicht geändert werden.",
  representativeMinor: "Die vertretende Person muss volljährig sein (mindestens 18 Jahre).",
  representativeEmailDuplicate:
    "Diese E-Mail-Adresse ist bereits bei einer anderen Person angegeben. Für die Unterschrift braucht jede Person eine eigene Adresse.",
  sectionBilling: "Rechnungsempfänger",
  sectionPaymentRoute: "Zahlungsweg",
  sectionBillingSummary: "Rechnung und Zahlung",
  billingFields: {
    invoice_to: "Wohin soll die Rechnung gehen?",
    invoice_name: "Name auf der Rechnung",
    invoice_street: "Straße und Hausnummer",
    invoice_zip: "PLZ",
    invoice_city: "Ort",
    invoice_country: "Land",
    invoice_email: "E-Mail für Rechnungen (optional)",
    payment_method: "Wie werden Sie bezahlen?",
    payment_method_details: "Bitte beschreiben",
    account_country: "Land des Kontos",
    account_holder: "Kontoinhaber/in",
    bank_name: "Name der Bank",
    via_third_party: "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    via_third_party_details: "Bitte beschreiben (wer, welcher Dienst)",
  },
  invoiceToOptions: {
    self: "An mich",
    payer: "An die zahlende Person / Organisation",
    other: "An eine andere Adresse",
  },
  invoiceToOptionsGuardian: {
    self: "An die Patientin / den Patienten (bei Minderjährigen an die gesetzlichen Vertreter)",
    payer: "An die zahlende Person / Organisation",
    other: "An eine andere Adresse",
  },
  invoiceToMeAsPayer: "An mich (ich zahle)",
  invoiceEmailHint: "Wenn leer, verwenden wir Ihre Kontaktadresse.",
  vatHint: "USt-IdNr. oder Steuernummer trägt GMED bei Bedarf ein.",
  paymentMethodOptions: {
    bank_transfer: "Überweisung",
    card: "Karte",
    cash: "Bar",
    crypto: "Kryptowährung",
    other: "Sonstiges",
  },
  cashCryptoNote: "Barzahlungen und Zahlungen in Kryptowährung prüft GMED gesondert (Geldwäschegesetz).",
  totalAmountHint: "Den voraussichtlichen Gesamtbetrag trägt GMED ein.",
  paymentRouteByPayer: "Den Zahlungsweg gibt die zahlende Person / Organisation selbst an; GMED wendet sich dazu an sie.",
  paymentRouteByPayerShort: "gibt die zahlende Person an",
  sectionLegal: "Gesetzliche Fragen (Geldwäscheprävention)",
  legalIntro: "Diese Fragen schreibt das Geldwäschegesetz vor. Bitte beantworten Sie jede mit Ja oder Nein.",
  legalShort: "Gesetzliche Fragen",
  summaryIntro: "Bitte prüfen Sie Ihre Angaben, bevor Sie sie senden.",
  summaryEmpty: "Noch keine Angaben",
  declarationTitle: "Bestätigung",
  declarationLabel:
    "Ich bestätige, dass meine Angaben vollständig und wahrheitsgemäß sind und dass ich Änderungen mitteile.",
  declarationRequired: "Bitte bestätigen Sie Ihre Angaben, bevor Sie die Anfrage senden.",
  declarationGivenAt: (dateTime) => `Bestätigt am ${dateTime}`,
  payerQuestionnaireTitle: "Angaben als zahlende Person",
  payerQuestionnaireIntro: (section) =>
    `Sie zahlen die Behandlung. Das Geldwäschegesetz verlangt dazu einige Angaben von Ihnen als zahlender Person. Name, Anschrift und Ausweis geben Sie im Abschnitt „${section}“ an.`,
  payerNoticeTitle: "Datenschutzhinweis für die zahlende Person",
  payerNotice:
    "Verantwortlich für die Verarbeitung ist GMED. Ihre Angaben als zahlende Person erhalten wir von Ihnen und aus der Anfrage der Patientin / des Patienten. Wir verarbeiten sie, um Sie nach dem Geldwäschegesetz zu identifizieren (§§ 10–12 GwG), um die Kostenübernahme zu klären und um Rechnungen zu stellen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO. Wir speichern die Angaben fünf Jahre nach dem Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG). Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Widerspruch sowie das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren.",
  payerNoticeAck: "Ich habe die Datenschutzhinweise gelesen.",
  payerNoticeAckAt: (dateTime) => `Bestätigt am ${dateTime}`,
  payerNoticeFirst: "Bitte bestätigen Sie zuerst den Datenschutzhinweis. Danach können Sie Ihre Angaben als zahlende Person machen.",
  payerContactChannels: "Wie dürfen wir Sie als zahlende Person kontaktieren?",
  payerQuestionnaireFields: {
    language: "Sprache",
    occupation: "Beruf / Tätigkeit",
    funds_sources: "Herkunft der Mittel",
    funds_description: "Beschreibung der Herkunft der Mittel",
  },
  payerLegalFields: {
    pep_self: "Üben Sie ein hochrangiges öffentliches Amt aus oder haben Sie es in den letzten 12 Monaten ausgeübt?",
    pep_self_details: "Amt, Land und Zeitraum",
    pep_related: "Ist ein unmittelbares Familienmitglied oder eine Ihnen nahestehende Person politisch exponiert?",
    pep_related_details: "Name der Person, Beziehung, Amt und Land",
    high_risk_country:
      "Haben Sie oder eine beteiligte Person Wohnsitz oder Sitz in einem Land, das die EU-Kommission als Drittstaat mit hohem Risiko führt?",
    high_risk_country_code: "Welches Land?",
    sanctions_links: "Bestehen Verbindungen zu Personen oder Unternehmen, die Sanktionen unterliegen?",
    sanctions_links_details: "Zu wem besteht die Verbindung und welcher Art ist sie?",
  },
  payerHighRiskTopic: "Land mit hohem Risiko",
  fundsSourceOptions: {
    employment: "Gehalt / nichtselbständige Arbeit",
    business_income: "Einkünfte aus Unternehmen / selbständiger Tätigkeit",
    savings: "Ersparnisse",
    asset_sale: "Verkauf von Vermögenswerten",
    inheritance_gift: "Erbschaft / Schenkung",
    other: "Sonstiges",
  },
  statedFundsSourceOptions: {
    income: "Einkommen",
    savings: "Ersparnisse",
    asset_sale: "Verkauf von Vermögenswerten",
    inheritance_gift: "Erbschaft / Schenkung",
    other: "Sonstiges",
  },
  payerFundsProofTitle: "Nachweis der Herkunft der Mittel",
  payerFundsProofRequired: "erforderlich",
  payerFundsProofOptional: "optional",
  payerFundsProofRequiredNote: "Für diese Zahlung schreibt das Geldwäschegesetz einen Nachweis der Herkunft der Mittel vor.",
  payerFundsProofHint: "Zum Beispiel Kontoauszug, Gehaltsnachweis, Kaufvertrag oder Erbschein. PDF, JPG oder PNG, bis 25 MB pro Datei.",
  payerFundsProofUpload: "Nachweis hochladen",
  noPayerFundsProof: "Noch kein Nachweis hochgeladen.",
  payerElsewhere: (section) => `Bitte im Abschnitt „${section}“ ergänzen:`,
  payerOwnMissingTitle: "Für das Senden fehlt noch:",
  payerNoticeMissing: "Datenschutzhinweis bestätigen",
  payerDeclarationLabel: "Ich bestätige, dass meine Angaben als zahlende Person vollständig und richtig sind.",
  payerDeclarationRequired: "Bitte bestätigen Sie Ihre Angaben, bevor Sie sie senden.",
  payerSubmitButton: "Angaben als Zahler senden",
  payerSubmittedAt: (dateTime) => `Ihre Angaben als zahlende Person wurden am ${dateTime} gesendet.`,
  payerSubmittedNote: "Möchten Sie etwas ändern, wenden Sie sich bitte an GMED.",
  payerQuestionnaireLoadFailed: "Ihre Angaben als zahlende Person konnten nicht geladen werden.",
  payerQuestionnaireLocked: "Ihre Angaben als zahlende Person sind bereits gesendet und können hier nicht mehr geändert werden.",
  payerSignatureSent: (date) =>
    `Unterlagen zur Unterschrift: Wir haben Ihnen ${date ? `am ${date} ` : ""}vier Dokumente zur qualifizierten elektronischen Signatur gesendet. Die Einladung kommt per E-Mail von unserem Partner Skribble; dort bestätigen Sie auch Ihre Identität.`,
  payerSignatureSigned: (date) =>
    `Vielen Dank – die unterschriebenen Unterlagen sind ${date ? `am ${date} ` : ""}bei GMED eingegangen.`,
};

const ru: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашего ребёнка",
  accountLabelGuardian: "Родитель / законный представитель",
  intro: "Пожалуйста, заполните свои личные данные и загрузите документы. Всё сохраняется автоматически.",
  introGuardian:
    "Пожалуйста, заполните личные данные ребёнка и загрузите документы. Всё сохраняется автоматически.",
  deadline: (date) => `Пожалуйста, заполните до ${date}.`,
  deadlineNote:
    "Из соображений защиты данных заявки, работа по которым к этой дате не продолжена, после неё удаляются автоматически.",
  steps: {
    person: "Согласие и личные данные",
    contact: "Контакты и проживание",
    identity: "Документ",
    payer: "Кто платит",
    billing: "Страховка и счёт",
    declarations: "Заявления",
    follow_up: "Дополнительные сведения",
    documents: "Обращение и документы",
    send: "Проверка и отправка",
  },
  stepsLabel: "Шаги заявки",
  stepMissingBadge: (count) => `Не хватает: ${count}`,
  stepComplete: "Заполнено",
  stepMissingTitle: "На этом шаге ещё не хватает:",
  fields: {
    first_name: "Имя",
    middle_name: "Отчество / второе имя",
    last_name: "Фамилия",
    date_of_birth: "Дата рождения",
    legal_sex: "Пол по документам",
    citizenships: "Гражданство",
    street_address: "Улица и дом",
    zip_code: "Почтовый индекс",
    city: "Город",
    country: "Страна проживания",
    phone: "Телефон",
    primary_language: "Предпочитаемый язык",
    has_insurance: "Есть страхование?",
    insurance_type: "Тип страхования",
    insurance_provider: "Страховая компания",
    insurance_number: "Номер полиса",
    insurance_covers_germany: "Покрывает лечение в Германии",
  },
  legalSexOptions: {
    female: "Женский",
    male: "Мужской",
    diverse: "Другой",
    no_entry: "Без указания",
  },
  choose: "Выберите",
  citizenshipsPlaceholder: "Добавить страну",
  required: "Обязательное поле",
  saving: "Сохраняется…",
  saved: "Сохранено",
  notSaved: "Не сохранено",
  invalidField: "Пожалуйста, проверьте это поле.",
  minorNeedsGuardian:
    "Для лиц младше 18 лет заявку заполняют родители или законный представитель. Мы сообщили вашей команде и свяжемся с вами.",
  next: "Далее",
  back: "Назад",
  inquiryConsentLabel: "Я согласен(на), что мои данные обрабатываются для рассмотрения моего обращения.",
  privacyLink: "Информация о защите данных",
  consentGivenAt: (dateTime) => `Согласие дано ${dateTime}`,
  consentWithdraw: "Отозвать согласие",
  consentWithdrawConfirm: "Отозвать согласие? Отзыв действует на будущее; мы получим уведомление.",
  documentsIntro:
    "Загрузите медицинские документы, которые у вас уже есть (выписки, заключения, снимки, анализы). PDF, JPG или PNG, до 25 МБ на файл.",
  healthConsentTitle: "Согласие на обработку данных о здоровье",
  healthConsentLabel: "Я даю согласие (обязательно перед первой загрузкой).",
  uploadButton: "Выбрать файлы",
  uploading: "Загружается…",
  uploadNeedsConsent: "Чтобы загрузить файлы, сначала подтвердите согласие выше.",
  fileTooLarge: (name) => `${name} больше 25 МБ.`,
  noDocuments: "Документы ещё не загружены.",
  documentsOptional: "Заявку можно отправить и без документов.",
  removeDocument: "Удалить",
  documentTakenOver: "Принято в работу",
  maxDocuments: (count) => `Не более ${count} файлов на заявку.`,
  sendTitle: "Отправить вашему менеджеру",
  missingTitle: "Пожалуйста, дополните:",
  inquiryConsentMissing: "Пожалуйста, дайте согласие на обработку данных на шаге «Согласие и личные данные».",
  sendButton: "Отправить менеджеру",
  sending: "Отправляется…",
  sentTitle: "Спасибо!",
  sentBody: (dateTime) => `Ваши данные отправлены ${dateTime}. Мы свяжемся с вами.`,
  nextTitle: "Что дальше",
  nextSteps: [
    "Ваш менеджер проверит данные и документы.",
    "Мы свяжемся с вами и обсудим следующие шаги.",
    "До этого от вас ничего не требуется. Если что-то изменилось или появились новые документы, дополните заявку и отправьте её ещё раз.",
  ],
  sentSummaryTitle: "Что мы получили",
  sendAgain: "Отправить ещё раз",
  editData: "Изменить данные",
  addDocuments: "Добавить документы",
  loadFailed: "Не удалось загрузить заявку.",
  retry: "Повторить",
  noRequest: "Для вашего аккаунта сейчас нет открытой заявки.",
  requestFor: "Заявка для",
  language: "Язык",
  sectionPerson: "Личные данные",
  sectionAddress: "Адрес",
  sectionContact: "Контакт",
  sectionConsent: "Защита данных и согласие",
  sectionUpload: "Ваши документы",
  stepOf: (index, total) => `Шаг ${index} из ${total}`,
  sectionInsurance: "Страхование",
  notStated: "Не указано",
  insuranceAnswerOptions: { yes: "Да", no: "Нет" },
  insuranceTypeOptions: { private: "Частное", public: "Государственное", foreign: "Иностранное" },
  insuranceCoverageOptions: { yes: "Да", no: "Нет", not_sure: "Не знаю" },
  changedAfterSend:
    "После отправки вы изменили заявку. Отправьте её ещё раз, чтобы менеджер получил изменения.",
  sectionPayer: "Кто оплачивает",
  payerQuestion: "Кто оплачивает лечение?",
  payerOptions: { self: "Я сам(а)", third_party: "Другой человек или организация" },
  payerOptionsGuardian: {
    self: "Сам пациент",
    guardian: "Оплачиваю я (как один из родителей)",
    third_party: "Другой человек или организация",
  },
  payerIntro: "Укажите, пожалуйста, кто оплачивает лечение. По закону мы обязаны знать, кто платит.",
  payerInformHint: "Пожалуйста, сообщите этому человеку, что вы передали нам его данные для оформления оплаты.",
  payerPerson: "Плательщик",
  payerTypeQuestion: "Кто является плательщиком?",
  payerTypeOptions: {
    person: "Частное лицо",
    company: "Компания",
    organisation: "Организация",
    insurance: "Страховая компания",
  },
  payerOrganisationName: {
    company: "Название компании",
    organisation: "Название организации",
    insurance: "Название страховой компании",
  },
  payerRelationship: "Кем приходится пациенту",
  payerRelationshipOptions: {
    spouse: "Супруг / супруга",
    parent: "Мать / отец",
    child: "Сын / дочь",
    sibling: "Брат / сестра",
    grandparent: "Бабушка / дедушка",
    relative: "Другой родственник",
    employer: "Работодатель",
    friend: "Друг / подруга",
    business_partner: "Деловой партнёр",
    other: "Другое",
  },
  payerRelationshipOther: "Кем именно приходится пациенту",
  payerSeatStreet: "Местонахождение (улица и дом)",
  payerSeatCountry: "Страна местонахождения",
  payerEmail: "E-mail",
  payerConsentLabel:
    "Я согласен(на), что GMED свяжется с этим человеком или организацией по вопросу оплаты лечения и сообщит им моё имя.",
  payerConsentLabelGuardian:
    "Я согласен(на), что GMED свяжется с этим человеком или организацией по вопросу оплаты лечения и сообщит им имя пациента.",
  payerConsentHint: "Без этого согласия мы не вправе обращаться к плательщику.",
  payerConsentShort: "Согласие на контакт",
  payerCostEstimateConsentLabel:
    "Я согласен(на), что GMED передаст плательщику смету с ожидаемыми расходами – только виды услуг и суммы, без диагнозов и названий лечения.",
  payerCostEstimateConsentHint:
    "Без этого согласия мы не можем отправить плательщику документы об оплате расходов на подпись.",
  payerCostEstimateConsentShort: "Согласие на передачу сметы",
  payerAnsweredByPayer: "Плательщик сам указал свои данные. Изменения только через GMED.",
  ownAccountQuestion: "Вы действуете в собственных экономических интересах?",
  beneficialOwner: "В чьих интересах вы действуете? (имя, дата рождения, место рождения, адрес)",
  ownAccountQuestionGuardian: "Пациент действует в собственных экономических интересах?",
  beneficialOwnerGuardian: "В чьих интересах действует пациент? (имя, дата рождения, место рождения, адрес)",
  payerMessenger: "WhatsApp / мессенджер",
  payerMessengerSameAsPhone: "как телефон",
  payerResidence: "Место жительства",
  payerBlockPerson: "Данные плательщика",
  payerBlockContact: "Контакты",
  payerBlockConsent: "Согласия",
  followUpTitle: "Нам нужны дополнительные сведения",
  followUpIntro: "Пожалуйста, дополните следующие сведения и затем отправьте их. Всё сохраняется автоматически.",
  followUpBlocks: {
    A: "Происхождение средств",
    B: "Отношения с плательщиком",
    C: "Способ оплаты",
    F: "Проживание и гражданство",
    G: "Кто действует за вас",
    H: "Сведения о государственной должности",
    I: "Документ, удостоверяющий личность",
    J: "Сведения о связях",
    K: "Личные данные",
    L: "Вопросы по закону (противодействие отмыванию денег)",
  },
  followUpSubmit: "Отправить сведения",
  followUpSending: "Отправляется…",
  followUpIncomplete: "Пожалуйста, сначала дополните недостающие сведения.",
  followUpAnsweredAt: (dateTime) => `Ваши дополнительные сведения отправлены ${dateTime}. Ваши данные проверяются.`,
  followUpOpen: "Пожалуйста, дополните ещё некоторые сведения.",
  followUpGo: "К дополнительным сведениям",
  reviewNotice: "Спасибо. Ваши данные проверяются. Мы свяжемся с вами.",
  extraFields: {
    payer_funds_source: "Откуда средства у плательщика? (насколько вам известно)",
    payer_funds_description: "Опишите, пожалуйста, происхождение средств плательщика",
    funds_source: "Происхождение средств",
    funds_description: "Опишите, пожалуйста, происхождение средств",
    occupation: "Профессия",
    sector: "Отрасль / сфера",
    funds_proof: "Подтверждения происхождения средств",
  },
  extraPayerStatesFunds: "Сведения о происхождении средств и подтверждения плательщик даёт по своей собственной ссылке.",
  extraOccupationElsewhere: "Профессию вы указываете в разделе «Сведения о плательщике».",
  selfFundsProofHint: "Например, выписка со счёта или справка о зарплате. PDF, JPG или PNG, до 25 МБ на файл.",
  relationshipProofTitle: "Подтверждение отношений",
  relationshipProofHint: "Например, свидетельство о браке или о рождении. PDF, JPG или PNG, до 25 МБ на файл.",
  noRelationshipProof: "Подтверждение ещё не загружено.",
  stayReasonOptions: { work: "Работа", study: "Учёба", family: "Семья", other: "Другое" },
  sanctionsLinkKindOptions: {
    family: "Семейная",
    business: "Деловая",
    ownership: "Участие / собственность",
    other: "Другое",
  },
  billingExtrasFields: {
    via_third_party_kind: "Через кого проходит оплата?",
    expected_total_eur: "Ожидаемая общая сумма (EUR)",
  },
  viaThirdPartyKindOptions: { person: "Через другого человека", psp: "Через платёжный сервис" },
  expectedTotalHint: "Насколько известно, например из сметы расходов.",
  identityRenewIntro: "Пожалуйста, загрузите актуальное, хорошо читаемое фото или скан вашего документа.",
  identityIntro:
    "Пожалуйста, загрузите фото или скан документа, удостоверяющего личность (для ID-карты — обе стороны). Данные из документа вносит GMED.",
  sectionRequest: "Ваше обращение",
  requestReasonHint: "Кратко опишите, с чем мы можем вам помочь.",
  payerLegalForm: "Правовая форма",
  payerRegisterNumber: "Регистрационный номер (если есть)",
  payerContactName: "Контактное лицо",
  payerEmailOrPhone: "E-mail или телефон",
  payerEmailOrPhoneHint: "Пожалуйста, укажите хотя бы адрес e-mail или номер телефона.",
  identificationFields: {
    salutation: "Обращение",
    former_names: "Фамилия при рождении (если другая)",
    birth_place: "Место рождения",
    birth_country: "Страна рождения",
    habitual_residence_country: "Страна постоянного пребывания (если другая)",
    contact_channels: "Как мы можем с вами связаться?",
    pep_self: "Занимаете ли вы высокую государственную должность или занимали её в последние 12 месяцев?",
    pep_related:
      "Является ли кто-то из ближайших членов вашей семьи или близкий вам человек политически значимым лицом?",
    sanctions_links: "Есть ли связи с лицами или компаниями, на которые наложены санкции?",
    payment_background: "Почему этот человек или организация берёт на себя расходы?",
    relationship_since: "С какого времени существуют отношения?",
    residence_since: "С какого времени вы живёте в стране проживания?",
    other_residences: "Другие места жительства за последние пять лет",
    former_citizenships: "Прежние гражданства",
    stay_reason: "Причина пребывания в стране проживания",
    stay_reason_details: "Опишите, пожалуйста",
    pep_office: "Должность или функция",
    pep_country: "Страна",
    pep_period: "Период",
    pep_relationship: "Кем вам приходится человек с должностью (если не вы сами)",
    pep_wealth_origin: "Происхождение имущества",
    sanctions_link_name: "Имя человека или название компании",
    sanctions_link_kind: "Вид связи",
    sanctions_link_since_extent: "С какого времени и в каком объёме?",
    request_reason: "Причина обращения",
  },
  identificationFieldsGuardian: {
    pep_self: "Занимает ли пациент высокую государственную должность или занимал её в последние 12 месяцев?",
    pep_related:
      "Является ли кто-то из ближайших членов семьи пациента или близкий ему человек политически значимым лицом?",
    residence_since: "С какого времени пациент живёт в стране проживания?",
  },
  legalTopics: {
    pep_self: "Государственная должность",
    pep_related: "Политически значимое близкое лицо",
    sanctions_links: "Санкции",
  },
  yesNo: { yes: "Да", no: "Нет" },
  salutationOptions: { mr: "Господин", ms: "Госпожа", none: "Без указания" },
  contactChannelOptions: { email: "E-mail", phone: "Телефон", messenger: "Мессенджер" },
  idDocumentTypeOptions: {
    passport: "Паспорт (заграничный)",
    id_card: "Удостоверение личности (ID-карта)",
    residence_permit: "Вид на жительство",
  },
  sectionIdentity: "Документ, удостоверяющий личность",
  identityUploadButton: "Загрузить фото или скан документа",
  identityUploadHint: "PDF, JPG или PNG, до 25 МБ на файл.",
  identityUploadNeedsConsent: "Чтобы загрузить, сначала дайте согласие на обработку данных на шаге «Согласие и личные данные».",
  identityNote:
    "Одной копии может быть недостаточно, если человек не присутствует лично. Мы свяжемся с вами по поводу идентификации.",
  noIdentityDocuments: "Документ ещё не загружен.",
  identityFiles: "Фото или скан документа",
  idDocumentExpired: "Срок действия документа истёк. Пожалуйста, укажите действующий документ.",
  sectionRepresentation: "Представительство",
  hasRepresentativeQuestion: "Действует ли кто-то от вашего имени (представитель, посредник, уполномоченное лицо)?",
  underGuardianshipQuestion: "Назначен ли вам опекун по решению суда (rechtliche Betreuung)?",
  sectionLegalRepresentatives: "Законные представители",
  legalRepresentativesIntro: "За несовершеннолетних действуют законные представители.",
  custodySignatureNote: {
    joint: "Согласие и подписи нужны от обоих родителей.",
    sole_parent: "Согласие и подпись даёт родитель, у которого единоличное право опеки.",
    guardian: "Согласие и подпись даёт опекун или попечитель.",
  },
  custodyQuestion: "Кто представляет ребёнка?",
  custodyOptions: {
    joint: "Оба родителя вместе",
    sole_parent: "Один из родителей (единоличное право опеки)",
    guardian: "Опекун или попечитель",
  },
  representativeCaptions: {
    rep1: "1-й представитель",
    rep2: "2-й представитель",
    agent: "Данные представителя",
    guardian: "Опекун",
  },
  representativeYou: "вы",
  representativeOtherParent: "второй родитель",
  representativeGuardianOfChild: "Опекун / попечитель",
  representativeOnFile: (name) =>
    `В GMED указан ещё один человек с правом опеки: ${name}. Пожалуйста, свяжитесь с нами.`,
  representativeOnFileGuardian: (name) =>
    `В GMED указан ещё один человек, у которого есть право опеки: ${name}. Пожалуйста, свяжитесь с нами.`,
  copyChildAddress: "Взять адрес ребёнка",
  representativeEmailIsLogin: "Ваш адрес для входа",
  representativeEmailIsTheirLogin: "Адрес для входа этого человека",
  representativeInviteHint: "На этот адрес мы отправим приглашение на подпись.",
  representativeInformHint: "Пожалуйста, сообщите этому человеку, что вы указываете его данные.",
  representativeRemove: "Удалить",
  representativeRemoveConfirm: (who) =>
    `${who}: все данные и загруженные файлы этого человека будут удалены. Продолжить?`,
  representativeGuardianIdentity: "Документ, удостоверяющий личность опекуна",
  representativeAuthority: {
    power_of_attorney: "Подтверждение полномочий (например, доверенность)",
    guardianship_certificate: "Решение о назначении опекуна или удостоверение опекуна",
    appointment_certificate: "Документ о назначении опекуном",
    sole_custody: "Подтверждение единоличного права опеки",
  },
  noAuthorityDocuments: "Подтверждение ещё не загружено.",
  representativeUploadNeedsPerson: "Чтобы загрузить, сначала укажите фамилию этого человека.",
  representativeInUse: "Этого человека нельзя удалить здесь. Пожалуйста, свяжитесь с нами.",
  representativeLimit: "В этой заявке больше нельзя указать ни одного человека.",
  representativeEmailLocked: "Это адрес для входа, изменить его здесь нельзя.",
  representativeMinor: "Представитель должен быть совершеннолетним (не младше 18 лет).",
  representativeEmailDuplicate:
    "Этот адрес e-mail уже указан для другого человека. Для подписи каждому нужен собственный адрес.",
  sectionBilling: "Получатель счёта",
  sectionPaymentRoute: "Способ оплаты",
  sectionBillingSummary: "Счёт и оплата",
  billingFields: {
    invoice_to: "Куда направить счёт?",
    invoice_name: "Имя или название на счёте",
    invoice_street: "Улица и дом",
    invoice_zip: "Почтовый индекс",
    invoice_city: "Город",
    invoice_country: "Страна",
    invoice_email: "E-mail для счетов (необязательно)",
    payment_method: "Как вы будете платить?",
    payment_method_details: "Опишите, пожалуйста",
    account_country: "Страна счёта",
    account_holder: "Владелец счёта",
    bank_name: "Название банка",
    via_third_party: "Производится ли оплата через третье лицо или платёжного провайдера?",
    via_third_party_details: "Опишите, пожалуйста (кто, какой сервис)",
  },
  invoiceToOptions: {
    self: "Мне",
    payer: "Плательщику (лицу или организации, которая платит)",
    other: "На другой адрес",
  },
  invoiceToOptionsGuardian: {
    self: "Пациенту (для несовершеннолетних — законным представителям)",
    payer: "Плательщику (лицу или организации, которая платит)",
    other: "На другой адрес",
  },
  invoiceToMeAsPayer: "Мне (я плачу)",
  invoiceEmailHint: "Если пусто, мы используем ваш контактный адрес.",
  vatHint: "USt-IdNr. или налоговый номер при необходимости вносит GMED.",
  paymentMethodOptions: {
    bank_transfer: "Банковский перевод",
    card: "Карта",
    cash: "Наличные",
    crypto: "Криптовалюта",
    other: "Другое",
  },
  cashCryptoNote: "Оплату наличными и криптовалютой GMED проверяет отдельно (закон о противодействии отмыванию денег).",
  totalAmountHint: "Ожидаемую общую сумму вносит GMED.",
  paymentRouteByPayer:
    "Способ оплаты указывает сам плательщик (лицо или организация, которая платит); GMED обратится к нему по этому вопросу.",
  paymentRouteByPayerShort: "указывает плательщик",
  sectionLegal: "Вопросы по закону (противодействие отмыванию денег)",
  legalIntro:
    "Эти вопросы требует немецкий закон о противодействии отмыванию денег. Пожалуйста, ответьте на каждый «да» или «нет».",
  legalShort: "Вопросы по закону",
  summaryIntro: "Пожалуйста, проверьте данные перед отправкой.",
  summaryEmpty: "Пока ничего не указано",
  declarationTitle: "Подтверждение",
  declarationLabel: "Я подтверждаю, что мои данные полные и достоверные и что я сообщу об изменениях.",
  declarationRequired: "Пожалуйста, подтвердите свои данные перед отправкой заявки.",
  declarationGivenAt: (dateTime) => `Подтверждено ${dateTime}`,
  payerQuestionnaireTitle: "Ваши данные как плательщика",
  payerQuestionnaireIntro: (section) =>
    `Вы оплачиваете лечение. Закон о противодействии отмыванию денег требует для этого некоторых данных о вас как о плательщике. Имя, адрес и документ, удостоверяющий личность, вы указываете в разделе «${section}».`,
  payerNoticeTitle: "Уведомление о защите данных для плательщика",
  payerNotice:
    "Ответственный за обработку — GMED. Ваши данные как плательщика мы получаем от вас и из заявки пациента. Мы обрабатываем их, чтобы идентифицировать вас по Закону Германии о противодействии отмыванию денег (§§ 10–12 GwG), согласовать оплату расходов и выставлять счета. Правовое основание — ст. 6 ч. 1 п. b и c DSGVO (GDPR). Мы храним данные пять лет после окончания деловых отношений (§ 8 абз. 4 GwG). Вы вправе получить информацию о своих данных, потребовать их исправления, удаления или ограничения обработки, возразить против обработки, а также подать жалобу в надзорный орган по защите данных.",
  payerNoticeAck: "Я ознакомился(-ась) с информацией о защите данных.",
  payerNoticeAckAt: (dateTime) => `Подтверждено ${dateTime}`,
  payerNoticeFirst: "Сначала подтвердите, пожалуйста, уведомление о защите данных. После этого вы сможете указать данные плательщика.",
  payerContactChannels: "Как мы можем связаться с вами как с плательщиком?",
  payerQuestionnaireFields: {
    language: "Язык",
    occupation: "Профессия / род занятий",
    funds_sources: "Источник средств",
    funds_description: "Описание источника средств",
  },
  payerLegalFields: {
    pep_self: "Занимаете ли вы высокую государственную должность или занимали её в последние 12 месяцев?",
    pep_self_details: "Должность, страна и период",
    pep_related:
      "Является ли кто-то из ближайших членов вашей семьи или близкий вам человек политически значимым лицом?",
    pep_related_details: "Имя человека, кем приходится, должность и страна",
    high_risk_country:
      "Проживаете ли вы или участвующее лицо в стране (или зарегистрированы в ней), которую Европейская комиссия относит к третьим странам высокого риска?",
    high_risk_country_code: "Какая страна?",
    sanctions_links: "Есть ли связи с лицами или компаниями, на которые наложены санкции?",
    sanctions_links_details: "С кем есть связь и какая именно?",
  },
  payerHighRiskTopic: "Страна высокого риска",
  fundsSourceOptions: {
    employment: "Заработная плата / работа по найму",
    business_income: "Доход от предпринимательской деятельности",
    savings: "Сбережения",
    asset_sale: "Продажа имущества",
    inheritance_gift: "Наследство / дарение",
    other: "Другое",
  },
  statedFundsSourceOptions: {
    income: "Доход",
    savings: "Сбережения",
    asset_sale: "Продажа имущества",
    inheritance_gift: "Наследство / дарение",
    other: "Другое",
  },
  payerFundsProofTitle: "Подтверждение источника средств",
  payerFundsProofRequired: "обязательно",
  payerFundsProofOptional: "по желанию",
  payerFundsProofRequiredNote: "Для этого платежа закон о противодействии отмыванию денег требует подтверждения источника средств.",
  payerFundsProofHint: "Например, выписка со счёта, справка о доходах, договор купли-продажи или свидетельство о наследстве. PDF, JPG или PNG, до 25 МБ на файл.",
  payerFundsProofUpload: "Загрузить подтверждение",
  noPayerFundsProof: "Подтверждение ещё не загружено.",
  payerElsewhere: (section) => `Пожалуйста, дополните в разделе «${section}»:`,
  payerOwnMissingTitle: "Для отправки ещё не хватает:",
  payerNoticeMissing: "Подтвердить уведомление о защите данных",
  payerDeclarationLabel: "Я подтверждаю, что мои данные как плательщика полны и верны.",
  payerDeclarationRequired: "Пожалуйста, подтвердите свои данные перед отправкой.",
  payerSubmitButton: "Отправить данные плательщика",
  payerSubmittedAt: (dateTime) => `Ваши данные как плательщика отправлены ${dateTime}.`,
  payerSubmittedNote: "Если вы хотите что-то изменить, обратитесь, пожалуйста, в GMED.",
  payerQuestionnaireLoadFailed: "Не удалось загрузить ваши данные как плательщика.",
  payerQuestionnaireLocked: "Ваши данные как плательщика уже отправлены, изменить их здесь больше нельзя.",
  payerSignatureSent: (date) =>
    `Документы на подпись: ${date ? `${date} ` : ""}мы отправили вам четыре документа для квалифицированной электронной подписи. Приглашение придёт по электронной почте от нашего партнёра Skribble; там вы также подтвердите свою личность.`,
  payerSignatureSigned: (date) => `Спасибо – подписанные документы поступили в GMED${date ? ` ${date}` : ""}.`,
};

const uk: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашої дитини",
  accountLabelGuardian: "Один із батьків / законний представник",
  intro: "Будь ласка, заповніть свої особисті дані та завантажте документи. Усе зберігається автоматично.",
  introGuardian:
    "Будь ласка, заповніть особисті дані дитини та завантажте документи. Усе зберігається автоматично.",
  deadline: (date) => `Будь ласка, заповніть до ${date}.`,
  deadlineNote:
    "З міркувань захисту даних заявки, робота над якими до цієї дати не продовжена, після неї видаляються автоматично.",
  steps: {
    person: "Згода й особисті дані",
    contact: "Контакти й проживання",
    identity: "Документ",
    payer: "Хто платить",
    billing: "Страхування й рахунок",
    declarations: "Заяви",
    follow_up: "Додаткові відомості",
    documents: "Звернення й документи",
    send: "Перевірка й надсилання",
  },
  stepsLabel: "Кроки заявки",
  stepMissingBadge: (count) => `Бракує: ${count}`,
  stepComplete: "Заповнено",
  stepMissingTitle: "На цьому кроці ще бракує:",
  fields: {
    first_name: "Ім'я",
    middle_name: "По батькові / друге ім'я",
    last_name: "Прізвище",
    date_of_birth: "Дата народження",
    legal_sex: "Стать за документами",
    citizenships: "Громадянство",
    street_address: "Вулиця і будинок",
    zip_code: "Поштовий індекс",
    city: "Місто",
    country: "Країна проживання",
    phone: "Телефон",
    primary_language: "Бажана мова",
    has_insurance: "Є страхування?",
    insurance_type: "Тип страхування",
    insurance_provider: "Страхова компанія",
    insurance_number: "Номер поліса",
    insurance_covers_germany: "Покриває лікування в Німеччині",
  },
  legalSexOptions: {
    female: "Жіноча",
    male: "Чоловіча",
    diverse: "Інша",
    no_entry: "Без зазначення",
  },
  choose: "Виберіть",
  citizenshipsPlaceholder: "Додати країну",
  required: "Обов'язкове поле",
  saving: "Зберігається…",
  saved: "Збережено",
  notSaved: "Не збережено",
  invalidField: "Будь ласка, перевірте це поле.",
  minorNeedsGuardian:
    "Для осіб, молодших 18 років, заявку заповнюють батьки або законний представник. Ми повідомили вашу команду і зв'яжемося з вами.",
  next: "Далі",
  back: "Назад",
  inquiryConsentLabel: "Я погоджуюся, що мої дані обробляються для розгляду мого звернення.",
  privacyLink: "Інформація про захист даних",
  consentGivenAt: (dateTime) => `Згоду надано ${dateTime}`,
  consentWithdraw: "Відкликати згоду",
  consentWithdrawConfirm: "Відкликати згоду? Відкликання діє на майбутнє; ми отримаємо повідомлення.",
  documentsIntro:
    "Завантажте медичні документи, які у вас уже є (виписки, висновки, знімки, аналізи). PDF, JPG або PNG, до 25 МБ на файл.",
  healthConsentTitle: "Згода на обробку даних про здоров'я",
  healthConsentLabel: "Я даю згоду (обов'язково перед першим завантаженням).",
  uploadButton: "Вибрати файли",
  uploading: "Завантажується…",
  uploadNeedsConsent: "Щоб завантажити файли, спершу підтвердьте згоду вище.",
  fileTooLarge: (name) => `${name} більший за 25 МБ.`,
  noDocuments: "Документи ще не завантажено.",
  documentsOptional: "Заявку можна надіслати і без документів.",
  removeDocument: "Видалити",
  documentTakenOver: "Прийнято в роботу",
  maxDocuments: (count) => `Не більше ${count} файлів на заявку.`,
  sendTitle: "Надіслати вашому менеджеру",
  missingTitle: "Будь ласка, доповніть:",
  inquiryConsentMissing: "Будь ласка, надайте згоду на обробку даних на кроці «Згода й особисті дані».",
  sendButton: "Надіслати менеджеру",
  sending: "Надсилається…",
  sentTitle: "Дякуємо!",
  sentBody: (dateTime) => `Ваші дані надіслано ${dateTime}. Ми зв'яжемося з вами.`,
  nextTitle: "Що далі",
  nextSteps: [
    "Ваш менеджер перевірить дані та документи.",
    "Ми зв'яжемося з вами й обговоримо наступні кроки.",
    "До того від вас нічого не потрібно. Якщо щось змінилося або з'явилися нові документи, доповніть заявку й надішліть її ще раз.",
  ],
  sentSummaryTitle: "Що ми отримали",
  sendAgain: "Надіслати ще раз",
  editData: "Змінити дані",
  addDocuments: "Додати документи",
  loadFailed: "Не вдалося завантажити заявку.",
  retry: "Спробувати ще раз",
  noRequest: "Для вашого акаунта зараз немає відкритої заявки.",
  requestFor: "Заявка для",
  language: "Мова",
  sectionPerson: "Особисті дані",
  sectionAddress: "Адреса",
  sectionContact: "Контакт",
  sectionConsent: "Захист даних і згода",
  sectionUpload: "Ваші документи",
  stepOf: (index, total) => `Крок ${index} з ${total}`,
  sectionInsurance: "Страхування",
  notStated: "Не вказано",
  insuranceAnswerOptions: { yes: "Так", no: "Ні" },
  insuranceTypeOptions: { private: "Приватне", public: "Державне", foreign: "Іноземне" },
  insuranceCoverageOptions: { yes: "Так", no: "Ні", not_sure: "Не знаю" },
  changedAfterSend:
    "Після надсилання ви змінили заявку. Надішліть її ще раз, щоб менеджер отримав зміни.",
  sectionPayer: "Хто оплачує",
  payerQuestion: "Хто оплачує лікування?",
  payerOptions: { self: "Я сам(а)", third_party: "Інша людина або організація" },
  payerOptionsGuardian: {
    self: "Сам пацієнт",
    guardian: "Оплачую я (як один із батьків)",
    third_party: "Інша людина або організація",
  },
  payerIntro: "Вкажіть, будь ласка, хто оплачує лікування. За законом ми зобов'язані знати, хто платить.",
  payerInformHint: "Будь ласка, повідомте цій людині, що ви передали нам її дані для оформлення оплати.",
  payerPerson: "Платник",
  payerTypeQuestion: "Хто є платником?",
  payerTypeOptions: {
    person: "Приватна особа",
    company: "Компанія",
    organisation: "Організація",
    insurance: "Страхова компанія",
  },
  payerOrganisationName: {
    company: "Назва компанії",
    organisation: "Назва організації",
    insurance: "Назва страхової компанії",
  },
  payerRelationship: "Ким доводиться пацієнту",
  payerRelationshipOptions: {
    spouse: "Чоловік / дружина",
    parent: "Мати / батько",
    child: "Син / донька",
    sibling: "Брат / сестра",
    grandparent: "Бабуся / дідусь",
    relative: "Інший родич",
    employer: "Роботодавець",
    friend: "Друг / подруга",
    business_partner: "Діловий партнер",
    other: "Інше",
  },
  payerRelationshipOther: "Ким саме доводиться пацієнту",
  payerSeatStreet: "Місцезнаходження (вулиця і будинок)",
  payerSeatCountry: "Країна місцезнаходження",
  payerEmail: "E-mail",
  payerConsentLabel:
    "Я погоджуюся, що GMED звернеться до цієї людини або організації щодо оплати лікування і повідомить їй моє ім'я.",
  payerConsentLabelGuardian:
    "Я погоджуюся, що GMED звернеться до цієї людини або організації щодо оплати лікування і повідомить їй ім'я пацієнта.",
  payerConsentHint: "Без цієї згоди ми не маємо права звертатися до платника.",
  payerConsentShort: "Згода на контакт",
  payerCostEstimateConsentLabel:
    "Я погоджуюся, що GMED передасть платнику кошторис з очікуваними витратами – лише види послуг і суми, без діагнозів і назв лікування.",
  payerCostEstimateConsentHint:
    "Без цієї згоди ми не можемо надіслати платнику документи щодо оплати витрат на підпис.",
  payerCostEstimateConsentShort: "Згода на передачу кошторису",
  payerAnsweredByPayer: "Платник сам указав свої дані. Зміни лише через GMED.",
  ownAccountQuestion: "Ви дієте у власних економічних інтересах?",
  beneficialOwner: "В чиїх інтересах ви дієте? (ім'я, дата народження, місце народження, адреса)",
  ownAccountQuestionGuardian: "Пацієнт діє у власних економічних інтересах?",
  beneficialOwnerGuardian: "В чиїх інтересах діє пацієнт? (ім'я, дата народження, місце народження, адреса)",
  payerMessenger: "WhatsApp / месенджер",
  payerMessengerSameAsPhone: "як телефон",
  payerResidence: "Місце проживання",
  payerBlockPerson: "Дані платника",
  payerBlockContact: "Контакти",
  payerBlockConsent: "Згоди",
  followUpTitle: "Нам потрібні додаткові відомості",
  followUpIntro: "Будь ласка, доповніть наведені нижче відомості й потім надішліть їх. Усе зберігається автоматично.",
  followUpBlocks: {
    A: "Походження коштів",
    B: "Стосунки з платником",
    C: "Спосіб оплати",
    F: "Проживання й громадянство",
    G: "Хто діє за вас",
    H: "Відомості про державну посаду",
    I: "Документ, що посвідчує особу",
    J: "Відомості про зв'язки",
    K: "Особисті дані",
    L: "Питання за законом (протидія відмиванню грошей)",
  },
  followUpSubmit: "Надіслати відомості",
  followUpSending: "Надсилається…",
  followUpIncomplete: "Будь ласка, спершу доповніть відомості, яких бракує.",
  followUpAnsweredAt: (dateTime) => `Ваші додаткові відомості надіслано ${dateTime}. Ваші дані перевіряються.`,
  followUpOpen: "Будь ласка, доповніть ще деякі відомості.",
  followUpGo: "До додаткових відомостей",
  reviewNotice: "Дякуємо. Ваші дані перевіряються. Ми зв'яжемося з вами.",
  extraFields: {
    payer_funds_source: "Звідки кошти в платника? (наскільки вам відомо)",
    payer_funds_description: "Опишіть, будь ласка, походження коштів платника",
    funds_source: "Походження коштів",
    funds_description: "Опишіть, будь ласка, походження коштів",
    occupation: "Професія",
    sector: "Галузь / сфера",
    funds_proof: "Підтвердження походження коштів",
  },
  extraPayerStatesFunds: "Відомості про походження коштів і підтвердження платник надає за своїм власним посиланням.",
  extraOccupationElsewhere: "Професію ви вказуєте в розділі «Відомості про платника».",
  selfFundsProofHint: "Наприклад, виписка з рахунку або довідка про зарплату. PDF, JPG або PNG, до 25 МБ на файл.",
  relationshipProofTitle: "Підтвердження стосунків",
  relationshipProofHint: "Наприклад, свідоцтво про шлюб або про народження. PDF, JPG або PNG, до 25 МБ на файл.",
  noRelationshipProof: "Підтвердження ще не завантажено.",
  stayReasonOptions: { work: "Робота", study: "Навчання", family: "Сім'я", other: "Інше" },
  sanctionsLinkKindOptions: {
    family: "Родинний",
    business: "Діловий",
    ownership: "Участь / власність",
    other: "Інше",
  },
  billingExtrasFields: {
    via_third_party_kind: "Через кого проходить оплата?",
    expected_total_eur: "Очікувана загальна сума (EUR)",
  },
  viaThirdPartyKindOptions: { person: "Через іншу особу", psp: "Через платіжний сервіс" },
  expectedTotalHint: "Наскільки відомо, наприклад з кошторису.",
  identityRenewIntro: "Будь ласка, завантажте актуальне, добре читабельне фото або скан вашого документа.",
  identityIntro:
    "Будь ласка, завантажте фото або скан документа, що посвідчує особу (для ID-картки — обидва боки). Дані з документа вносить GMED.",
  sectionRequest: "Ваше звернення",
  requestReasonHint: "Коротко опишіть, із чим ми можемо вам допомогти.",
  payerLegalForm: "Правова форма",
  payerRegisterNumber: "Реєстраційний номер (якщо є)",
  payerContactName: "Контактна особа",
  payerEmailOrPhone: "E-mail або телефон",
  payerEmailOrPhoneHint: "Будь ласка, вкажіть принаймні адресу e-mail або номер телефону.",
  identificationFields: {
    salutation: "Звертання",
    former_names: "Прізвище при народженні (якщо інше)",
    birth_place: "Місце народження",
    birth_country: "Країна народження",
    habitual_residence_country: "Країна постійного перебування (якщо інша)",
    contact_channels: "Як ми можемо з вами зв'язатися?",
    pep_self: "Чи обіймаєте ви високу державну посаду або обіймали її протягом останніх 12 місяців?",
    pep_related:
      "Чи є хтось із найближчих членів вашої родини або близька вам людина політично значущою особою?",
    sanctions_links: "Чи є зв'язки з особами або компаніями, на які накладено санкції?",
    payment_background: "Чому ця особа або організація бере на себе витрати?",
    relationship_since: "Відколи існують стосунки?",
    residence_since: "Відколи ви живете в країні проживання?",
    other_residences: "Інші місця проживання за останні п'ять років",
    former_citizenships: "Попередні громадянства",
    stay_reason: "Причина перебування в країні проживання",
    stay_reason_details: "Опишіть, будь ласка",
    pep_office: "Посада або функція",
    pep_country: "Країна",
    pep_period: "Період",
    pep_relationship: "Ким вам доводиться людина з посадою (якщо не ви самі)",
    pep_wealth_origin: "Походження майна",
    sanctions_link_name: "Ім'я особи або назва компанії",
    sanctions_link_kind: "Вид зв'язку",
    sanctions_link_since_extent: "Відколи і в якому обсязі?",
    request_reason: "Причина звернення",
  },
  identificationFieldsGuardian: {
    pep_self: "Чи обіймає пацієнт високу державну посаду або обіймав її протягом останніх 12 місяців?",
    pep_related:
      "Чи є хтось із найближчих членів родини пацієнта або близька йому людина політично значущою особою?",
    residence_since: "Відколи пацієнт живе в країні проживання?",
  },
  legalTopics: {
    pep_self: "Державна посада",
    pep_related: "Політично значуща близька особа",
    sanctions_links: "Санкції",
  },
  yesNo: { yes: "Так", no: "Ні" },
  salutationOptions: { mr: "Пан", ms: "Пані", none: "Без зазначення" },
  contactChannelOptions: { email: "E-mail", phone: "Телефон", messenger: "Месенджер" },
  idDocumentTypeOptions: {
    passport: "Паспорт (закордонний)",
    id_card: "Посвідчення особи (ID-картка)",
    residence_permit: "Посвідка на проживання",
  },
  sectionIdentity: "Документ, що посвідчує особу",
  identityUploadButton: "Завантажити фото або скан документа",
  identityUploadHint: "PDF, JPG або PNG, до 25 МБ на файл.",
  identityUploadNeedsConsent: "Щоб завантажити, спершу надайте згоду на обробку даних на кроці «Згода й особисті дані».",
  identityNote:
    "Самої копії може бути недостатньо, якщо людина не присутня особисто. Ми зв'яжемося з вами щодо ідентифікації.",
  noIdentityDocuments: "Документ ще не завантажено.",
  identityFiles: "Фото або скан документа",
  idDocumentExpired: "Термін дії документа минув. Будь ласка, вкажіть дійсний документ.",
  sectionRepresentation: "Представництво",
  hasRepresentativeQuestion: "Чи діє хтось від вашого імені (представник, посередник, уповноважена особа)?",
  underGuardianshipQuestion: "Чи призначено вам опікуна за рішенням суду (rechtliche Betreuung)?",
  sectionLegalRepresentatives: "Законні представники",
  legalRepresentativesIntro: "За неповнолітніх діють законні представники.",
  custodySignatureNote: {
    joint: "Згода та підписи потрібні від обох батьків.",
    sole_parent: "Згоду та підпис дає той із батьків, хто має одноосібне право опіки.",
    guardian: "Згоду та підпис дає опікун або піклувальник.",
  },
  custodyQuestion: "Хто представляє дитину?",
  custodyOptions: {
    joint: "Обоє батьків разом",
    sole_parent: "Один із батьків (одноосібне право опіки)",
    guardian: "Опікун або піклувальник",
  },
  representativeCaptions: {
    rep1: "1-й представник",
    rep2: "2-й представник",
    agent: "Дані представника",
    guardian: "Опікун",
  },
  representativeYou: "ви",
  representativeOtherParent: "другий із батьків",
  representativeGuardianOfChild: "Опікун / піклувальник",
  representativeOnFile: (name) =>
    `У GMED зазначено ще одну людину з правом опіки: ${name}. Будь ласка, зв'яжіться з нами.`,
  representativeOnFileGuardian: (name) =>
    `У GMED зазначено ще одну людину, яка має право опіки: ${name}. Будь ласка, зв'яжіться з нами.`,
  copyChildAddress: "Взяти адресу дитини",
  representativeEmailIsLogin: "Ваша адреса для входу",
  representativeEmailIsTheirLogin: "Адреса для входу цієї людини",
  representativeInviteHint: "На цю адресу ми надішлемо запрошення до підписання.",
  representativeInformHint: "Будь ласка, повідомте цій людині, що ви вказуєте її дані.",
  representativeRemove: "Видалити",
  representativeRemoveConfirm: (who) =>
    `${who}: усі дані та завантажені файли цієї людини буде видалено. Продовжити?`,
  representativeGuardianIdentity: "Документ, що посвідчує особу опікуна",
  representativeAuthority: {
    power_of_attorney: "Підтвердження повноважень (наприклад, довіреність)",
    guardianship_certificate: "Рішення про призначення опікуна або посвідчення опікуна",
    appointment_certificate: "Документ про призначення опікуном",
    sole_custody: "Підтвердження одноосібного права опіки",
  },
  noAuthorityDocuments: "Підтвердження ще не завантажено.",
  representativeUploadNeedsPerson: "Щоб завантажити, спершу вкажіть прізвище цієї людини.",
  representativeInUse: "Цю людину не можна видалити тут. Будь ласка, зв'яжіться з нами.",
  representativeLimit: "У цій заявці більше не можна вказати жодної людини.",
  representativeEmailLocked: "Це адреса для входу, змінити її тут не можна.",
  representativeMinor: "Представник має бути повнолітнім (щонайменше 18 років).",
  representativeEmailDuplicate:
    "Цю адресу e-mail уже вказано для іншої людини. Для підпису кожному потрібна власна адреса.",
  sectionBilling: "Отримувач рахунку",
  sectionPaymentRoute: "Спосіб оплати",
  sectionBillingSummary: "Рахунок і оплата",
  billingFields: {
    invoice_to: "Куди надсилати рахунок?",
    invoice_name: "Ім'я або назва на рахунку",
    invoice_street: "Вулиця і будинок",
    invoice_zip: "Поштовий індекс",
    invoice_city: "Місто",
    invoice_country: "Країна",
    invoice_email: "E-mail для рахунків (необов'язково)",
    payment_method: "Як ви будете платити?",
    payment_method_details: "Опишіть, будь ласка",
    account_country: "Країна рахунку",
    account_holder: "Власник рахунку",
    bank_name: "Назва банку",
    via_third_party: "Чи здійснюється оплата через третю особу або платіжного провайдера?",
    via_third_party_details: "Опишіть, будь ласка (хто, який сервіс)",
  },
  invoiceToOptions: {
    self: "Мені",
    payer: "Платнику (особі або організації, яка платить)",
    other: "На іншу адресу",
  },
  invoiceToOptionsGuardian: {
    self: "Пацієнту (для неповнолітніх — законним представникам)",
    payer: "Платнику (особі або організації, яка платить)",
    other: "На іншу адресу",
  },
  invoiceToMeAsPayer: "Мені (я плачу)",
  invoiceEmailHint: "Якщо порожньо, ми використаємо вашу контактну адресу.",
  vatHint: "USt-IdNr. або податковий номер за потреби вносить GMED.",
  paymentMethodOptions: {
    bank_transfer: "Банківський переказ",
    card: "Картка",
    cash: "Готівка",
    crypto: "Криптовалюта",
    other: "Інше",
  },
  cashCryptoNote: "Оплату готівкою та криптовалютою GMED перевіряє окремо (закон про запобігання відмиванню коштів).",
  totalAmountHint: "Очікувану загальну суму вносить GMED.",
  paymentRouteByPayer:
    "Спосіб оплати вказує сам платник (особа або організація, яка платить); GMED звернеться до нього із цього приводу.",
  paymentRouteByPayerShort: "вказує платник",
  sectionLegal: "Запитання за законом (запобігання відмиванню коштів)",
  legalIntro:
    "Ці запитання вимагає німецький закон про запобігання відмиванню коштів. Будь ласка, дайте на кожне відповідь «так» або «ні».",
  legalShort: "Запитання за законом",
  summaryIntro: "Будь ласка, перевірте дані перед надсиланням.",
  summaryEmpty: "Ще нічого не вказано",
  declarationTitle: "Підтвердження",
  declarationLabel: "Я підтверджую, що мої дані повні й правдиві та що я повідомлю про зміни.",
  declarationRequired: "Будь ласка, підтвердьте свої дані перед надсиланням заявки.",
  declarationGivenAt: (dateTime) => `Підтверджено ${dateTime}`,
  payerQuestionnaireTitle: "Ваші дані як платника",
  payerQuestionnaireIntro: (section) =>
    `Ви оплачуєте лікування. Закон про протидію відмиванню грошей вимагає для цього деяких даних про вас як про платника. Ім'я, адресу та документ, що посвідчує особу, ви вказуєте в розділі «${section}».`,
  payerNoticeTitle: "Повідомлення про захист даних для платника",
  payerNotice:
    "Відповідальним за обробку є GMED. Ваші дані як платника ми отримуємо від вас і із запиту пацієнта. Ми обробляємо їх, щоб ідентифікувати вас відповідно до Закону Німеччини про протидію відмиванню грошей (§§ 10–12 GwG), узгодити оплату витрат і виставляти рахунки. Правова підстава — ст. 6 ч. 1 п. b і c DSGVO (GDPR). Ми зберігаємо дані п'ять років після завершення ділових відносин (§ 8 абз. 4 GwG). Ви маєте право на доступ до своїх даних, їх виправлення, видалення або обмеження обробки, право заперечити проти обробки, а також право подати скаргу до наглядового органу із захисту даних.",
  payerNoticeAck: "Я ознайомився(-лася) з інформацією про захист даних.",
  payerNoticeAckAt: (dateTime) => `Підтверджено ${dateTime}`,
  payerNoticeFirst: "Спочатку підтвердьте, будь ласка, повідомлення про захист даних. Після цього ви зможете вказати дані платника.",
  payerContactChannels: "Як ми можемо зв'язатися з вами як з платником?",
  payerQuestionnaireFields: {
    language: "Мова",
    occupation: "Професія / рід занять",
    funds_sources: "Походження коштів",
    funds_description: "Опис походження коштів",
  },
  payerLegalFields: {
    pep_self: "Чи обіймаєте ви високу державну посаду або обіймали її протягом останніх 12 місяців?",
    pep_self_details: "Посада, країна і період",
    pep_related:
      "Чи є хтось із найближчих членів вашої родини або близька вам людина політично значущою особою?",
    pep_related_details: "Ім'я людини, ким доводиться, посада і країна",
    high_risk_country:
      "Чи проживаєте ви або залучена особа в країні (або зареєстровані в ній), яку Європейська комісія відносить до третіх країн високого ризику?",
    high_risk_country_code: "Яка країна?",
    sanctions_links: "Чи є зв'язки з особами або компаніями, на які накладено санкції?",
    sanctions_links_details: "З ким є зв'язок і який саме?",
  },
  payerHighRiskTopic: "Країна високого ризику",
  fundsSourceOptions: {
    employment: "Заробітна плата / робота за наймом",
    business_income: "Доходи від підприємницької діяльності",
    savings: "Заощадження",
    asset_sale: "Продаж майна",
    inheritance_gift: "Спадщина / дарування",
    other: "Інше",
  },
  statedFundsSourceOptions: {
    income: "Дохід",
    savings: "Заощадження",
    asset_sale: "Продаж майна",
    inheritance_gift: "Спадщина / дарування",
    other: "Інше",
  },
  payerFundsProofTitle: "Підтвердження походження коштів",
  payerFundsProofRequired: "обов'язково",
  payerFundsProofOptional: "за бажанням",
  payerFundsProofRequiredNote: "Для цього платежу закон про протидію відмиванню грошей вимагає підтвердження походження коштів.",
  payerFundsProofHint: "Наприклад, виписка з рахунку, довідка про доходи, договір купівлі-продажу або свідоцтво про спадщину. PDF, JPG або PNG, до 25 МБ на файл.",
  payerFundsProofUpload: "Завантажити підтвердження",
  noPayerFundsProof: "Підтвердження ще не завантажено.",
  payerElsewhere: (section) => `Будь ласка, доповніть у розділі «${section}»:`,
  payerOwnMissingTitle: "Для надсилання ще бракує:",
  payerNoticeMissing: "Підтвердити повідомлення про захист даних",
  payerDeclarationLabel: "Я підтверджую, що мої дані як платника повні та правильні.",
  payerDeclarationRequired: "Будь ласка, підтвердьте свої дані перед надсиланням.",
  payerSubmitButton: "Надіслати дані платника",
  payerSubmittedAt: (dateTime) => `Ваші дані як платника надіслано ${dateTime}.`,
  payerSubmittedNote: "Якщо ви хочете щось змінити, зверніться, будь ласка, до GMED.",
  payerQuestionnaireLoadFailed: "Не вдалося завантажити ваші дані як платника.",
  payerQuestionnaireLocked: "Ваші дані як платника вже надіслано, змінити їх тут більше не можна.",
  payerSignatureSent: (date) =>
    `Документи на підпис: ${date ? `${date} ` : ""}ми надіслали вам чотири документи для кваліфікованого електронного підпису. Запрошення надійде електронною поштою від нашого партнера Skribble; там ви також підтвердите свою особу.`,
  payerSignatureSigned: (date) => `Дякуємо – підписані документи надійшли до GMED${date ? ` ${date}` : ""}.`,
};

const en: LeadRequestText = {
  title: "Your request",
  titleGuardian: "Request for your child",
  accountLabelGuardian: "Parent / legal representative",
  intro: "Please enter your personal details and upload your documents. Everything is saved automatically.",
  introGuardian:
    "Please enter your child's personal details and upload the documents. Everything is saved automatically.",
  deadline: (date) => `Please complete by ${date}.`,
  deadlineNote:
    "For data protection reasons, requests that are not taken further by then are deleted automatically after this date.",
  steps: {
    person: "Consent & person",
    contact: "Contact & residence",
    identity: "ID document",
    payer: "Who pays",
    billing: "Insurance & invoice",
    declarations: "Declarations",
    follow_up: "Additional information",
    documents: "Request & documents",
    send: "Review & send",
  },
  stepsLabel: "Steps of the request",
  stepMissingBadge: (count) => (count === 1 ? "1 item missing" : `${count} items missing`),
  stepComplete: "Complete",
  stepMissingTitle: "Still missing in this step:",
  fields: {
    first_name: "First name",
    middle_name: "Middle name",
    last_name: "Last name",
    date_of_birth: "Date of birth",
    legal_sex: "Sex as in your ID",
    citizenships: "Citizenship(s)",
    street_address: "Street and number",
    zip_code: "Postcode",
    city: "City",
    country: "Country of residence",
    phone: "Phone",
    primary_language: "Preferred language",
    has_insurance: "Do you have health insurance?",
    insurance_type: "Type of insurance",
    insurance_provider: "Insurer",
    insurance_number: "Policy number",
    insurance_covers_germany: "Covers treatment in Germany",
  },
  legalSexOptions: {
    female: "Female",
    male: "Male",
    diverse: "Diverse",
    no_entry: "Not specified",
  },
  choose: "Select",
  citizenshipsPlaceholder: "Add country",
  required: "Required",
  saving: "Saving…",
  saved: "Saved",
  notSaved: "Not saved",
  invalidField: "Please check this entry.",
  minorNeedsGuardian:
    "For persons under 18 the parents or the legal guardian fill in the request. We have informed your team and will get in touch.",
  next: "Next",
  back: "Back",
  inquiryConsentLabel: "I agree that my details are processed to handle my request.",
  privacyLink: "Privacy information",
  consentGivenAt: (dateTime) => `Agreed on ${dateTime}`,
  consentWithdraw: "Withdraw consent",
  consentWithdrawConfirm: "Withdraw your consent? The withdrawal applies to the future; we will be informed.",
  documentsIntro:
    "Upload medical documents you already have (doctors' letters, findings, images, lab results). PDF, JPG or PNG, up to 25 MB per file.",
  healthConsentTitle: "Consent to health data processing",
  healthConsentLabel: "I consent (required before the first upload).",
  uploadButton: "Choose files",
  uploading: "Uploading…",
  uploadNeedsConsent: "To upload files, first confirm the consent above.",
  fileTooLarge: (name) => `${name} is larger than 25 MB.`,
  noDocuments: "No documents uploaded yet.",
  documentsOptional: "You can also send the request without documents.",
  removeDocument: "Remove",
  documentTakenOver: "Taken over by us",
  maxDocuments: (count) => `At most ${count} files per request.`,
  sendTitle: "Send to your contact person",
  missingTitle: "Please add:",
  inquiryConsentMissing: "Please agree to the processing of your details in the step “Consent & person”.",
  sendButton: "Send to the manager",
  sending: "Sending…",
  sentTitle: "Thank you!",
  sentBody: (dateTime) => `Your details were sent on ${dateTime}. We will get in touch.`,
  nextTitle: "What happens next",
  nextSteps: [
    "Your contact person reviews your details and documents.",
    "We will get in touch and discuss the next steps.",
    "Until then there is nothing more to do. If something has changed or you have new documents, add them to your request and send it again.",
  ],
  sentSummaryTitle: "What we received",
  sendAgain: "Send again",
  editData: "Edit details",
  addDocuments: "Add documents",
  loadFailed: "The request could not be loaded.",
  retry: "Try again",
  noRequest: "There is no open request for your account at the moment.",
  requestFor: "Request for",
  language: "Language",
  sectionPerson: "Personal details",
  sectionAddress: "Address",
  sectionContact: "Contact",
  sectionConsent: "Privacy and consent",
  sectionUpload: "Your documents",
  stepOf: (index, total) => `Step ${index} of ${total}`,
  sectionInsurance: "Insurance",
  notStated: "Not specified",
  insuranceAnswerOptions: { yes: "Yes", no: "No" },
  insuranceTypeOptions: { private: "Private", public: "Statutory (public)", foreign: "Foreign" },
  insuranceCoverageOptions: { yes: "Yes", no: "No", not_sure: "Not sure" },
  changedAfterSend:
    "You changed your request after sending it. Send it again so that your contact person receives the changes.",
  sectionPayer: "Who pays",
  payerQuestion: "Who pays for the treatment?",
  payerOptions: { self: "I do", third_party: "Another person or organisation" },
  payerOptionsGuardian: {
    self: "The patient",
    guardian: "I pay (as a parent)",
    third_party: "Another person or organisation",
  },
  payerIntro: "Please tell us who pays for the treatment. We are required by law to know who pays.",
  payerInformHint: "Please let this person know that you gave us their details for the payment arrangements.",
  payerPerson: "Payer",
  payerTypeQuestion: "Who is the payer?",
  payerTypeOptions: {
    person: "Private person",
    company: "Company",
    organisation: "Organisation",
    insurance: "Insurer",
  },
  payerOrganisationName: {
    company: "Name of the company",
    organisation: "Name of the organisation",
    insurance: "Name of the insurer",
  },
  payerRelationship: "Relationship to the patient",
  payerRelationshipOptions: {
    spouse: "Spouse",
    parent: "Parent",
    child: "Child",
    sibling: "Brother / sister",
    grandparent: "Grandparent",
    relative: "Other relative",
    employer: "Employer",
    friend: "Friend",
    business_partner: "Business partner",
    other: "Other",
  },
  payerRelationshipOther: "How exactly related to the patient",
  payerSeatStreet: "Registered office (street and number)",
  payerSeatCountry: "Country of the registered office",
  payerEmail: "E-mail",
  payerConsentLabel:
    "I agree that GMED contacts this person or organisation about covering the costs and tells them my name.",
  payerConsentLabelGuardian:
    "I agree that GMED contacts this person or organisation about covering the costs and tells them the patient's name.",
  payerConsentHint: "Without this consent we may not approach the payer.",
  payerConsentShort: "Consent to contact",
  payerCostEstimateConsentLabel:
    "I agree that GMED sends the paying person the cost estimate with the expected costs – only the types of services and the amounts, without diagnoses or names of treatments.",
  payerCostEstimateConsentHint:
    "Without this consent we cannot send the paying person the documents on covering the costs for signature.",
  payerCostEstimateConsentShort: "Consent to pass on the cost estimate",
  payerAnsweredByPayer: "The paying person has given their details themselves. Changes only through GMED.",
  ownAccountQuestion: "Are you acting in your own economic interest?",
  beneficialOwner: "In whose interest are you acting? (name, date of birth, place of birth, address)",
  ownAccountQuestionGuardian: "Is the patient acting in their own economic interest?",
  beneficialOwnerGuardian: "In whose interest is the patient acting? (name, date of birth, place of birth, address)",
  payerMessenger: "WhatsApp / messenger",
  payerMessengerSameAsPhone: "same as phone",
  payerResidence: "Place of residence",
  payerBlockPerson: "Payer's details",
  payerBlockContact: "Contact",
  payerBlockConsent: "Consents",
  followUpTitle: "We need some additional information",
  followUpIntro: "Please complete the following details and then send them. Everything is saved automatically.",
  followUpBlocks: {
    A: "Source of funds",
    B: "Relationship to the paying person",
    C: "Payment route",
    F: "Residence and citizenship",
    G: "Who acts for you",
    H: "Details of the public office",
    I: "Identity document",
    J: "Details of the links",
    K: "Personal details",
    L: "Questions under the anti-money-laundering law",
  },
  followUpSubmit: "Send details",
  followUpSending: "Sending…",
  followUpIncomplete: "Please first complete the details that are still open.",
  followUpAnsweredAt: (dateTime) => `Your additional details were sent on ${dateTime}. Your details are being reviewed.`,
  followUpOpen: "Please complete a few more details.",
  followUpGo: "To the additional information",
  reviewNotice: "Thank you. Your details are being reviewed. We will get in touch with you.",
  extraFields: {
    payer_funds_source: "Where do the paying person's funds come from? (as far as you know)",
    payer_funds_description: "Please describe the origin of the paying person's funds",
    funds_source: "Source of funds",
    funds_description: "Please describe the source of the funds",
    occupation: "Occupation",
    sector: "Industry / sector",
    funds_proof: "Proofs of the source of funds",
  },
  extraPayerStatesFunds: "The paying person states the source of funds and provides the proofs through their own link.",
  extraOccupationElsewhere: "You state your occupation in the section “Details as the paying person”.",
  selfFundsProofHint: "For example a bank statement or a payslip. PDF, JPG or PNG, up to 25 MB per file.",
  relationshipProofTitle: "Proof of the relationship",
  relationshipProofHint: "For example a marriage or birth certificate. PDF, JPG or PNG, up to 25 MB per file.",
  noRelationshipProof: "No proof uploaded yet.",
  stayReasonOptions: { work: "Work", study: "Studies", family: "Family", other: "Other" },
  sanctionsLinkKindOptions: {
    family: "Family",
    business: "Business",
    ownership: "Shareholding / ownership",
    other: "Other",
  },
  billingExtrasFields: {
    via_third_party_kind: "Through whom is the payment made?",
    expected_total_eur: "Expected total amount (EUR)",
  },
  viaThirdPartyKindOptions: { person: "Through another person", psp: "Through a payment service provider" },
  expectedTotalHint: "As far as known, for example from the cost estimate.",
  identityRenewIntro: "Please upload a current, clearly readable photo or scan of your identity document.",
  identityIntro:
    "Please upload a photo or scan of your identity document (for an ID card both sides). GMED enters the details from the document.",
  sectionRequest: "Your request",
  requestReasonHint: "Briefly describe what we can help you with.",
  payerLegalForm: "Legal form",
  payerRegisterNumber: "Register number (if any)",
  payerContactName: "Contact person",
  payerEmailOrPhone: "E-mail or phone",
  payerEmailOrPhoneHint: "Please give at least an e-mail address or a phone number.",
  identificationFields: {
    salutation: "Title",
    former_names: "Name at birth (if different)",
    birth_place: "Place of birth",
    birth_country: "Country of birth",
    habitual_residence_country: "Country of habitual residence (if different)",
    contact_channels: "How may we contact you?",
    pep_self: "Do you hold a prominent public office, or have you held one in the last 12 months?",
    pep_related: "Is an immediate family member or a person close to you politically exposed?",
    sanctions_links: "Are there any links to persons or companies that are subject to sanctions?",
    payment_background: "Why does this person or organisation cover the costs?",
    relationship_since: "Since when has the relationship existed?",
    residence_since: "Since when have you lived in your country of residence?",
    other_residences: "Other residences in the last five years",
    former_citizenships: "Former citizenships",
    stay_reason: "Reason for living in the country of residence",
    stay_reason_details: "Please describe",
    pep_office: "Office or function",
    pep_country: "Country",
    pep_period: "Period",
    pep_relationship: "Relationship to the office holder (if not yourself)",
    pep_wealth_origin: "Origin of the wealth",
    sanctions_link_name: "Name of the person or company",
    sanctions_link_kind: "Kind of link",
    sanctions_link_since_extent: "Since when and to what extent?",
    request_reason: "Reason for your request",
  },
  identificationFieldsGuardian: {
    pep_self: "Does the patient hold a prominent public office, or have they held one in the last 12 months?",
    pep_related: "Is an immediate family member of the patient or a person close to the patient politically exposed?",
    residence_since: "Since when has the patient lived in the country of residence?",
  },
  legalTopics: {
    pep_self: "Public office",
    pep_related: "Politically exposed close person",
    sanctions_links: "Sanctions",
  },
  yesNo: { yes: "Yes", no: "No" },
  salutationOptions: { mr: "Mr", ms: "Ms", none: "Not specified" },
  contactChannelOptions: { email: "E-mail", phone: "Phone", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Passport", id_card: "Identity card", residence_permit: "Residence permit" },
  sectionIdentity: "Identity document",
  identityUploadButton: "Upload a photo or scan of the document",
  identityUploadHint: "PDF, JPG or PNG, up to 25 MB per file.",
  identityUploadNeedsConsent: "To upload, first agree to the processing of your details in the step “Consent & person”.",
  identityNote:
    "A copy alone may not be enough if the person is not present in person. We will get in touch about the identification.",
  noIdentityDocuments: "No identity document uploaded yet.",
  identityFiles: "Photo or scan of the document",
  idDocumentExpired: "The document has expired. Please enter a valid document.",
  sectionRepresentation: "Representation",
  hasRepresentativeQuestion: "Is somebody acting for you (representative, messenger, authorised person)?",
  underGuardianshipQuestion: "Are you under legal guardianship?",
  sectionLegalRepresentatives: "Legal representatives",
  legalRepresentativesIntro: "For minors the legal representatives act.",
  custodySignatureNote: {
    joint: "Consent and signatures are needed from both parents.",
    sole_parent: "Consent and signature are given by the parent with sole custody.",
    guardian: "Consent and signature are given by the guardian or custodian.",
  },
  custodyQuestion: "Who represents the child?",
  custodyOptions: {
    joint: "Both parents together",
    sole_parent: "One parent alone (sole custody)",
    guardian: "Guardian or custodian",
  },
  representativeCaptions: {
    rep1: "1st representative",
    rep2: "2nd representative",
    agent: "Representative's details",
    guardian: "Legal guardian",
  },
  representativeYou: "you",
  representativeOtherParent: "other parent",
  representativeGuardianOfChild: "Guardian / custodian",
  representativeOnFile: (name) => `GMED has another person with custody on file: ${name}. Please contact us.`,
  representativeOnFileGuardian: (name) =>
    `GMED has a further person with parental responsibility on file: ${name}. Please contact us.`,
  copyChildAddress: "Use the child's address",
  representativeEmailIsLogin: "Your sign-in address",
  representativeEmailIsTheirLogin: "This person's sign-in address",
  representativeInviteHint: "We send the invitation to sign to this address.",
  representativeInformHint: "Please let this person know that you are giving us their details.",
  representativeRemove: "Remove",
  representativeRemoveConfirm: (who) =>
    `${who}: all details and uploaded files of this person will be removed. Continue?`,
  representativeGuardianIdentity: "Identity document of the guardian",
  representativeAuthority: {
    power_of_attorney: "Proof of authority (e.g. power of attorney)",
    guardianship_certificate: "Certificate of appointment or guardian's ID card",
    appointment_certificate: "Certificate of appointment as guardian",
    sole_custody: "Proof of sole custody",
  },
  noAuthorityDocuments: "No proof uploaded yet.",
  representativeUploadNeedsPerson: "To upload, first enter this person's last name.",
  representativeInUse: "This person cannot be removed here. Please contact us.",
  representativeLimit: "No further person can be named for this request.",
  representativeEmailLocked: "This is a sign-in address and cannot be changed here.",
  representativeMinor: "The representative must be of full age (at least 18).",
  representativeEmailDuplicate:
    "This e-mail address is already given for another person. Each person needs an address of their own to sign.",
  sectionBilling: "Invoice recipient",
  sectionPaymentRoute: "Payment",
  sectionBillingSummary: "Invoice and payment",
  billingFields: {
    invoice_to: "Where should the invoice go?",
    invoice_name: "Name on the invoice",
    invoice_street: "Street and number",
    invoice_zip: "Postcode",
    invoice_city: "City",
    invoice_country: "Country",
    invoice_email: "E-mail for invoices (optional)",
    payment_method: "How will you pay?",
    payment_method_details: "Please describe",
    account_country: "Country of the account",
    account_holder: "Account holder",
    bank_name: "Name of the bank",
    via_third_party: "Is the payment made through a third person or a payment service provider?",
    via_third_party_details: "Please describe (who, which service)",
  },
  invoiceToOptions: {
    self: "To me",
    payer: "To the paying person / organisation",
    other: "To another address",
  },
  invoiceToOptionsGuardian: {
    self: "To the patient (for minors: to the legal representatives)",
    payer: "To the paying person / organisation",
    other: "To another address",
  },
  invoiceToMeAsPayer: "To me (I pay)",
  invoiceEmailHint: "If empty, we use your contact address.",
  vatHint: "GMED enters a VAT ID or tax number if needed.",
  paymentMethodOptions: {
    bank_transfer: "Bank transfer",
    card: "Card",
    cash: "Cash",
    crypto: "Cryptocurrency",
    other: "Other",
  },
  cashCryptoNote: "GMED checks cash payments and payments in cryptocurrency separately (Money Laundering Act).",
  totalAmountHint: "GMED enters the expected total amount.",
  paymentRouteByPayer: "The paying person / organisation states the payment route themselves; GMED will contact them about it.",
  paymentRouteByPayerShort: "stated by the paying person",
  sectionLegal: "Legal questions (anti-money laundering)",
  legalIntro: "German anti-money laundering law requires these questions. Please answer each with yes or no.",
  legalShort: "Legal questions",
  summaryIntro: "Please check your details before you send them.",
  summaryEmpty: "Nothing entered yet",
  declarationTitle: "Confirmation",
  declarationLabel: "I confirm that my details are complete and true and that I will report any changes.",
  declarationRequired: "Please confirm your details before you send the request.",
  declarationGivenAt: (dateTime) => `Confirmed on ${dateTime}`,
  payerQuestionnaireTitle: "Your details as the paying person",
  payerQuestionnaireIntro: (section) =>
    `You pay for the treatment. German anti-money laundering law requires some details from you as the paying person. You enter your name, address and identity document in the section "${section}".`,
  payerNoticeTitle: "Privacy notice for the paying person",
  payerNotice:
    "GMED is the controller. We receive your details as the paying person from you and from the patient's request. We process them to identify you under the German Anti-Money Laundering Act (sections 10–12 GwG), to arrange the cost coverage and to issue invoices. The legal basis is Art. 6(1)(b) and (c) GDPR. We keep the details for five years after the end of the business relationship (section 8(4) GwG). You have the right of access, rectification, erasure, restriction of processing and objection, and the right to lodge a complaint with a data protection supervisory authority.",
  payerNoticeAck: "I have read the privacy information.",
  payerNoticeAckAt: (dateTime) => `Confirmed on ${dateTime}`,
  payerNoticeFirst: "Please confirm the privacy notice first. Then you can enter your details as the paying person.",
  payerContactChannels: "How may we contact you as the paying person?",
  payerQuestionnaireFields: {
    language: "Language",
    occupation: "Occupation",
    funds_sources: "Source of funds",
    funds_description: "Description of the source of funds",
  },
  payerLegalFields: {
    pep_self: "Do you hold a prominent public office, or have you held one in the last 12 months?",
    pep_self_details: "Office, country and period",
    pep_related: "Is an immediate family member or a person close to you politically exposed?",
    pep_related_details: "Name of the person, relationship, office and country",
    high_risk_country:
      "Do you or a person involved live or have a registered office in a country that the EU Commission lists as a high-risk third country?",
    high_risk_country_code: "Which country?",
    sanctions_links: "Are there any links to persons or companies that are subject to sanctions?",
    sanctions_links_details: "Who is the link to, and what kind of link is it?",
  },
  payerHighRiskTopic: "High-risk country",
  fundsSourceOptions: {
    employment: "Salary / employment",
    business_income: "Business or self-employed income",
    savings: "Savings",
    asset_sale: "Sale of assets",
    inheritance_gift: "Inheritance / gift",
    other: "Other",
  },
  statedFundsSourceOptions: {
    income: "Income",
    savings: "Savings",
    asset_sale: "Sale of assets",
    inheritance_gift: "Inheritance / gift",
    other: "Other",
  },
  payerFundsProofTitle: "Proof of the source of funds",
  payerFundsProofRequired: "required",
  payerFundsProofOptional: "optional",
  payerFundsProofRequiredNote: "For this payment German anti-money laundering law requires a proof of the source of funds.",
  payerFundsProofHint: "For example a bank statement, a payslip, a sales contract or a certificate of inheritance. PDF, JPG or PNG, up to 25 MB per file.",
  payerFundsProofUpload: "Upload proof",
  noPayerFundsProof: "No proof uploaded yet.",
  payerElsewhere: (section) => `Please add in the section "${section}":`,
  payerOwnMissingTitle: "Still missing before sending:",
  payerNoticeMissing: "Confirm the privacy notice",
  payerDeclarationLabel: "I confirm that my details as the paying person are complete and correct.",
  payerDeclarationRequired: "Please confirm your details before you send them.",
  payerSubmitButton: "Send my details as payer",
  payerSubmittedAt: (dateTime) => `Your details as the paying person were sent on ${dateTime}.`,
  payerSubmittedNote: "If you want to change something, please contact GMED.",
  payerQuestionnaireLoadFailed: "Your details as the paying person could not be loaded.",
  payerQuestionnaireLocked: "Your details as the paying person have been sent and can no longer be changed here.",
  payerSignatureSent: (date) =>
    `Documents for signature: ${date ? `On ${date} we` : "We"} sent you four documents to sign with a qualified electronic signature. The invitation comes by e-mail from our partner Skribble; there you also confirm your identity.`,
  payerSignatureSigned: (date) => `Thank you – GMED received the signed documents${date ? ` on ${date}` : ""}.`,
};

/** Languages of the lead cabinet: the portal's DE/RU plus UA and EN. */
export type LeadCabinetLang = "de" | "en" | "uk" | "ru";

export const LEAD_CABINET_LANGS: readonly { value: LeadCabinetLang; label: string; name: string }[] = [
  { value: "de", label: "DE", name: "Deutsch" },
  { value: "en", label: "EN", name: "English" },
  { value: "uk", label: "UA", name: "Українська" },
  { value: "ru", label: "RU", name: "Русский" },
];

/** A stored or preferred language as a cabinet language, if it is one. */
export function asLeadCabinetLang(value: string | null | undefined): LeadCabinetLang | null {
  const code = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "ua") return "uk";
  return code === "de" || code === "en" || code === "uk" || code === "ru" ? code : null;
}

/**
 * The language the cabinet shows. UA and EN exist only here, so they stay
 * until the person picks another one. DE and RU are the portal's languages:
 * the cabinet then follows the portal, so its language button in the top bar
 * and the switch above the title never disagree. Without a choice the
 * language of the request applies if it is UA or EN; a DE/RU request language
 * is taken over into the portal once, for an account without a language of
 * its own (see `LeadRequestPage`).
 */
export function resolveLeadCabinetLang(
  chosen: LeadCabinetLang | null,
  requestLang: LeadCabinetLang | null,
  portalLang: Lang,
): LeadCabinetLang {
  if (chosen === "en" || chosen === "uk") return chosen;
  if (chosen) return portalLang;
  return requestLang === "en" || requestLang === "uk" ? requestLang : portalLang;
}

export function leadRequestText(lang: Lang | LeadCabinetLang | string): LeadRequestText {
  switch (asLeadCabinetLang(lang)) {
    case "de":
      return de;
    case "en":
      return en;
    case "uk":
      return uk;
    default:
      return ru;
  }
}
