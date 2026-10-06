import type { PaymentMethod } from "@/pages/patient-lead/lead-request-api";
import { asLeadCabinetLang, type LeadCabinetLang } from "@/pages/patient-lead/lead-request-text";

import type { PayerType } from "./payer-link-api";
import {
  LEGAL_QUESTIONS,
  isOrganisation,
  isPayerField,
  sortMissing,
  type ContactChannel,
  type FundsSource,
  type IdDocumentType,
  type LegalQuestion,
  type OrganisationType,
  type OwnerField,
  type PayerField,
  type PayerStep,
  type RelationshipKind,
  type Salutation,
} from "./payer-link-model";

/**
 * Texts of the payer's own link in DE, EN, UA and RU (contract phase 3a,
 * 5.1): formal address, the terms of the lead cabinet, nothing medical.
 */

export type PayerLabelField = PayerField | "email";

/** Keys of `missing_for_submit` that are no form field, or that read differently in the list. */
type MissingLabelKey =
  | "privacy_ack"
  | "id_document_upload"
  | "funds_proof_upload"
  | "relationship"
  | "funds_description"
  | "payment_method"
  | "payment_method_details"
  | "via_third_party"
  | "via_third_party_details"
  | "pep_self_details"
  | "pep_related_details"
  | "high_risk_country_code"
  | "sanctions_links_details"
  | "other";

export type PayerLinkText = {
  pageTitle: string;
  language: string;
  loading: string;
  retry: string;
  linkIncomplete: string;
  linkInvalid: string;
  linkRevoked: string;
  linkExpired: string;
  linkLocked: string;
  loadFailed: string;
  networkError: string;
  tooManyRequests: string;
  unexpectedError: string;
  mailFailed: string;
  sessionExpired: string;
  privacyFirst: string;
  alreadySubmitted: string;
  namedYou: (patient: string) => string;
  codeWillBeSent: (email: string) => string;
  codeSentTo: (email: string) => string;
  submittedCodeNote: string;
  linkValidUntil: (date: string) => string;
  sendCode: string;
  sendingCode: string;
  codeLabel: string;
  confirmCode: string;
  confirming: string;
  resendCode: string;
  resendIn: (seconds: number) => string;
  codeFormat: string;
  codeInvalid: (attemptsLeft: number | null) => string;
  codeExpired: string;
  codeRateLimited: (seconds: number | null) => string;
  stepOf: (index: number, total: number) => string;
  steps: Record<PayerStep, string>;
  organisationSteps: { details: string; identity: string };
  next: string;
  back: string;
  saving: string;
  saved: string;
  notSaved: string;
  autosaveNote: string;
  choose: string;
  invalidField: string;
  idDocumentExpired: string;
  privacyNotice: (patient: string) => readonly string[];
  privacyLink: string;
  privacyAck: string;
  privacyAckedAt: (dateTime: string) => string;
  contactQuestion: string;
  contactChannels: Record<ContactChannel, string>;
  emailConfirmed: string;
  seat: string;
  representative: string;
  seatLabel: (label: string) => string;
  representativeLabel: (label: string) => string;
  citizenshipsPlaceholder: string;
  salutations: Record<Salutation, string>;
  organisationName: Record<OrganisationType, string>;
  fields: Record<PayerLabelField, string>;
  missing: Record<MissingLabelKey, string>;
  legalTopics: Record<LegalQuestion, string>;
  identityIntro: string;
  identityIntroOrganisation: string;
  idDocumentTypes: Record<IdDocumentType, string>;
  identityFiles: string;
  identityUploadButton: string;
  uploadHint: string;
  uploading: string;
  noIdentityDocuments: string;
  removeDocument: string;
  documentReviewed: string;
  fileTooLarge: (name: string) => string;
  tooManyDocuments: string;
  uploadFailed: (name: string) => string;
  uploadReviewed: string;
  removeFailed: string;
  ownersIntro: string;
  ownersOptional: string;
  ownerHeading: (index: number) => string;
  ownerFields: Record<OwnerField, string>;
  ownerAddress: string;
  addOwner: string;
  removeOwner: string;
  ownerIncomplete: string;
  ownerShare: string;
  ownersTotal: string;
  noOwners: string;
  ownersLimit: string;
  relationshipKinds: Record<RelationshipKind, string>;
  fundsSources: Record<FundsSource, string>;
  fundsDescriptionHint: string;
  fundsProof: string;
  fundsProofRequired: string;
  fundsProofOptional: string;
  fundsProofHint: string;
  fundsProofButton: string;
  noFundsProof: string;
  paymentMethods: Record<PaymentMethod, string>;
  cashCryptoNote: string;
  declarationsIntro: string;
  yesNo: { yes: string; no: string };
  summaryIntro: string;
  missingTitle: string;
  complete: string;
  goToStep: string;
  edit: string;
  confirmLabel: string;
  submit: string;
  submitting: string;
  submitNeedsConfirm: string;
  submitNeedsMissing: string;
  thanksTitle: string;
  thanksBody: string;
  submittedAt: (dateTime: string) => string;
  thanksNext: string;
  summaryTitle: string;
  notStated: string;
  noDocuments: string;
};

