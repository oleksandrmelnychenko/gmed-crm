import { countryLabel } from "@/components/ui/country-select";
import { servicesText } from "./lead-request-services-text";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { disclosureDefaultsToNo, formatBirthDate, personScope, storedTrustedPersons } from "./lead-trusted-persons-model";
import { REPRESENTATIVE_COUNTRY_FIELDS } from "./lead-request-representative-questions-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";
import { asksAccount, asksPaymentRoute, type BillingField } from "./lead-request-billing-model";
import {
  STATED_FUNDS_SOURCES,
  blockAAsks,
  draftFromExtra,
  followUpShown,
  openFollowUpBlocks,
  paymentReasonAskedWithPayer,
  type StatedFundsSource,
} from "./lead-request-follow-up-model";
import {
  LEGAL_QUESTIONS,
  answerFromBoolean,
  draftFromPayer,
  languageName,
  organisationPayerType,
  payerAnswer,
  payerChoiceOf,
  payerTypeOf,
  type PayerField,
} from "./lead-request-model";
import { draftFromRecipient, flowOf, knowsRecipient, payerFitsFlow } from "./lead-request-recipient-model";
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
  childSectionTitle,
  extraFieldLabel,
  extraWorkSubject,
  followUpFieldLabel,
  recipientFieldLabel,
  recipientOptions,
  hasInsuranceLabel,
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
  | "payment"
  | "legal"
  | "follow_up"
  | "request"
  | "documents"
  | "services"
  | "disclosure"
  | "consent_form";

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

function custodyOf(request: Pick<LeadRequest, "minor" | "representation">) {
  return request.minor ? (request.representation?.custody ?? "joint") : null;
}

/**
 * "Who pays" when a parent or legal representative pays (owner decision
 * 2026-10-19): the contracting representative, never a third party. The
 * summary names that person — "I (as a parent) – name" for the own login,
 * else the representative's heading with the name — instead of reading the
 * answer as "a private person". `null` for any other payer.
 */
