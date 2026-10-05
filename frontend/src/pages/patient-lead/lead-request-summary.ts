import { countryLabel } from "@/components/ui/country-select";
import { formatAppDate } from "@/lib/app-time-zone";

import type { LeadRequest } from "./lead-request-api";
import { LEGAL_DETAILS, LEGAL_QUESTIONS, answerFromBoolean, languageName } from "./lead-request-model";
import { identificationFieldLabel, payerFieldLabel, type LeadRequestText } from "./lead-request-text";

/** One statement in the summary; a row without a label is an entry of a list (a file). */
export type SummaryRow = { label: string; value: string };

export type SummaryGroupId =
  | "person"
  | "address"
  | "contact"
  | "identity"
  | "insurance"
  | "payer"
  | "legal"
  | "documents";

export type SummaryGroup = {
  id: SummaryGroupId;
  title: string;
  rows: SummaryRow[];
  /** What the group says while nothing was entered. */
  empty: string;
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
  const group = (id: SummaryGroupId, title: string, rows: Array<[string, string | null | undefined]>, empty = text.summaryEmpty) => {
    groups.push({
      id,
      title,
      rows: rows.flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : [])),
      empty,
    });
  };

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
      [text.identityFiles, (request.identity_documents ?? []).map((document) => document.file_name ?? "—").join(", ")],
    ]);
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
    group("payer", text.sectionPayer, [
      [text.payerQuestion, option(guardian ? text.payerOptionsGuardian : text.payerOptions, payer?.payer_kind)],
      ...(thirdParty
        ? ([
            [payerFieldLabel(text, "payer_first_name"), thirdParty.first_name],
            [payerFieldLabel(text, "payer_last_name"), thirdParty.last_name],
            [payerFieldLabel(text, "payer_date_of_birth"), formatAppDate(thirdParty.date_of_birth)],
            [payerFieldLabel(text, "payer_citizenships"), countries(thirdParty.citizenships)],
            [payerFieldLabel(text, "payer_relationship"), thirdParty.relationship],
            [payerFieldLabel(text, "payer_street"), thirdParty.street],
            [payerFieldLabel(text, "payer_zip"), thirdParty.zip],
            [payerFieldLabel(text, "payer_city"), thirdParty.city],
            [payerFieldLabel(text, "payer_country"), country(thirdParty.country)],
            [payerFieldLabel(text, "payer_phone"), thirdParty.phone],
            [payerFieldLabel(text, "payer_email"), thirdParty.email],
            [identificationLabel("payment_background"), identification?.payment_background],
          ] satisfies Array<[string, string | null | undefined]>)
        : []),
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
