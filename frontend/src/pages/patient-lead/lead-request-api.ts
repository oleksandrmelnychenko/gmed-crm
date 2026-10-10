import { apiFetch } from "@/lib/api";

/** Consent to process the uploaded health documents (Art. 9 DSGVO), before the first upload. */
export const HEALTH_CONSENT = "health_data_processing";
/** Consent to process the entered data for the request, before "send to the manager". */
export const INQUIRY_CONSENT = "lead_inquiry_processing";

export type LeadRequestPersonalData = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  legal_sex: string | null;
  citizenships: string[];
  street_address: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  primary_language: string | null;
  /** The insurance block of wizard step 1 (owner request 2026-10-05). */
  has_insurance: boolean | null;
  insurance_type: string | null;
  insurance_provider: string | null;
  insurance_number: string | null;
  insurance_covers_germany: string | null;
};

/** What a third-party payer is: a natural person, or a company, organisation or insurer. */
export type PayerType = "person" | "company" | "organisation" | "insurance";

/**
 * Who pays, as stated in the cabinet (owner request 2026-10-05). A third
 * party is named with identity and citizenships; staff complete the rest.
 */
export type LeadRequestPayer = {
  payer_kind: "self" | "third_party";
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  citizenships: string[];
  /** Free text; with `relationship_kind` only for the kind `other`. */
  relationship: string | null;
  email: string | null;
  phone: string | null;
  /** WhatsApp / messenger number of a third party (2026-10-07); absent while none is stored. */
  messenger?: string | null;
  /**
   * Own economic interest (GwG): `null` until answered, absent on an older
   * server. On "no" the person in whose interest the patient acts is named.
   */
  acts_on_own_account?: boolean | null;
  beneficial_owner?: string | null;
  /**
   * The payer block of the owner spec, sections 5 and 6: what the third party
   * is (`null` for "I pay myself"), the name of a company, organisation or
   * insurer, the relationship from the list, and when the lead agreed that
   * GMED contacts the payer. All four are absent on an older server.
   */
  payer_type?: PayerType | null;
  organisation_name?: string | null;
  /**
   * The organisation mask (trigger flow, 2026-10-07): legal form, register
   * number and the contact person of a company, organisation or insurer.
   * `null` for a person; absent on an older server.
   */
  organisation_legal_form?: string | null;
  organisation_register_number?: string | null;
  organisation_contact_name?: string | null;
  /**
   * `spouse`, `parent`, `child`, `sibling`, `grandparent`, `relative`,
   * `employer`, `friend`, `business_partner` or `other`.
   */
  relationship_kind?: string | null;
  contact_consent_at?: string | null;
  /**
   * The payer answered on the own link (phase 3a): the cabinet shows only the
   * name, what the payer is, the relationship and the consent — every other
   * identity, address and contact key is `null` — and "who pays" is read-only
   * (`POST …/payer` answers 409 `payer_answered_by_payer`). Absent on an older
   * server.
   */
  answered_by_payer?: boolean;
  /**
   * When the lead agreed that GMED sends the third-party payer the cost
   * estimate (types of services and amounts only; contract phase 3b, 11).
   * Saved on its own (`saveLeadPayerCostEstimateConsent`), also while
   * `answered_by_payer` is true; cleared by the server with a change of the
   * payer. Absent on an older server, which does not ask for it.
   */
  cost_estimate_consent_at?: string | null;
};

/** What the cabinet sends: the whole answer, empty values left out. */
export type LeadRequestPayerInput = {
  payer_kind: "self" | "third_party";
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  citizenships?: string[];
  relationship?: string;
  email?: string;
  phone?: string;
  /** Always sent with a third party: `""` clears it. */
  messenger?: string;
  /** Left out until answered: the server then keeps the stored answer. */
  acts_on_own_account?: boolean;
  /** Sent with the answer "no" only. */
  beneficial_owner?: string;
  /** Sent with a third party to a server that knows the payer type. */
  payer_type?: PayerType;
  organisation_name?: string;
  /** The organisation mask; sent with a company, organisation or insurer only. */
  organisation_legal_form?: string;
  organisation_register_number?: string;
  organisation_contact_name?: string;
  relationship_kind?: string;
  /** `true` records the consent (the first time stays), `false` removes it. */
  contact_consent?: boolean;
};

