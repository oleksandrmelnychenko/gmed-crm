import { useCallback, useMemo, useRef, useState } from "react";

import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import {
  checkboxClass,
  inputClass,
  selectClass,
  textareaClass,
  tokens,
} from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import { saveLeadInvoiceRecipient, type LeadRequest } from "./lead-request-api";
import type { IdentificationForm } from "./lead-request-identification";
import {
  RELATIONSHIP_KINDS,
  costEstimateConsentAsked,
  draftFromPayer,
  payerAnswer,
  payerDraftFromRecipient,
  recipientPayerExtras,
  withPayerChoice,
  type PayerDraft,
  type RecipientPayerExtras,
  type SaveState,
} from "./lead-request-model";
import {
  CabinetSection as Section,
  LabeledField,
  RequiredMark,
  YesNoSelect,
  errorBody,
  useAutosave,
  type RequestQueue,
} from "./lead-request-parts";
import {
  CostEstimateConsent,
  MessengerField,
  PayerContactConsent,
  PayerSection,
  PaymentReasonField,
  usePayerAutosave,
} from "./lead-request-payer-section";
import {
  RECIPIENT_ANSWERS,
  RECIPIENT_TYPES,
  draftFromRecipient,
  flowOf,
  payerChoices,
  payerFitsFlow,
  recipientFieldOf,
  recipientPatch,
  recipientValue,
  withRecipientAnswer,
  withRecipientRelationship,
  withRecipientType,
  type RecipientDraft,
  type RecipientField,
} from "./lead-request-recipient-model";
import { payerAnsweredByPayer } from "./lead-request-summary";
import { asLeadCabinetLang, payerFieldLabel, recipientFieldLabel, type LeadRequestText } from "./lead-request-text";

type Refused = Partial<Record<keyof RecipientDraft, string>>;

/**
 * Step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the invoice
 * recipient first and "who pays" with it.
 *
 * 1. "Кто является получателем счёта?" — me, or a third party or an
 *    organisation; a third party is a person or an organisation with its
 *    data (a person: name, address, contact, relationship to the patient;
 *    an organisation: name, legal form, seat, contact person, why the
 *    payment goes through it).
 * 2. "Получатель счёта является плательщиком?" — "yes": the patient (or the
 *    paying parent) pays, or the third-party recipient is the payer with a
 *    few more of its data and the consents; "no": "who pays" and the payer's
 *    data (`PayerSection`).
 *
 * The recipient saves on the billing route on its own; the payer stays the
 * payer declaration (`POST …/payer`), which the risk triggers, the payer link
 * and the documents read.
 */