function representativePayerLabel(
  request: Pick<LeadRequest, "payer" | "payer_self_template" | "representation" | "minor">,
  text: LeadRequestText,
  custody: ReturnType<typeof custodyOf>,
): string | null {
  const payer = request.payer;
  if (payer?.payer_kind !== "representative") return null;
  const person = request.representation?.representatives.find((item) => item.id === payer.payer_representative_id);
  const name = [payer.first_name, payer.last_name].map((part) => part?.trim()).filter(Boolean).join(" ")
    || [person?.first_name, person?.last_name].map((part) => part?.trim()).filter(Boolean).join(" ");
  const mine = person ? person.mine : payerAnswer(payer, request.payer_self_template ?? null) === "guardian";
  const label = mine
    ? text.recipient.payerOptions.guardian
    : person?.slot
      ? representativeHeading(text, person.slot, false, custody)
      : text.payerRelationshipOptions.parent;
  return name ? `${label} – ${name}` : label;
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

  group("person", childSectionTitle(text, "person", request.minor), [
    [identificationLabel("salutation"), request.minor ? "" : option(text.salutationOptions, identification?.salutation)],
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

  group("address", childSectionTitle(text, "address", request.minor), [
    [text.fields.street_address, data.street_address],
    [text.fields.zip_code, data.zip_code],
    [text.fields.city, data.city],
    [text.fields.country, country(data.country)],
  ]);

  group("contact", childSectionTitle(text, "contact", request.minor), [
    [text.fields.phone, data.phone],
    [text.fields.primary_language, data.primary_language ? languageName(data.primary_language, lang) : ""],
    [
      identificationLabel("contact_channels"),
      (identification?.contact_channels ?? []).map((channel) => option(text.contactChannelOptions, channel)).filter(Boolean).join(", "),
    ],
  ]);

  // Who acts for the lead: the answers of an adult or the custody of a minor,
  // then each person the form asks for, with the files (step 1, like the form).
  const representation = request.representation;
  if (representation) {
    const custody = custodyOf(request);
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
          // Only an answer given: until then the server lists the custody as missing.
          ? [[text.custodyQuestion, representation.custody_stated ? text.custodyOptions[custody] : null]]
          : [
              [text.hasRepresentativeQuestion, yesNo(representation.has_representative)],
              // Asked only after its "yes" (owner 2026-10-11).
              [text.underGuardianshipQuestion, yesNo(representation.under_guardianship)],
            ],
      ),
      empty: text.summaryEmpty,
      parts,
    });
  }

  // The identity document, the step after the person: the copies only, GMED enters the data.
  if (identification) {
    group("identity", childSectionTitle(text, "identity", request.minor), [[request.minor ? text.childIdentityFiles : text.identityFiles, fileNames(request.identity_documents)]]);
  }

  group("insurance", childSectionTitle(text, "insurance", request.minor), [
    [hasInsuranceLabel(text, request), yesNo(data.has_insurance)],
    ...(data.has_insurance
      ? ([
          [text.fields.insurance_type, option(text.insuranceTypeOptions, data.insurance_type)],
          [text.fields.insurance_provider, data.insurance_provider],
          [text.fields.insurance_number, data.insurance_number],
          [text.fields.insurance_covers_germany, option(text.insuranceCoverageOptions, data.insurance_covers_germany)],
        ] satisfies Array<[string, string | null]>)
      : []),
  ]);

  // Step 3 (owner spec 2026-10-11): who receives the invoice and whether that
  // recipient pays, before who pays; the data of a recipient who pays are the payer's.
  const flowKnown = knowsRecipient(request);
  if (request.billing && flowKnown) {
    const billing = request.billing;
    const recipient = billing.recipient;
    const third = billing.invoice_recipient === "third_party";
    const recipientDraft = draftFromRecipient(billing);
    const paying = billing.invoice_recipient_is_payer === true && payerFitsFlow(flowOf(recipientDraft), payer, recipientDraft, billing.payment_route_by === "guardian", request.representation?.representatives);
    const invoiceParent = request.representation?.representatives.find((person) => person.id === recipient?.representative_id);
    const party = third && !paying && recipient ? recipient : null;
    const organisation = party?.type === "organisation";
    const kind = option(text.payerRelationshipOptions, party?.relationship_kind);
    const relationship =
      party?.relationship_kind && party.relationship_kind !== "other" ? kind : party?.relationship?.trim() || kind;
    const name = party
      ? organisation
        ? party.organisation_name
        : [party.first_name, party.last_name].filter((part) => part?.trim()).join(" ") || party.name
      : "";
    group("billing", text.recipient.section, [
      [
        text.recipient.question,
        // "One of the parents" when the other parent receives the invoice; that parent's name follows.
        billing.invoice_recipient ? recipientOptions(text, request, Boolean(invoiceParent && !invoiceParent.mine))[billing.invoice_recipient] : "",
      ],
      [text.recipient.typeQuestion, third && recipient?.type ? text.recipient.typeOptions[recipient.type] : ""],
      [text.recipient.parentQuestion, invoiceParent ? [invoiceParent.first_name, invoiceParent.last_name].filter(Boolean).join(" ") : ""],
      [organisation ? text.recipient.organisationName : text.recipient.missingPrefix, name],
      [text.recipient.legalForm, organisation ? party?.legal_form : ""],
      [text.recipient.contactName, organisation ? party?.contact_name : ""],
      [recipientFieldLabel(text, "relationship_kind", guardian), organisation ? "" : relationship],
      [text.fields.street_address, party?.street],
      [text.fields.zip_code, party?.zip],
      [text.fields.city, party?.city],
      [text.billingFields.invoice_country, country(party?.country)],
      [third ? text.recipient.email : text.billingFields.invoice_email, paying && third ? "" : recipient?.email],
      [text.recipient.phone, party?.phone],
      [text.recipient.paymentReason, organisation ? party?.payment_reason : ""],
      [billing.invoice_recipient === "self" ? text.recipient.isPayerSelf : third ? text.recipient.isPayerThirdParty : text.recipient.isPayer, yesNo(billing.invoice_recipient_is_payer)],
    ]);
  }

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
      const organisation = Boolean(organisationPayerType(party.payer_type));
      return [
        // An older server does not know the type; it is then not shown. Step 3 names it in the first answer.
        [
          payerLabel("payer_type"),
          party.payer_type === undefined || flowKnown ? "" : text.payerTypeOptions[payerTypeOf(party)],
        ],
        ...named,
        // An organisation states why the payment goes through it (owner 2026-10-11).
        [payerLabel("payer_relationship"), organisation && flowKnown ? "" : relationship],
        [text.recipient.paymentReason, organisation && flowKnown ? identification?.payment_background : ""],
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
    // Step 3's one answer: the patient, the paying parent, a person or an organisation.
    const choice = payerChoiceOf(draftFromPayer(payer, guardian ? request.payer_self_template : null));
    const choiceLabel =
      choice === "self" && guardian ? text.recipient.payerSelfGuardian : choice ? text.recipient.payerOptions[choice] : "";
    group("payer", text.sectionPayer, [
      [
        text.payerQuestion,
        representativePayerLabel(request, text, custodyOf(request))
          ?? (flowKnown ? choiceLabel : option(guardian ? text.payerOptionsGuardian : text.payerOptions, answer)),
      ],
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
    // The account is a question of follow-up block C, not of the base form
    // (owner 2026-10-10): listed while block C is open or once the lead
    // answered it — never only the account holder offered from the name (QA
    // 2026-10-10).
    const blockCAsked =
      (followUpShown(request) && openFollowUpBlocks(request).includes("C"))
      || Boolean(billing.account_country?.trim())
      || Boolean(billing.bank_name?.trim())
      || (billing.via_third_party !== null && billing.via_third_party !== undefined);
    const account = asksAccount(billing.payment_method ?? "") && blockCAsked;
    // Step 3 lists the recipient above; here only how the patient side pays.
    const section7: Array<[string, string | null | undefined]> = flowKnown
      ? []
      : [
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
        ];
    // Nothing asked here: the one row sits under "invoice and payment", not under a heading it repeats (B7).
    group(flowKnown ? "payment" : "billing", flowKnown && routeAsked ? text.sectionPaymentRoute : text.sectionBillingSummary, [
      ...section7,
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
          ] satisfies Array<[string, string | null | undefined]>)
        : [[
            text.paymentMethodRow,
            // The other parent pays and answers it in the own access (owner 2026-10-23).
            guardian && request.payer?.payer_kind === "representative" ? text.paymentRouteByOtherParentShort : text.paymentRouteByPayerShort,
          ] satisfies [string, string]]),
    ]);
  }

  // The declarations: yes or no only (the details are follow-up blocks). Asked
  // only in block L since 2026-10-09: listed once answered (QA 2026-10-10).
  if (identification && LEGAL_QUESTIONS.some((question) => identification[question] !== null && identification[question] !== undefined)) {
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
      const subject = extraWorkSubject(request);
      if (asks.occupation) rows.push([extraFieldLabel(text, "occupation", subject), answers.occupation]);
      if (asks.sector) rows.push([extraFieldLabel(text, "sector", subject), answers.sector]);
      if (asks.funds_proof) rows.push([text.extraFields.funds_proof, fileNames(request.follow_up?.funds_proof_documents)]);
    }
    if (blocks.includes("B")) {
      // An organisation's reason stands with the payer (owner 2026-10-24: one place).
      if (!paymentReasonAskedWithPayer(request)) rows.push([identificationLabel("payment_background"), identification?.payment_background]);
      rows.push([identificationLabel("relationship_since"), identification?.relationship_since]);
      rows.push([text.relationshipProofTitle, fileNames(request.follow_up?.relationship_proof_documents)]);
    }
    if (blocks.includes("F")) {
      rows.push([identificationLabel("residence_since"), identification?.residence_since]);
      rows.push([identificationLabel("stay_reason"), option(text.stayReasonOptions, identification?.stay_reason)]);
      rows.push([
        identificationLabel("stay_reason_details"),
        identification?.stay_reason === "other" ? identification.stay_reason_details : "",
      ]);
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
    if (blocks.includes("R")) {
      for (const person of request.follow_up?.representatives ?? []) {
        for (const field of REPRESENTATIVE_COUNTRY_FIELDS) {
          const value = person.fields[field];
          const shown = typeof value === "boolean" ? yesNo(value)
            : field === "stay_reason" ? option(text.stayReasonOptions, value)
              : field === "sanctions_link_kind" ? option(text.sanctionsLinkKindOptions, value)
                : field === "pep_country" || field === "birth_country" ? country(value) : value;
          rows.push([`${person.name}: ${followUpFieldLabel(text, field)}`, shown]);
        }
      }
    }
    // K and L are listed in their own groups: with nothing else answered there is no
    // empty "follow-up" group (QA 2026-10-10).
    if (entered(rows).length > 0) group("follow_up", text.steps.follow_up, rows);
  }

  // This explicit decision is independent of whether Anlage 1's core choices were saved.
  if (request.disclosure) {
    const disclosure = request.disclosure;
    const wording = trustedPersonsText(lang);
    const relations = consentFormText(lang).recipientRelations;
    groups.push({
      id: "disclosure", title: wording.title, empty: text.summaryEmpty,
      rows: entered([
        [wording.question, yesNo(disclosure.allow_disclosure)],
        // The consent is asked only after "yes": after "no" there is nothing to consent to.
        [wording.consentHeading, disclosure.allow_disclosure ? [yesNo(disclosure.consent_given), disclosure.company_name].filter(Boolean).join(" · ") : ""],
        // No "saved · time · author" row: save metadata is not part of the answer (labels audit 2026-10-26, A3).
      ]),
      parts: disclosure.allow_disclosure ? storedTrustedPersons(request).map((person, index) => ({
        id: `disclosure-person-${index}`, title: person.name,
        // Date of birth and the phone the person calls from (owner 2026-10-26); a legacy contact while there is no phone.
        rows: entered([[wording.relation, relations[person.relation]], [wording.birthDate, formatBirthDate(person.birth_date)], [wording.phone, person.phone],
          [wording.contact, person.phone ? "" : person.contact], [wording.scope, personScope(person, lang)]]),
      })) : [],
    });
  } else if (disclosureDefaultsToNo(request)) {
    // Not answered counts as "no" (owner decision 2026-10-22): no information to third parties;
    // printed as the default, not as an answer the person gave (QA 2026-10-24, A-1).
    const wording = trustedPersonsText(lang);
    groups.push({
      id: "disclosure", title: wording.title, empty: text.summaryEmpty,
      rows: entered([[wording.question, `${yesNo(false)} (${wording.byDefault})`]]),
      parts: [],
    });
  }

  // The reason of the request (13.1), from a server that knows it.
  if (identification && "request_reason" in identification) {
    group("request", text.sectionRequest, [[identificationLabel("request_reason"), identification.request_reason]]);
  }

  group(
    "documents",
    text.sectionUpload,
    request.documents.map((document) => ["", document.file_name ?? "—"]),
  );

  if (request.service_preferences) {
    const services = request.service_preferences;
    const wording = servicesText(lang);
    group("services", text.steps.services, [
      [wording.from, services.program_date_from ? formatAppDate(services.program_date_from) : ""],
      [wording.to, services.program_date_to ? formatAppDate(services.program_date_to) : ""],
      [wording.services, services.services.map((key) => wording.options[key as keyof typeof wording.options] ?? key).join(", ")],
      ...services.services.flatMap((key): Entry[] => services.service_comments[key]?.trim()
        ? [[wording.options[key as keyof typeof wording.options] ?? key, services.service_comments[key]]] : []),
      [wording.notes, services.notes],
    ]);
  }

  // The choices of Anlage 1, the last part of step "documents", in the order of
  // the form (the server's JSON keys come in any order); the channels as one row.
  const consent = request.consent_form;
  if (consent?.choices) {
    const choices = consent.choices;
    const wording = consentFormText(lang, guardian && request.minor);
    const keys = (Object.keys(wording.options) as Array<keyof typeof choices>).filter((key) => key in choices);
    const channels = keys.filter((key) => key.startsWith("channel_"));
    group("consent_form", wording.title, [
      ...keys.filter((key) => !key.startsWith("channel_")).map((key): Entry => [wording.options[key], yesNo(choices[key])]),
      [wording.channelsTitle, channels.length > 0
        ? channels.filter((key) => choices[key]).map((key) => wording.options[key]).join(", ") || "—"
        : ""],
      ...(!request.disclosure && choices.named_recipients ? storedTrustedPersons(request).map((person): Entry =>
        [wording.recipientsTitle, [person.name, wording.recipientRelations[person.relation], formatBirthDate(person.birth_date), person.phone || person.contact, personScope(person, lang)].filter(Boolean).join(" · ")]) : []),
      // No save time of the own choice (labels audit 2026-10-26, A3); only the other parent's choice is named.
      [text.saved, consent.chosen_at && consent.chosen_by_me === false ? wording.savedByOtherAt(formatAppDateTime(consent.chosen_at)) : ""],
    ]);
  }

  // Only what was entered (QA 2026-10-10): a group without a statement, a
  // person or a remark is left out instead of saying "nothing yet".
  return groups.filter((item) => item.rows.length > 0 || Boolean(item.parts?.length) || Boolean(item.note));
}