/**
 * A parent's own data for the answer "I pay (as a parent)", taken from the
 * lead's trusted contact the login is linked to. A single-word name is the
 * last name: the first name is then empty. Citizenships and address come
 * from the parent's own representative data when the parent entered them;
 * an older server does not send these keys.
 */
export type PayerSelfTemplate = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  citizenships?: string[] | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
};

/**
 * The lead's own statements for the GwG identification sheet (owner spec
 * "Patientenformular", 2026-10-05). Everything is optional until the request
 * is sent. Since the trigger flow (2026-10-07) the identity document's data
 * are staff's (`id_*` are gone; a write answers 422 `staff_only`), the legal
 * questions are yes/no only, and the details of a "yes" are asked in the
 * follow-up blocks (F, B, H, J). Keys of the follow-up are absent on an older
 * server.
 */
export type LeadRequestIdentification = {
  /** `mr`, `ms` or `none`. */
  salutation: string | null;
  former_names: string | null;
  birth_place: string | null;
  birth_country: string | null;
  /** Only when it differs from the country of residence. */
  habitual_residence_country: string | null;
  /** Subset of `email`, `phone`, `messenger`. */
  contact_channels: string[];
  pep_self: boolean | null;
  pep_related: boolean | null;
  sanctions_links: boolean | null;
  /** Why another person pays (block B). */
  payment_background: string | null;
  /** Block B: since when the patient and the payer know each other (≤ 100). */
  relationship_since?: string | null;
  /** Block F: residence and citizenships. */
  residence_since?: string | null;
  other_residences?: string | null;
  /** ISO codes. */
  former_citizenships?: string[];
  /** `work`, `study`, `family` or `other`. */
  stay_reason?: string | null;
  stay_reason_details?: string | null;
  /** Block H: the public office (the patient's own "yes"). */
  pep_office?: string | null;
  /** ISO code. */
  pep_country?: string | null;
  pep_period?: string | null;
  pep_relationship?: string | null;
  pep_wealth_origin?: string | null;
  /** Block J: the link to a sanctioned person or company. */
  sanctions_link_name?: string | null;
  /** `family`, `business`, `ownership` or `other`. */
  sanctions_link_kind?: string | null;
  sanctions_link_since_extent?: string | null;
  /** "Grund der Anfrage" (owner 2026-10-07, 13.1): the lead's own words, ≤ 4000. */
  request_reason?: string | null;
  /** Set by the server when the request is sent with the confirmation. */
  declared_correct_at: string | null;
};

/** Only the changed keys: `""` clears a text, date or choice, `null` an answer. */
export type IdentificationPatch = Partial<
  Record<Exclude<keyof LeadRequestIdentification, "declared_correct_at">, string | string[] | boolean | null>
>;

export type LeadRequestConsent = {
  type: string;
  version: string;
  /** The exact text per language (de, ru, uk, en); what is shown is what is stored. */
  texts: Record<string, string>;
  given_at: string | null;
};

export type LeadRequestDocument = {
  id: string;
  file_name: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string;
  uploaded_by_me: boolean;
  reviewed: boolean;
  can_delete: boolean;
};

/**
 * The place a person has in the form: the first and second legal
 * representative of a minor, an adult's representative, an adult's legal
 * guardian (Betreuer).
 */
export type RepresentativeSlot = "rep1" | "rep2" | "agent" | "guardian";

export type RepresentativeRole = "legal_representative" | "authorised_representative" | "legal_guardian";

/** Who represents a minor: both parents, one parent alone, or a guardian. */
export type Custody = "joint" | "sole_parent" | "guardian";