const de: PayerLinkText = {
  pageTitle: "Angaben zur Kostenübernahme",
  language: "Sprache",
  loading: "Wird geladen…",
  retry: "Erneut versuchen",
  linkIncomplete:
    "Dieser Link ist unvollständig. Bitte öffnen Sie den vollständigen Link aus der E-Mail von GMED. Wenn das nicht hilft, wenden Sie sich bitte an GMED.",
  linkInvalid: "Dieser Link ist nicht gültig. Bitte wenden Sie sich an GMED.",
  linkRevoked: "Dieser Link ist nicht mehr gültig. Bitte wenden Sie sich an GMED.",
  linkExpired: "Dieser Link ist abgelaufen. Bitte wenden Sie sich an GMED, wenn Sie einen neuen Link benötigen.",
  linkLocked: "Dieser Link wurde nach zu vielen falschen Codes gesperrt. Bitte wenden Sie sich an GMED.",
  loadFailed: "Die Seite konnte nicht geladen werden.",
  networkError: "Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.",
  tooManyRequests: "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
  unexpectedError: "Das hat leider nicht geklappt. Bitte versuchen Sie es erneut.",
  mailFailed: "Die E-Mail mit dem Code konnte gerade nicht gesendet werden. Bitte versuchen Sie es später erneut.",
  sessionExpired: "Ihre Sitzung ist abgelaufen. Bitte fordern Sie einen neuen Code an. Ihre Angaben bleiben gespeichert.",
  privacyFirst: "Bitte bestätigen Sie zuerst die Datenschutzhinweise.",
  alreadySubmitted: "Ihre Angaben sind bereits bei GMED eingegangen.",
  namedYou: (patient) => `${patient} hat Sie als zahlende Person für eine Anfrage bei GMED benannt.`,
  codeWillBeSent: (email) => `Wir senden einen Bestätigungscode an ${email}.`,
  codeSentTo: (email) => `Wir haben einen Code an ${email} gesendet. Er ist 15 Minuten gültig.`,
  submittedCodeNote: "Ihre Angaben sind bereits bei GMED eingegangen. Mit einem Code können Sie sie ansehen.",
  linkValidUntil: (date) => `Der Link ist gültig bis ${date}.`,
  sendCode: "Code senden",
  sendingCode: "Wird gesendet…",
  codeLabel: "Bestätigungscode (6 Ziffern)",
  confirmCode: "Bestätigen",
  confirming: "Wird geprüft…",
  resendCode: "Code erneut senden",
  resendIn: (seconds) => `Code erneut senden (in ${seconds} s)`,
  codeFormat: "Bitte geben Sie die 6 Ziffern aus der E-Mail ein.",
  codeInvalid: (left) =>
    left === null
      ? "Der Code ist nicht richtig."
      : left === 0
        ? "Der Code ist nicht richtig. Bitte fordern Sie einen neuen Code an."
        : left === 1
          ? "Der Code ist nicht richtig. Sie haben noch einen Versuch."
          : `Der Code ist nicht richtig. Sie haben noch ${left} Versuche.`,
  codeExpired: "Der Code ist abgelaufen. Bitte fordern Sie einen neuen Code an.",
  codeRateLimited: (seconds) =>
    seconds
      ? `Bitte warten Sie ${seconds} s, bevor Sie einen neuen Code anfordern.`
      : "Bitte warten Sie etwas, bevor Sie einen neuen Code anfordern.",
  stepOf: (index, total) => `Schritt ${index} von ${total}`,
  steps: {
    privacy: "Datenschutz",
    details: "Angaben zur Person",
    identity: "Ausweisdokument",
    owners: "Wirtschaftlich Berechtigte",
    funds: "Beziehung und Herkunft der Mittel",
    payment: "Zahlungsweg",
    declarations: "Erklärungen",
    summary: "Zusammenfassung",
  },
  organisationSteps: {
    details: "Angaben zur Organisation",
    identity: "Ausweisdokument der vertretungsberechtigten Person",
  },
  next: "Weiter",
  back: "Zurück",
  saving: "Wird gespeichert…",
  saved: "Gespeichert",
  notSaved: "Nicht gespeichert",
  autosaveNote: "Ihre Angaben werden automatisch gespeichert.",
  choose: "Auswählen",
  invalidField: "Bitte prüfen Sie diese Angabe.",
  idDocumentExpired: "Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.",
  privacyNotice: (patient) => [
    `${patient} hat Sie als zahlende Person benannt und uns dafür Ihren Namen und Ihre Kontaktdaten mitgeteilt.`,
    "Verantwortlich für die Verarbeitung Ihrer Daten ist GMED. Wir verarbeiten Ihre Angaben, um Sie nach dem Geldwäschegesetz zu identifizieren (§§ 10–12 GwG), die Kostenübernahme zu klären und Rechnungen zu stellen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO.",
    "Wir speichern die Angaben fünf Jahre nach dem Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG). Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Widerspruch sowie das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.",
  ],
  privacyLink: "Vollständige Datenschutzhinweise",
  privacyAck: "Ich habe die Datenschutzhinweise gelesen.",
  privacyAckedAt: (dateTime) => `Bestätigt am ${dateTime}`,
  contactQuestion: "Wie dürfen wir Sie kontaktieren?",
  contactChannels: { email: "E-Mail", phone: "Telefon", messenger: "Messenger" },
  emailConfirmed: "bestätigt",
  seat: "Sitz",
  representative: "Gesetzliche/r Vertreter/in",
  seatLabel: (label) => `Sitz: ${label}`,
  representativeLabel: (label) => `Gesetzliche/r Vertreter/in: ${label}`,
  citizenshipsPlaceholder: "Land hinzufügen",
  salutations: { mr: "Herr", ms: "Frau", none: "Keine Angabe" },
  organisationName: { company: "Firma", organisation: "Name der Organisation", insurance: "Name der Versicherung" },
  fields: {
    salutation: "Anrede",
    first_name: "Vorname",
    last_name: "Nachname",
    former_names: "Frühere Namen (z. B. Geburtsname)",
    date_of_birth: "Geburtsdatum",
    birth_place: "Geburtsort",
    birth_country: "Geburtsland",
    citizenships: "Staatsangehörigkeit(en)",
    street: "Straße und Hausnummer",
    zip: "PLZ",
    city: "Ort",
    country: "Land",
    habitual_residence_country: "Gewöhnlicher Aufenthalt (falls abweichend)",
    email: "E-Mail",
    phone: "Telefon",
    language: "Sprache",
    id_document_type: "Art des Dokuments",
    id_document_number: "Dokumentnummer",
    id_issuing_authority: "Ausstellende Behörde",
    id_issuing_country: "Ausstellungsland",
    id_issued_on: "Ausgestellt am",
    id_valid_until: "Gültig bis",
    organisation_name: "Firma",
    register_court: "Registergericht",
    register_number: "Registernummer",
    representative_first_name: "Vorname",
    representative_last_name: "Nachname",
    representative_role: "Funktion",
    beneficial_owners: "Wirtschaftlich Berechtigte",
    beneficial_owners_none: "Es gibt keine natürliche Person mit mehr als 25 %",
    relationship_kind: "Beziehung zur Patientin / zum Patienten",
    relationship: "Bitte angeben",
    occupation: "Beruf",
    industry: "Branche",
    funds_sources: "Herkunft der Mittel",
    funds_description: "Beschreibung",
    pep_self: "Üben Sie ein hochrangiges öffentliches Amt aus oder haben Sie es in den letzten 12 Monaten ausgeübt?",
    pep_self_details: "Amt, Land und Zeitraum",
    pep_related: "Ist ein unmittelbares Familienmitglied oder eine Ihnen nahestehende Person politisch exponiert?",
    pep_related_details: "Name der Person, Beziehung, Amt und Land",
    high_risk_country:
      "Haben Sie oder eine beteiligte Person Wohnsitz oder Sitz in einem Land, das die EU-Kommission als Drittstaat mit hohem Risiko führt?",
    high_risk_country_code: "Welches Land?",
    sanctions_links: "Bestehen Verbindungen zu Personen oder Unternehmen, die Sanktionen unterliegen?",
    sanctions_links_details: "Zu wem besteht die Verbindung und welcher Art ist sie?",
    payment_method: "Wie werden Sie bezahlen?",
    payment_method_details: "Bitte beschreiben",
    account_country: "Land des Kontos",
    account_holder: "Kontoinhaber/in",
    bank_name: "Name der Bank",
    via_third_party: "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    via_third_party_details: "Bitte beschreiben (wer, welcher Dienst)",
  },
  missing: {
    privacy_ack: "Bestätigung der Datenschutzhinweise",
    id_document_upload: "Foto oder Scan des Ausweises",
    funds_proof_upload: "Nachweis der Herkunft der Mittel",
    relationship: "Beziehung: nähere Angabe",
    funds_description: "Herkunft der Mittel: Beschreibung",
    payment_method: "Zahlungsart",
    payment_method_details: "Zahlungsart: Beschreibung",
    via_third_party: "Zahlung über Dritte",
    via_third_party_details: "Zahlung über Dritte: Beschreibung",
    pep_self_details: "Öffentliches Amt: Angaben",
    pep_related_details: "Politisch exponierte nahestehende Person: Angaben",
    high_risk_country_code: "Land mit hohem Risiko: welches Land",
    sanctions_links_details: "Sanktionen: Angaben",
    other: "Weitere Angaben",
  },
  legalTopics: {
    pep_self: "Öffentliches Amt",
    pep_related: "Politisch exponierte nahestehende Person",
    high_risk_country: "Land mit hohem Risiko",
    sanctions_links: "Sanktionen",
  },
  identityIntro: "Bitte geben Sie die Daten Ihres Ausweisdokuments an und laden Sie ein Foto oder einen Scan hoch.",
  identityIntroOrganisation:
    "Bitte geben Sie die Daten des Ausweisdokuments der Person an, die die Organisation vertritt, und laden Sie ein Foto oder einen Scan hoch.",
  idDocumentTypes: { passport: "Reisepass", id_card: "Personalausweis", residence_permit: "Aufenthaltstitel" },
  identityFiles: "Foto oder Scan des Ausweises",
  identityUploadButton: "Foto oder Scan hochladen",
  uploadHint: "PDF, JPG oder PNG, bis 25 MB pro Datei.",
  uploading: "Wird hochgeladen…",
  noIdentityDocuments: "Noch kein Ausweis hochgeladen.",
  removeDocument: "Entfernen",
  documentReviewed: "Von GMED geprüft",
  fileTooLarge: (name) => `${name} ist größer als 25 MB.`,
  tooManyDocuments: "Es können keine weiteren Dateien hochgeladen werden. Bitte wenden Sie sich an GMED.",
  uploadFailed: (name) => `${name} konnte nicht hochgeladen werden. Bitte prüfen Sie die Datei (PDF, JPG oder PNG, bis 25 MB).`,
  uploadReviewed: "Diese Datei hat GMED bereits geprüft; sie kann nicht mehr entfernt werden.",
  removeFailed: "Die Datei konnte nicht entfernt werden.",
  ownersIntro:
    "Bitte nennen Sie jede natürliche Person, die mehr als 25 % der Anteile oder Stimmrechte hält oder die Organisation auf andere Weise kontrolliert.",
  ownersOptional: "Für Organisationen und Versicherungen ist diese Angabe freiwillig.",
  ownerHeading: (index) => `Person ${index}`,
  ownerFields: {
    first_name: "Vorname",
    last_name: "Nachname",
    date_of_birth: "Geburtsdatum",
    birth_place: "Geburtsort",
    street: "Straße und Hausnummer",
    zip: "PLZ",
    city: "Ort",
    country: "Land",
    share_percent: "Anteil in %",
  },
  ownerAddress: "Anschrift",
  addOwner: "Person hinzufügen",
  removeOwner: "Person entfernen",
  ownerIncomplete: "Bitte Vorname und Nachname angeben; erst dann wird diese Person gespeichert.",
  ownerShare: "Bitte einen Anteil über 0 und bis 100 % angeben (höchstens zwei Nachkommastellen).",
  ownersTotal: "Die Anteile ergeben zusammen mehr als 100 %.",
  noOwners: "Noch keine Person angegeben.",
  ownersLimit: "Es können höchstens 10 Personen angegeben werden.",
  relationshipKinds: {
    spouse: "Ehepartner/in",
    parent: "Elternteil",
    child: "Kind",
    relative: "Sonstige/r Verwandte/r",
    employer: "Arbeitgeber",
    friend: "Freund/in",
    business_partner: "Geschäftspartner/in",
    other: "Sonstige",
  },
  fundsSources: {
    employment: "Gehalt / nichtselbständige Arbeit",
    business_income: "Einkünfte aus Unternehmen / selbständiger Tätigkeit",
    savings: "Ersparnisse",
    asset_sale: "Verkauf von Vermögenswerten",
    inheritance_gift: "Erbschaft / Schenkung",
    other: "Sonstiges",
  },
  fundsDescriptionHint: "Bei „Sonstiges“ bitte beschreiben, sonst freiwillig.",
  fundsProof: "Nachweis der Herkunft der Mittel",
  fundsProofRequired: "erforderlich",
  fundsProofOptional: "freiwillig",
  fundsProofHint:
    "Zum Beispiel Kontoauszug, Gehaltsabrechnung, Kaufvertrag oder Erbschein. PDF, JPG oder PNG, bis 25 MB pro Datei.",
  fundsProofButton: "Nachweis hochladen",
  noFundsProof: "Noch kein Nachweis hochgeladen.",
  paymentMethods: {
    bank_transfer: "Überweisung",
    card: "Karte",
    cash: "Bar",
    crypto: "Kryptowährung",
    other: "Sonstiges",
  },
  cashCryptoNote: "Barzahlungen und Zahlungen in Kryptowährung prüft GMED gesondert (Geldwäschegesetz).",
  declarationsIntro: "Diese Fragen schreibt das Geldwäschegesetz vor. Bitte beantworten Sie jede mit Ja oder Nein.",
  yesNo: { yes: "Ja", no: "Nein" },
  summaryIntro: "Bitte prüfen Sie Ihre Angaben, bevor Sie sie senden.",
  missingTitle: "Bitte noch ergänzen:",
  complete: "Alle erforderlichen Angaben sind vorhanden.",
  goToStep: "Ergänzen",
  edit: "Ändern",
  confirmLabel: "Ich bestätige, dass meine Angaben vollständig und richtig sind.",
  submit: "Absenden",
  submitting: "Wird gesendet…",
  submitNeedsConfirm: "Bitte bestätigen Sie, dass Ihre Angaben vollständig und richtig sind.",
  submitNeedsMissing: "Bitte ergänzen Sie zuerst die fehlenden Angaben.",
  thanksTitle: "Vielen Dank.",
  thanksBody: "Ihre Angaben sind bei GMED eingegangen.",
  submittedAt: (dateTime) => `Gesendet am ${dateTime}`,
  thanksNext: "Wenn sich etwas ändert, wenden Sie sich bitte an GMED.",
  summaryTitle: "Ihre Angaben",
  notStated: "Keine Angabe",
  noDocuments: "Keine Datei",
};

