import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import {
  LEGAL_DETAILS,
  LEGAL_QUESTIONS,
  answerFromBoolean,
  languageName,
  organisationPayerType,
  payerAnswer,
  payerTypeOf,
  type PayerField,
} from "./lead-request-model";
import {
  REPRESENTATIVE_FIELDS,
  REPRESENTATIVE_SLOTS,
  asksRepresentativeField,
  authorityProofOf,
  representativeInSlot,
  type RepresentativeField,
} from "./lead-request-representation-model";
import {
  identificationFieldLabel,
  payerFieldLabel,
  representativeFieldLabel,
  representativeHeading,
  representativeUploadLabel,
  type LeadRequestText,
} from "./lead-request-text";

/** One statement in the summary; a row without a label is an entry of a list (a file). */
export type SummaryRow = { label: string; value: string };

export type SummaryGroupId =
  | "person"
  | "address"
  | "contact"
  | "identity"
  | "representation"
  | "insurance"
  | "payer"
  | "legal"
  | "documents";

/** A person inside a group: a representative with the own statements and files. */
export type SummaryPart = { id: string; title: string; rows: SummaryRow[] };

export type SummaryGroup = {
  id: SummaryGroupId;
  title: string;
  rows: SummaryRow[];
  /** What the group says while nothing was entered. */
  empty: string;
  /** The persons of the group, below its own rows. */
  parts?: SummaryPart[];
};

/**
 * What "send to the manager" sends, grouped like the form (step "send"). Only
 * what was entered is listed: what is still needed is the list of missing
 * fields. Groups an older server does not know are left out.
 */