/** A person who acts for the lead, with the own identity document and uploads. */
export type LeadRequestRepresentative = {
  id: string;
  /** `null`: on file at GMED, but not asked for in the form (a second parent with sole custody). */
  slot: RepresentativeSlot | null;
  role: RepresentativeRole;
  relation: string | null;
  /** The person the caller's login was issued for. */
  mine: boolean;
  /** The e-mail is a sign-in address: only staff change it. */
  email_locked: boolean;
  can_remove: boolean;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  birth_country: string | null;
  citizenships: string[];
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  /** Photos or scans of this person's identity document. */
  identity_documents: LeadRequestDocument[];
  /** Proof that this person may act: power of attorney, appointment, sole custody. */
  authority_documents: LeadRequestDocument[];
};

/**
 * Who acts for the lead (owner spec "Patientenformular", section 3). An adult
 * answers the two questions and `custody` is `null`; for a minor the answers
 * are `null` and `custody` is never `null` (not stated counts as `joint`).
 */
export type LeadRequestRepresentation = {
  has_representative: boolean | null;
  under_guardianship: boolean | null;
  custody: Custody | null;
  custody_stated: boolean;
  representatives: LeadRequestRepresentative[];
};

/** Only the changed answers: the two questions of an adult, or the custody of a minor. */
export type RepresentationPatch = {
  has_representative?: boolean | null;
  under_guardianship?: boolean | null;
  custody?: Custody;
};

/**
 * Only the changed keys of a person: `""` clears a text, date or choice.
 * `role` goes with the first save of a person, which creates it.
 */
export type RepresentativePatch = Partial<
  Record<
    Exclude<
      keyof LeadRequestRepresentative,
      | "id"
      | "slot"
      | "role"
      | "relation"
      | "mine"
      | "email_locked"
      | "can_remove"
      | "citizenships"
      | "identity_documents"
      | "authority_documents"
    >,
    string
  >
> & { citizenships?: string[]; role?: RepresentativeRole };

/** The two uploads of a representative: a copy of the identity document, and the proof of authority. */
export type RepresentativeUploadKind = "identity" | "authority";

/** Where the invoice goes: to the patient, to the declared payer, or to another address. */
export type InvoiceTo = "self" | "payer" | "other";

export type PaymentMethod = "bank_transfer" | "card" | "cash" | "crypto" | "other";

/**
 * Who answers how the treatment is paid (contract phase 2, D6): the patient
 * (nobody else pays), the paying parent whose login fills in the request, or
 * the payer, whom GMED asks on its own — the cabinet then asks nothing.
 */
export type PaymentRouteBy = "patient" | "guardian" | "payer";

/**
 * Invoice recipient and payment route (owner spec "Patientenformular",
 * sections 7 and 8). Both live on the payer declaration; the server clears
 * what does not belong to the chosen answer. Absent on an older server.
 */
export type LeadRequestBilling = {
  invoice_to: InvoiceTo | null;
  /** The address the invoice goes to; only with `other`. */
  invoice_name: string | null;
  invoice_street: string | null;
  invoice_zip: string | null;
  invoice_city: string | null;
  invoice_country: string | null;
  /** Only with `self` or `other`; the contact address is used when empty. */
  invoice_email: string | null;
  /** A third party is declared as payer: the answer `payer` is offered only then. */
  payer_declared: boolean;
  payment_route_by: PaymentRouteBy;
  payment_method: PaymentMethod | null;
  /** Only with the method `other`. */
  payment_method_details: string | null;
  /** The account the payment comes from; only with a bank transfer or a card. */
  account_country: string | null;
  account_holder: string | null;
  bank_name: string | null;
  /** The payment goes through a third person or a payment service provider. */
  via_third_party: boolean | null;
  via_third_party_details: string | null;
  /** The name of the person who pays, offered for the account holder; `null` for `payer`. */
  account_holder_suggestion: string | null;
  /**
   * Block C of the follow-up (trigger flow): through whom the payment goes
   * (`person` or `psp`, only with `via_third_party`), and the expected total
   * in EUR. Absent on an older server.
   */
  via_third_party_kind?: "person" | "psp" | null;
  expected_total_eur?: number | string | null;
};

