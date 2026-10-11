import { useCallback, useRef, useState } from "react";

import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import {
  checkboxClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  NO_THIRD_PARTY_PAYER,
  PAYER_ANSWERED_BY_PAYER,
  fetchMyLeadRequests,
  saveLeadPayer,
  saveLeadPayerCostEstimateConsent,
  type LeadRequest,
} from "./lead-request-api";
import {
  IdentificationTextArea,
  type IdentificationForm,
} from "./lead-request-identification";
import {
  PAYER_FIELDS,
  RELATIONSHIP_KINDS,
  costEstimateConsentAsked,
  draftFromPayer,
  knowsOrganisationMask,
  knowsPayerType,
  payerAnswer,
  payerChoiceOf,
  payerInput,
  payerTypeOf,
  payerContactRequired,
  unansweredPayerDraft,
  withPayerChoice,
  withRelationshipKind,
  type PayerDraft,
  type PayerField,
  type SaveState,
} from "./lead-request-model";
import {
  CabinetSection as Section,
  ConsentGivenChip,
  LabeledField,
  RequiredMark,
  YesNoSelect,
  errorBody,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import { payerFitsFlow, type PayerChoice, type RecipientDraft, type RecipientFlow } from "./lead-request-recipient-model";
import { SummaryRows } from "./lead-request-send-step";
import { answeredPayerRows, payerAnsweredByPayer } from "./lead-request-summary";
import { asLeadCabinetLang, payerFieldLabel, type LeadRequestText } from "./lead-request-text";

/**
 * The autosave of "who pays" (owner request 2026-10-05): the whole answer is
 * sent once the draft has rested and differs from the saved one; a refused
 * answer is not repeated until it changes. Once the payer answered on the
 * own link, nothing is sent: the request is loaded afresh and the block turns
 * read-only. Shared by the payer form and by the invoice recipient who pays
 * (step 3, owner spec 2026-10-11), whose answer is built from the recipient.
 */
export function usePayerAutosave({
  request,
  draft,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  draft: PayerDraft;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}): { fieldError: string | null } {
  // An older server knows only a person as payer, with the relationship in words.
  const typed = knowsPayerType(request);
  // The payer answered on the own link: nothing is sent from the cabinet.
  const answeredRef = useRef(payerAnsweredByPayer(request));
  answeredRef.current = payerAnsweredByPayer(request);
  const savedRef = useRef<PayerDraft>(draftFromPayer(request.payer));
  const rejectedRef = useRef<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // A parent who pays is not asked to agree that GMED contacts them (the
  // parent is the payer); a server that still lists the consent as missing
  // (an older one) gets the box, or the request could not be sent.
  const serverAsksConsent = request.progress.missing_for_submit.includes("payer_contact_consent");

  const save = useCallback(
    (snapshot: PayerDraft) => {
      void enqueue(async () => {
        if (answeredRef.current) return;
        // Without the box the consent is left out: the server keeps what it has.
        const withConsent = !snapshot.guardian_pays || serverAsksConsent;
        const input = payerInput(snapshot, typed, withConsent);
        const key = JSON.stringify(input);
        if (key === JSON.stringify(payerInput(savedRef.current, typed, withConsent))) {
          // Back at the saved answer: an answer the server refused in between is no error any more.
          if (rejectedRef.current !== null) {
            rejectedRef.current = null;
            setFieldError(null);
            onSaveState("saved");
          }
          return;
        }
        if (!input || key === rejectedRef.current) return;
        onSaveState("saving");
        try {
          const next = await saveLeadPayer(request.lead_id, input);
          savedRef.current = draftFromPayer(next.payer);
          rejectedRef.current = null;
          setFieldError(null);
          onSaveState("saved");
          onChange(next);
        } catch (cause) {
          // The refused answer is not repeated until the patient changes it.
          rejectedRef.current = key;
          const body = errorBody(cause);
          if (body?.code === PAYER_ANSWERED_BY_PAYER) {
            // The payer has answered in the meantime: the request is loaded
            // afresh and the block turns read-only; nothing was saved.
            answeredRef.current = true;
            try {
              const fresh = (await fetchMyLeadRequests()).find((item) => item.lead_id === request.lead_id);
              if (fresh) {
                onChange(fresh);
                onSaveState("saved");
                return;
              }
            } catch {
              // The next load of the page shows the state.
            }
            onSaveState("error");
            return;
          }
          const field = body?.field;
          setFieldError(PAYER_FIELDS.includes(field as PayerField) ? (field as PayerField) : "payer");
          onSaveState("error");
        }
      });
    },
    [enqueue, onChange, onSaveState, request.lead_id, serverAsksConsent, typed],
  );

  useAutosave(draft, save);
  return { fieldError };
}

/**
 * "Who pays" in step 3 (owner spec 2026-10-11, "Patientenformular" sections
 * 5 and 6): asked when the invoice recipient does not pay. One answer of a
 * list — the patient himself (where it makes sense), the paying parent, a
 * person or an organisation (a company, organisation or insurer of an older
 * request counts as an organisation) — then the payer's data: a person's
 * name, citizenships, birth date and relationship to the patient, an
 * organisation's name, legal form, register number, contact person and why
 * the payment goes through it; contact, residence or seat, and the consents
 * to contact the payer and to pass the cost estimate on. The answer is saved
 * as a whole; the server keeps it in the lead's payer declaration, where the
 * sanctions screening picks it up. With `ownAccountOnly` (follow-up block L)
 * only the own economic interest is asked.
 */
export function PayerSection({
  request,
  text,
  lang,
  identification,
  enqueue,
  onChange,
  onSaveState,
  ownAccountOnly = false,
  choices = ["person", "organisation"],
  flow = null,
  recipient = null,
  question,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  /** The GwG statements; absent on a server that does not know them yet. */
  identification?: IdentificationForm;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  /**
   * Only the own economic interest (follow-up block L, owner 2026-10-09): asked with the
   * enhanced check, saved with the answer "who pays" as before.
   */
  ownAccountOnly?: boolean;
  /** The answers "who pays" offers in step 3. */
  choices?: readonly PayerChoice[];
  /** Step 3's answers: a stored payer that does not fit them is shown unanswered. */
  flow?: RecipientFlow | null;
  recipient?: RecipientDraft | null;
  /** The label of the list instead of "who is the payer?" ("the payer is", owner 2026-10-11). */
  question?: string;
}) {
  const guardian = request.access_kind === "guardian";
  const typed = knowsPayerType(request);
  // A parent's own data on file: the parent may answer "I pay".
  const template = guardian && typed ? (request.payer_self_template ?? null) : null;
  const answered = payerAnsweredByPayer(request);
  const [draft, setDraft] = useState<PayerDraft>(() => {
    const parentPays = payerAnswer(request.payer, template) === "guardian";
    const fits = !flow || !recipient || payerFitsFlow(flow, request.payer, recipient, parentPays);
    const stored = fits ? draftFromPayer(request.payer, template) : unansweredPayerDraft(request.payer);
    // A stored answer the list does not offer is no answer here.
    const choice = payerChoiceOf(stored);
    return ownAccountOnly || !choice || choices.includes(choice) ? stored : unansweredPayerDraft(request.payer);
  });
  const { fieldError } = usePayerAutosave({ request, draft, enqueue, onChange, onSaveState });
  // E-mail, phone and residence of a third party are required, not of the paying parent.
  const contactRequired = (name: "payer_email" | "payer_phone" | "payer_country" | "payer_city") =>
    payerContactRequired(draft, request, name);
  // "Same as phone": the messenger number follows the phone.
  const [messengerSameAsPhone, setMessengerSameAsPhone] = useState(
    () => Boolean(draft.messenger) && draft.messenger === draft.phone,
  );
  const serverAsksConsent = request.progress.missing_for_submit.includes("payer_contact_consent");
  const consentAsked = typed && (!draft.guardian_pays || serverAsksConsent);
  const costConsent = { request, text, enqueue, onChange, onSaveState };

  if (answered && ownAccountOnly) return null;
  if (answered) {
    // The paying parent answers as the payer: no consent to send oneself the cost estimate.
    const parentPays = payerAnswer(request.payer, template) === "guardian";
    return (
      <Section title={text.sectionPayer}>
        <div className="space-y-3" data-testid="lead-request-payer">
          <p
            role="note"
            className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm leading-5 text-muted-foreground"
            data-testid="lead-request-payer-answered"
          >
            {text.payerAnsweredByPayer}
          </p>
          <div data-testid="lead-request-payer-readonly">
            <SummaryRows rows={answeredPayerRows(request, text)} />
          </div>
          {/* So is the consent to pass the cost estimate on: it stays the lead's to give or take back. */}
          {costEstimateConsentAsked(request, parentPays) ? <CostEstimateConsent {...costConsent} /> : null}
        </div>
      </Section>
    );
  }

  const set = <K extends keyof PayerDraft>(field: K, value: PayerDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const choice = payerChoiceOf(draft);
  const choose = (next: string) => {
    if (next === choice) return;
    setDraft((current) => withPayerChoice(current, next, template));
    // Why somebody pays was said about the payer of the answer before.
    if (identification?.draft.payment_background) identification.set("payment_background", "");
  };
  const thirdParty = draft.payer_kind === "third_party";
  const payerType = typed ? payerTypeOf(draft) : "person";
  const organisation = payerType !== "person";
  // The organisation mask (trigger flow): a server that sends its keys knows it.
  const orgMask = typed && knowsOrganisationMask(request);
  const consentAt = request.payer?.contact_consent_at ?? null;
  const errorFor = (field: PayerField) => (fieldError === field ? text.invalidField : undefined);
  const fieldProps = (field: PayerField) => ({
    id: `lead-request-${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-${field}-error` : undefined,
  });
  const field = (name: PayerField, required = false, className?: string) => ({
    id: `lead-request-${name}`,
    label: payerFieldLabel(text, name, guardian, payerType),
    error: errorFor(name),
    required,
    className,
  });
  const choiceLabel = (value: PayerChoice) =>
    value === "self" && guardian ? text.recipient.payerSelfGuardian : text.recipient.payerOptions[value];

  if (ownAccountOnly) {
    return (
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="lead-request-payer-own-account">
        {identification && draft.payer_kind ? (
          <>
            <LabeledField {...field("payer_own_account", true, "sm:col-span-2 lg:col-span-3")}>
              <YesNoSelect
                id="lead-request-payer_own_account"
                className="sm:max-w-[calc(50%-0.5rem)]"
                value={draft.acts_on_own_account}
                text={text}
                // The server keeps an answer once given; it can be changed, not taken back.
                keepAnswer
                invalid={Boolean(errorFor("payer_own_account"))}
                onChange={(ownAccount) => set("acts_on_own_account", ownAccount)}
              />
            </LabeledField>
            {draft.acts_on_own_account === "no" ? (
              <LabeledField {...field("payer_beneficial_owner", true, "sm:col-span-2 lg:col-span-3")}>
                <textarea
                  {...fieldProps("payer_beneficial_owner")}
                  className={cn(textareaClass, "text-base md:text-sm")}
                  rows={3}
                  maxLength={2000}
                  autoComplete="off"
                  value={draft.beneficial_owner}
                  onChange={(event) => set("beneficial_owner", event.target.value)}
                />
              </LabeledField>
            ) : null}
          </>
        ) : null}
        {fieldError === "payer" ? (
          <p role="alert" className="text-xs text-destructive sm:col-span-2 lg:col-span-3">
            {text.notSaved}
          </p>
        ) : null}
      </div>
    );
  }

  // Several cards (owner 2026-10-09): who pays, the payer, contact, residence and the consents.
  return (
    <div className="space-y-4" data-testid="lead-request-payer">
      <Section title={text.recipient.payerSection}>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledField
            {...field("payer_kind", true, "sm:col-span-2 lg:col-span-3")}
            label={question ?? payerFieldLabel(text, "payer_kind", guardian, payerType)}
          >
            <NativeComboboxSelect
              {...fieldProps("payer_kind")}
              className={cn(selectClass, "sm:max-w-[calc(50%-0.5rem)]")}
              value={choice}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">{text.choose}</option>
              {choices.map((value) => (
                <option key={value} value={value}>
                  {choiceLabel(value)}
                </option>
              ))}
            </NativeComboboxSelect>
          </LabeledField>
          {fieldError === "payer" ? (
            <p role="alert" className="text-xs text-destructive sm:col-span-2 lg:col-span-3">
              {text.notSaved}
            </p>
          ) : null}
        </div>
      </Section>
      {thirdParty ? (
        <>
          <Section title={text.payerBlockPerson}>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {organisation ? (
                // The organisation mask: an organisation has a name, a legal form, a register number
                // and a contact person; no date of birth and no citizenship.
                <>
                  <LabeledField {...field("payer_organisation_name", true, "sm:col-span-2")}>
                    <Input
                      {...fieldProps("payer_organisation_name")}
                      className={inputClass}
                      autoComplete="off"
                      maxLength={200}
                      value={draft.organisation_name}
                      onChange={(event) => set("organisation_name", event.target.value)}
                    />
                  </LabeledField>
                  {orgMask ? (
                    <>
                      <LabeledField {...field("payer_legal_form", true)}>
                        <Input
                          {...fieldProps("payer_legal_form")}
                          className={inputClass}
                          autoComplete="off"
                          maxLength={100}
                          value={draft.organisation_legal_form}
                          onChange={(event) => set("organisation_legal_form", event.target.value)}
                        />
                      </LabeledField>
                      <LabeledField {...field("payer_register_number")}>
                        <Input
                          {...fieldProps("payer_register_number")}
                          className={inputClass}
                          autoComplete="off"
                          maxLength={60}
                          value={draft.organisation_register_number}
                          onChange={(event) => set("organisation_register_number", event.target.value)}
                        />
                      </LabeledField>
                      <LabeledField {...field("payer_contact_name", true)}>
                        <Input
                          {...fieldProps("payer_contact_name")}
                          className={inputClass}
                          autoComplete="off"
                          maxLength={200}
                          value={draft.organisation_contact_name}
                          onChange={(event) => set("organisation_contact_name", event.target.value)}
                        />
                      </LabeledField>
                    </>
                  ) : null}
                  {/* Why the payment goes through the organisation (owner 2026-10-11), instead of a relationship. */}
                  {identification ? (
                    <PaymentReasonField identification={identification} text={text} />
                  ) : null}
                </>
              ) : (
                <>
                  <LabeledField {...field("payer_first_name", true)}>
                    <Input
                      {...fieldProps("payer_first_name")}
                      className={inputClass}
                      autoComplete="off"
                      value={draft.first_name}
                      onChange={(event) => set("first_name", event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField {...field("payer_last_name", true)}>
                    <Input
                      {...fieldProps("payer_last_name")}
                      className={inputClass}
                      autoComplete="off"
                      value={draft.last_name}
                      onChange={(event) => set("last_name", event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField {...field("payer_citizenships", true)}>
                    <CitizenshipMultiSelect
                      id="lead-request-payer_citizenships"
                      value={draft.citizenships}
                      lang={lang}
                      placeholder={text.citizenshipsPlaceholder}
                      invalid={Boolean(errorFor("payer_citizenships"))}
                      onChange={(next) => set("citizenships", next)}
                    />
                  </LabeledField>
                  <LabeledField {...field("payer_date_of_birth")}>
                    <Input
                      key={`payer_date_of_birth-${lang}`}
                      {...fieldProps("payer_date_of_birth")}
                      className={inputClass}
                      type="date"
                      autoComplete="off"
                      pickerLang={asLeadCabinetLang(lang) ?? undefined}
                      max={appDateKey()}
                      value={draft.date_of_birth}
                      onChange={(event) => set("date_of_birth", event.target.value)}
                    />
                  </LabeledField>
                  {!typed ? (
                    <LabeledField {...field("payer_relationship", false, "sm:col-span-2 lg:col-span-3")}>
                      <Input
                        {...fieldProps("payer_relationship")}
                        className={inputClass}
                        autoComplete="off"
                        value={draft.relationship}
                        onChange={(event) => set("relationship", event.target.value)}
                      />
                    </LabeledField>
                  ) : draft.guardian_pays ? null : (
                    <>
                      <LabeledField {...field("payer_relationship_kind", true)}>
                        <NativeComboboxSelect
                          {...fieldProps("payer_relationship_kind")}
                          className={selectClass}
                          value={draft.relationship_kind}
                          onChange={(event) => setDraft((current) => withRelationshipKind(current, event.target.value))}
                        >
                          <option value="">{text.choose}</option>
                          {RELATIONSHIP_KINDS.map((value) => (
                            <option key={value} value={value}>
                              {text.payerRelationshipOptions[value]}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </LabeledField>
                      {/* "Other" says in words what the list does not offer. */}
                      {draft.relationship_kind === "other" ? (
                        <LabeledField
                          id="lead-request-payer_relationship"
                          label={text.payerRelationshipOther}
                          error={errorFor("payer_relationship")}
                          required
                        >
                          <Input
                            {...fieldProps("payer_relationship")}
                            className={inputClass}
                            autoComplete="off"
                            value={draft.relationship}
                            onChange={(event) => set("relationship", event.target.value)}
                          />
                        </LabeledField>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
          </Section>
          <Section title={text.payerBlockContact}>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Contact (owner request 2026-10-07): e-mail and phone are required of a third person, the
                  messenger is not; an organisation needs one of the two. */}
              {organisation && orgMask ? (
                <p
                  id="lead-request-payer_email_or_phone-hint"
                  className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3"
                  data-testid="lead-request-payer-email-or-phone"
                >
                  {text.payerEmailOrPhone}
                  <RequiredMark />
                  {` – ${text.payerEmailOrPhoneHint}`}
                </p>
              ) : null}
              <LabeledField {...field("payer_email", !organisation && contactRequired("payer_email"))}>
                <Input
                  {...fieldProps("payer_email")}
                  className={inputClass}
                  type="email"
                  autoComplete="off"
                  value={draft.email}
                  onChange={(event) => set("email", event.target.value)}
                />
              </LabeledField>
              <LabeledField {...field("payer_phone", !organisation && contactRequired("payer_phone"))}>
                <Input
                  {...fieldProps("payer_phone")}
                  className={inputClass}
                  type="tel"
                  autoComplete="off"
                  value={draft.phone}
                  onChange={(event) => {
                    const phone = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      phone,
                      // "Same as phone" keeps the two numbers equal.
                      messenger: messengerSameAsPhone ? phone : current.messenger,
                    }));
                  }}
                />
              </LabeledField>
              {typed ? (
                <MessengerField
                  text={text}
                  label={payerFieldLabel(text, "payer_messenger", guardian, payerType)}
                  value={draft.messenger}
                  sameAsPhone={messengerSameAsPhone}
                  invalid={Boolean(errorFor("payer_messenger"))}
                  onSameAsPhone={(same) => {
                    setMessengerSameAsPhone(same);
                    if (same) setDraft((current) => ({ ...current, messenger: current.phone }));
                  }}
                  onChange={(messenger) => set("messenger", messenger)}
                />
              ) : null}
            </div>
          </Section>
          {/* A person lives somewhere, an organisation has its seat (QA 2026-10-10). */}
          <Section title={organisation ? text.payerSeat : text.payerResidence}>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* The country of the seat is what the screening of an organisation works with. */}
              <LabeledField {...field("payer_country", organisation || contactRequired("payer_country"))}>
                <CountrySelect
                  value={draft.country || null}
                  lang={lang}
                  className={selectClass}
                  aria-label={payerFieldLabel(text, "payer_country", guardian, payerType)}
                  onChange={(code) => set("country", code ?? "")}
                />
              </LabeledField>
              <LabeledField {...field("payer_city", !organisation && contactRequired("payer_city"))}>
                <Input
                  {...fieldProps("payer_city")}
                  className={inputClass}
                  autoComplete="off"
                  value={draft.city}
                  onChange={(event) => set("city", event.target.value)}
                />
              </LabeledField>
              <LabeledField {...field("payer_street")}>
                <Input
                  {...fieldProps("payer_street")}
                  className={inputClass}
                  autoComplete="off"
                  value={draft.street}
                  onChange={(event) => set("street", event.target.value)}
                />
              </LabeledField>
              <LabeledField {...field("payer_zip")}>
                <Input
                  {...fieldProps("payer_zip")}
                  className={inputClass}
                  autoComplete="off"
                  value={draft.zip}
                  onChange={(event) => set("zip", event.target.value)}
                />
              </LabeledField>
            </div>
          </Section>
          {consentAsked || costEstimateConsentAsked(request, draft.guardian_pays) ? (
            <Section title={text.payerBlockConsent}>
              <div className="space-y-3">
                {consentAsked ? (
                  <PayerContactConsent
                    text={text}
                    guardian={guardian}
                    checked={draft.contact_consent}
                    consentAt={consentAt}
                    error={errorFor("payer_contact_consent")}
                    onChange={(checked) => set("contact_consent", checked)}
                  />
                ) : null}
                {/* Below the contact consent, saved on its own: about the third party the server has stored. */}
                {costEstimateConsentAsked(request, draft.guardian_pays) ? <CostEstimateConsent {...costConsent} /> : null}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Why the payment goes through the organisation (owner spec 2026-10-11): the
 * reason of an organisation that pays, stored as the lead's statement
 * `payment_background` (what follow-up block B asks of a third party).
 */
export function PaymentReasonField({ identification, text }: { identification: IdentificationForm; text: LeadRequestText }) {
  const error = identification.errorFor("payment_background");
  return (
    <LabeledField
      id="lead-request-payment_background"
      label={text.recipient.paymentReason}
      error={error}
      required
      className="sm:col-span-2 lg:col-span-3"
    >
      <IdentificationTextArea form={identification} field="payment_background" maxLength={2000} rows={3} />
    </LabeledField>
  );
}

/** The payer's messenger / WhatsApp number with "same as phone" on the label's line. */
export function MessengerField({
  text,
  label,
  value,
  sameAsPhone,
  invalid,
  onSameAsPhone,
  onChange,
}: {
  text: LeadRequestText;
  label: string;
  value: string;
  sameAsPhone: boolean;
  invalid: boolean;
  onSameAsPhone: (same: boolean) => void;
  onChange: (value: string) => void;
}) {
  return (
    <LabeledField
      id="lead-request-payer_messenger"
      label={label}
      error={invalid ? text.invalidField : undefined}
      // "Same as phone" sits on the label's line, so the field is as tall as its neighbours.
      aside={
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={sameAsPhone}
            data-testid="lead-request-payer-messenger-same"
            onChange={(event) => onSameAsPhone(event.target.checked)}
          />
          {text.payerMessengerSameAsPhone}
        </label>
      }
    >
      <Input
        id="lead-request-payer_messenger"
        aria-invalid={invalid || undefined}
        className={inputClass}
        type="tel"
        autoComplete="off"
        maxLength={60}
        disabled={sameAsPhone}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </LabeledField>
  );
}

/** The consent that GMED contacts the payer and tells them the patient's name: part of the answer, needed to send. */
export function PayerContactConsent({
  text,
  guardian,
  checked,
  consentAt,
  error,
  onChange,
}: {
  text: LeadRequestText;
  guardian: boolean;
  checked: boolean;
  consentAt: string | null;
  error?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="lead-request-payer-consent">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          id="lead-request-payer_contact_consent"
          className={cn(checkboxClass, "mt-0.5")}
          checked={checked}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "lead-request-payer_contact_consent-error" : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="min-w-0 leading-snug">
          {payerFieldLabel(text, "payer_contact_consent", guardian)}
          <RequiredMark />
        </span>
      </label>
      {/* Indented to the text of the label: the checkbox and its gap. */}
      <div className="space-y-1 pl-7 text-xs text-muted-foreground">
        {checked && consentAt ? (
          <p>
            <ConsentGivenChip>{text.consentGivenAt(formatAppDateTime(consentAt))}</ConsentGivenChip>
          </p>
        ) : null}
      </div>
      {error ? (
        <p id="lead-request-payer_contact_consent-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The consent that GMED sends the third-party payer the cost estimate — the
 * types of services and the amounts, nothing medical (contract phase 3b,
 * 11.7). The lead's own word about the payer the server has stored: saved at
 * once on its own route, not with the answer "who pays", so it can still be
 * given or taken back once the payer answered and the block is read-only.
 */
export function CostEstimateConsent({
  request,
  text,
  enqueue,
  onChange,
  onSaveState,
  className,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
  className?: string;
}) {
  // The answer on its way: the box shows it until the server's comes back.
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const leadId = request.lead_id;
  const givenAt = request.payer?.cost_estimate_consent_at ?? null;
  const checked = pending ?? Boolean(givenAt);
  const id = "lead-request-payer_cost_estimate_consent";

  async function change(consent: boolean) {
    setPending(consent);
    setFailed(false);
    onSaveState("saving");
    try {
      onChange(await enqueue(() => saveLeadPayerCostEstimateConsent(leadId, consent)));
      onSaveState("saved");
    } catch (cause) {
      setFailed(true);
      onSaveState("error");
      // Nobody else pays any more (GMED changed the payer): the request is loaded afresh.
      if (errorBody(cause)?.code === NO_THIRD_PARTY_PAYER) {
        try {
          const fresh = (await fetchMyLeadRequests()).find((item) => item.lead_id === leadId);
          if (fresh) onChange(fresh);
        } catch {
          // The next load of the page shows the state.
        }
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className={cn("space-y-1.5 rounded-lg border border-border bg-muted/10 px-3 py-3", className)}
      data-testid="lead-request-payer-cost-estimate-consent"
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          id={id}
          className={cn(checkboxClass, "mt-0.5")}
          checked={checked}
          disabled={pending !== null}
          aria-invalid={failed || undefined}
          aria-describedby={failed ? `${id}-error` : undefined}
          onChange={(event) => void change(event.target.checked)}
        />
        <span className="min-w-0 leading-snug">
          {text.payerCostEstimateConsentLabel}
          <RequiredMark />
        </span>
      </label>
      {/* Indented to the text of the label: the checkbox and its gap. The consent stays
          required; its explanatory line went (QA 2026-10-10). */}
      {checked && givenAt ? (
        <div className="pl-7 text-xs text-muted-foreground">
          <ConsentGivenChip>{text.consentGivenAt(formatAppDateTime(givenAt))}</ConsentGivenChip>
        </div>
      ) : null}
      {failed ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {text.notSaved}
        </p>
      ) : null}
    </div>
  );
}
