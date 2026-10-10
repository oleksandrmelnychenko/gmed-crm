/**
 * The § 15 GwG form (verstärkte Sorgfaltspflichten) takes what the lead and the
 * payer already answered (QA 2026-10-10): the source of funds of the cabinet's
 * follow-up block A (or of the payer's own link), the PEP details of block H,
 * the links to sanctioned persons of block J and the uploaded proofs of the
 * funds. It only fills fields staff left empty and never changes what staff
 * typed. The texts are German: they are printed on the German document.
 */
import type { AssetOriginEvidence } from "@/pages/documents/model/asset-origin-evidence";

import type { LeadGwgIdentification, LeadPortalEnhancedDetails } from "../data/lead-portal-intake-api";
import type { StaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import { statedFundsSourceLabel } from "./lead-payer";
import { payerFundsSourceLabel } from "./lead-payer-link";

/** The German side of the bilingual labels. */
const de = (_ru: string, german: string) => german;

/** What the lead and the payer answered, as the wizard has it. */
export type AmlLeadAnswers = {
  identification: LeadGwgIdentification | null | undefined;
  enhancedDetails: LeadPortalEnhancedDetails | null | undefined;
  /** The payer's own answers; only a sent questionnaire counts. */
  payer: StaffPayerQuestionnaire | null | undefined;
  /** ISO code → German country name. */
  countryName: (code: string) => string;
};

/** The fields of the form the answers fill. */
export type AmlPrefillTarget = {
  assetOrigin: string;
  assetOriginEvidence: AssetOriginEvidence[];
  additionalContractPartnerInfo: string;
  pepContractPartner: boolean;
  pepStatusChecked: boolean;
  pepOfficeFunction: string;
  pepAssetOrigin: string;
  sanctionsLinks: string;
};

export type AmlLeadPrefill = {
  assetOrigin: string;
  evidence: AssetOriginEvidence[];
  contractPartnerInfo: string;
  /** The lead said "yes" to "are you a PEP yourself". */
  pepSelf: boolean;
  pepOfficeFunction: string;
  pepAssetOrigin: string;
  sanctionsLinks: string;
};

const clean = (value: string | null | undefined) => value?.trim() ?? "";
const joined = (parts: readonly (string | null | undefined)[], separator: string) =>
  parts.map(clean).filter(Boolean).join(separator);

/** "Einkommen – Gehalt als Ingenieur": the sources in words, then the description. */
function fundsLine(sources: readonly string[], description: string | null | undefined, label: (source: string) => string) {
  return joined([sources.map(label).join(", "), description], " – ");
}

function sanctionsLinkKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "family":
      return "familiär";
    case "business":
      return "geschäftlich";
    case "ownership":
      return "Beteiligung / Eigentum";
    case "other":
      return "sonstige Verbindung";
    default:
      return clean(kind);
  }
}

/** The payer's answers once the payer sent them; drafts are not a statement. */
function sentPayer(payer: StaffPayerQuestionnaire | null | undefined) {
  return payer && (payer.submitted_at || payer.state === "submitted") ? payer : null;
}

function payerName(payer: StaffPayerQuestionnaire) {
  const answers = payer.answers;
  return clean(answers.organisation_name) || joined([answers.first_name, answers.last_name], " ");
}