/** What the block-C extras of the billing route take: `null` clears a value. */
export type BillingExtrasPatch = {
  via_third_party_kind?: string | null;
  expected_total_eur?: number | null;
};

/**
 * The paying parent's own questionnaire in short (contract phase 3a, 4.5):
 * sent only to the login of the parent who pays for the child; `null` (or
 * absent on an older server) for everybody else.
 */
export type LeadRequestPayerQuestionnaireSummary = {
  available: boolean;
  submitted_at: string | null;
  missing_count: number;
  /** The payer's signature package (phase 3b); absent on an older server. */
  signature_package?: LeadPayerSignaturePackage | null;
};

/**
 * Where the payer's signature package stands, as the payer and the paying
 * parent see it (contract phase 3b, 4.4 and 6.3): `sent` while the payer is
 * to sign, `signed` once it came back; `null` without such a package. No
 * titles, ids or request data.
 */
export type LeadPayerSignaturePackage = {
  status: "sent" | "signed";
  sent_at: string | null;
  signed_at: string | null;
};

/** An upload of the paying person (proof of the source of funds, identity document). */
export type LeadPayerDocument = {
  id: string;
  file_name: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  reviewed: boolean;
  can_delete: boolean;
};

/**
 * The answers of the paying person the cabinet reads (contract 3.5): the keys
 * the paying parent writes here, as the server holds them. Name, address and
 * identity document are the parent's representative data and stay there.
 */
export type LeadPayerAnswers = {
  salutation: string | null;
  former_names: string | null;
  habitual_residence_country: string | null;
  /** `de`, `en`, `uk` or `ru`. */
  language: string | null;
  occupation: string | null;
  /** Subset of the sources of funds. */
  funds_sources: string[];
  funds_description: string | null;
  pep_self: boolean | null;
  pep_self_details: string | null;
  pep_related: boolean | null;
  pep_related_details: string | null;
  high_risk_country: boolean | null;
  high_risk_country_code: string | null;
  sanctions_links: boolean | null;
  sanctions_links_details: string | null;
};

/** `GET /me/lead-requests/{lead_id}/payer-questionnaire`: the paying parent's questionnaire (contract 3.5). */
export type LeadPayerQuestionnaire = {
  /** `draft` or `submitted`. */
  state: string | null;
  email: string | null;
  privacy: { acknowledged_at: string | null; text_version: string | null; contact_channels: string[] };
  answers: LeadPayerAnswers;
  funds_proof_documents: LeadPayerDocument[];
  funds_proof_required: boolean;
  /** What is still missing for "send", in the order of the form (contract 3.5). */
  missing_for_submit: string[];
  declared_correct_at: string | null;
  submitted_at: string | null;
  /** The signature package, when the server sends it with the questionnaire; absent otherwise. */
  signature_package?: LeadPayerSignaturePackage | null;
};

/** Only the changed keys the paying parent may write; `null` clears a text, a choice or an answer. */
export type PayerQuestionnairePatch = Partial<Record<keyof LeadPayerAnswers, string | string[] | boolean | null>>;

/**
 * The follow-up blocks the cabinet asks (trigger flow, contract 3.1): A
 * funds, B relationship to the payer, C payment route, F residence and
 * citizenships, G representation, H public office, I identity document, J
 * links to sanctioned persons. D and E belong to the payer's own link.
 */
export type FollowUpBlock = "A" | "B" | "C" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

/**
 * "Wir benötigen ergänzende Angaben" (contract 3.1): which blocks are open,
 * in letter order, and what each still misses; with the answers of block A
 * and the proofs of blocks A and B. The cabinet learns nothing else — never
 * why (no points, level, trigger or reason). Absent on an older server.
 */