export function requestSummary(request: LeadRequest, text: LeadRequestText, lang: string): SummaryGroup[] {
  const guardian = request.access_kind === "guardian";
  const data = request.personal_data;
  const identification = request.identification;
  const payer = request.payer;
  const groups: SummaryGroup[] = [];

  const country = (code: string | null | undefined) => countryLabel(code, lang);
  const countries = (codes: readonly string[] | null | undefined) =>
    (codes ?? []).map((code) => countryLabel(code, lang)).join(", ");
  const option = (options: Record<string, string>, value: string | null | undefined) =>
    value ? options[value] ?? "" : "";
  const yesNo = (value: boolean | null | undefined) => option(text.yesNo, answerFromBoolean(value));
  const identificationLabel = (field: Parameters<typeof identificationFieldLabel>[1]) =>
    identificationFieldLabel(text, field, guardian);
  const entered = (rows: Array<[string, string | null | undefined]>): SummaryRow[] =>
    rows.flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : []));
  const group = (id: SummaryGroupId, title: string, rows: Array<[string, string | null | undefined]>, empty = text.summaryEmpty) => {
    groups.push({ id, title, rows: entered(rows), empty });
  };
  const fileNames = (documents: readonly { file_name: string | null }[] | null | undefined) =>
    (documents ?? []).map((document) => document.file_name ?? "—").join(", ");

  group("person", text.sectionPerson, [
    [identificationLabel("salutation"), option(text.salutationOptions, identification?.salutation)],
    [text.fields.first_name, data.first_name],
    [text.fields.last_name, data.last_name],
    [text.fields.middle_name, data.middle_name],
    [identificationLabel("former_names"), identification?.former_names],
    [text.fields.date_of_birth, formatAppDate(data.date_of_birth)],
    [identificationLabel("birth_place"), identification?.birth_place],
    [identificationLabel("birth_country"), country(identification?.birth_country)],
    [text.fields.legal_sex, option(text.legalSexOptions, data.legal_sex)],
    [text.fields.citizenships, countries(data.citizenships)],
  ]);

  group("address", text.sectionAddress, [
    [text.fields.street_address, data.street_address],
    [text.fields.zip_code, data.zip_code],
    [text.fields.city, data.city],
    [text.fields.country, country(data.country)],
    [identificationLabel("habitual_residence_country"), country(identification?.habitual_residence_country)],
  ]);

  group("contact", text.sectionContact, [
    [text.fields.phone, data.phone],
    [text.fields.primary_language, data.primary_language ? languageName(data.primary_language, lang) : ""],
    [
      identificationLabel("contact_channels"),
      (identification?.contact_channels ?? []).map((channel) => option(text.contactChannelOptions, channel)).filter(Boolean).join(", "),
    ],
  ]);

  if (identification) {
    group("identity", text.sectionIdentity, [
      [identificationLabel("id_document_type"), option(text.idDocumentTypeOptions, identification.id_document_type)],
      [identificationLabel("id_document_number"), identification.id_document_number],
      [identificationLabel("id_issuing_authority"), identification.id_issuing_authority],
      [identificationLabel("id_issuing_country"), country(identification.id_issuing_country)],
      [identificationLabel("id_issued_on"), formatAppDate(identification.id_issued_on)],
      [identificationLabel("id_valid_until"), formatAppDate(identification.id_valid_until)],
      [text.identityFiles, fileNames(request.identity_documents)],
    ]);
  }

  // Who acts for the lead: the answers of an adult or the custody of a minor,
  // then each person the form asks for, with the files.
  const representation = request.representation;
  if (representation) {
    const custody = request.minor ? (representation.custody ?? "joint") : null;
    const stated = (person: LeadRequestRepresentative, field: RepresentativeField) => {
      switch (field) {
        case "citizenships":
          return countries(person.citizenships);
        case "birth_country":
        case "country":
        case "id_issuing_country":
          return country(person[field]);
        case "date_of_birth":
        case "id_issued_on":
        case "id_valid_until":
          return formatAppDate(person[field]);
        case "id_document_type":
          return option(text.idDocumentTypeOptions, person.id_document_type);
        default:
          return person[field];
      }
    };
    const parts = REPRESENTATIVE_SLOTS.flatMap((slot) => {
      const person = representativeInSlot(representation, slot);
      if (!person) return [];
      const proof = authorityProofOf(slot, custody);
      return [
        {
          id: slot,
          title: representativeHeading(text, slot, person.mine),
          rows: entered([
            ...REPRESENTATIVE_FIELDS.filter((field) => asksRepresentativeField(slot, field)).map(
              (field): [string, string | null | undefined] => [representativeFieldLabel(text, field), stated(person, field)],
            ),
            [representativeUploadLabel(text, slot, "identity"), fileNames(person.identity_documents)],
            // A proof is listed where the form asks for one.
            [
              proof ? text.representativeAuthority[proof.proof] : "",
              proof ? fileNames(person.authority_documents) : "",
            ],
          ]),
        },
      ];
    });
    groups.push({
      id: "representation",
      title: request.minor ? text.sectionLegalRepresentatives : text.sectionRepresentation,
      rows: entered(
        custody
          ? [[text.custodyQuestion, text.custodyOptions[custody]]]
          : [
              [text.hasRepresentativeQuestion, yesNo(representation.has_representative)],
              [text.underGuardianshipQuestion, yesNo(representation.under_guardianship)],
            ],
      ),
      empty: text.summaryEmpty,
      parts,
    });
  }

  group("insurance", text.sectionInsurance, [
    [text.fields.has_insurance, yesNo(data.has_insurance)],
    ...(data.has_insurance
      ? ([
          [text.fields.insurance_type, option(text.insuranceTypeOptions, data.insurance_type)],
          [text.fields.insurance_provider, data.insurance_provider],
          [text.fields.insurance_number, data.insurance_number],
          [text.fields.insurance_covers_germany, option(text.insuranceCoverageOptions, data.insurance_covers_germany)],
        ] satisfies Array<[string, string | null]>)
      : []),
  ]);

  if (payer !== undefined) {
    const thirdParty = payer?.payer_kind === "third_party" ? payer : null;
    // A parent's own answer "I pay" is stored as a third party; it is shown as it was given.
    const answer = payerAnswer(payer, guardian ? request.payer_self_template : null);
    const payerLabel = (field: PayerField) => payerFieldLabel(text, field, guardian, thirdParty?.payer_type);
    const thirdPartyRows = (party: NonNullable<typeof thirdParty>): Array<[string, string | null | undefined]> => {
      // A company, organisation or insurer has a name; a person has an identity.
      const named: Array<[string, string | null | undefined]> = organisationPayerType(party.payer_type)
        ? [[payerLabel("payer_organisation_name"), party.organisation_name]]
        : [
            [payerLabel("payer_first_name"), party.first_name],
            [payerLabel("payer_last_name"), party.last_name],
            [payerLabel("payer_date_of_birth"), formatAppDate(party.date_of_birth)],
            [payerLabel("payer_citizenships"), countries(party.citizenships)],
          ];
      // In words for "other" and for a text stored before the list existed.
      const kind = option(text.payerRelationshipOptions, party.relationship_kind);
      const relationship =
        party.relationship_kind && party.relationship_kind !== "other" ? kind : party.relationship?.trim() || kind;
      return [
        // An older server does not know the type; it is then not shown.
        [payerLabel("payer_type"), party.payer_type === undefined ? "" : text.payerTypeOptions[payerTypeOf(party)]],
        ...named,
        [payerLabel("payer_relationship"), relationship],
        [payerLabel("payer_street"), party.street],
        [payerLabel("payer_zip"), party.zip],
        [payerLabel("payer_city"), party.city],
        [payerLabel("payer_country"), country(party.country)],
        [payerLabel("payer_phone"), party.phone],
        [payerLabel("payer_email"), party.email],
        [identificationLabel("payment_background"), identification?.payment_background],
        [
          text.payerConsentShort,
          party.contact_consent_at ? text.consentGivenAt(formatAppDateTime(party.contact_consent_at)) : "",
        ],
      ];
    };
    group("payer", text.sectionPayer, [
      [text.payerQuestion, option(guardian ? text.payerOptionsGuardian : text.payerOptions, answer)],
      ...(thirdParty ? thirdPartyRows(thirdParty) : []),
      [payerFieldLabel(text, "payer_own_account", guardian), yesNo(payer?.acts_on_own_account)],
      [
        payerFieldLabel(text, "payer_beneficial_owner", guardian),
        payer?.acts_on_own_account === false ? payer.beneficial_owner : "",
      ],
    ]);
  }

  if (identification) {
    group(
      "legal",
      text.sectionLegal,
      LEGAL_QUESTIONS.flatMap((question): Array<[string, string | null | undefined]> => {
        const details = LEGAL_DETAILS[question];
        const stated = identification[details];
        return [
          [identificationLabel(question), yesNo(identification[question])],
          [
            identificationLabel(details),
            identification[question] ? (details === "high_risk_country_code" ? country(stated) : stated) : "",
          ],
        ];
      }),
    );
  }

  group(
    "documents",
    text.sectionUpload,
    request.documents.map((document) => ["", document.file_name ?? "—"]),
    text.noDocuments,
  );

  return groups;
}
