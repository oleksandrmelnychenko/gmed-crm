import type { Lang } from "@/lib/i18n";

import type { Custody, InvoiceTo, PaymentMethod, PaymentRouteBy, PayerType, RepresentativeSlot } from "./lead-request-api";
import { BILLING_SUBMIT_FIELDS, INVOICE_FIELDS, type BillingField } from "./lead-request-billing-model";
import {
  organisationPayerType,
  type ContactChannel,
  type IdentificationField,
  type LegalQuestion,
  type OrganisationPayerType,
  type PayerField,
  type PersonalField,
  type RelationshipKind,
  type SubmitField,
} from "./lead-request-model";
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
  intro: string;
  introGuardian: string;
  deadline: (date: string) => string;
  deadlineNote: string;
  stepData: string;
  stepDocuments: string;
  stepSend: string;
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
  /** Own economic interest (GwG), part of "who pays". */
  ownAccountQuestion: string;
  beneficialOwner: string;
  /** The same two when a parent fills in the request of a child. */
  ownAccountQuestionGuardian: string;
  beneficialOwnerGuardian: string;
  /** The statements for the GwG identification (owner spec 2026-10-05). */
  identificationFields: Record<IdentificationField, string>;
  /** Questions that say "you", for a parent who fills in the request of a child. */
  identificationFieldsGuardian: Record<"pep_self" | "pep_related" | "high_risk_country", string>;
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
  custodyQuestion: string;
  custodyOptions: Record<Custody, string>;
  /** A person of the block: the heading of the form, and the prefix in the list of what is still missing. */
  representativeCaptions: Record<RepresentativeSlot, string>;
  /** Added to the caption: the person who fills in the form, and the other parent. */
  representativeYou: string;
  representativeOtherParent: string;
  /** A person with custody on file at GMED whom the form does not ask for. */
  representativeOnFile: (name: string) => string;
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
};

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
    // The name passed on is the patient's: a parent reads it so.
    case "payer_contact_consent":
      return guardian ? text.payerConsentLabelGuardian : text.payerConsentLabel;
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
 * the second representative of a minor is the other parent.
 */
export function representativeHeading(text: LeadRequestText, slot: RepresentativeSlot, mine = false): string {
  const caption = text.representativeCaptions[slot];
  if (mine) return `${caption} – ${text.representativeYou}`;
  return slot === "rep2" ? `${caption} – ${text.representativeOtherParent}` : caption;
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
  pep_self_details: "pep_self",
  pep_related: "pep_related",
  pep_related_details: "pep_related",
  high_risk_country: "high_risk_country",
  high_risk_country_code: "high_risk_country",
  sanctions_links: "sanctions_links",
  sanctions_links_details: "sanctions_links",
};

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
  if (field === "payer_relationship") return `${text.payerPerson}: ${text.payerRelationship} – ${text.payerRelationshipOther}`;
  if (field.startsWith("payer_")) {
    return `${text.payerPerson}: ${payerFieldLabel(text, field as PayerField, guardian, payerType)}`;
  }
  if (field === "payment_background") return `${text.payerPerson}: ${text.identificationFields.payment_background}`;
  if (field === "id_document_upload") return `${text.sectionIdentity}: ${text.identityFiles}`;
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
  const topic = LEGAL_TOPIC_OF[field];
  if (topic) {
    // A missing answer names the question; missing details name what a "yes" asks for.
    const label = field === topic ? text.legalTopics[topic] : `${text.legalTopics[topic]} – ${text.identificationFields[field as IdentificationField]}`;
    return `${text.legalShort}: ${label}`;
  }
  const label = text.identificationFields[field as IdentificationField];
  return field.startsWith("id_") ? `${text.sectionIdentity}: ${label}` : label;
}

