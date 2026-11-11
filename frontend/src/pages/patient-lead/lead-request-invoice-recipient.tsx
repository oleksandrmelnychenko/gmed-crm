import { ContactRound, Wallet, ListPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

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

import { actsAsGuardian, staffForChild } from "./lead-request-access";
import { PAYER_REPLACEMENT_UNCONFIRMED, fetchMyLeadRequest, saveLeadInvoiceRecipient, type LeadRequest } from "./lead-request-api";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import type { IdentificationForm } from "./lead-request-identification";
import { useDateRefusal } from "./lead-request-date-refusal";
import {
  PAYER_BORN_AFTER_PATIENT,
  RELATIONSHIP_KINDS,
  costEstimateConsentAsked,
  draftFromPayer,
  nameCorrected,
  otherParentOf,
  payerAnswer,
  payerIdentityKey,
  unansweredPayerDraft,
  payerDraftFromRecipient,
  recipientPayerExtras,
  withPayerChoice,
  type PayerDraft,
  type RecipientPayerExtras,
  type RecipientPayerMemo,
  type SaveState,
} from "./lead-request-model";
import {
  CabinetSection as Section,
  CabinetHint,
  ConsentNeededNote,
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
  usePayerEdits,
  type PayerEdits,
} from "./lead-request-payer-section";
import {
  OTHER_PAYER_CHOICES,
  PAYER_PARTIES,
  RECIPIENT_ANSWERS,
  RECIPIENT_TYPES,
  draftFromRecipient,
  flowOf,
  payerFitsFlow,
  payerOnFileName,
  payerPartyOf,
  thirdPartyPayerOnFile,
  recipientFieldOf,
  recipientExpected,
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
import { actsAsVormund, asLeadCabinetLang, payerFieldLabel, recipientFieldLabel, recipientOptions, type LeadRequestText } from "./lead-request-text";

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
  // Staff on a minor's form answer as the parents do (owner 2026-10-30), but are none of them.
  const guardian = actsAsGuardian(request);
  const template = guardian ? (request.payer_self_template ?? null) : null;
  const answered = payerAnsweredByPayer(request);
  const onRecipientState = partState("recipient");
  const parents = guardian ? request.representation?.representatives.filter((person) => person.slot === "rep1" || person.slot === "rep2") ?? [] : [];
  // "Я (как родитель / законный представитель)" is the parent who is signed in (owner 2026-10-21):
  // that parent receives the invoice, nobody is asked which parent. Staff have no own parent: they
  // name the parent who receives it, as a login that is none of the parents does.
  const ownParent = parents.find((person) => person.mine) ?? null;
  // As stored: the signed-in parent is named by an answer, never by opening the step (QA 2026-10-31).
  const [draft, setDraft] = useState<RecipientDraft>(() => draftFromRecipient(request.billing));
  const invoiceParent = parents.find((person) => person.id === draft.representative_id);
  // Which parent: only for a login that is none of the parents, or a choice of the other parent made before.
  // Also when two parents are on file and none is named any more (the parent named before was removed, QA 2026-10-31 B-7).
  const parentNotNamed = draft.recipient === "self" && !invoiceParent && (parents.length > 1 || Boolean(draft.representative_id));
  const parentChoiceShown = guardian && flowOf(draft).recipient === "self" && parents.length > 0
    && (!ownParent || parentNotNamed || Boolean(draft.representative_id && draft.representative_id !== ownParent.id));
  const parentChoiceNeeded = !invoiceParent && (parents.length > 1 || Boolean(draft.representative_id));
  const savedRef = useRef<RecipientDraft>(draftFromRecipient(request.billing));
  const queuedDraftRef = useRef(savedRef.current);
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});
  // The code of each refusal, for the message at the field ("" when the server named none).
  const refusedCodesRef = useRef<Refused>({});
  const [refusedCodes, setRefusedCodes] = useState<Refused>({});
  // Someone changed the recipient after this tab read it (QA 2026-11-03, F2).
  const [changedMeanwhile, setChangedMeanwhile] = useState(false);
  // A third party on file as payer (named by the lead, entered by staff, or answered on the
  // payer's link or paper questionnaire) is replaced only after the person confirmed it (release
  // QA 2026-11-11, F2): choosing "me" ticked "I pay myself" and replaced it in one click.
  const parentPays =
    payerAnswer(request.payer, template) === "guardian" || request.billing?.payment_route_by === "guardian";
  const payerOnFile = answered ? null : thirdPartyPayerOnFile(request.payer, parentPays, request.representation?.representatives);
  const payerReplaceConfirmedRef = useRef(false);
  const [payerKept, setPayerKept] = useState(false);
  const confirmPayerReplacement = () =>
    window.confirm(text.recipient.payerReplaceConfirm(payerOnFileName(payerOnFile)));

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
            // The confirmation goes only with the answer "the recipient pays" it was given for.
            const replacing = payerReplaceConfirmedRef.current && (patch as Record<string, unknown>).invoice_recipient_is_payer === true;
            const next = await saveLeadInvoiceRecipient(request.lead_id, patch, recipientExpected(baseline), replacing);
            if (replacing) payerReplaceConfirmedRef.current = false;
            setPayerKept(false);
            const fresh = draftFromRecipient(next.billing);
            const written = Object.keys(patch).map(recipientFieldOf).filter((field): field is keyof RecipientDraft => field !== null);
            savedRef.current = fresh;
            queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, fresh, baseline, written, edited);
            setDraft((current) => mergeSavedDraft(current, snapshot, fresh, baseline, written, edited));
            onChange(next);
            setChangedMeanwhile(false);
            saved = true;
            break;
          } catch (cause) {
            const body = errorBody(cause);
            // Another parent or staff named another recipient after this tab read it: nothing is
            // written onto that person; the current answers are read again and shown.
            // "The recipient pays" would replace the third party on file, not confirmed (another
            // tab, or the payer was named meanwhile): nothing was written; the answers are read again.
            const payerRefused = cause instanceof ApiRequestError && cause.status === 409 && body?.code === PAYER_REPLACEMENT_UNCONFIRMED;
            if (payerRefused || (cause instanceof ApiRequestError && cause.status === 409 && body?.code === "recipient_changed")) {
              try {
                const current = await fetchMyLeadRequest(request.lead_id);
                const fresh = draftFromRecipient(current.billing);
                savedRef.current = fresh;
                queuedDraftRef.current = fresh;
                setDraft(fresh);
                onChange(current);
              } catch {
                // The notice still asks to check the answers.
              }
              for (const field of Object.keys(rejected)) delete rejected[field as keyof RecipientDraft];
              payerReplaceConfirmedRef.current = false;
              if (payerRefused) setPayerKept(true);
              else setChangedMeanwhile(true);
              failed = true;
              break;
            }
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
  const [partyChoice, setPartyChoice] = useState<PayerParty | null>(null);
  // "The patient pays" was confirmed in place of the third party on file.
  const [patientPaysConfirmed, setPatientPaysConfirmed] = useState(false);
  const storedParty =
    third && flow.isPayer === "no" && payerFitsFlow(flow, request.payer, draft, parentPays, request.representation?.representatives)
      ? payerPartyOf(request.payer, parentPays)
      : "";
  const party = partyChoice ?? storedParty;

  // What the person changes here may also name the payer: the changes of the server do not.
  const payerEditsRef = usePayerEdits();
  // What was entered about the recipient who pays outlives a correction of the recipient's name.
  const payerMemoRef = useRef<RecipientPayerMemo | null>(null);
  // "The patient pays" is the answer of the radio alone, whatever else is edited in the step.
  const partyEditsRef = usePayerEdits();
  const update = (change: (current: RecipientDraft) => RecipientDraft) => {
    payerEditsRef.current.made += 1;
    setDraft(change);
  };
  const set = (field: RecipientField, value: string) => update((current) => ({ ...current, [field]: value }));
  // The invoice — and with it who pays — moves from one parent to the other only after the
  // person read what that means and confirmed (owner decision 2026-11-10; QA finding 2: one
  // click took the role and dropped the other parent's payment method without a word). The
  // first naming of a parent asks nothing.
  const confirmParentChange = (next: RecipientDraft): boolean => {
    if (next.recipient !== "self" || !next.representative_id || savedRef.current.recipient !== "self") return true;
    const from = parents.find((person) => person.id === savedRef.current.representative_id);
    const to = parents.find((person) => person.id === next.representative_id);
    if (!from || !to || from.id === to.id) return true;
    const nameOf = (person: { first_name: string | null; last_name: string | null }) =>
      [person.first_name, person.last_name].filter(Boolean).join(" ");
    return window.confirm(text.recipient.parentChangeConfirm(nameOf(from), nameOf(to), flowOf(next).isPayer !== "no"));
  };
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
    label: field === "representative_id" && vormund ? text.recipient.parentQuestionVormund : recipientFieldLabel(text, field, guardian),
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
    // The patient side pays in place of the third party on file: only after the confirmation.
    // A third-party recipient who pays is confirmed in its own block (`RecipientPayer`).
    if (answer === "yes" && flow.recipient === "self" && payerOnFile) {
      if (!confirmPayerReplacement()) return;
      payerReplaceConfirmedRef.current = true;
    }
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
    && (!ownParent || parentNotNamed || Boolean(draft.representative_id && draft.representative_id !== ownParent.id));
  // A Vormund is no parent (QA 2026-10-31, B-4).
  const vormund = actsAsVormund(request);
  const options = recipientOptions(text, request, otherParentReceives);
  // "I pay (as a parent)" only for a minor's parent; an adult's representative reads "the patient",
  // staff on a minor's form "one of the parents" (owner 2026-10-30).
  const payerPartyOptions = staffForChild(request) ? text.recipient.payerPartyParents
    : guardian && request.minor ? text.recipient.payerPartyGuardian : text.recipient.payerParty;
  // "I pay myself" is the signed-in recipient's; a parent named by somebody else "also pays".
  const isPayerLabel = flow.recipient === "self"
    ? otherParentReceives ? (vormund ? text.recipient.isPayerVormund : text.recipient.isPayerOtherParent) : text.recipient.isPayerSelf
    : organisation ? text.recipient.isPayerOrganisation : text.recipient.isPayerThirdParty;
  // Unanswered after "Next": said at the question too, not only in the list at the top.
  const recipientMissing = useStepMissingError("lead-request-invoice_recipient");
  // The data a payer needs are required of the recipient who pays (owner request 2026-10-07): the
  // e-mail also of an organisation, which answers on its own link (QA 2026-10-11 A-35). The phone
  // is optional, as on the server (2026-10-24).
  const emailRequired = third && recipientPays;

  return (
    <>
      <Section icon={ContactRound} title={text.recipient.section}>
        <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2" data-testid="lead-request-invoice-recipient">
          {changedMeanwhile && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900 sm:col-span-2 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" data-testid="lead-request-recipient-changed">
              {text.recipient.changedMeanwhile}
            </p>
          )}
          {payerKept && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900 sm:col-span-2 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" data-testid="lead-request-payer-kept">
              {text.recipient.payerReplaceKept}
            </p>
          )}
          <div role="radiogroup" aria-labelledby="lead-request-invoice_recipient-label" className="space-y-1.5 sm:col-span-2">
            <p id="lead-request-invoice_recipient-label" className={cn(tokens.text.label, "block")}>
              {text.recipient.question}
              <RequiredMark />
            </p>
            <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              {RECIPIENT_ANSWERS.map((answer) => {
                const checked = draft.recipient === answer;
                return (
                  <label
                    key={answer}
                    className={cn("relative min-w-0 max-w-full", locked ? "cursor-default" : "cursor-pointer")}
                  >
                    <input
                      type="radio"
                      id={`lead-request-invoice_recipient-${answer}`}
                      name="lead-request-invoice_recipient"
                      value={answer}
                      // Named by the visible answer, never by the raw value (labels audit 2026-10-26, S1).
                      aria-label={options[answer]}
                      className="peer sr-only"
                      checked={checked}
                      disabled={locked}
                      onChange={() => {
                        // With a third party on file as payer the new recipient does not pay by default.
                        const keep = Boolean(payerOnFile);
                        if (!confirmParentChange(withOwnParent(withRecipientAnswer(draft, answer, keep), ownParent?.id))) return;
                        setPartyChoice(null);
                        if (identification && third && organisation && recipientPays) identification.set("payment_background", "");
                        update((current) => withOwnParent(withRecipientAnswer(current, answer, keep), ownParent?.id));
                      }}
                    />
                    <span className={cn(
                      "flex min-h-7 items-center rounded-md border px-2.5 py-1 text-xs leading-4 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30",
                      checked
                        ? "border-primary bg-primary font-semibold text-primary-foreground"
                        : "border-transparent bg-card text-muted-foreground peer-enabled:hover:border-border peer-enabled:hover:bg-muted/70 peer-enabled:hover:text-foreground",
                    )}>
                      {options[answer]}
                    </span>
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
            <LabeledField {...labeled("representative_id", parents.length > 1 || parentChoiceNeeded, "w-full max-w-xl")}>
              <NativeComboboxSelect
                {...control("representative_id")}
                className={selectClass}
                // A parent no longer on file is no answer: the question is open again (QA 2026-10-31, B-7).
                value={invoiceParent ? draft.representative_id : ""}
                disabled={locked}
                onChange={(event) => {
                  const chosen = event.target.value;
                  if (!confirmParentChange({ ...draft, representative_id: chosen, email: "" })) return;
                  update((current) => ({ ...current, representative_id: chosen, email: "" }));
                }}
              >
                <option value="">{text.choose}</option>
                {parents.map((person) => <option key={person.id} value={person.id}>{[person.first_name, person.last_name].filter(Boolean).join(" ")}</option>)}
              </NativeComboboxSelect>
            </LabeledField>
          ) : null}

          {third ? (
            <div className="space-y-2.5 sm:col-span-2" data-testid="lead-request-recipient-party">
              <LabeledField {...labeled("type", true, "w-full max-w-xl")}>
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
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
              className="w-full max-w-xl"
            >
              {textInput("email", 254, "email")}
              {errorFor("email") ? null : <EmailDomainWarning email={draft.email} lang={lang} />}
              <CabinetHint>{text.invoiceEmailHint}</CabinetHint>
            </LabeledField>
          ) : null}

          {flow.recipient ? (
            <div className="space-y-1.5 sm:col-span-2" data-testid="lead-request-recipient-is-payer">
              {/* A box, ticked as soon as a recipient is chosen (owner 2026-10-11). */}
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 text-sm leading-snug",
                  locked && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  {...control("is_payer")}
                  aria-label={isPayerLabel}
                  type="checkbox"
                  className={cn(checkboxClass, "mt-0.5")}
                  checked={draft.is_payer === "yes"}
                  disabled={locked}
                  onChange={(event) => answerIsPayer(event.target.checked ? "yes" : "no")}
                />
                {/* In the person's words, not "the invoice recipient is the payer" (labels audit 2026-10-26, B3). */}
                <span className="min-w-0">{isPayerLabel}</span>
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
              className="flex max-w-3xl flex-wrap gap-2 sm:col-span-2"
              data-testid="lead-request-payer-party"
            >
              {PAYER_PARTIES.map((value) => {
                const checked = party === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      "flex min-h-9 min-w-0 max-w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm leading-snug",
                      checked ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      id={`lead-request-payer_party-${value}`}
                      name="lead-request-payer_party"
                      value={value}
                      aria-label={payerPartyOptions[value]}
                      className={cn(checkboxClass, "mt-0.5 rounded-full")}
                      checked={checked}
                      onChange={() => {
                        // The patient pays in place of the third party on file: only after the confirmation.
                        if (value === "patient" && payerOnFile) {
                          if (!confirmPayerReplacement()) return;
                          setPatientPaysConfirmed(true);
                        }
                        partyEditsRef.current.made += 1;
                        setPartyChoice(value);
                      }}
                    />
                    <span className="min-w-0">
                      {payerPartyOptions[value]}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {/* The patient side as recipient: only another person or organisation can pay instead. */}
          {!answered && flow.recipient === "self" && flow.isPayer === "no" ? (
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2" data-testid="lead-request-payer-party-other">
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
          // Staff are none of the parents: the parent who does not receive the invoice is "the other".
          choices={request.access_kind === "guardian" && invoiceParent && !invoiceParent.mine
            ? ["guardian", ...OTHER_PAYER_CHOICES]
            : otherParentOf(request, draft.representative_id) && (third || invoiceParent)
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
          editsRef={partyEditsRef}
          replacementConfirmed={patientPaysConfirmed}
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
          memoRef={payerMemoRef}
          editsRef={payerEditsRef}
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
          editsRef={partyEditsRef}
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
  editsRef,
  parentSelected = false,
  replacementConfirmed = false,
  text,
  lang,
  identification,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  editsRef: PayerEdits;
  parentSelected?: boolean;
  /** The person confirmed that the patient side pays in place of the third party on file. */
  replacementConfirmed?: boolean;
  text: LeadRequestText;
  lang: string;
  identification?: IdentificationForm;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  // Staff on a minor's form: one of the parents pays, staff name which (owner 2026-10-30).
  if (staffForChild(request)) {
    return <ParentPayer request={request} text={text} enqueue={enqueue} onChange={onChange} onSaveState={onSaveState} />;
  }
  // The signed-in parent's own data ("I pay (as a parent)") belong to a parent's login only.
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
  return <OwnPayer request={request} editsRef={editsRef} parentSelected={parentSelected} text={text} replacementConfirmed={replacementConfirmed} enqueue={enqueue} onChange={onChange} onSaveState={onSaveState} />;
}

/**
 * The patient side as recipient who pays: the patient himself, or — a
 * parent's login with the own data on file — the paying parent. Saved at
 * once; nothing more is asked here (the paying parent answers the payer's
 * questions below).
 */
function OwnPayer({
  request,
  editsRef,
  parentSelected = false,
  text,
  replacementConfirmed = false,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  editsRef: PayerEdits;
  parentSelected?: boolean;
  text: LeadRequestText;
  replacementConfirmed?: boolean;
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
  usePayerAutosave({ request, draft, editsRef, enqueue, onChange, onSaveState, text, replacementConfirmed });
  return null;
}

/**
 * Staff on a minor's form (owner 2026-10-30): a parent of the child pays and
 * staff name which one — staff are none of the parents, so there is no
 * "I pay (as a parent)". The parent is named by id, never as a third party
 * (owner decision 2026-10-19).
 */
function ParentPayer({
  request,
  text,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const parents = request.representation?.representatives.filter((person) => person.slot === "rep1" || person.slot === "rep2") ?? [];
  const [draft, setDraft] = useState<PayerDraft>(() =>
    request.payer?.payer_kind === "representative" ? draftFromPayer(request.payer) : unansweredPayerDraft(request.payer));
  const editsRef = usePayerEdits();
  usePayerAutosave({ request, draft, editsRef, enqueue, onChange, onSaveState, text });
  const chosen = draft.payer_kind === "third_party" && parents.some((person) => person.id === draft.representative_id)
    ? draft.representative_id ?? ""
    : "";
  return (
    <Section icon={Wallet} title={text.recipient.payerSection}>
      <div data-testid="lead-request-parent-payer">
        <LabeledField
          id="lead-request-payer_kind"
          label={text.recipient.parentPayerQuestion}
          required
          className="w-full max-w-xl"
        >
          <NativeComboboxSelect
            id="lead-request-payer_kind"
            className={selectClass}
            value={chosen}
            onChange={(event) => {
              const parent = parents.find((person) => person.id === event.target.value) ?? null;
              editsRef.current.made += 1;
              setDraft(parent ? withPayerChoice(unansweredPayerDraft(request.payer), "other_parent", null, parent) : unansweredPayerDraft(request.payer));
            }}
          >
            <option value="">{text.choose}</option>
            {parents.map((person) => <option key={person.id} value={person.id}>{[person.first_name, person.last_name].filter(Boolean).join(" ")}</option>)}
          </NativeComboboxSelect>
        </LabeledField>
      </div>
    </Section>
  );
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
  memoRef,
  editsRef,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  recipient: RecipientDraft;
  /** What was entered about the payer, kept across a correction of the recipient's name. */
  memoRef: MutableRefObject<RecipientPayerMemo | null>;
  /** The person's changes of the recipient: this payer is built from a copy that may be older. */
  editsRef: PayerEdits;
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
  // This block starts anew with every change of the recipient's name. A corrected name (a typo) is
  // the same person: what was entered about the payer stays, only the consents — they belong to the
  // person named — are asked again, and the block says so (QA 2026-11-10, finding 11).
  const organisation = recipient.type === "organisation";
  const recipientName = organisation ? recipient.organisation_name : [recipient.first_name, recipient.last_name].join(" ");
  const [kept] = useState<RecipientPayerMemo | null>(() => {
    const memo = memoRef.current;
    return !fits && memo && memo.organisation === organisation && nameCorrected(memo.name, recipientName) ? memo : null;
  });
  const [extras, setExtras] = useState<RecipientPayerExtras>(() => kept
    ? { ...kept.extras, citizenships: [...kept.extras.citizenships], contact_consent: false }
    : recipientPayerExtras(fits ? request.payer : null));
  const [consentAskedAgain, setConsentAskedAgain] = useState(
    () => Boolean(kept && (kept.consentAskedAgain || kept.extras.contact_consent || request.payer?.cost_estimate_consent_at)),
  );
  const editedHere = useRef(false);
  useEffect(() => {
    // The entries belong to the name they were stored or made for.
    if (fits || editedHere.current) memoRef.current = { name: recipientName, organisation, extras, consentAskedAgain };
  });
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
  const { fieldError, fieldErrorCode } = usePayerAutosave({ request, draft, editsRef, enqueue, onChange, onSaveState, enabled: !replacementPending && (fits || readyToReplace), text, replacementConfirmed });
  const payerType = organisation ? "organisation" : "person";
  const errorFor = (field: string) => (fieldError === field
    ? field === "payer_date_of_birth" && fieldErrorCode === PAYER_BORN_AFTER_PATIENT ? text.payerBornAfterPatient : text.invalidField
    : undefined);
  // A date of birth the field did not take says what is wrong (QA 2026-11-10, finding 4).
  const payerBirth = useDateRefusal(lang, extras.date_of_birth, { min: "1900-01-01", max: appDateKey() });
  const set = <K extends keyof RecipientPayerExtras>(field: K, value: RecipientPayerExtras[K]) => {
    editsRef.current.made += 1;
    editedHere.current = true;
    // Another date of birth is another person to the consents: said at the boxes, not done silently.
    const birthChanged = field === "date_of_birth" && value !== extras.date_of_birth;
    if (birthChanged && (extras.contact_consent || (sameIdentity && request.payer?.cost_estimate_consent_at))) setConsentAskedAgain(true);
    else if (field === "contact_consent" && value === true) setConsentAskedAgain(false);
    setExtras((current) => ({ ...current, [field]: value, ...(field === "date_of_birth" && value !== current.date_of_birth ? { contact_consent: false } : {}) }));
  };

  return (
    <Section icon={ListPlus} title={text.recipient.payerExtrasBlock}>
      <div className="space-y-3" data-testid="lead-request-recipient-payer">
        {replacementPending ? <div className="space-y-3" data-testid="lead-request-payer-replacement">
          {/* A corrected name keeps what was entered; another payer replaces it. */}
          <StatusChip tone="warning" className="items-start whitespace-normal">{kept ? text.payerRenamedHint : text.recipient.replacePayerHint}</StatusChip>
          <Button type="button" disabled={!readyToReplace} onClick={() => {
            // Says who pays now and what goes with the change (release QA 2026-11-11, F2).
            if (request.payer?.payer_kind === "third_party"
              && !window.confirm(text.recipient.payerReplaceConfirm(payerOnFileName(request.payer)))) return;
            editsRef.current.made += 1;
            setReplacementConfirmed(true);
          }}>{text.recipient.confirmPayerChange}</Button>
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
                error={payerBirth.message ?? errorFor("payer_date_of_birth")}
              >
                {payerBirth.wrap(<Input
                  key={`payer_date_of_birth-${lang}`}
                  id="lead-request-payer_date_of_birth"
                  className={inputClass}
                  type="date"
                  autoComplete="off"
                  pickerLang={asLeadCabinetLang(lang) ?? undefined}
                  min="1900-01-01"
                  max={appDateKey()}
                  onPickerValidation={payerBirth.onPickerValidation}
                  aria-invalid={Boolean(errorFor("payer_date_of_birth")) || undefined}
                  value={extras.date_of_birth}
                  onChange={(event) => set("date_of_birth", event.target.value)}
                />)}
              </LabeledField>
              <MessengerField
                text={text}
                label={payerFieldLabel(text, "payer_messenger", guardian, payerType)}
                value={messengerSameAsPhone ? recipient.phone : extras.messenger}
                sameAsPhone={messengerSameAsPhone}
                invalid={Boolean(errorFor("payer_messenger"))}
                onSameAsPhone={(same) => {
                  editsRef.current.made += 1;
                  setMessengerSameAsPhone(same);
                  if (!same) set("messenger", recipient.phone);
                }}
                onChange={(messenger) => set("messenger", messenger)}
              />
            </>
          )}
        </div>
        {consentAskedAgain ? <ConsentNeededNote>{text.payerConsentAskedAgain}</ConsentNeededNote> : null}
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
          <CostEstimateConsent request={request} text={text} lang={lang} enqueue={enqueue} onChange={onChange} onSaveState={onSaveState} />
        ) : null}
        {fieldError === "payer" ? (
          <p role="alert" className="text-xs text-destructive">
            {fieldErrorCode === PAYER_REPLACEMENT_UNCONFIRMED ? text.recipient.payerReplaceKept : text.notSaved}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