const en: PayerLinkText = {
  pageTitle: "Details on covering the costs",
  language: "Language",
  loading: "Loading…",
  retry: "Try again",
  linkIncomplete:
    "This link is incomplete. Please open the complete link from GMED's e-mail. If that does not help, please contact GMED.",
  linkInvalid: "This link is not valid. Please contact GMED.",
  linkRevoked: "This link is no longer valid. Please contact GMED.",
  linkExpired: "This link has expired. Please contact GMED if you need a new link.",
  linkLocked: "This link was locked after too many wrong codes. Please contact GMED.",
  loadFailed: "The page could not be loaded.",
  networkError: "No connection to the server. Please check your internet connection and try again.",
  tooManyRequests: "Too many requests in a short time. Please wait a moment and try again.",
  unexpectedError: "That did not work. Please try again.",
  mailFailed: "The e-mail with the code could not be sent just now. Please try again later.",
  sessionExpired: "Your session has expired. Please request a new code. Your details remain saved.",
  privacyFirst: "Please confirm the privacy information first.",
  alreadySubmitted: "GMED has already received your details.",
  namedYou: (patient) => `${patient} has named you as the paying person for a request at GMED.`,
  codeWillBeSent: (email) => `We will send a confirmation code to ${email}.`,
  codeSentTo: (email) => `We have sent a code to ${email}. It is valid for 15 minutes.`,
  submittedCodeNote: "GMED has already received your details. You can view them with a code.",
  linkValidUntil: (date) => `The link is valid until ${date}.`,
  sendCode: "Send code",
  sendingCode: "Sending…",
  codeLabel: "Confirmation code (6 digits)",
  confirmCode: "Confirm",
  confirming: "Checking…",
  resendCode: "Send the code again",
  resendIn: (seconds) => `Send the code again (in ${seconds} s)`,
  codeFormat: "Please enter the 6 digits from the e-mail.",
  codeInvalid: (left) =>
    left === null
      ? "The code is not correct."
      : left === 0
        ? "The code is not correct. Please request a new code."
        : left === 1
          ? "The code is not correct. You have one more attempt."
          : `The code is not correct. You have ${left} more attempts.`,
  codeExpired: "The code has expired. Please request a new code.",
  codeRateLimited: (seconds) =>
    seconds
      ? `Please wait ${seconds} s before you request a new code.`
      : "Please wait a little before you request a new code.",
  stepOf: (index, total) => `Step ${index} of ${total}`,
  steps: {
    privacy: "Privacy",
    details: "Personal details",
    identity: "Identity document",
    owners: "Beneficial owners",
    funds: "Relationship and source of funds",
    payment: "Payment",
    declarations: "Declarations",
    summary: "Summary",
  },
  organisationSteps: {
    details: "Details of the organisation",
    identity: "Identity document of the authorised representative",
  },
  next: "Next",
  back: "Back",
  saving: "Saving…",
  saved: "Saved",
  notSaved: "Not saved",
  autosaveNote: "Your details are saved automatically.",
  choose: "Select",
  invalidField: "Please check this entry.",
  idDocumentExpired: "The document has expired. Please enter a valid document.",
  privacyNotice: (patient) => [
    `${patient} has named you as the paying person and gave us your name and contact details for this purpose.`,
    "GMED is responsible for processing your data. We process your details to identify you under the German Money Laundering Act (Sections 10–12 GwG), to arrange the covering of the costs and to issue invoices. The legal basis is Art. 6(1)(b) and (c) GDPR.",
    "We keep the details for five years after the end of the business relationship (Section 8(4) GwG). You have the right of access, rectification, erasure, restriction of processing and objection, and the right to lodge a complaint with a data protection supervisory authority.",
  ],
  privacyLink: "Full privacy information",
  privacyAck: "I have read the privacy information.",
  privacyAckedAt: (dateTime) => `Confirmed on ${dateTime}`,
  contactQuestion: "How may we contact you?",
  contactChannels: { email: "E-mail", phone: "Phone", messenger: "Messenger" },
  emailConfirmed: "confirmed",
  seat: "Registered office",
  representative: "Legal representative",
  seatLabel: (label) => `Registered office: ${label}`,
  representativeLabel: (label) => `Legal representative: ${label}`,
  citizenshipsPlaceholder: "Add country",
  salutations: { mr: "Mr", ms: "Ms", none: "Not specified" },
  organisationName: { company: "Company name", organisation: "Name of the organisation", insurance: "Name of the insurer" },
  fields: {
    salutation: "Title",
    first_name: "First name",
    last_name: "Last name",
    former_names: "Former names (e.g. name at birth)",
    date_of_birth: "Date of birth",
    birth_place: "Place of birth",
    birth_country: "Country of birth",
    citizenships: "Citizenship(s)",
    street: "Street and number",
    zip: "Postcode",
    city: "City",
    country: "Country",
    habitual_residence_country: "Habitual residence (if different)",
    email: "E-mail",
    phone: "Phone",
    language: "Language",
    id_document_type: "Type of document",
    id_document_number: "Document number",
    id_issuing_authority: "Issuing authority",
    id_issuing_country: "Country of issue",
    id_issued_on: "Date of issue",
    id_valid_until: "Valid until",
    organisation_name: "Company name",
    register_court: "Register court",
    register_number: "Register number",
    representative_first_name: "First name",
    representative_last_name: "Last name",
    representative_role: "Position",
    beneficial_owners: "Beneficial owners",
    beneficial_owners_none: "There is no natural person holding more than 25 %",
    relationship_kind: "Relationship to the patient",
    relationship: "Please specify",
    occupation: "Occupation",
    industry: "Industry",
    funds_sources: "Source of funds",
    funds_description: "Description",
    pep_self: "Do you hold a prominent public office, or have you held one in the last 12 months?",
    pep_self_details: "Office, country and period",
    pep_related: "Is an immediate family member or a person close to you politically exposed?",
    pep_related_details: "Name of the person, relationship, office and country",
    high_risk_country:
      "Do you or a person involved live or have a registered office in a country that the EU Commission lists as a high-risk third country?",
    high_risk_country_code: "Which country?",
    sanctions_links: "Are there any links to persons or companies that are subject to sanctions?",
    sanctions_links_details: "Who is the link to, and what kind of link is it?",
    payment_method: "How will you pay?",
    payment_method_details: "Please describe",
    account_country: "Country of the account",
    account_holder: "Account holder",
    bank_name: "Name of the bank",
    via_third_party: "Is the payment made through a third person or a payment service provider?",
    via_third_party_details: "Please describe (who, which service)",
  },
  missing: {
    privacy_ack: "Confirmation of the privacy information",
    id_document_upload: "Photo or scan of the identity document",
    funds_proof_upload: "Proof of the source of funds",
    relationship: "Relationship: details",
    funds_description: "Source of funds: description",
    payment_method: "Payment method",
    payment_method_details: "Payment method: description",
    via_third_party: "Payment through third parties",
    via_third_party_details: "Payment through third parties: description",
    pep_self_details: "Public office: details",
    pep_related_details: "Politically exposed close person: details",
    high_risk_country_code: "High-risk country: which country",
    sanctions_links_details: "Sanctions: details",
    other: "Further details",
  },
  legalTopics: {
    pep_self: "Public office",
    pep_related: "Politically exposed close person",
    high_risk_country: "High-risk country",
    sanctions_links: "Sanctions",
  },
  identityIntro: "Please enter the details of your identity document and upload a photo or scan of it.",
  identityIntroOrganisation:
    "Please enter the details of the identity document of the person who represents the organisation, and upload a photo or scan of it.",
  idDocumentTypes: { passport: "Passport", id_card: "Identity card", residence_permit: "Residence permit" },
  identityFiles: "Photo or scan of the identity document",
  identityUploadButton: "Upload a photo or scan",
  uploadHint: "PDF, JPG or PNG, up to 25 MB per file.",
  uploading: "Uploading…",
  noIdentityDocuments: "No identity document uploaded yet.",
  removeDocument: "Remove",
  documentReviewed: "Checked by GMED",
  fileTooLarge: (name) => `${name} is larger than 25 MB.`,
  tooManyDocuments: "No further files can be uploaded. Please contact GMED.",
  uploadFailed: (name) => `${name} could not be uploaded. Please check the file (PDF, JPG or PNG, up to 25 MB).`,
  uploadReviewed: "GMED has already checked this file; it can no longer be removed.",
  removeFailed: "The file could not be removed.",
  ownersIntro:
    "Please name every natural person who holds more than 25 % of the shares or voting rights or who controls the organisation in another way.",
  ownersOptional: "For organisations and insurers this is optional.",
  ownerHeading: (index) => `Person ${index}`,
  ownerFields: {
    first_name: "First name",
    last_name: "Last name",
    date_of_birth: "Date of birth",
    birth_place: "Place of birth",
    street: "Street and number",
    zip: "Postcode",
    city: "City",
    country: "Country",
    share_percent: "Share in %",
  },
  ownerAddress: "Address",
  addOwner: "Add a person",
  removeOwner: "Remove this person",
  ownerIncomplete: "Please enter the first and last name; only then is this person saved.",
  ownerShare: "Please enter a share above 0 and up to 100 % (at most two decimals).",
  ownersTotal: "The shares add up to more than 100 %.",
  noOwners: "No person entered yet.",
  ownersLimit: "At most 10 persons can be entered.",
  relationshipKinds: {
    spouse: "Spouse",
    parent: "Parent",
    child: "Child",
    relative: "Other relative",
    employer: "Employer",
    friend: "Friend",
    business_partner: "Business partner",
    other: "Other",
  },
  fundsSources: {
    employment: "Salary / employment",
    business_income: "Business or self-employed income",
    savings: "Savings",
    asset_sale: "Sale of assets",
    inheritance_gift: "Inheritance / gift",
    other: "Other",
  },
  fundsDescriptionHint: "Please describe with \"Other\"; optional otherwise.",
  fundsProof: "Proof of the source of funds",
  fundsProofRequired: "required",
  fundsProofOptional: "optional",
  fundsProofHint:
    "For example a bank statement, a payslip, a sales contract or a certificate of inheritance. PDF, JPG or PNG, up to 25 MB per file.",
  fundsProofButton: "Upload proof",
  noFundsProof: "No proof uploaded yet.",
  paymentMethods: {
    bank_transfer: "Bank transfer",
    card: "Card",
    cash: "Cash",
    crypto: "Cryptocurrency",
    other: "Other",
  },
  cashCryptoNote: "GMED checks cash payments and payments in cryptocurrency separately (Money Laundering Act).",
  declarationsIntro: "German anti-money laundering law requires these questions. Please answer each with yes or no.",
  yesNo: { yes: "Yes", no: "No" },
  summaryIntro: "Please check your details before you send them.",
  missingTitle: "Please add:",
  complete: "All required details are there.",
  goToStep: "Complete",
  edit: "Edit",
  confirmLabel: "I confirm that my details are complete and correct.",
  submit: "Send",
  submitting: "Sending…",
  submitNeedsConfirm: "Please confirm that your details are complete and correct.",
  submitNeedsMissing: "Please add the missing details first.",
  thanksTitle: "Thank you.",
  thanksBody: "GMED has received your details.",
  submittedAt: (dateTime) => `Sent on ${dateTime}`,
  thanksNext: "If anything changes, please contact GMED.",
  summaryTitle: "Your details",
  notStated: "Not specified",
  noDocuments: "No file",
};