const de: LeadRequestText = {
  title: "Ihre Anfrage",
  titleGuardian: "Anfrage für Ihr Kind",
  intro: "Bitte tragen Sie Ihre persönlichen Daten ein und laden Sie Ihre Unterlagen hoch. Alles wird automatisch gespeichert.",
  introGuardian:
    "Bitte tragen Sie die persönlichen Daten Ihres Kindes ein und laden Sie die Unterlagen hoch. Alles wird automatisch gespeichert.",
  deadline: (date) => `Bitte bis ${date} ausfüllen.`,
  deadlineNote:
    "Aus Datenschutzgründen löschen wir Anfragen, die bis dahin nicht weiterbearbeitet werden, nach diesem Datum automatisch.",
  stepData: "Daten",
  stepDocuments: "Unterlagen",
  stepSend: "Senden",
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
    "Laden Sie ärztliche Unterlagen hoch, die Sie bereits haben (Arztbriefe, Befunde, Bilder, Laborwerte). PDF, JPG oder PNG, bis 25 MB pro Datei. Dieser Schritt ist freiwillig.",
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
  inquiryConsentMissing: "Bitte stimmen Sie unter „Daten“ der Verarbeitung Ihrer Angaben zu.",
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
    relative: "Sonstige/r Verwandte/r",
    employer: "Arbeitgeber",
    friend: "Freund/in",
    business_partner: "Geschäftspartner/in",
    other: "Sonstige",
  },
  payerRelationshipOther: "Bitte angeben",
  payerSeatStreet: "Sitz (Straße und Hausnummer)",
  payerSeatCountry: "Land des Sitzes",
  payerEmail: "E-Mail",
  payerConsentLabel:
    "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr meinen Namen mitteilt.",
  payerConsentLabelGuardian:
    "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr den Namen der Patientin / des Patienten mitteilt.",
  payerConsentHint: "Ohne dieses Einverständnis dürfen wir den Zahler nicht ansprechen.",
  payerConsentShort: "Einverständnis zur Kontaktaufnahme",
  ownAccountQuestion: "Handeln Sie im eigenen wirtschaftlichen Interesse?",
  beneficialOwner: "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  ownAccountQuestionGuardian: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?",
  beneficialOwnerGuardian:
    "In wessen Interesse handelt die Patientin / der Patient? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  identificationFields: {
    salutation: "Anrede",
    former_names: "Frühere Namen (z. B. Geburtsname)",
    birth_place: "Geburtsort",
    birth_country: "Geburtsland",
    habitual_residence_country: "Land des gewöhnlichen Aufenthalts (falls abweichend)",
    contact_channels: "Wie dürfen wir Sie kontaktieren?",
    id_document_type: "Art des Dokuments",
    id_document_number: "Dokumentnummer",
    id_issuing_authority: "Ausstellende Behörde",
    id_issuing_country: "Ausstellungsland",
    id_issued_on: "Ausgestellt am",
    id_valid_until: "Gültig bis",
    payment_background: "Warum zahlt diese Person?",
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
  identificationFieldsGuardian: {
    pep_self:
      "Übt die Patientin / der Patient ein hochrangiges öffentliches Amt aus oder hat sie / er es in den letzten 12 Monaten ausgeübt?",
    pep_related:
      "Ist ein unmittelbares Familienmitglied der Patientin / des Patienten oder eine ihr / ihm nahestehende Person politisch exponiert?",
    high_risk_country:
      "Hat die Patientin / der Patient oder eine beteiligte Person Wohnsitz oder Sitz in einem Land, das die EU-Kommission als Drittstaat mit hohem Risiko führt?",
  },
  legalTopics: {
    pep_self: "Öffentliches Amt",
    pep_related: "Politisch exponierte nahestehende Person",
    high_risk_country: "Land mit hohem Risiko",
    sanctions_links: "Sanktionen",
  },
  yesNo: { yes: "Ja", no: "Nein" },
  salutationOptions: { mr: "Herr", ms: "Frau", none: "Keine Angabe" },
  contactChannelOptions: { email: "E-Mail", phone: "Telefon", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Reisepass", id_card: "Personalausweis", residence_permit: "Aufenthaltstitel" },
  sectionIdentity: "Ausweisdokument",
  identityUploadButton: "Foto oder Scan des Ausweises hochladen",
  identityUploadHint: "PDF, JPG oder PNG, bis 25 MB pro Datei.",
  identityUploadNeedsConsent: "Zum Hochladen bitte zuerst oben der Verarbeitung Ihrer Angaben zustimmen.",
  identityNote:
    "Eine Kopie allein reicht möglicherweise nicht aus, wenn die Person nicht persönlich anwesend ist. Wir melden uns bei Ihnen wegen der Identifizierung.",
  noIdentityDocuments: "Noch kein Ausweis hochgeladen.",
  identityFiles: "Foto oder Scan des Ausweises",
  idDocumentExpired: "Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.",
  sectionRepresentation: "Vertretung",
  hasRepresentativeQuestion: "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?",
  underGuardianshipQuestion: "Stehen Sie unter rechtlicher Betreuung?",
  sectionLegalRepresentatives: "Gesetzliche Vertreter",
  legalRepresentativesIntro:
    "Für Minderjährige handeln die gesetzlichen Vertreter. Einwilligung und Unterschriften werden von beiden Elternteilen benötigt.",
  custodyQuestion: "Wer vertritt das Kind?",
  custodyOptions: {
    joint: "Beide Eltern gemeinsam",
    sole_parent: "Ein Elternteil allein (alleiniges Sorgerecht)",
    guardian: "Vormund oder Pfleger",
  },
  representativeCaptions: {
    rep1: "1. Vertreter/in",
    rep2: "2. Vertreter/in",
    agent: "Vertretende Person",
    guardian: "Betreuer/in",
  },
  representativeYou: "Sie",
  representativeOtherParent: "anderer Elternteil",
  representativeOnFile: (name) =>
    `Bei GMED ist eine weitere sorgeberechtigte Person hinterlegt: ${name}. Bitte sprechen Sie uns an.`,
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
};