export function InvoiceRecipientSection({
  request,
  text,
  lang,
  identification,
  enqueue,
  onChange,
  partState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  /** The GwG statements (the reason an organisation pays); absent on an older server. */
  identification?: IdentificationForm;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  /** The save state of a part of the step. */
  partState: (part: string) => (state: SaveState) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const template = guardian ? (request.payer_self_template ?? null) : null;
  const answered = payerAnsweredByPayer(request);
  const onRecipientState = partState("recipient");
  const [draft, setDraft] = useState<RecipientDraft>(() => draftFromRecipient(request.billing));
  const savedRef = useRef<RecipientDraft>(draftFromRecipient(request.billing));
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});

  const save = useCallback(
    (snapshot: RecipientDraft) => {
      void enqueue(async () => {
        const patch = recipientPatch(savedRef.current, snapshot, refusedRef.current);
        if (Object.keys(patch).length === 0) return;
        onRecipientState("saving");
        try {
          const next = await saveLeadInvoiceRecipient(request.lead_id, patch);
          savedRef.current = draftFromRecipient(next.billing);
          refusedRef.current = {};
          setRefused({});
          onRecipientState("saved");
          onChange(next);
        } catch (cause) {
          const key = errorBody(cause)?.field;
          const field = typeof key === "string" ? recipientFieldOf(key) : null;
          // The refused value is not sent again until it is changed.
          if (field) {
            refusedRef.current = { ...refusedRef.current, [field]: recipientValue(field, snapshot) };
            setRefused(refusedRef.current);
          }
          onRecipientState("error");
        }
      });
    },
    [enqueue, onChange, onRecipientState, request.lead_id],
  );
  useAutosave(draft, save);

  const flow = flowOf(draft);
  const third = flow.recipient === "third_party";
  const organisation = draft.type === "organisation";
  const recipientPays = flow.isPayer === "yes";
  // Once the payer answered on the own link, only GMED changes who pays: the answers that decide it stay.
  const locked = answered;
  const lockedParty = answered && third && recipientPays;

  const update = (change: (current: RecipientDraft) => RecipientDraft) => setDraft(change);
  const set = (field: RecipientField, value: string) => update((current) => ({ ...current, [field]: value }));
  const errorFor = (field: keyof RecipientDraft) =>
    refused[field] !== undefined && refused[field] === recipientValue(field, draft) ? text.invalidField : undefined;
  const control = (field: keyof RecipientDraft) => ({
    id: `lead-request-recipient_${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-recipient_${field}-error` : undefined,
  });
  const labeled = (field: keyof RecipientDraft, required = false, className?: string) => ({
    id: `lead-request-recipient_${field}`,
    label: recipientFieldLabel(text, field),
    error: errorFor(field),
    required,
    className,
  });
  const textInput = (field: RecipientField, maxLength: number, type: "text" | "email" | "tel" = "text") => (
    <Input
      {...control(field)}
      className={inputClass}
      type={type}
      autoComplete="off"
      maxLength={maxLength}
      disabled={lockedParty}
      value={draft[field]}
      onChange={(event) => set(field, event.target.value)}
    />
  );

  /** "Is the recipient the payer?": an organisation's reason moves with it (the payer's is `payment_background`). */
  const answerIsPayer = (answer: string) => {
    if (answer === draft.is_payer) return;
    if (third && organisation && identification) {
      if (answer === "yes") {
        if (draft.payment_reason.trim() && !identification.draft.payment_background.trim()) {
          identification.set("payment_background", draft.payment_reason);
        }
        update((current) => ({ ...current, is_payer: answer, payment_reason: "" }));
        return;
      }
      if (draft.is_payer === "yes") {
        const reason = identification.draft.payment_background;
        identification.set("payment_background", "");
        update((current) => ({ ...current, is_payer: answer, payment_reason: current.payment_reason || reason }));
        return;
      }
    }
    update((current) => ({ ...current, is_payer: answer }));
  };

  const options = guardian ? text.recipient.optionsGuardian : text.recipient.options;
  // The data a payer needs are required of the recipient who pays (owner request 2026-10-07).
  const contactRequired = third && recipientPays && !organisation;

  return (
    <>
      <Section title={text.recipient.section}>
        <div className="space-y-4" data-testid="lead-request-invoice-recipient">
          <div role="radiogroup" aria-labelledby="lead-request-invoice_recipient-label" className="space-y-1.5">
            <p id="lead-request-invoice_recipient-label" className={cn(tokens.text.label, "block")}>
              {text.recipient.question}
              <RequiredMark />
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {RECIPIENT_ANSWERS.map((answer) => {
                const checked = draft.recipient === answer;
                return (
                  <label
                    key={answer}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug sm:flex-1",
                      checked ? "border-[var(--brand)] bg-muted/40" : "border-border",
                      locked && "cursor-not-allowed opacity-70",
                    )}
                  >
                    <input
                      type="radio"
                      id={`lead-request-invoice_recipient-${answer}`}
                      name="lead-request-invoice_recipient"
                      value={answer}
                      className={cn(checkboxClass, "mt-0.5 rounded-full")}
                      checked={checked}
                      disabled={locked}
                      onChange={() => update((current) => withRecipientAnswer(current, answer))}
                    />
                    <span className="min-w-0">{options[answer]}</span>
                  </label>
                );
              })}
            </div>
            {errorFor("recipient") ? (
              <p role="alert" className="text-xs text-destructive">
                {errorFor("recipient")}
              </p>
            ) : null}
          </div>

          {third ? (
            <div className="space-y-3" data-testid="lead-request-recipient-party">
              <LabeledField {...labeled("type", true, "sm:max-w-[calc(50%-0.5rem)]")}>
                <NativeComboboxSelect
                  {...control("type")}
                  className={selectClass}
                  value={draft.type}
                  disabled={lockedParty}
                  onChange={(event) => update((current) => withRecipientType(current, event.target.value))}
                >
                  <option value="">{text.choose}</option>
                  {RECIPIENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {text.recipient.typeOptions[type]}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </LabeledField>
              {draft.type ? (
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {organisation ? (
                    <>
                      <LabeledField {...labeled("organisation_name", true, "sm:col-span-2")}>
                        {textInput("organisation_name", 200)}
                      </LabeledField>
                      <LabeledField {...labeled("legal_form", recipientPays)}>{textInput("legal_form", 100)}</LabeledField>
                      <LabeledField {...labeled("contact_name", recipientPays)}>{textInput("contact_name", 200)}</LabeledField>
                    </>
                  ) : (
                    <>
                      <LabeledField {...labeled("first_name", true)}>{textInput("first_name", 100)}</LabeledField>
                      <LabeledField {...labeled("last_name", true)}>{textInput("last_name", 100)}</LabeledField>
                      <LabeledField {...labeled("relationship_kind", true)}>
                        <NativeComboboxSelect
                          {...control("relationship_kind")}
                          className={selectClass}
                          value={draft.relationship_kind}
                          disabled={lockedParty}
                          onChange={(event) => update((current) => withRecipientRelationship(current, event.target.value))}
                        >
                          <option value="">{text.choose}</option>
                          {RELATIONSHIP_KINDS.map((value) => (
                            <option key={value} value={value}>
                              {text.payerRelationshipOptions[value]}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </LabeledField>
                      {draft.relationship_kind === "other" ? (
                        <LabeledField
                          id="lead-request-recipient_relationship"
                          label={text.payerRelationshipOther}
                          error={errorFor("relationship")}
                          required
                        >
                          {textInput("relationship", 200)}
                        </LabeledField>
                      ) : null}
                    </>
                  )}
                  <LabeledField {...labeled("street", true, "sm:col-span-2 lg:col-span-3")}>{textInput("street", 200)}</LabeledField>
                  <LabeledField {...labeled("zip", true)}>{textInput("zip", 20)}</LabeledField>
                  <LabeledField {...labeled("city", true)}>{textInput("city", 200)}</LabeledField>
                  <LabeledField {...labeled("country", true)}>
                    <CountrySelect
                      value={draft.country || null}
                      lang={lang}
                      className={selectClass}
                      aria-label={recipientFieldLabel(text, "country")}
                      onChange={(code) => set("country", code ?? "")}
                    />
                  </LabeledField>
                  <LabeledField {...labeled("email", contactRequired)}>{textInput("email", 254, "email")}</LabeledField>
                  <LabeledField {...labeled("phone", contactRequired)}>{textInput("phone", 40, "tel")}</LabeledField>
                  {organisation ? (
                    // An organisation that pays states the reason as the payer's (`payment_background`).
                    recipientPays && identification ? (
                      <PaymentReasonField identification={identification} text={text} />
                    ) : (
                      <LabeledField {...labeled("payment_reason", true, "sm:col-span-2 lg:col-span-3")}>
                        <textarea
                          {...control("payment_reason")}
                          className={cn(textareaClass, "text-base md:text-sm")}
                          rows={3}
                          maxLength={2000}
                          autoComplete="off"
                          disabled={lockedParty}
                          value={draft.payment_reason}
                          onChange={(event) => set("payment_reason", event.target.value)}
                        />
                      </LabeledField>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {flow.recipient === "self" ? (
            <LabeledField
              id="lead-request-recipient_email"
              label={text.billingFields.invoice_email}
              error={errorFor("email")}
              className="sm:max-w-[calc(50%-0.5rem)]"
            >
              {textInput("email", 254, "email")}
              <p className="text-xs leading-5 text-muted-foreground">{text.invoiceEmailHint}</p>
            </LabeledField>
          ) : null}

          {flow.recipient ? (
            <LabeledField {...labeled("is_payer", true)} question>
              <YesNoSelect
                id="lead-request-recipient_is_payer"
                className="sm:max-w-[calc(50%-0.5rem)]"
                value={draft.is_payer}
                text={text}
                invalid={Boolean(errorFor("is_payer"))}
                onChange={(answer) => {
                  if (!locked) answerIsPayer(answer);
                }}
              />
            </LabeledField>
          ) : null}
        </div>
      </Section>

      {/* The payer answered on the own link: who pays is read-only. */}
      {answered ? (
        <PayerSection
          request={request}
          text={text}
          lang={lang}
          identification={identification}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
        />
      ) : flow.isPayer === "no" ? (
        <PayerSection
          // Another flow: the payer form starts anew with what fits it.
          key={`payer-${flow.recipient}`}
          request={request}
          text={text}
          lang={lang}
          identification={identification}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
          choices={payerChoices(flow, request, template)}
          flow={flow}
          recipient={draft}
        />
      ) : flow.isPayer === "yes" && third ? (
        <RecipientPayer
          request={request}
          text={text}
          lang={lang}
          recipient={draft}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
        />
      ) : flow.isPayer === "yes" && flow.recipient === "self" ? (
        guardian && !template ? (
          // A parent's login without own data on file names the parent who pays.
          <PayerSection
            key="payer-parent"
            request={request}
            text={text}
            lang={lang}
            identification={identification}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={partState("payer")}
            choices={["person"]}
          />
        ) : (
          <OwnPayer
            key="payer-own"
            request={request}
            enqueue={enqueue}
            onChange={onChange}
            onSaveState={partState("payer")}
          />
        )
      ) : null}
    </>
  );
}

/**
 * The patient side as recipient who pays: the patient himself, or — a
 * parent's login with the own data on file — the paying parent. Saved at
 * once; nothing more is asked here (the paying parent answers the payer's
 * questions below).
 */
function OwnPayer({
  request,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const template = guardian ? (request.payer_self_template ?? null) : null;
  const [draft] = useState<PayerDraft>(() =>
    withPayerChoice(draftFromPayer(request.payer, template), guardian && template ? "guardian" : "self", template),
  );
  usePayerAutosave({ request, draft, enqueue, onChange, onSaveState });
  return null;
}

/**
 * The third-party recipient who pays: the payer is the recipient, with what
 * GMED needs of a payer besides (a person's citizenships and birth date, the
 * messenger, an organisation's register number) and the consents to contact
 * the payer and to pass the cost estimate on. The payer's answer is built
 * from the recipient and saved whenever either changes.
 */
function RecipientPayer({
  request,
  text,
  lang,
  recipient,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  recipient: RecipientDraft;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const template = guardian ? (request.payer_self_template ?? null) : null;
  // What the stored payer says of the recipient who pays; nothing of another payer.
  const fits = payerFitsFlow(
    { recipient: "third_party", isPayer: "yes" },
    request.payer,
    recipient,
    payerAnswer(request.payer, template) === "guardian",
  );
  const [base] = useState<PayerDraft>(() => draftFromPayer(request.payer));
  const [extras, setExtras] = useState<RecipientPayerExtras>(() => recipientPayerExtras(fits ? request.payer : null));
  const [messengerSameAsPhone, setMessengerSameAsPhone] = useState(
    () => Boolean(extras.messenger) && extras.messenger === recipient.phone,
  );
  const draft = useMemo(
    () =>
      payerDraftFromRecipient(base, recipient, {
        ...extras,
        // "Same as phone" keeps the two numbers equal.
        messenger: messengerSameAsPhone ? recipient.phone : extras.messenger,
      }),
    [base, extras, messengerSameAsPhone, recipient],
  );
  const { fieldError } = usePayerAutosave({ request, draft, enqueue, onChange, onSaveState });
  const organisation = recipient.type === "organisation";
  const payerType = organisation ? "organisation" : "person";
  const errorFor = (field: string) => (fieldError === field ? text.invalidField : undefined);
  const set = <K extends keyof RecipientPayerExtras>(field: K, value: RecipientPayerExtras[K]) =>
    setExtras((current) => ({ ...current, [field]: value }));

  return (
    <Section title={text.recipient.payerExtrasBlock}>
      <div className="space-y-3" data-testid="lead-request-recipient-payer">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {organisation ? (
            <LabeledField
              id="lead-request-payer_register_number"
              label={payerFieldLabel(text, "payer_register_number", guardian, payerType)}
              error={errorFor("payer_register_number")}
            >
              <Input
                id="lead-request-payer_register_number"
                className={inputClass}
                autoComplete="off"
                maxLength={60}
                value={extras.register_number}
                onChange={(event) => set("register_number", event.target.value)}
              />
            </LabeledField>
          ) : (
            <>
              <LabeledField
                id="lead-request-payer_citizenships"
                label={payerFieldLabel(text, "payer_citizenships", guardian, payerType)}
                error={errorFor("payer_citizenships")}
                required
              >
                <CitizenshipMultiSelect
                  id="lead-request-payer_citizenships"
                  value={extras.citizenships}
                  lang={lang}
                  placeholder={text.citizenshipsPlaceholder}
                  invalid={Boolean(errorFor("payer_citizenships"))}
                  onChange={(next) => set("citizenships", next)}
                />
              </LabeledField>
              <LabeledField
                id="lead-request-payer_date_of_birth"
                label={payerFieldLabel(text, "payer_date_of_birth", guardian, payerType)}
                error={errorFor("payer_date_of_birth")}
              >
                <Input
                  key={`payer_date_of_birth-${lang}`}
                  id="lead-request-payer_date_of_birth"
                  className={inputClass}
                  type="date"
                  autoComplete="off"
                  pickerLang={asLeadCabinetLang(lang) ?? undefined}
                  max={appDateKey()}
                  value={extras.date_of_birth}
                  onChange={(event) => set("date_of_birth", event.target.value)}
                />
              </LabeledField>
              <MessengerField
                text={text}
                label={payerFieldLabel(text, "payer_messenger", guardian, payerType)}
                value={messengerSameAsPhone ? recipient.phone : extras.messenger}
                sameAsPhone={messengerSameAsPhone}
                invalid={Boolean(errorFor("payer_messenger"))}
                onSameAsPhone={(same) => {
                  setMessengerSameAsPhone(same);
                  if (!same) set("messenger", recipient.phone);
                }}
                onChange={(messenger) => set("messenger", messenger)}
              />
            </>
          )}
        </div>
        <PayerContactConsent
          text={text}
          guardian={guardian}
          checked={extras.contact_consent}
          consentAt={request.payer?.contact_consent_at ?? null}
          error={errorFor("payer_contact_consent")}
          onChange={(checked) => set("contact_consent", checked)}
        />
        {/* Saved on its own, about the third party the server has stored. */}
        {costEstimateConsentAsked(request, false) ? (
          <CostEstimateConsent request={request} text={text} enqueue={enqueue} onChange={onChange} onSaveState={onSaveState} />
        ) : null}
        {fieldError === "payer" ? (
          <p role="alert" className="text-xs text-destructive">
            {text.notSaved}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