const uk: PayerLinkText = {
  pageTitle: "Відомості про оплату витрат",
  language: "Мова",
  loading: "Завантаження…",
  retry: "Спробувати ще раз",
  linkIncomplete:
    "Це посилання неповне. Будь ласка, відкрийте повне посилання з листа GMED. Якщо це не допоможе, зверніться, будь ласка, до GMED.",
  linkInvalid: "Це посилання недійсне. Будь ласка, зверніться до GMED.",
  linkRevoked: "Це посилання більше не дійсне. Будь ласка, зверніться до GMED.",
  linkExpired: "Термін дії цього посилання минув. Якщо вам потрібне нове посилання, зверніться, будь ласка, до GMED.",
  linkLocked: "Це посилання заблоковано після надто багатьох неправильних кодів. Будь ласка, зверніться до GMED.",
  loadFailed: "Не вдалося завантажити сторінку.",
  networkError: "Немає з'єднання із сервером. Будь ласка, перевірте підключення до інтернету й спробуйте ще раз.",
  tooManyRequests: "Забагато запитів за короткий час. Будь ласка, зачекайте трохи й спробуйте ще раз.",
  unexpectedError: "Не вдалося. Будь ласка, спробуйте ще раз.",
  mailFailed: "Зараз не вдалося надіслати лист із кодом. Будь ласка, спробуйте пізніше.",
  sessionExpired: "Ваш сеанс завершився. Будь ласка, запросіть новий код. Ваші дані збережено.",
  privacyFirst: "Будь ласка, спершу підтвердьте інформацію про захист даних.",
  alreadySubmitted: "Ваші дані вже надійшли до GMED.",
  namedYou: (patient) => `${patient} вказав(ла) вас платником за заявкою в GMED.`,
  codeWillBeSent: (email) => `Ми надішлемо код підтвердження на ${email}.`,
  codeSentTo: (email) => `Ми надіслали код на ${email}. Він дійсний 15 хвилин.`,
  submittedCodeNote: "Ваші дані вже надійшли до GMED. Переглянути їх можна за допомогою коду.",
  linkValidUntil: (date) => `Посилання дійсне до ${date}.`,
  sendCode: "Надіслати код",
  sendingCode: "Надсилається…",
  codeLabel: "Код підтвердження (6 цифр)",
  confirmCode: "Підтвердити",
  confirming: "Перевіряється…",
  resendCode: "Надіслати код ще раз",
  resendIn: (seconds) => `Надіслати код ще раз (через ${seconds} с)`,
  codeFormat: "Будь ласка, введіть 6 цифр із листа.",
  codeInvalid: (left) =>
    left === null
      ? "Код неправильний."
      : left === 0
        ? "Код неправильний. Будь ласка, запросіть новий код."
        : `Код неправильний. Залишилося спроб: ${left}.`,
  codeExpired: "Термін дії коду минув. Будь ласка, запросіть новий код.",
  codeRateLimited: (seconds) =>
    seconds
      ? `Будь ласка, зачекайте ${seconds} с, перш ніж запросити новий код.`
      : "Будь ласка, зачекайте трохи, перш ніж запросити новий код.",
  stepOf: (index, total) => `Крок ${index} з ${total}`,
  steps: {
    privacy: "Захист даних",
    details: "Особисті дані",
    identity: "Документ, що посвідчує особу",
    owners: "Кінцеві бенефіціари",
    funds: "Зв'язок і походження коштів",
    payment: "Спосіб оплати",
    declarations: "Заяви",
    summary: "Підсумок",
  },
  organisationSteps: {
    details: "Дані організації",
    identity: "Документ особи, уповноваженої представляти організацію",
  },
  next: "Далі",
  back: "Назад",
  saving: "Зберігається…",
  saved: "Збережено",
  notSaved: "Не збережено",
  autosaveNote: "Ваші дані зберігаються автоматично.",
  choose: "Виберіть",
  invalidField: "Будь ласка, перевірте це поле.",
  idDocumentExpired: "Термін дії документа минув. Будь ласка, вкажіть дійсний документ.",
  privacyNotice: (patient) => [
    `${patient} вказав(ла) вас платником і для цього повідомив(ла) нам ваше ім'я та контактні дані.`,
    "Відповідальна за обробку ваших даних — GMED. Ми обробляємо ваші дані, щоб ідентифікувати вас відповідно до німецького закону про запобігання відмиванню коштів (§§ 10–12 GwG), узгодити оплату витрат і виставляти рахунки. Правова підстава — ст. 6 абз. 1 літ. b і c GDPR (DSGVO).",
    "Ми зберігаємо дані п'ять років після завершення ділових відносин (§ 8 абз. 4 GwG). Ви маєте право на доступ до даних, їх виправлення, видалення, обмеження обробки та заперечення, а також право подати скаргу до наглядового органу із захисту даних.",
  ],
  privacyLink: "Повна інформація про захист даних",
  privacyAck: "Я прочитав(ла) інформацію про захист даних.",
  privacyAckedAt: (dateTime) => `Підтверджено ${dateTime}`,
  contactQuestion: "Як ми можемо з вами зв'язатися?",
  contactChannels: { email: "E-mail", phone: "Телефон", messenger: "Месенджер" },
  emailConfirmed: "підтверджено",
  seat: "Місцезнаходження",
  representative: "Законний представник",
  seatLabel: (label) => `Місцезнаходження: ${label}`,
  representativeLabel: (label) => `Законний представник: ${label}`,
  citizenshipsPlaceholder: "Додати країну",
  salutations: { mr: "Пан", ms: "Пані", none: "Без зазначення" },
  organisationName: { company: "Назва компанії", organisation: "Назва організації", insurance: "Назва страхової компанії" },
  fields: {
    salutation: "Звертання",
    first_name: "Ім'я",
    last_name: "Прізвище",
    former_names: "Попередні імена та прізвища (наприклад, прізвище при народженні)",
    date_of_birth: "Дата народження",
    birth_place: "Місце народження",
    birth_country: "Країна народження",
    citizenships: "Громадянство",
    street: "Вулиця і будинок",
    zip: "Поштовий індекс",
    city: "Місто",
    country: "Країна",
    habitual_residence_country: "Країна постійного перебування (якщо інша)",
    email: "E-mail",
    phone: "Телефон",
    language: "Мова",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Ким виданий",
    id_issuing_country: "Країна видачі",
    id_issued_on: "Дата видачі",
    id_valid_until: "Дійсний до",
    organisation_name: "Назва компанії",
    register_court: "Реєстровий суд",
    register_number: "Реєстраційний номер",
    representative_first_name: "Ім'я",
    representative_last_name: "Прізвище",
    representative_role: "Посада",
    beneficial_owners: "Кінцеві бенефіціари",
    beneficial_owners_none: "Немає фізичної особи з часткою понад 25 %",
    relationship_kind: "Ким ви доводитеся пацієнту",
    relationship: "Вкажіть, будь ласка",
    occupation: "Професія",
    industry: "Галузь",
    funds_sources: "Походження коштів",
    funds_description: "Опис",
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
    payment_method: "Як ви будете платити?",
    payment_method_details: "Опишіть, будь ласка",
    account_country: "Країна рахунку",
    account_holder: "Власник рахунку",
    bank_name: "Назва банку",
    via_third_party: "Чи здійснюється оплата через третю особу або платіжного провайдера?",
    via_third_party_details: "Опишіть, будь ласка (хто, який сервіс)",
  },
  missing: {
    privacy_ack: "Підтвердження інформації про захист даних",
    id_document_upload: "Фото або скан документа",
    funds_proof_upload: "Підтвердження походження коштів",
    relationship: "Ким ви доводитеся: уточнення",
    funds_description: "Походження коштів: опис",
    payment_method: "Спосіб оплати",
    payment_method_details: "Спосіб оплати: опис",
    via_third_party: "Оплата через третіх осіб",
    via_third_party_details: "Оплата через третіх осіб: опис",
    pep_self_details: "Державна посада: подробиці",
    pep_related_details: "Політично значуща близька особа: подробиці",
    high_risk_country_code: "Країна високого ризику: яка саме",
    sanctions_links_details: "Санкції: подробиці",
    other: "Інші дані",
  },
  legalTopics: {
    pep_self: "Державна посада",
    pep_related: "Політично значуща близька особа",
    high_risk_country: "Країна високого ризику",
    sanctions_links: "Санкції",
  },
  identityIntro: "Будь ласка, вкажіть дані вашого документа, що посвідчує особу, і завантажте його фото або скан.",
  identityIntroOrganisation:
    "Будь ласка, вкажіть дані документа особи, яка представляє організацію, і завантажте його фото або скан.",
  idDocumentTypes: {
    passport: "Паспорт (закордонний)",
    id_card: "Посвідчення особи (ID-картка)",
    residence_permit: "Посвідка на проживання",
  },
  identityFiles: "Фото або скан документа",
  identityUploadButton: "Завантажити фото або скан",
  uploadHint: "PDF, JPG або PNG, до 25 МБ на файл.",
  uploading: "Завантажується…",
  noIdentityDocuments: "Документ ще не завантажено.",
  removeDocument: "Видалити",
  documentReviewed: "Перевірено GMED",
  fileTooLarge: (name) => `${name} більший за 25 МБ.`,
  tooManyDocuments: "Більше файлів завантажити не можна. Будь ласка, зверніться до GMED.",
  uploadFailed: (name) => `Не вдалося завантажити ${name}. Будь ласка, перевірте файл (PDF, JPG або PNG, до 25 МБ).`,
  uploadReviewed: "GMED уже перевірила цей файл; видалити його більше не можна.",
  removeFailed: "Не вдалося видалити файл.",
  ownersIntro:
    "Будь ласка, вкажіть кожну фізичну особу, якій належить понад 25 % часток або голосів чи яка іншим чином контролює організацію.",
  ownersOptional: "Для організацій і страхових компаній ці дані необов'язкові.",
  ownerHeading: (index) => `Особа ${index}`,
  ownerFields: {
    first_name: "Ім'я",
    last_name: "Прізвище",
    date_of_birth: "Дата народження",
    birth_place: "Місце народження",
    street: "Вулиця і будинок",
    zip: "Поштовий індекс",
    city: "Місто",
    country: "Країна",
    share_percent: "Частка, %",
  },
  ownerAddress: "Адреса",
  addOwner: "Додати особу",
  removeOwner: "Видалити особу",
  ownerIncomplete: "Будь ласка, вкажіть ім'я та прізвище; лише тоді цю особу буде збережено.",
  ownerShare: "Будь ласка, вкажіть частку більше 0 і не більше 100 % (не більше двох знаків після коми).",
  ownersTotal: "Разом частки перевищують 100 %.",
  noOwners: "Ще не вказано жодної особи.",
  ownersLimit: "Можна вказати не більше 10 осіб.",
  relationshipKinds: {
    spouse: "Чоловік / дружина",
    parent: "Мати / батько",
    child: "Син / донька",
    relative: "Інший родич",
    employer: "Роботодавець",
    friend: "Друг / подруга",
    business_partner: "Діловий партнер",
    other: "Інше",
  },
  fundsSources: {
    employment: "Заробітна плата / робота за наймом",
    business_income: "Доходи від підприємницької діяльності",
    savings: "Заощадження",
    asset_sale: "Продаж майна",
    inheritance_gift: "Спадщина / дарування",
    other: "Інше",
  },
  fundsDescriptionHint: "Для «Інше» опишіть, будь ласка; в інших випадках необов'язково.",
  fundsProof: "Підтвердження походження коштів",
  fundsProofRequired: "обов'язково",
  fundsProofOptional: "необов'язково",
  fundsProofHint:
    "Наприклад, банківська виписка, розрахунковий листок, договір купівлі-продажу або свідоцтво про спадщину. PDF, JPG або PNG, до 25 МБ на файл.",
  fundsProofButton: "Завантажити підтвердження",
  noFundsProof: "Підтвердження ще не завантажено.",
  paymentMethods: {
    bank_transfer: "Банківський переказ",
    card: "Картка",
    cash: "Готівка",
    crypto: "Криптовалюта",
    other: "Інше",
  },
  cashCryptoNote: "Оплату готівкою та криптовалютою GMED перевіряє окремо (закон про запобігання відмиванню коштів).",
  declarationsIntro:
    "Ці запитання вимагає німецький закон про запобігання відмиванню коштів. Будь ласка, дайте на кожне відповідь «так» або «ні».",
  yesNo: { yes: "Так", no: "Ні" },
  summaryIntro: "Будь ласка, перевірте дані перед надсиланням.",
  missingTitle: "Будь ласка, доповніть:",
  complete: "Усі обов'язкові дані вказано.",
  goToStep: "Доповнити",
  edit: "Змінити",
  confirmLabel: "Я підтверджую, що мої дані повні й правильні.",
  submit: "Надіслати",
  submitting: "Надсилається…",
  submitNeedsConfirm: "Будь ласка, підтвердьте, що ваші дані повні й правильні.",
  submitNeedsMissing: "Будь ласка, спершу доповніть відсутні дані.",
  thanksTitle: "Дякуємо.",
  thanksBody: "Ваші дані надійшли до GMED.",
  submittedAt: (dateTime) => `Надіслано ${dateTime}`,
  thanksNext: "Якщо щось зміниться, зверніться, будь ласка, до GMED.",
  summaryTitle: "Ваші дані",
  notStated: "Не вказано",
  noDocuments: "Немає файлу",
};

