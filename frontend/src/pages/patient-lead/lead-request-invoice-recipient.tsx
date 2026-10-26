import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
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
import { ApiRequestError } from "@/lib/api";
import { EmailDomainWarning, emailDomainWarningText } from "@/components/email-domain-warning";
import { isValidEmailAddress } from "@/lib/contact-validation";
import { isKnownNoMailEmail } from "@/lib/email-domain-check";
import { cn } from "@/lib/utils";

import { saveLeadInvoiceRecipient, type LeadRequest } from "./lead-request-api";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import type { IdentificationForm } from "./lead-request-identification";
import {
  RELATIONSHIP_KINDS,
  costEstimateConsentAsked,
  draftFromPayer,
  otherParentOf,
  payerAnswer,
  payerIdentityKey,
  unansweredPayerDraft,
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
  useStepMissingError,
  errorBody,
  useAutosave,
  runDraftSave,
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
  OTHER_PAYER_CHOICES,
  PAYER_PARTIES,
  RECIPIENT_ANSWERS,
  RECIPIENT_TYPES,
  draftFromRecipient,
  flowOf,
  payerFitsFlow,
  payerPartyOf,
  recipientFieldOf,
  recipientPatch,
  recipientPayerReady,
  recipientValue,
  withOwnParent,
  withRecipientAnswer,
  withRecipientRelationship,
  withRecipientType,
  type PayerParty,
  type RecipientDraft,
  type RecipientField,
} from "./lead-request-recipient-model";
import { useServerDraftSync } from "./lead-request-server-sync";
import { payerAnsweredByPayer } from "./lead-request-summary";
import { PERSON_CITY_MAX } from "@/lib/person-fields";
import { asLeadCabinetLang, payerFieldLabel, recipientFieldLabel, recipientOptions, type LeadRequestText } from "./lead-request-text";

type Refused = Partial<Record<keyof RecipientDraft, string>>;

/** The server's refusal of an address whose domain accepts no mail (`email_address::EMAIL_DOMAIN_NO_MAIL`). */
const EMAIL_DOMAIN_NO_MAIL = "email_domain_no_mail";

