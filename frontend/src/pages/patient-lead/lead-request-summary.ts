import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { asksAccount, asksPaymentRoute, draftFromBillingExtras, type BillingField } from "./lead-request-billing-model";
import { STATED_FUNDS_SOURCES, blockAAsks, draftFromExtra, openFollowUpBlocks, type StatedFundsSource } from "./lead-request-follow-up-model";
import {
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
  invoiceToLabel,
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
  | "billing"
  | "legal"
  | "follow_up"
  | "request"
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
  /** A remark below the rows, e.g. that the payer answered and only GMED changes it. */
  note?: string;
};

type Entry = [string, string | null | undefined];

/** Only what was entered, trimmed. */
function enteredRows(rows: Entry[]): SummaryRow[] {
  return rows.flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : []));
}

/**
 * The consent that GMED sends the payer the cost estimate (phase 3b, 11.7),
 * as a row of "who pays": listed once given, like the consent to contact the
 * payer; while it is missing the list of what is still needed names it.
 */
function costEstimateConsentRow(givenAt: string | null | undefined, text: LeadRequestText): Entry {
  return [text.payerCostEstimateConsentShort, givenAt ? text.consentGivenAt(formatAppDateTime(givenAt)) : ""];
}

/**
 * The payer answered on the own link (`answered_by_payer`): the lead cabinet
 * no longer changes "who pays" — only GMED does — and the server sends only
 * what the lead named. `false` for an older server, which does not say so.
 */
export function payerAnsweredByPayer(request: Pick<LeadRequest, "payer">): boolean {
  return request.payer?.answered_by_payer === true;
}

/**
 * "Who pays" read-only, after the payer answered: what the lead named (the
 * answer, what the payer is, the name, the relationship, the consents to
 * contact the payer and to send it the cost estimate) and the own economic
 * interest. The lead cabinet shows
 * these rows in the block and in the summary of step "send".
 */