export type LeadRequestFollowUp = {
  required: boolean;
  blocks: string[];
  missing: Record<string, string[]>;
  answered_at: string | null;
  /** Block A's answers as saved through `…/enhanced-details`. */
  answers?: Partial<ExtraAnswers>;
  /** The source list the server offers, in form order. */
  funds_source_options?: string[];
  /** Block A: the uploaded proofs of the own funds (bank statement, salary slip …). */
  funds_proof_documents?: LeadRequestDocument[];
  /** Block B: proofs of the relationship to the payer. */
  relationship_proof_documents?: LeadRequestDocument[];
  /**
   * Block I: the copies of the identity document that answer it — those
   * uploaded since GMED took the document's data down; an older copy is no
   * answer (QA 2026-10-10). Absent on an older server.
   */
  identity_documents?: LeadRequestDocument[];
};

/** Which questions of block A this login is asked (from who pays and what the server misses). */
export type ExtraQuestionAsks = {
  /** What the patient knows of the third party's funds. */
  payer_funds: boolean;
  /** The self-payer's own source of funds and its words. */
  funds: boolean;
  occupation: boolean;
  sector: boolean;
  /** The proofs of the own funds (at least one file). */
  funds_proof: boolean;
  /** A note: the paying person states its funds and proofs through the own link. */
  payer_states_funds: boolean;
};

/**
 * The answers of block A, saved through `…/enhanced-details`: one source
 * (`income`, `savings`, `asset_sale`, `inheritance_gift`, `other`) with the
 * words, profession and sector.
 */
export type ExtraAnswers = {
  funds_source: string | null;
  funds_description: string | null;
  payer_funds_source: string | null;
  payer_funds_description: string | null;
  occupation: string | null;
  sector: string | null;
};

/** Only the changed keys: `""` clears one. */
export type EnhancedDetailsPatch = Partial<Record<keyof ExtraAnswers, string>>;

/** The keys of the billing the cabinet writes: everything but what the server computes. */
export type BillingKey = Exclude<keyof LeadRequestBilling, "payer_declared" | "payment_route_by" | "account_holder_suggestion">;

/** Only the changed keys: `""` clears a text or a choice, `null` an answer. */
export type BillingPatch = Partial<Record<BillingKey, string | boolean | null>>;

/** One request (lead) the login fills in: its own or, as a parent, a child's. */
export type LeadRequest = {
  lead_id: string;
  access_kind: "self" | "guardian";
  created_at: string;
  personal_data: LeadRequestPersonalData;
  progress: {
    filled: number;
    total: number;
    missing_for_submit: string[];
    /**
     * The same keys by the step of the cabinet they are answered in (contract
     * 3.1): `person`, `contact`, `identity`, `payer`, `billing`,
     * `declarations`. Absent on an older server: the cabinet then maps the keys itself.
     */
    missing_by_step?: Partial<Record<string, string[]>>;
  };
  /** `null` until the question is answered; absent on an older server. */
  payer?: LeadRequestPayer | null;
  /**
   * For a parent's login linked to a trusted contact of the lead; otherwise
   * `null`. Absent on a server that does not know the payer type yet.
   */
  payer_self_template?: PayerSelfTemplate | null;
  /** The statements for the identification; absent on an older server. */
  identification?: LeadRequestIdentification;
  /** Photos or scans of the identity document; never among `documents` (medical). */
  identity_documents?: LeadRequestDocument[];
  /** Who acts for the lead; absent on an older server. `minor` says which of the two blocks applies. */
  representation?: LeadRequestRepresentation;
  /** Invoice recipient and payment route; absent on an older server. */
  billing?: LeadRequestBilling;
  /** The paying parent's own questionnaire; set only for the parent who pays (phase 3a). */
  payer_questionnaire?: LeadRequestPayerQuestionnaireSummary | null;
  /** The follow-up blocks to answer; never why. Absent on an older server. */
  follow_up?: LeadRequestFollowUp;
  /**
   * True from sending until GMED sends the first document for signature, for
   * every request alike: "Ihre Angaben werden geprüft". Absent on an older server.
   */
  review_notice?: boolean;
  minor: boolean;
  documents: LeadRequestDocument[];
  max_documents: number;
  consents: Record<string, LeadRequestConsent>;
  submitted_at: string | null;
  /** Data or documents changed after sending; absent on an older server. */
  changed_since_submit?: boolean;
  retention_deadline_at: string | null;
};