/**
 * Step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the invoice
 * recipient first and "who pays" with it.
 *
 * 1. "Кто является получателем счёта?" — me, or a third party or an
 *    organisation; a third party is a person or an organisation with its
 *    data (a person: name, address, contact, relationship to the patient;
 *    an organisation: name, legal form, seat, contact person, why the
 *    payment goes through it).
 * 2. The box "Получатель счёта является плательщиком", ticked by default
 *    (owner 2026-10-11): the patient (or the paying parent) pays, or the
 *    third-party recipient is the payer with a few more of its data and the
 *    consents. Unticked, a third-party recipient: "Плательщиком счёта
 *    является пациент" (a parent's login: "…являюсь я (как родитель)") or
 *    "…другое лицо или организация" with the payer's data (`PayerSection`);
 *    the patient side as recipient: only the latter, shown at once.
 *
 * The recipient saves on the billing route on its own; the payer stays the
 * payer declaration (`POST …/payer`), which the risk triggers, the payer link
 * and the documents read. "The recipient pays" names the payer on the server
 * with the recipient's answer (owner decision 2026-10-23); the cabinet sends
 * `…/payer` only for a payer other than the recipient and for a paying third
 * party's further data.
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
  const parents = guardian ? request.representation?.representatives.filter((person) => person.slot === "rep1" || person.slot === "rep2") ?? [] : [];
  // "Я (как родитель / законный представитель)" is the parent who is signed in (owner 2026-10-21):
  // that parent receives the invoice, nobody is asked which parent.
  const ownParent = parents.find((person) => person.mine) ?? null;
  const [draft, setDraft] = useState<RecipientDraft>(() => withOwnParent(draftFromRecipient(request.billing), ownParent?.id));
  const invoiceParent = parents.find((person) => person.id === draft.representative_id);
  // Which parent: only for a login that is none of the parents, or a choice of the other parent made before.
  const parentChoiceShown = guardian && flowOf(draft).recipient === "self" && parents.length > 0
    && (!ownParent || Boolean(draft.representative_id && draft.representative_id !== ownParent.id));
  const parentChoiceNeeded = !invoiceParent && (parents.length > 1 || Boolean(draft.representative_id));
  const savedRef = useRef<RecipientDraft>(draftFromRecipient(request.billing));
  const queuedDraftRef = useRef(savedRef.current);
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});
  // The code of each refusal, for the message at the field ("" when the server named none).
  const refusedCodesRef = useRef<Refused>({});
  const [refusedCodes, setRefusedCodes] = useState<Refused>({});

  const save = useCallback(
    (snapshot: RecipientDraft) => {
      const fields = queuedDraftFields(recipientPatch(savedRef.current, snapshot), recipientPatch(queuedDraftRef.current, snapshot));
      const edited = new Set(Array.from(fields).map(recipientFieldOf).filter((field): field is keyof RecipientDraft => field !== null));
      queuedDraftRef.current = snapshot;
      return runDraftSave(enqueue, fields, async () => {
        const hadRefusal = Object.keys(refusedRef.current).length > 0;
        const rejected = Object.fromEntries(Object.entries(refusedRef.current).filter(
          ([field, value]) => recipientValue(field as keyof RecipientDraft, snapshot) === value,
        )) as Refused;
        const codes: Refused = Object.fromEntries(Object.keys(rejected).map((field) => [field, refusedCodesRef.current[field as keyof RecipientDraft] ?? ""]));
        let saved = false;
        let failed = false;
        // A refused value stays visible while the other changed fields save.
        for (;;) {
          const patch = scopedDraftPatch(recipientPatch(savedRef.current, snapshot, rejected), fields);
          if (Object.keys(patch).length === 0) break;
          // An address the server would refuse is set aside here, like a refusal of the server.
          const typedEmail = (patch as Record<string, unknown>).recipient_email;
          // So is one whose domain is known to receive no mail.
          if (typeof typedEmail === "string" && typedEmail.trim() && (!isValidEmailAddress(typedEmail) || isKnownNoMailEmail(typedEmail)) && rejected.email === undefined) {
            rejected.email = recipientValue("email", snapshot);
            codes.email = isKnownNoMailEmail(typedEmail) ? EMAIL_DOMAIN_NO_MAIL : "email_invalid";
            continue;
          }
          onRecipientState("saving");
          try {
            const baseline = savedRef.current;
            const next = await saveLeadInvoiceRecipient(request.lead_id, patch);
            const fresh = draftFromRecipient(next.billing);
            const written = Object.keys(patch).map(recipientFieldOf).filter((field): field is keyof RecipientDraft => field !== null);
            savedRef.current = fresh;
            queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, fresh, baseline, written, edited);
            setDraft((current) => mergeSavedDraft(current, snapshot, fresh, baseline, written, edited));
            onChange(next);
            saved = true;
            break;
          } catch (cause) {
            const body = errorBody(cause);
            const key = body?.field;
            const field = typeof key === "string" ? recipientFieldOf(key) : null;
            if (cause instanceof ApiRequestError && cause.status === 422 && field && typeof key === "string" && key in patch && rejected[field] === undefined) {
              rejected[field] = recipientValue(field, snapshot);
              // Tolerant: a refusal without a code reads as "invalid".
              codes[field] = typeof body?.code === "string" ? body.code : "";
              continue;
            }
            failed = true;
            break;
          }
        }
        refusedRef.current = rejected;
        refusedCodesRef.current = codes;
        setRefused(rejected);
        setRefusedCodes(codes);
        if (failed || Object.keys(rejected).length > 0) onRecipientState("error");
        else if (saved || hadRefusal) onRecipientState("saved");
        return !failed && Object.keys(rejected).length === 0;
      });
    },
    [enqueue, onChange, onRecipientState, request.lead_id],
  );
  useAutosave(draft, save);
  // The other parent saved the recipient meanwhile (the request was re-read): the untouched
  // fields follow, a field being typed in keeps its value and says so at the field.
  useServerDraftSync({
    incoming: draftFromRecipient(request.billing),
    draft,
    savedRef,
    queuedDraftRef,
    setDraft,
    idOf: (field) => `lead-request-recipient_${field}`,
  });

  const flow = flowOf(draft);
  const third = flow.recipient === "third_party";
  const organisation = draft.type === "organisation";
  const recipientPays = flow.isPayer === "yes";
  // Once the payer answered on the own link, only GMED changes who pays: the answers that decide it stay.
  const locked = answered;
  const lockedParty = answered && third && recipientPays;
  // Who pays when a third-party recipient does not: the answer chosen here, else what the stored payer says.
  const parentPays =
    payerAnswer(request.payer, template) === "guardian" || request.billing?.payment_route_by === "guardian";
  const [partyChoice, setPartyChoice] = useState<PayerParty | null>(null);
  const storedParty =
    third && flow.isPayer === "no" && payerFitsFlow(flow, request.payer, draft, parentPays, request.representation?.representatives)
      ? payerPartyOf(request.payer, parentPays)
      : "";
  const party = partyChoice ?? storedParty;

  const update = (change: (current: RecipientDraft) => RecipientDraft) => setDraft(change);
  const set = (field: RecipientField, value: string) => update((current) => ({ ...current, [field]: value }));
  const errorFor = (field: keyof RecipientDraft) => {
    if (refused[field] === undefined || refused[field] !== recipientValue(field, draft)) return undefined;
    if (field !== "email") return text.invalidField;
    // "The domain … accepts no mail" when the server (or the known list) says so (QA 2026-10-24, B-3).
    return refusedCodes.email === EMAIL_DOMAIN_NO_MAIL || isKnownNoMailEmail(draft.email)
      ? emailDomainWarningText(draft.email, lang)
      : text.invalidEmail;
  };
  const control = (field: keyof RecipientDraft) => ({
    id: `lead-request-recipient_${field}`,
    "aria-invalid": Boolean(errorFor(field)) || undefined,
    "aria-describedby": errorFor(field) ? `lead-request-recipient_${field}-error` : undefined,
  });
  const labeled = (field: keyof RecipientDraft, required = false, className?: string) => ({
    id: `lead-request-recipient_${field}`,
    label: recipientFieldLabel(text, field, guardian),
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

  /** "The recipient is also the payer": an organisation's reason moves with it (the payer's is `payment_background`). */
  const answerIsPayer = (answer: string) => {
    if (answer === draft.is_payer) return;
    setPartyChoice(null);
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

  // "I (as a parent)" only for the parent who receives the invoice (QA 2026-10-24): the other
  // parent, or a login that is none of the parents, reads "one of the parents" with the name below.
  const otherParentReceives = guardian && parents.length > 0
    && (!ownParent || Boolean(draft.representative_id && draft.representative_id !== ownParent.id));
  const options = recipientOptions(text, request, otherParentReceives);
  // Unanswered after "Next": said at the question too, not only in the list at the top.
  const recipientMissing = useStepMissingError("lead-request-invoice_recipient");
  // The data a payer needs are required of the recipient who pays (owner request 2026-10-07): the
  // e-mail also of an organisation, which answers on its own link (QA 2026-10-11 A-35). The phone
  // is optional, as on the server (2026-10-24).
  const emailRequired = third && recipientPays;

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
                      // Named by the visible answer, never by the raw value (labels audit 2026-10-26, S1).
                      aria-label={options[answer]}
                      className={cn(checkboxClass, "mt-0.5 rounded-full")}
                      checked={checked}
                      disabled={locked}
                      onChange={() => {
                        setPartyChoice(null);
                        if (identification && third && organisation && recipientPays) identification.set("payment_background", "");
                        update((current) => withOwnParent(withRecipientAnswer(current, answer), ownParent?.id));
                      }}
                    />
                    <span className="min-w-0">{options[answer]}</span>
                  </label>
                );
              })}
            </div>
            {errorFor("recipient") || (!draft.recipient && recipientMissing) ? (
              <p role="alert" className="text-xs text-destructive">
                {errorFor("recipient") || recipientMissing}
              </p>
            ) : null}
          </div>

          {parentChoiceShown ? (
            <LabeledField {...labeled("representative_id", parents.length > 1 || parentChoiceNeeded)}>
              <NativeComboboxSelect
                {...control("representative_id")}
                className={selectClass}
                value={draft.representative_id}
                disabled={locked}
                onChange={(event) => update((current) => ({ ...current, representative_id: event.target.value, email: "" }))}
              >
                <option value="">{text.choose}</option>
                {parents.map((person) => <option key={person.id} value={person.id}>{[person.first_name, person.last_name].filter(Boolean).join(" ")}</option>)}
              </NativeComboboxSelect>
            </LabeledField>
          ) : null}

          {third ? (
            <div className="space-y-3" data-testid="lead-request-recipient-party">
              <LabeledField {...labeled("type", true, "sm:max-w-[calc(50%-0.5rem)]")}>
                <NativeComboboxSelect
                  {...control("type")}
                  className={selectClass}
                  value={draft.type}
                  disabled={lockedParty}
                  onChange={(event) => {
                    if (identification && organisation && event.target.value !== "organisation" && recipientPays) identification.set("payment_background", "");
                    update((current) => withRecipientType(current, event.target.value));
                  }}
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
                          label={guardian ? text.payerRelationshipOther : text.payerRelationshipOtherToYou}
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
                  <LabeledField {...labeled("city", true)}>{textInput("city", PERSON_CITY_MAX)}</LabeledField>
                  <LabeledField {...labeled("country", true)}>
                    <CountrySelect
                      value={draft.country || null}
                      lang={lang}
                      disabled={lockedParty}
                      className={selectClass}
                      aria-label={recipientFieldLabel(text, "country")}
                      onChange={(code) => set("country", code ?? "")}
                    />
                  </LabeledField>
                  <LabeledField {...labeled("email", emailRequired)}>
                    {textInput("email", 254, "email")}
                    {errorFor("email") ? null : <EmailDomainWarning email={draft.email} lang={lang} />}
                  </LabeledField>
                  <LabeledField {...labeled("phone")}>{textInput("phone", 40, "tel")}</LabeledField>
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
              {errorFor("email") ? null : <EmailDomainWarning email={draft.email} lang={lang} />}
              <p className="text-xs leading-5 text-muted-foreground">{text.invoiceEmailHint}</p>
            </LabeledField>
          ) : null}

          {flow.recipient ? (
            <div className="space-y-1.5" data-testid="lead-request-recipient-is-payer">
              {/* A box, ticked as soon as a recipient is chosen (owner 2026-10-11). */}
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 text-sm leading-snug",
                  locked && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  {...control("is_payer")}
                  aria-label={flow.recipient === "self" ? text.recipient.isPayerSelf : text.recipient.isPayerThirdParty}
                  type="checkbox"
                  className={cn(checkboxClass, "mt-0.5")}
                  checked={draft.is_payer === "yes"}
                  disabled={locked}
                  onChange={(event) => answerIsPayer(event.target.checked ? "yes" : "no")}
                />
                {/* In the person's words, not "the invoice recipient is the payer" (labels audit 2026-10-26, B3). */}
                <span className="min-w-0">{flow.recipient === "self" ? text.recipient.isPayerSelf : text.recipient.isPayerThirdParty}</span>
              </label>
              {errorFor("is_payer") ? (
                <p id="lead-request-recipient_is_payer-error" role="alert" className="text-xs text-destructive">
                  {errorFor("is_payer")}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Unticked: who pays. A third-party recipient leaves the patient or another party. */}
          {!answered && third && flow.isPayer === "no" ? (
            <div
              role="radiogroup"
              aria-label={text.recipient.payerQuestion}
              className="flex flex-col gap-2"
              data-testid="lead-request-payer-party"
            >
              {PAYER_PARTIES.map((value) => {
                const checked = party === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug",
                      checked ? "border-[var(--brand)] bg-muted/40" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      id={`lead-request-payer_party-${value}`}
                      name="lead-request-payer_party"
                      value={value}
                      aria-label={(guardian && request.minor ? text.recipient.payerPartyGuardian : text.recipient.payerParty)[value]}
                      className={cn(checkboxClass, "mt-0.5 rounded-full")}
                      checked={checked}
                      onChange={() => setPartyChoice(value)}
                    />
                    <span className="min-w-0">
                      {/* "I pay (as a parent)" only for a minor's parent; an adult's representative reads "the patient". */}
                      {(guardian && request.minor ? text.recipient.payerPartyGuardian : text.recipient.payerParty)[value]}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {/* The patient side as recipient: only another person or organisation can pay instead. */}
          {!answered && flow.recipient === "self" && flow.isPayer === "no" ? (
            <p className="text-sm leading-snug" data-testid="lead-request-payer-party-other">
              {text.recipient.payerParty.other}
            </p>
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
      ) : flow.isPayer === "no" && (flow.recipient === "self" || party === "other") ? (
        <PayerSection
          // Another flow: the payer form starts anew with what fits it.
          key={`payer-other-${flow.recipient}-${draft.representative_id}`}
          request={request}
          text={text}
          lang={lang}
          identification={identification}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
          // A parent of the minor never pays as a third party (owner decision 2026-10-19): the signed-in
          // parent is "I (as a parent)", the other parent of joint custody has an answer of its own.
          choices={guardian && invoiceParent && !invoiceParent.mine
            ? ["guardian", ...OTHER_PAYER_CHOICES]
            : otherParentOf(request) && (third || invoiceParent?.mine)
              ? ["other_parent", ...OTHER_PAYER_CHOICES]
              : OTHER_PAYER_CHOICES}
          flow={flow}
          recipient={draft}
          question={text.recipient.payerTypeQuestion}
        />
      ) : flow.isPayer === "no" && third && party === "patient" ? (
        <PatientSidePayer
          key="payer-patient"
          request={request}
          text={text}
          lang={lang}
          identification={identification}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
        />
      ) : flow.isPayer === "yes" && third && !draft.type ? null : flow.isPayer === "yes" && third ? (
        // Ticked by default: the recipient is named as payer once it is a person or an organisation.
        <RecipientPayer
          key={JSON.stringify([draft.type, draft.first_name, draft.last_name, draft.organisation_name])}
          request={request}
          text={text}
          lang={lang}
          recipient={draft}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
        />
      ) : flow.isPayer === "yes" && flow.recipient === "self" && !parentChoiceNeeded && guardian && !invoiceParent
        && request.payer?.payer_kind === "self" ? (
        // A parent's login with "the patient pays" stored before: the parent names who pays.
        <PatientSidePayer
          key="payer-own"
          request={request}
          text={text}
          lang={lang}
          identification={identification}
          enqueue={enqueue}
          onChange={onChange}
          onSaveState={partState("payer")}
        />
      ) : null}
      {/* Otherwise the patient side receives and pays: the server names the payer with
          the recipient's answer (the adult patient, or the parent chosen as recipient;
          owner decision 2026-10-23), nothing more is asked here. */}
    </>
  );
}

/**
 * The patient side pays: the patient himself, or — a parent's login — the
 * parent: with the own data on file at once, otherwise the parent names
 * himself as a person.
 */
function PatientSidePayer({
  request,
  parentSelected = false,
  text,
  lang,
  identification,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  parentSelected?: boolean;
  text: LeadRequestText;
  lang: string;
  identification?: IdentificationForm;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const template = guardian ? (request.payer_self_template ?? null) : null;
  if (guardian && (!template || (request.payer?.payer_kind === "self" && !parentSelected))) {
    // A parent's login without own data on file names the parent who pays.
    return (
      <PayerSection
        request={request}
        text={text}
        lang={lang}
        identification={identification}
        enqueue={enqueue}
        onChange={onChange}
        onSaveState={onSaveState}
        choices={template ? ["guardian"] : ["person"]}
      />
    );
  }
  return <OwnPayer request={request} parentSelected={parentSelected} enqueue={enqueue} onChange={onChange} onSaveState={onSaveState} />;
}

/**
 * The patient side as recipient who pays: the patient himself, or — a
 * parent's login with the own data on file — the paying parent. Saved at
 * once; nothing more is asked here (the paying parent answers the payer's
 * questions below).
 */
function OwnPayer({
  request,
  parentSelected = false,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  parentSelected?: boolean;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const template = guardian ? (request.payer_self_template ?? null) : null;
  const [draft] = useState<PayerDraft>(() => {
    const sameParent = payerAnswer(request.payer, template) === "guardian"
      && request.payer?.email?.trim().toLowerCase() === template?.email?.trim().toLowerCase();
    const payer = parentSelected && !sameParent ? null : request.payer;
    return withPayerChoice(draftFromPayer(payer, template), guardian && template ? "guardian" : "self", template);
  });
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
    request.representation?.representatives,
  );
  const [base] = useState<PayerDraft>(() => fits ? draftFromPayer(request.payer) : unansweredPayerDraft(request.payer));
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const [extras, setExtras] = useState<RecipientPayerExtras>(() => recipientPayerExtras(fits ? request.payer : null));
  // The payer's extras as the server last had them: the other parent's newer values are taken
  // over where nothing is typed; the recipient's own data come through the recipient's sync.
  const savedExtrasRef = useRef<RecipientPayerExtras>(recipientPayerExtras(fits ? request.payer : null));
  const queuedExtrasRef = useRef(savedExtrasRef.current);
  useServerDraftSync({
    incoming: recipientPayerExtras(fits ? request.payer : null),
    draft: extras,
    savedRef: savedExtrasRef,
    queuedDraftRef: queuedExtrasRef,
    setDraft: setExtras,
    idOf: (field) => `lead-request-payer_${field}`,
    enabled: fits,
  });
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
  // Only a named payer saved before is replaced after a confirmation: the own "I pay" is no
  // previous payer to warn about (labels audit 2026-10-26, B4).
  const replacementPending = Boolean(request.payer) && request.payer?.payer_kind !== "self" && !fits && !replacementConfirmed;
  const readyToReplace = recipientPayerReady(recipient);
  const sameIdentity = fits && payerIdentityKey(draftFromPayer(request.payer)) === payerIdentityKey(draft);
  const { fieldError } = usePayerAutosave({ request, draft, enqueue, onChange, onSaveState, enabled: !replacementPending && (fits || readyToReplace) });
  const organisation = recipient.type === "organisation";
  const payerType = organisation ? "organisation" : "person";
  const errorFor = (field: string) => (fieldError === field ? text.invalidField : undefined);
  const set = <K extends keyof RecipientPayerExtras>(field: K, value: RecipientPayerExtras[K]) =>
    setExtras((current) => ({ ...current, [field]: value, ...(field === "date_of_birth" && value !== current.date_of_birth ? { contact_consent: false } : {}) }));

  return (
    <Section title={text.recipient.payerExtrasBlock}>
      <div className="space-y-3" data-testid="lead-request-recipient-payer">
        {replacementPending ? <div className="space-y-3" data-testid="lead-request-payer-replacement">
          <StatusChip tone="warning">{text.recipient.replacePayerHint}</StatusChip>
          <Button type="button" disabled={!readyToReplace} onClick={() => setReplacementConfirmed(true)}>{text.recipient.confirmPayerChange}</Button>
        </div> : null}
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
          consentAt={sameIdentity ? request.payer?.contact_consent_at ?? null : null}
          error={errorFor("payer_contact_consent")}
          onChange={(checked) => set("contact_consent", checked)}
        />
        {/* Saved on its own, about the third party the server has stored. */}
        {sameIdentity && costEstimateConsentAsked(request, false) ? (
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