const ru: PayerLinkText = {
  pageTitle: "Сведения об оплате расходов",
  language: "Язык",
  loading: "Загрузка…",
  retry: "Повторить",
  linkIncomplete:
    "Эта ссылка неполная. Пожалуйста, откройте полную ссылку из письма GMED. Если это не поможет, обратитесь, пожалуйста, в GMED.",
  linkInvalid: "Эта ссылка недействительна. Пожалуйста, обратитесь в GMED.",
  linkRevoked: "Эта ссылка больше не действительна. Пожалуйста, обратитесь в GMED.",
  linkExpired: "Срок действия этой ссылки истёк. Если вам нужна новая ссылка, обратитесь, пожалуйста, в GMED.",
  linkLocked: "Эта ссылка заблокирована после слишком большого числа неверных кодов. Пожалуйста, обратитесь в GMED.",
  loadFailed: "Не удалось загрузить страницу.",
  networkError: "Нет соединения с сервером. Пожалуйста, проверьте подключение к интернету и повторите попытку.",
  tooManyRequests: "Слишком много запросов за короткое время. Пожалуйста, подождите немного и повторите попытку.",
  unexpectedError: "Не получилось. Пожалуйста, повторите попытку.",
  mailFailed: "Сейчас не удалось отправить письмо с кодом. Пожалуйста, повторите попытку позже.",
  sessionExpired: "Ваш сеанс истёк. Пожалуйста, запросите новый код. Ваши данные сохранены.",
  privacyFirst: "Пожалуйста, сначала подтвердите информацию о защите данных.",
  alreadySubmitted: "Ваши данные уже поступили в GMED.",
  namedYou: (patient) => `${patient} указал(а) вас плательщиком по заявке в GMED.`,
  codeWillBeSent: (email) => `Мы отправим код подтверждения на ${email}.`,
  codeSentTo: (email) => `Мы отправили код на ${email}. Он действует 15 минут.`,
  submittedCodeNote: "Ваши данные уже поступили в GMED. Просмотреть их можно с помощью кода.",
  linkValidUntil: (date) => `Ссылка действительна до ${date}.`,
  sendCode: "Отправить код",
  sendingCode: "Отправляется…",
  codeLabel: "Код подтверждения (6 цифр)",
  confirmCode: "Подтвердить",
  confirming: "Проверяется…",
  resendCode: "Отправить код ещё раз",
  resendIn: (seconds) => `Отправить код ещё раз (через ${seconds} с)`,
  codeFormat: "Пожалуйста, введите 6 цифр из письма.",
  codeInvalid: (left) =>
    left === null
      ? "Код неверный."
      : left === 0
        ? "Код неверный. Пожалуйста, запросите новый код."
        : `Код неверный. Осталось попыток: ${left}.`,
  codeExpired: "Срок действия кода истёк. Пожалуйста, запросите новый код.",
  codeRateLimited: (seconds) =>
    seconds
      ? `Пожалуйста, подождите ${seconds} с, прежде чем запросить новый код.`
      : "Пожалуйста, подождите немного, прежде чем запросить новый код.",
  stepOf: (index, total) => `Шаг ${index} из ${total}`,
  steps: {
    privacy: "Защита данных",
    details: "Личные данные",
    identity: "Документ, удостоверяющий личность",
    owners: "Конечные бенефициары",
    funds: "Связь и происхождение средств",
    payment: "Способ оплаты",
    declarations: "Заявления",
    summary: "Итог",
  },
  organisationSteps: {
    details: "Данные организации",
    identity: "Документ лица, уполномоченного представлять организацию",
  },
  next: "Далее",
  back: "Назад",
  saving: "Сохраняется…",
  saved: "Сохранено",
  notSaved: "Не сохранено",
  autosaveNote: "Ваши данные сохраняются автоматически.",
  choose: "Выберите",
  invalidField: "Пожалуйста, проверьте это поле.",
  idDocumentExpired: "Срок действия документа истёк. Пожалуйста, укажите действующий документ.",
  privacyNotice: (patient) => [
    `${patient} указал(а) вас плательщиком и для этого сообщил(а) нам ваше имя и контактные данные.`,
    "Ответственная за обработку ваших данных — GMED. Мы обрабатываем ваши данные, чтобы идентифицировать вас по немецкому закону о противодействии отмыванию денег (§§ 10–12 GwG), согласовать оплату расходов и выставлять счета. Правовое основание — ст. 6 абз. 1 лит. b и c GDPR (DSGVO).",
    "Мы храним данные пять лет после окончания деловых отношений (§ 8 абз. 4 GwG). Вы имеете право на доступ к данным, их исправление, удаление, ограничение обработки и возражение, а также право подать жалобу в надзорный орган по защите данных.",
  ],
  privacyLink: "Полная информация о защите данных",
  privacyAck: "Я прочитал(а) информацию о защите данных.",
  privacyAckedAt: (dateTime) => `Подтверждено ${dateTime}`,
  contactQuestion: "Как мы можем с вами связаться?",
  contactChannels: { email: "E-mail", phone: "Телефон", messenger: "Мессенджер" },
  emailConfirmed: "подтверждён",
  seat: "Местонахождение",
  representative: "Законный представитель",
  seatLabel: (label) => `Местонахождение: ${label}`,
  representativeLabel: (label) => `Законный представитель: ${label}`,
  citizenshipsPlaceholder: "Добавить страну",
  salutations: { mr: "Господин", ms: "Госпожа", none: "Без указания" },
  organisationName: { company: "Название компании", organisation: "Название организации", insurance: "Название страховой компании" },
  fields: {
    salutation: "Обращение",
    first_name: "Имя",
    last_name: "Фамилия",
    former_names: "Прежние имена и фамилии (например, фамилия при рождении)",
    date_of_birth: "Дата рождения",
    birth_place: "Место рождения",
    birth_country: "Страна рождения",
    citizenships: "Гражданство",
    street: "Улица и дом",
    zip: "Почтовый индекс",
    city: "Город",
    country: "Страна",
    habitual_residence_country: "Страна постоянного пребывания (если другая)",
    email: "E-mail",
    phone: "Телефон",
    language: "Язык",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Кем выдан",
    id_issuing_country: "Страна выдачи",
    id_issued_on: "Дата выдачи",
    id_valid_until: "Действителен до",
    organisation_name: "Название компании",
    register_court: "Регистрационный суд",
    register_number: "Регистрационный номер",
    representative_first_name: "Имя",
    representative_last_name: "Фамилия",
    representative_role: "Должность",
    beneficial_owners: "Конечные бенефициары",
    beneficial_owners_none: "Нет физического лица с долей более 25 %",
    relationship_kind: "Кем вы приходитесь пациенту",
    relationship: "Укажите, пожалуйста",
    occupation: "Профессия",
    industry: "Отрасль",
    funds_sources: "Происхождение средств",
    funds_description: "Описание",
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
    payment_method: "Как вы будете платить?",
    payment_method_details: "Опишите, пожалуйста",
    account_country: "Страна счёта",
    account_holder: "Владелец счёта",
    bank_name: "Название банка",
    via_third_party: "Производится ли оплата через третье лицо или платёжного провайдера?",
    via_third_party_details: "Опишите, пожалуйста (кто, какой сервис)",
  },
  missing: {
    privacy_ack: "Подтверждение информации о защите данных",
    id_document_upload: "Фото или скан документа",
    funds_proof_upload: "Подтверждение происхождения средств",
    relationship: "Кем вы приходитесь: уточнение",
    funds_description: "Происхождение средств: описание",
    payment_method: "Способ оплаты",
    payment_method_details: "Способ оплаты: описание",
    via_third_party: "Оплата через третьих лиц",
    via_third_party_details: "Оплата через третьих лиц: описание",
    pep_self_details: "Государственная должность: подробности",
    pep_related_details: "Политически значимое близкое лицо: подробности",
    high_risk_country_code: "Страна высокого риска: какая именно",
    sanctions_links_details: "Санкции: подробности",
    other: "Другие данные",
  },
  legalTopics: {
    pep_self: "Государственная должность",
    pep_related: "Политически значимое близкое лицо",
    high_risk_country: "Страна высокого риска",
    sanctions_links: "Санкции",
  },
  identityIntro: "Пожалуйста, укажите данные вашего документа, удостоверяющего личность, и загрузите его фото или скан.",
  identityIntroOrganisation:
    "Пожалуйста, укажите данные документа лица, которое представляет организацию, и загрузите его фото или скан.",
  idDocumentTypes: {
    passport: "Паспорт (заграничный)",
    id_card: "Удостоверение личности (ID-карта)",
    residence_permit: "Вид на жительство",
  },
  identityFiles: "Фото или скан документа",
  identityUploadButton: "Загрузить фото или скан",
  uploadHint: "PDF, JPG или PNG, до 25 МБ на файл.",
  uploading: "Загружается…",
  noIdentityDocuments: "Документ ещё не загружен.",
  removeDocument: "Удалить",
  documentReviewed: "Проверено GMED",
  fileTooLarge: (name) => `${name} больше 25 МБ.`,
  tooManyDocuments: "Больше файлов загрузить нельзя. Пожалуйста, обратитесь в GMED.",
  uploadFailed: (name) => `Не удалось загрузить ${name}. Пожалуйста, проверьте файл (PDF, JPG или PNG, до 25 МБ).`,
  uploadReviewed: "GMED уже проверила этот файл; удалить его больше нельзя.",
  removeFailed: "Не удалось удалить файл.",
  ownersIntro:
    "Пожалуйста, укажите каждое физическое лицо, которому принадлежит более 25 % долей или голосов либо которое иным образом контролирует организацию.",
  ownersOptional: "Для организаций и страховых компаний эти данные необязательны.",
  ownerHeading: (index) => `Лицо ${index}`,
  ownerFields: {
    first_name: "Имя",
    last_name: "Фамилия",
    date_of_birth: "Дата рождения",
    birth_place: "Место рождения",
    street: "Улица и дом",
    zip: "Почтовый индекс",
    city: "Город",
    country: "Страна",
    share_percent: "Доля, %",
  },
  ownerAddress: "Адрес",
  addOwner: "Добавить лицо",
  removeOwner: "Удалить лицо",
  ownerIncomplete: "Пожалуйста, укажите имя и фамилию; только тогда это лицо будет сохранено.",
  ownerShare: "Пожалуйста, укажите долю больше 0 и не более 100 % (не более двух знаков после запятой).",
  ownersTotal: "В сумме доли превышают 100 %.",
  noOwners: "Пока не указано ни одного лица.",
  ownersLimit: "Можно указать не более 10 лиц.",
  relationshipKinds: {
    spouse: "Супруг / супруга",
    parent: "Мать / отец",
    child: "Сын / дочь",
    relative: "Другой родственник",
    employer: "Работодатель",
    friend: "Друг / подруга",
    business_partner: "Деловой партнёр",
    other: "Другое",
  },
  fundsSources: {
    employment: "Заработная плата / работа по найму",
    business_income: "Доход от предпринимательской деятельности",
    savings: "Сбережения",
    asset_sale: "Продажа имущества",
    inheritance_gift: "Наследство / дарение",
    other: "Другое",
  },
  fundsDescriptionHint: "Для «Другое» опишите, пожалуйста; в остальных случаях необязательно.",
  fundsProof: "Подтверждение происхождения средств",
  fundsProofRequired: "обязательно",
  fundsProofOptional: "необязательно",
  fundsProofHint:
    "Например, банковская выписка, расчётный листок, договор купли-продажи или свидетельство о наследстве. PDF, JPG или PNG, до 25 МБ на файл.",
  fundsProofButton: "Загрузить подтверждение",
  noFundsProof: "Подтверждение ещё не загружено.",
  paymentMethods: {
    bank_transfer: "Банковский перевод",
    card: "Карта",
    cash: "Наличные",
    crypto: "Криптовалюта",
    other: "Другое",
  },
  cashCryptoNote: "Оплату наличными и криптовалютой GMED проверяет отдельно (закон о противодействии отмыванию денег).",
  declarationsIntro:
    "Эти вопросы требует немецкий закон о противодействии отмыванию денег. Пожалуйста, ответьте на каждый «да» или «нет».",
  yesNo: { yes: "Да", no: "Нет" },
  summaryIntro: "Пожалуйста, проверьте данные перед отправкой.",
  missingTitle: "Пожалуйста, дополните:",
  complete: "Все обязательные данные указаны.",
  goToStep: "Дополнить",
  edit: "Изменить",
  confirmLabel: "Я подтверждаю, что мои данные полные и верные.",
  submit: "Отправить",
  submitting: "Отправляется…",
  submitNeedsConfirm: "Пожалуйста, подтвердите, что ваши данные полные и верные.",
  submitNeedsMissing: "Пожалуйста, сначала дополните недостающие данные.",
  thanksTitle: "Спасибо.",
  thanksBody: "Ваши данные поступили в GMED.",
  submittedAt: (dateTime) => `Отправлено ${dateTime}`,
  thanksNext: "Если что-то изменится, обратитесь, пожалуйста, в GMED.",
  summaryTitle: "Ваши данные",
  notStated: "Не указано",
  noDocuments: "Нет файла",
};