export type PersonalDataPatch = Partial<Record<keyof LeadRequestPersonalData, string | string[]>>;

const base = (leadId: string) => `/me/lead-requests/${encodeURIComponent(leadId)}`;

export async function fetchMyLeadRequests(): Promise<LeadRequest[]> {
  const result = await apiFetch<{ requests: LeadRequest[] }>("/me/lead-requests", { forceFresh: true });
  return result.requests ?? [];
}

export function saveLeadPersonalData(leadId: string, patch: PersonalDataPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/personal-data`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** The refusal of "who pays" once the payer answered on the own link: only GMED changes the payer then. */
export const PAYER_ANSWERED_BY_PAYER = "payer_answered_by_payer";

/** Saves the answer "who pays"; 409 `payer_answered_by_payer` after the payer answered on the own link. */
export function saveLeadPayer(leadId: string, payer: LeadRequestPayerInput): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/payer`, {
    method: "POST",
    body: JSON.stringify(payer),
  });
}

/** The refusal of the cost estimate consent when no third party pays (any more). */
export const NO_THIRD_PARTY_PAYER = "no_third_party_payer";

/**
 * The lead's consent that GMED sends the third-party payer the cost estimate
 * (contract phase 3b, 11.2): `true` records it (the first time stays), `false`
 * removes it. Saved at once and on its own, also while "who pays" is
 * read-only; 409 `no_third_party_payer` without a third party.
 */
export function saveLeadPayerCostEstimateConsent(leadId: string, consent: boolean): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/payer/cost-estimate-consent`, {
    method: "POST",
    body: JSON.stringify({ consent }),
  });
}

export function saveLeadIdentification(leadId: string, patch: IdentificationPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/identification`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export function giveLeadConsent(
  leadId: string,
  purpose: string,
  version: string,
  language: string,
): Promise<{ purpose: string; given_at: string; version: string }> {
  return apiFetch(`${base(leadId)}/consent`, {
    method: "POST",
    body: JSON.stringify({ purpose, version, language }),
  });
}

export function revokeLeadConsent(leadId: string, purpose: string): Promise<{ revoked: boolean }> {
  return apiFetch(`${base(leadId)}/consent/revoke`, {
    method: "POST",
    body: JSON.stringify({ purpose }),
  });
}

export function uploadLeadDocument(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/documents`, { method: "POST", body: form });
}

/** A photo or scan of the identity document; the server needs the request consent first. */
export function uploadLeadIdentityDocument(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/identity-document`, { method: "POST", body: form });
}

/** The answers about who acts for the lead; an answer taken back removes the person named for it. */
export function saveLeadRepresentation(leadId: string, patch: RepresentationPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/representation`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

const representative = (leadId: string, representativeId: string) =>
  `${base(leadId)}/representatives/${encodeURIComponent(representativeId)}`;

/** Saves the changed keys of a representative; an id the server does not know creates the person. */
export function saveLeadRepresentative(
  leadId: string,
  representativeId: string,
  patch: RepresentativePatch,
): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(representative(leadId, representativeId), {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** Removes a representative the cabinet created, with the uploads; the server refuses anybody else. */
export function removeLeadRepresentative(leadId: string, representativeId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(representative(leadId, representativeId), { method: "DELETE" });
}

/** An upload of a representative; like the lead's identity document it needs the request consent first. */
export function uploadLeadRepresentativeDocument(
  leadId: string,
  representativeId: string,
  kind: RepresentativeUploadKind,
  file: File,
): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${representative(leadId, representativeId)}/${kind}-document`, {
    method: "POST",
    body: form,
  });
}

/**
 * Saves the changed keys of the invoice recipient and the payment route. The
 * server answers 422 `invalid_field` with the key it refuses, and 409
 * `payment_route_by_payer` when the payment route is the payer's to answer.
 */