export function answeredPayerRows(request: LeadRequest, text: LeadRequestText): SummaryRow[] {
  const guardian = request.access_kind === "guardian";
  const payer = request.payer;
  if (!payer) return [];
  const option = (options: Record<string, string>, value: string | null | undefined) =>
    value ? options[value] ?? "" : "";
  const yesNo = (value: boolean | null | undefined) => option(text.yesNo, answerFromBoolean(value));
  const thirdParty = payer.payer_kind === "third_party";
  const label = (field: PayerField) => payerFieldLabel(text, field, guardian, payer.payer_type);
  const kind = option(text.payerRelationshipOptions, payer.relationship_kind);
  const relationship =
    payer.relationship_kind && payer.relationship_kind !== "other" ? kind : payer.relationship?.trim() || kind;
  return enteredRows([
    [text.payerQuestion, option(guardian ? text.payerOptionsGuardian : text.payerOptions, payerAnswer(payer))],
    ...(thirdParty
      ? ([
          [label("payer_type"), payer.payer_type === undefined ? "" : text.payerTypeOptions[payerTypeOf(payer)]],
          ...(organisationPayerType(payer.payer_type)
            ? ([[label("payer_organisation_name"), payer.organisation_name]] satisfies Entry[])
            : ([
                [label("payer_first_name"), payer.first_name],
                [label("payer_last_name"), payer.last_name],
              ] satisfies Entry[])),
          [label("payer_relationship"), relationship],
          [text.payerConsentShort, payer.contact_consent_at ? text.consentGivenAt(formatAppDateTime(payer.contact_consent_at)) : ""],
          costEstimateConsentRow(payer.cost_estimate_consent_at, text),
        ] satisfies Entry[])
      : []),
    [payerFieldLabel(text, "payer_own_account", guardian), yesNo(payer.acts_on_own_account)],
    [payerFieldLabel(text, "payer_beneficial_owner", guardian), payer.acts_on_own_account === false ? payer.beneficial_owner : ""],
  ]);
}

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
  ]);

  group("contact", text.sectionContact, [
    [text.fields.phone, data.phone],
    [text.fields.primary_language, data.primary_language ? languageName(data.primary_language, lang) : ""],
    [
      identificationLabel("contact_channels"),
      (identification?.contact_channels ?? []).map((channel) => option(text.contactChannelOptions, channel)).filter(Boolean).join(", "),
    ],
  ]);

  // The identity document: the copies only, GMED enters the data.
  if (identification) {
    group("identity", text.sectionIdentity, [[text.identityFiles, fileNames(request.identity_documents)]]);
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
          return country(person[field]);
        case "date_of_birth":
          return formatAppDate(person[field]);
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
          title: representativeHeading(text, slot, person.mine, custody),
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

  if (payer && payerAnsweredByPayer(request)) {
    // The payer answered: the same read-only rows as the block, and why they are read-only.
    groups.push({
      id: "payer",
      title: text.sectionPayer,
      rows: answeredPayerRows(request, text),
      empty: text.summaryEmpty,
      note: text.payerAnsweredByPayer,
    });
  } else if (payer !== undefined) {
    const thirdParty = payer?.payer_kind === "third_party" ? payer : null;
    // A parent's own answer "I pay" is stored as a third party; it is shown as it was given.
    const answer = payerAnswer(payer, guardian ? request.payer_self_template : null);
    const payerLabel = (field: PayerField) => payerFieldLabel(text, field, guardian, thirdParty?.payer_type);
    const thirdPartyRows = (party: NonNullable<typeof thirdParty>): Array<[string, string | null | undefined]> => {
      // A company, organisation or insurer has a name; a person has an identity.
      const named: Array<[string, string | null | undefined]> = organisationPayerType(party.payer_type)
        ? [
            [payerLabel("payer_organisation_name"), party.organisation_name],
            [payerLabel("payer_legal_form"), party.organisation_legal_form],
            [payerLabel("payer_register_number"), party.organisation_register_number],
            [payerLabel("payer_contact_name"), party.organisation_contact_name],
          ]
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
        [payerLabel("payer_email"), party.email],
        [payerLabel("payer_phone"), party.phone],
        [payerLabel("payer_messenger"), party.messenger],
        [payerLabel("payer_country"), country(party.country)],
        [payerLabel("payer_city"), party.city],
        [payerLabel("payer_street"), party.street],
        [payerLabel("payer_zip"), party.zip],
        [
          text.payerConsentShort,
          party.contact_consent_at ? text.consentGivenAt(formatAppDateTime(party.contact_consent_at)) : "",
        ],
        costEstimateConsentRow(party.cost_estimate_consent_at, text),
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

  // Invoice recipient and payment route: the entered rows of section 7 and,
  // when it is asked, of section 8; the payer's answer is named as such.
  const billing = request.billing;
  if (billing) {
    const label = (field: BillingField) => text.billingFields[field];
    const other = billing.invoice_to === "other";
    const routeAsked = asksPaymentRoute(billing.payment_route_by);
    const account = asksAccount(billing.payment_method ?? "");
    group("billing", text.sectionBillingSummary, [
      [
        label("invoice_to"),
        billing.invoice_to ? invoiceToLabel(text, billing.invoice_to, guardian, billing.payment_route_by) : "",
      ],
      [label("invoice_name"), other ? billing.invoice_name : ""],
      [label("invoice_street"), other ? billing.invoice_street : ""],
      [label("invoice_zip"), other ? billing.invoice_zip : ""],
      [label("invoice_city"), other ? billing.invoice_city : ""],
      [label("invoice_country"), other ? country(billing.invoice_country) : ""],
      [label("invoice_email"), billing.invoice_to === "payer" ? "" : billing.invoice_email],
      ...(routeAsked
        ? ([
            [label("payment_method"), option(text.paymentMethodOptions, billing.payment_method)],
            [label("payment_method_details"), billing.payment_method === "other" ? billing.payment_method_details : ""],
            [label("account_country"), account ? country(billing.account_country) : ""],
            [label("account_holder"), account ? billing.account_holder : ""],
            [label("bank_name"), account ? billing.bank_name : ""],
            [label("via_third_party"), yesNo(billing.via_third_party)],
            [label("via_third_party_details"), billing.via_third_party ? billing.via_third_party_details : ""],
            [
              text.billingExtrasFields.via_third_party_kind,
              billing.via_third_party && billing.via_third_party_kind
                ? text.viaThirdPartyKindOptions[billing.via_third_party_kind]
                : "",
            ],
            [text.billingExtrasFields.expected_total_eur, draftFromBillingExtras(billing).expected_total_eur],
          ] satisfies Array<[string, string | null | undefined]>)
        : [[text.sectionPaymentRoute, text.paymentRouteByPayerShort] satisfies [string, string]]),
    ]);
  }

  // The declarations: yes or no only (the details are follow-up blocks). Asked
  // only in block L since 2026-10-09: no empty group in the base form (QA 2026-10-10).
  if (
    identification &&
    (openFollowUpBlocks(request).includes("L") ||
      LEGAL_QUESTIONS.some((question) => identification[question] !== null && identification[question] !== undefined))
  ) {
    group(
      "legal",
      text.sectionLegal,
      LEGAL_QUESTIONS.map((question): [string, string] => [identificationLabel(question), yesNo(identification[question])]),
    );
  }

  // The follow-up blocks the server opened, answered (C, G and I are in their groups above).
  const blocks = openFollowUpBlocks(request);
  if (blocks.length > 0) {
    const rows: Array<[string, string | null | undefined]> = [];
    if (blocks.includes("A")) {
      const asks = blockAAsks(request);
      const answers = draftFromExtra(request.follow_up);
      const source = (value: string) =>
        (STATED_FUNDS_SOURCES as readonly string[]).includes(value) ? text.statedFundsSourceOptions[value as StatedFundsSource] : value;
      if (asks.payer_funds) {
        rows.push([text.extraFields.payer_funds_source, source(answers.payer_funds_source)]);
        rows.push([text.extraFields.payer_funds_description, answers.payer_funds_description]);
      }
      if (asks.funds) {
        rows.push([text.extraFields.funds_source, source(answers.funds_source)]);
        rows.push([text.extraFields.funds_description, answers.funds_description]);
      }
      if (asks.occupation) rows.push([text.extraFields.occupation, answers.occupation]);
      if (asks.sector) rows.push([text.extraFields.sector, answers.sector]);
      if (asks.funds_proof) rows.push([text.extraFields.funds_proof, fileNames(request.follow_up?.funds_proof_documents)]);
    }
    if (blocks.includes("B")) {
      rows.push([identificationLabel("payment_background"), identification?.payment_background]);
      rows.push([identificationLabel("relationship_since"), identification?.relationship_since]);
      rows.push([text.relationshipProofTitle, fileNames(request.follow_up?.relationship_proof_documents)]);
    }
    if (blocks.includes("F")) {
      rows.push([identificationLabel("residence_since"), identification?.residence_since]);
      rows.push([identificationLabel("stay_reason"), option(text.stayReasonOptions, identification?.stay_reason)]);
      rows.push([identificationLabel("stay_reason_details"), identification?.stay_reason_details]);
      rows.push([identificationLabel("former_citizenships"), countries(identification?.former_citizenships)]);
      rows.push([identificationLabel("other_residences"), identification?.other_residences]);
    }
    if (blocks.includes("H")) {
      rows.push([identificationLabel("pep_office"), identification?.pep_office]);
      rows.push([identificationLabel("pep_country"), country(identification?.pep_country)]);
      rows.push([identificationLabel("pep_period"), identification?.pep_period]);
      rows.push([identificationLabel("pep_relationship"), identification?.pep_relationship]);
      rows.push([identificationLabel("pep_wealth_origin"), identification?.pep_wealth_origin]);
    }
    if (blocks.includes("J")) {
      rows.push([identificationLabel("sanctions_link_name"), identification?.sanctions_link_name]);
      rows.push([identificationLabel("sanctions_link_kind"), option(text.sanctionsLinkKindOptions, identification?.sanctions_link_kind)]);
      rows.push([identificationLabel("sanctions_link_since_extent"), identification?.sanctions_link_since_extent]);
    }
    group("follow_up", text.steps.follow_up, rows);
  }

  // The reason of the request (13.1), from a server that knows it.
  if (identification && "request_reason" in identification) {
    group("request", text.sectionRequest, [[identificationLabel("request_reason"), identification.request_reason]]);
  }

  group(
    "documents",
    text.sectionUpload,
    request.documents.map((document) => ["", document.file_name ?? "—"]),
    text.noDocuments,
  );

  return groups;
}