const TEXTS: Record<LeadCabinetLang, PayerLinkText> = { de, en, uk, ru };

/** The texts of a language; anything that is not DE, EN, UA or RU reads German. */
export function payerLinkText(lang: string | null | undefined): PayerLinkText {
  return TEXTS[asLeadCabinetLang(lang) ?? "de"];
}

/** All four, for the tests. */
export const PAYER_LINK_TEXTS: Readonly<Record<LeadCabinetLang, PayerLinkText>> = TEXTS;

/** The title of a step; details and identity read differently for an organisation. */
export function stepTitle(text: PayerLinkText, step: PayerStep, payerType: PayerType): string {
  if (isOrganisation(payerType) && (step === "details" || step === "identity")) return text.organisationSteps[step];
  return text.steps[step];
}

/** The label of a form field for this payer type. */
export function fieldLabel(text: PayerLinkText, field: PayerLabelField, payerType: PayerType): string {
  if (field === "organisation_name" && isOrganisation(payerType)) return text.organisationName[payerType];
  return text.fields[field];
}

const SEAT_FIELDS: ReadonlySet<string> = new Set(["street", "zip", "city", "country"]);
const REPRESENTATIVE_FIELDS: ReadonlySet<string> = new Set([
  "representative_first_name",
  "representative_last_name",
  "representative_role",
]);

/** How a key of `missing_for_submit` reads in the list "please add". */
export function missingLabel(text: PayerLinkText, key: string, payerType: PayerType): string {
  if (key in text.missing && key !== "other") return text.missing[key as MissingLabelKey];
  if ((LEGAL_QUESTIONS as readonly string[]).includes(key)) return text.legalTopics[key as LegalQuestion];
  if (!isPayerField(key) && key !== "email") return text.missing.other;
  const label = fieldLabel(text, key, payerType);
  if (isOrganisation(payerType) && SEAT_FIELDS.has(key)) return text.seatLabel(label);
  if (REPRESENTATIVE_FIELDS.has(key)) return text.representativeLabel(label);
  return label;
}

/** The labels of the missing keys in the order of the form, each once. */
export function missingLabels(text: PayerLinkText, missing: readonly string[], payerType: PayerType): string[] {
  return Array.from(new Set(sortMissing(missing, payerType).map((key) => missingLabel(text, key, payerType))));
}