export function saveLeadBilling(leadId: string, patch: BillingPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/billing`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** Block C: through whom the payment goes and the expected total, on the billing route. */
export function saveLeadBillingExtras(leadId: string, patch: BillingExtrasPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/billing`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** The refusal of the own source of funds when somebody else pays (any more). */
export const PAYER_NOT_SELF = "payer_not_self";
/** The refusal of the payer's funds when nobody else pays (any more). */
export const PAYER_NOT_THIRD_PARTY = "payer_not_third_party";

/**
 * Saves the changed keys of block A. The server answers 422
 * `invalid_field` with the key it refuses, and 409 `payer_not_self` /
 * `payer_not_third_party` / `payer_not_declared` when who pays changed.
 */
export function saveLeadEnhancedDetails(leadId: string, patch: EnhancedDetailsPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/enhanced-details`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

/** A proof of the own funds; like the identity document it needs the request consent first. */
export function uploadLeadFundsProof(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/funds-proof`, { method: "POST", body: form });
}

/** Block B: a proof of the relationship to the payer; needs the request consent first. */
export function uploadLeadRelationshipProof(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/relationship-proof`, { method: "POST", body: form });
}

/** The refusal of "send the follow-up" while a block misses something; the body carries `missing`. */
export const FOLLOW_UP_INCOMPLETE = "follow_up_incomplete";

/**
 * Sends the answers of the follow-up blocks (contract 3.2). 422
 * `follow_up_incomplete` with `missing` (by block) while a block misses
 * something; otherwise the request with `follow_up.answered_at` set.
 */
export function submitLeadFollowUp(leadId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/follow-up/submit`, { method: "POST" });
}

/** Withdraws an own upload: a medical document, a copy of an identity document or a proof of authority. */
export function withdrawLeadDocument(leadId: string, documentId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

const payerQuestionnaire = (leadId: string) => `${base(leadId)}/payer-questionnaire`;

// The paying parent's own questionnaire (contract phase 3a, 5.2). Every call
// answers with the questionnaire (contract 3.5); the caller normalizes it,
// because the cabinet must not break on an answer of another shape.

export function fetchLeadPayerQuestionnaire(leadId: string): Promise<unknown> {
  return apiFetch<unknown>(payerQuestionnaire(leadId), { forceFresh: true });
}

/** Saves the changed keys; the server refuses a key the parent may not write (422 `invalid_field`). */
export function saveLeadPayerQuestionnaire(leadId: string, patch: PayerQuestionnairePatch): Promise<unknown> {
  return apiFetch<unknown>(payerQuestionnaire(leadId), { method: "POST", body: JSON.stringify(patch) });
}

/** The acknowledgement of the payer notice, with how the parent may be contacted; nothing is writable before it. */
export function acknowledgeLeadPayerNotice(leadId: string, contactChannels: string[]): Promise<unknown> {
  return apiFetch<unknown>(`${payerQuestionnaire(leadId)}/consent`, {
    method: "POST",
    body: JSON.stringify({ acknowledged: true, contact_channels: contactChannels }),
  });
}

/** A proof of the source of funds; withdrawn through `withdrawLeadDocument`. */
export function uploadLeadPayerFundsProof(leadId: string, file: File): Promise<unknown> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<unknown>(`${payerQuestionnaire(leadId)}/funds-proof`, { method: "POST", body: form });
}

/** Sends the questionnaire with the confirmation that it is complete and correct. */
export function submitLeadPayerQuestionnaire(leadId: string): Promise<unknown> {
  return apiFetch<unknown>(`${payerQuestionnaire(leadId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ declared_correct: true }),
  });
}

/**
 * Sends the request. `declaredCorrect` is the confirmation that the statements
 * are complete and true; a server that knows the identification requires it.
 */
export function submitLeadRequest(leadId: string, declaredCorrect: boolean): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/submit`, {
    method: "POST",
    ...(declaredCorrect ? { body: JSON.stringify({ declared_correct: true }) } : {}),
  });
}