const ru: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашего ребёнка",
  intro: "Пожалуйста, заполните свои личные данные и загрузите документы. Всё сохраняется автоматически.",
  introGuardian:
    "Пожалуйста, заполните личные данные ребёнка и загрузите документы. Всё сохраняется автоматически.",
  deadline: (date) => `Пожалуйста, заполните до ${date}.`,
  deadlineNote:
    "Из соображений защиты данных заявки, работа по которым к этой дате не продолжена, после неё удаляются автоматически.",
  stepData: "Данные",
  stepDocuments: "Документы",
  stepSend: "Отправка",
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
    "Загрузите медицинские документы, которые у вас уже есть (выписки, заключения, снимки, анализы). PDF, JPG или PNG, до 25 МБ на файл. Этот шаг необязателен.",
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
  inquiryConsentMissing: "Пожалуйста, дайте согласие на обработку данных в разделе «Данные».",
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
    relative: "Другой родственник",
    employer: "Работодатель",
    friend: "Друг / подруга",
    business_partner: "Деловой партнёр",
    other: "Другое",
  },
  payerRelationshipOther: "Укажите, пожалуйста",
  payerSeatStreet: "Местонахождение (улица и дом)",
  payerSeatCountry: "Страна местонахождения",
  payerEmail: "E-mail",
  payerConsentLabel:
    "Я согласен(на), что GMED свяжется с этим человеком или организацией по вопросу оплаты лечения и сообщит им моё имя.",
  payerConsentLabelGuardian:
    "Я согласен(на), что GMED свяжется с этим человеком или организацией по вопросу оплаты лечения и сообщит им имя пациента.",
  payerConsentHint: "Без этого согласия мы не вправе обращаться к плательщику.",
  payerConsentShort: "Согласие на контакт",
  ownAccountQuestion: "Вы действуете в собственных экономических интересах?",
  beneficialOwner: "В чьих интересах вы действуете? (имя, дата рождения, место рождения, адрес)",
  ownAccountQuestionGuardian: "Пациент действует в собственных экономических интересах?",
  beneficialOwnerGuardian: "В чьих интересах действует пациент? (имя, дата рождения, место рождения, адрес)",
  identificationFields: {
    salutation: "Обращение",
    former_names: "Прежние имена и фамилии (например, фамилия при рождении)",
    birth_place: "Место рождения",
    birth_country: "Страна рождения",
    habitual_residence_country: "Страна постоянного пребывания (если другая)",
    contact_channels: "Как мы можем с вами связаться?",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Кем выдан",
    id_issuing_country: "Страна выдачи",
    id_issued_on: "Дата выдачи",
    id_valid_until: "Действителен до",
    payment_background: "Почему платит этот человек?",
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
  identificationFieldsGuardian: {
    pep_self: "Занимает ли пациент высокую государственную должность или занимал её в последние 12 месяцев?",
    pep_related:
      "Является ли кто-то из ближайших членов семьи пациента или близкий ему человек политически значимым лицом?",
    high_risk_country:
      "Проживает ли пациент или участвующее лицо в стране (или зарегистрированы в ней), которую Европейская комиссия относит к третьим странам высокого риска?",
  },
  legalTopics: {
    pep_self: "Государственная должность",
    pep_related: "Политически значимое близкое лицо",
    high_risk_country: "Страна высокого риска",
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
  identityUploadNeedsConsent: "Чтобы загрузить, сначала дайте вверху согласие на обработку данных.",
  identityNote:
    "Одной копии может быть недостаточно, если человек не присутствует лично. Мы свяжемся с вами по поводу идентификации.",
  noIdentityDocuments: "Документ ещё не загружен.",
  identityFiles: "Фото или скан документа",
  idDocumentExpired: "Срок действия документа истёк. Пожалуйста, укажите действующий документ.",
  sectionRepresentation: "Представительство",
  hasRepresentativeQuestion: "Действует ли кто-то от вашего имени (представитель, посредник, уполномоченное лицо)?",
  underGuardianshipQuestion: "Назначен ли вам опекун по решению суда (rechtliche Betreuung)?",
  sectionLegalRepresentatives: "Законные представители",
  legalRepresentativesIntro:
    "За несовершеннолетних действуют законные представители. Согласие и подписи нужны от обоих родителей.",
  custodyQuestion: "Кто представляет ребёнка?",
  custodyOptions: {
    joint: "Оба родителя вместе",
    sole_parent: "Один из родителей (единоличное право опеки)",
    guardian: "Опекун или попечитель",
  },
  representativeCaptions: {
    rep1: "1-й представитель",
    rep2: "2-й представитель",
    agent: "Представитель",
    guardian: "Опекун",
  },
  representativeYou: "вы",
  representativeOtherParent: "второй родитель",
  representativeOnFile: (name) =>
    `В GMED указан ещё один человек с правом опеки: ${name}. Пожалуйста, свяжитесь с нами.`,
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
};

const uk: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашої дитини",
  intro: "Будь ласка, заповніть свої особисті дані та завантажте документи. Усе зберігається автоматично.",
  introGuardian:
    "Будь ласка, заповніть особисті дані дитини та завантажте документи. Усе зберігається автоматично.",
  deadline: (date) => `Будь ласка, заповніть до ${date}.`,
  deadlineNote:
    "З міркувань захисту даних заявки, робота над якими до цієї дати не продовжена, після неї видаляються автоматично.",
  stepData: "Дані",
  stepDocuments: "Документи",
  stepSend: "Надсилання",
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
    "Завантажте медичні документи, які у вас уже є (виписки, висновки, знімки, аналізи). PDF, JPG або PNG, до 25 МБ на файл. Цей крок необов'язковий.",
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
  inquiryConsentMissing: "Будь ласка, надайте згоду на обробку даних у розділі «Дані».",
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
    relative: "Інший родич",
    employer: "Роботодавець",
    friend: "Друг / подруга",
    business_partner: "Діловий партнер",
    other: "Інше",
  },
  payerRelationshipOther: "Вкажіть, будь ласка",
  payerSeatStreet: "Місцезнаходження (вулиця і будинок)",
  payerSeatCountry: "Країна місцезнаходження",
  payerEmail: "E-mail",
  payerConsentLabel:
    "Я погоджуюся, що GMED звернеться до цієї людини або організації щодо оплати лікування і повідомить їй моє ім'я.",
  payerConsentLabelGuardian:
    "Я погоджуюся, що GMED звернеться до цієї людини або організації щодо оплати лікування і повідомить їй ім'я пацієнта.",
  payerConsentHint: "Без цієї згоди ми не маємо права звертатися до платника.",
  payerConsentShort: "Згода на контакт",
  ownAccountQuestion: "Ви дієте у власних економічних інтересах?",
  beneficialOwner: "В чиїх інтересах ви дієте? (ім'я, дата народження, місце народження, адреса)",
  ownAccountQuestionGuardian: "Пацієнт діє у власних економічних інтересах?",
  beneficialOwnerGuardian: "В чиїх інтересах діє пацієнт? (ім'я, дата народження, місце народження, адреса)",
  identificationFields: {
    salutation: "Звертання",
    former_names: "Попередні імена та прізвища (наприклад, прізвище при народженні)",
    birth_place: "Місце народження",
    birth_country: "Країна народження",
    habitual_residence_country: "Країна постійного перебування (якщо інша)",
    contact_channels: "Як ми можемо з вами зв'язатися?",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Ким виданий",
    id_issuing_country: "Країна видачі",
    id_issued_on: "Дата видачі",
    id_valid_until: "Дійсний до",
    payment_background: "Чому платить ця людина?",
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
  identificationFieldsGuardian: {
    pep_self: "Чи обіймає пацієнт високу державну посаду або обіймав її протягом останніх 12 місяців?",
    pep_related:
      "Чи є хтось із найближчих членів родини пацієнта або близька йому людина політично значущою особою?",
    high_risk_country:
      "Чи проживає пацієнт або залучена особа в країні (або зареєстровані в ній), яку Європейська комісія відносить до третіх країн високого ризику?",
  },
  legalTopics: {
    pep_self: "Державна посада",
    pep_related: "Політично значуща близька особа",
    high_risk_country: "Країна високого ризику",
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
  identityUploadNeedsConsent: "Щоб завантажити, спершу надайте вгорі згоду на обробку даних.",
  identityNote:
    "Самої копії може бути недостатньо, якщо людина не присутня особисто. Ми зв'яжемося з вами щодо ідентифікації.",
  noIdentityDocuments: "Документ ще не завантажено.",
  identityFiles: "Фото або скан документа",
  idDocumentExpired: "Термін дії документа минув. Будь ласка, вкажіть дійсний документ.",
  sectionRepresentation: "Представництво",
  hasRepresentativeQuestion: "Чи діє хтось від вашого імені (представник, посередник, уповноважена особа)?",
  underGuardianshipQuestion: "Чи призначено вам опікуна за рішенням суду (rechtliche Betreuung)?",
  sectionLegalRepresentatives: "Законні представники",
  legalRepresentativesIntro:
    "За неповнолітніх діють законні представники. Згода та підписи потрібні від обох батьків.",
  custodyQuestion: "Хто представляє дитину?",
  custodyOptions: {
    joint: "Обоє батьків разом",
    sole_parent: "Один із батьків (одноосібне право опіки)",
    guardian: "Опікун або піклувальник",
  },
  representativeCaptions: {
    rep1: "1-й представник",
    rep2: "2-й представник",
    agent: "Представник",
    guardian: "Опікун",
  },
  representativeYou: "ви",
  representativeOtherParent: "другий із батьків",
  representativeOnFile: (name) =>
    `У GMED зазначено ще одну людину з правом опіки: ${name}. Будь ласка, зв'яжіться з нами.`,
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
};

const en: LeadRequestText = {
  title: "Your request",
  titleGuardian: "Request for your child",
  intro: "Please enter your personal details and upload your documents. Everything is saved automatically.",
  introGuardian:
    "Please enter your child's personal details and upload the documents. Everything is saved automatically.",
  deadline: (date) => `Please complete by ${date}.`,
  deadlineNote:
    "For data protection reasons, requests that are not taken further by then are deleted automatically after this date.",
  stepData: "Details",
  stepDocuments: "Documents",
  stepSend: "Send",
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
    "Upload medical documents you already have (doctors' letters, findings, images, lab results). PDF, JPG or PNG, up to 25 MB per file. This step is optional.",
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
  inquiryConsentMissing: "Please agree to the processing of your details under \"Details\".",
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
    relative: "Other relative",
    employer: "Employer",
    friend: "Friend",
    business_partner: "Business partner",
    other: "Other",
  },
  payerRelationshipOther: "Please specify",
  payerSeatStreet: "Registered office (street and number)",
  payerSeatCountry: "Country of the registered office",
  payerEmail: "E-mail",
  payerConsentLabel:
    "I agree that GMED contacts this person or organisation about covering the costs and tells them my name.",
  payerConsentLabelGuardian:
    "I agree that GMED contacts this person or organisation about covering the costs and tells them the patient's name.",
  payerConsentHint: "Without this consent we may not approach the payer.",
  payerConsentShort: "Consent to contact",
  ownAccountQuestion: "Are you acting in your own economic interest?",
  beneficialOwner: "In whose interest are you acting? (name, date of birth, place of birth, address)",
  ownAccountQuestionGuardian: "Is the patient acting in their own economic interest?",
  beneficialOwnerGuardian: "In whose interest is the patient acting? (name, date of birth, place of birth, address)",
  identificationFields: {
    salutation: "Title",
    former_names: "Former names (e.g. name at birth)",
    birth_place: "Place of birth",
    birth_country: "Country of birth",
    habitual_residence_country: "Country of habitual residence (if different)",
    contact_channels: "How may we contact you?",
    id_document_type: "Type of document",
    id_document_number: "Document number",
    id_issuing_authority: "Issuing authority",
    id_issuing_country: "Country of issue",
    id_issued_on: "Date of issue",
    id_valid_until: "Valid until",
    payment_background: "Why is this person paying?",
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
  identificationFieldsGuardian: {
    pep_self: "Does the patient hold a prominent public office, or have they held one in the last 12 months?",
    pep_related: "Is an immediate family member of the patient or a person close to the patient politically exposed?",
    high_risk_country:
      "Does the patient or a person involved live or have a registered office in a country that the EU Commission lists as a high-risk third country?",
  },
  legalTopics: {
    pep_self: "Public office",
    pep_related: "Politically exposed close person",
    high_risk_country: "High-risk country",
    sanctions_links: "Sanctions",
  },
  yesNo: { yes: "Yes", no: "No" },
  salutationOptions: { mr: "Mr", ms: "Ms", none: "Not specified" },
  contactChannelOptions: { email: "E-mail", phone: "Phone", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Passport", id_card: "Identity card", residence_permit: "Residence permit" },
  sectionIdentity: "Identity document",
  identityUploadButton: "Upload a photo or scan of the document",
  identityUploadHint: "PDF, JPG or PNG, up to 25 MB per file.",
  identityUploadNeedsConsent: "To upload, first agree to the processing of your details at the top.",
  identityNote:
    "A copy alone may not be enough if the person is not present in person. We will get in touch about the identification.",
  noIdentityDocuments: "No identity document uploaded yet.",
  identityFiles: "Photo or scan of the document",
  idDocumentExpired: "The document has expired. Please enter a valid document.",
  sectionRepresentation: "Representation",
  hasRepresentativeQuestion: "Is somebody acting for you (representative, messenger, authorised person)?",
  underGuardianshipQuestion: "Are you under legal guardianship?",
  sectionLegalRepresentatives: "Legal representatives",
  legalRepresentativesIntro:
    "For minors the legal representatives act. Consent and signatures are needed from both parents.",
  custodyQuestion: "Who represents the child?",
  custodyOptions: {
    joint: "Both parents together",
    sole_parent: "One parent alone (sole custody)",
    guardian: "Guardian or custodian",
  },
  representativeCaptions: {
    rep1: "1st representative",
    rep2: "2nd representative",
    agent: "Representative",
    guardian: "Legal guardian",
  },
  representativeYou: "you",
  representativeOtherParent: "other parent",
  representativeOnFile: (name) => `GMED has another person with custody on file: ${name}. Please contact us.`,
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