/** The lead's and the payer's answers as texts of the form. */
export function amlPrefillFromLeadAnswers(input: AmlLeadAnswers): AmlLeadPrefill {
  const identification = input.identification ?? null;
  const details = input.enhancedDetails ?? null;
  const payer = sentPayer(input.payer);
  const statedLabel = (source: string) => statedFundsSourceLabel(source, de);
  const payerLabel = (source: string) => payerFundsSourceLabel(source, de);

  // Block A: the self-payer's own funds, what the patient knows of a payer's
  // funds, and the payer's own statement through the link.
  const assetLines: string[] = [];
  const ownFunds = details ? fundsLine(details.answers.funds_sources, details.answers.funds_description, statedLabel) : "";
  if (ownFunds) assetLines.push(`Angabe der Patientin/des Patienten: ${ownFunds}`);
  if (payer) {
    const answers = payer.answers;
    const payerFunds = fundsLine(answers.funds_sources, answers.funds_description, payerLabel);
    const work = joined([
      answers.occupation ? `Beruf: ${clean(answers.occupation)}` : "",
      answers.industry ? `Branche: ${clean(answers.industry)}` : "",
    ], "; ");
    const statement = joined([payerFunds, work], "; ");
    if (statement) {
      const name = payerName(payer);
      assetLines.push(`Angabe des Kostenübernehmers${name ? ` (${name})` : ""}: ${statement}`);
    }
  }
  const statedForPayer = details
    ? fundsLine(details.answers.payer_funds_source ? [details.answers.payer_funds_source] : [], details.answers.payer_funds_description, statedLabel)
    : "";
  if (statedForPayer) assetLines.push(`Angabe der Patientin/des Patienten zur zahlenden Person: ${statedForPayer}`);

  const contractPartnerInfo = details
    ? joined([
        details.answers.occupation ? `Beruf: ${clean(details.answers.occupation)}` : "",
        details.answers.sector ? `Branche: ${clean(details.answers.sector)}` : "",
      ], "; ")
    : "";

  // The proofs of the funds the lead and the payer uploaded.
  const evidence: AssetOriginEvidence[] = [];
  const addEvidence = (documents: readonly { id: string; file_name: string }[] | undefined) => {
    for (const document of documents ?? []) {
      if (!document.id || evidence.some((item) => item.documentId === document.id)) continue;
      evidence.push({ documentId: document.id, filename: document.file_name });
    }
  };
  addEvidence(details?.funds_proof_documents);
  addEvidence(payer?.funds_proof_documents);

  // Block H: the PEP details; a family member or close associate says how.
  const pepSelf = identification?.pep_self === true;
  const pepRelated = identification?.pep_related === true;
  let pepOfficeFunction = "";
  if (pepSelf || pepRelated) {
    const office = joined([
      identification?.pep_office,
      identification?.pep_country ? input.countryName(identification.pep_country) : "",
      identification?.pep_period,
    ], ", ") || joined([pepSelf ? identification?.pep_self_details : identification?.pep_related_details], "");
    const relationship = !pepSelf && pepRelated
      ? `Familienmitglied / nahestehende Person einer PeP${identification?.pep_relationship ? ` (${clean(identification.pep_relationship)})` : ""}`
      : "";
    pepOfficeFunction = joined([relationship, office], ": ");
  }
  const pepAssetOrigin = pepSelf || pepRelated ? clean(identification?.pep_wealth_origin) : "";

  // Block J: the link to a sanctioned person; the payer's own answer as well.
  const sanctionsLines: string[] = [];
  if (identification?.sanctions_links === true) {
    const link = joined([
      identification.sanctions_link_name,
      identification.sanctions_link_kind ? `(${sanctionsLinkKindLabel(identification.sanctions_link_kind)})` : "",
    ], " ");
    const text = joined([link, identification.sanctions_link_since_extent], " – ") || clean(identification.sanctions_links_details);
    sanctionsLines.push(`Angabe der Patientin/des Patienten: ${text || "Verbindung angegeben, keine Einzelheiten"}`);
  }
  if (payer?.answers.sanctions_links === true) {
    const name = payerName(payer);
    const text = clean(payer.answers.sanctions_links_details);
    sanctionsLines.push(`Angabe des Kostenübernehmers${name ? ` (${name})` : ""}: ${text || "Verbindung angegeben, keine Einzelheiten"}`);
  }

  return {
    assetOrigin: assetLines.join("\n"),
    evidence,
    contractPartnerInfo,
    pepSelf,
    pepOfficeFunction,
    pepAssetOrigin,
    sanctionsLinks: sanctionsLines.join("\n"),
  };
}

/**
 * The form with the answers in every field staff left empty. The PEP box is
 * ticked only while staff have not checked the PEP status themselves; the
 * proofs are named only while the form names none (staff may remove them).
 */
export function applyAmlLeadPrefill<T extends AmlPrefillTarget>(form: T, prefill: AmlLeadPrefill): T {
  const fill = (current: string, value: string) => (current.trim() ? current : value || current);
  return {
    ...form,
    assetOrigin: fill(form.assetOrigin, prefill.assetOrigin),
    assetOriginEvidence: form.assetOriginEvidence.length > 0 ? form.assetOriginEvidence : prefill.evidence,
    additionalContractPartnerInfo: fill(form.additionalContractPartnerInfo, prefill.contractPartnerInfo),
    pepContractPartner: form.pepContractPartner || (prefill.pepSelf && !form.pepStatusChecked),
    pepOfficeFunction: fill(form.pepOfficeFunction, prefill.pepOfficeFunction),
    pepAssetOrigin: fill(form.pepAssetOrigin, prefill.pepAssetOrigin),
    sanctionsLinks: fill(form.sanctionsLinks, prefill.sanctionsLinks),
  };
}
